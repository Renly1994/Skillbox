import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { planPathIdentityRemap } from "../src/main/skill-storage-records"

test("迁移翻译偏好身份时更新旧路径", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const identity = path.join(previous, "group", "demo")

  assert.deepEqual(planPathIdentityRemap([identity], previous, next), {
    updates: [{
      identity,
      nextIdentity: path.join(next, "group", "demo"),
    }],
    removals: [],
  })
})

test("翻译偏好目标身份冲突时保留目标路径记录", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const oldIdentity = path.join(previous, "demo")
  const newIdentity = path.join(next, "demo")

  assert.deepEqual(planPathIdentityRemap([oldIdentity, newIdentity], previous, next), {
    updates: [],
    removals: [oldIdentity],
  })
})
