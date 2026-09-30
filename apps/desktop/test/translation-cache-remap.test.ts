import assert from "node:assert/strict"
import type Database from "better-sqlite3"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { TranslationCacheStore } from "../src/main/db/translation-cache"

function createStore(initialIdentities: string[]) {
  const identities = [...initialIdentities]
  const db = {
    prepare(query: string) {
      if (query.startsWith("SELECT identity")) {
        return { all: () => identities.map((identity) => ({ identity })) }
      }
      return {
        run(...values: string[]) {
          if (query.startsWith("DELETE")) {
            const index = identities.indexOf(values[0])
            if (index >= 0) identities.splice(index, 1)
          } else if (query.startsWith("UPDATE")) {
            const index = identities.indexOf(values[1])
            if (index >= 0) identities[index] = values[0]
          }
        },
      }
    },
    transaction(callback: () => void) {
      return () => callback()
    },
  } as unknown as Database.Database
  return { store: new TranslationCacheStore(db), identities }
}

test("翻译偏好存储按实体路径更新身份", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const oldIdentity = path.join(previous, "demo")
  const { store, identities } = createStore([oldIdentity])

  store.remapPreferenceIdentities(previous, next)

  assert.deepEqual(identities, [path.join(next, "demo")])
})

test("翻译偏好身份冲突时删除旧身份并保留目标身份", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const newIdentity = path.join(next, "demo")
  const { store, identities } = createStore([path.join(previous, "demo"), newIdentity])

  store.remapPreferenceIdentities(previous, next)

  assert.deepEqual(identities, [newIdentity])
})
