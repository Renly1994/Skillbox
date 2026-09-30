import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  remapPathKeyedRecords,
  remapSkillStoragePath,
  remapSkillStoragePathFromRoots,
  remapSkillStoragePathList,
} from "../src/main/skill-storage-records"

test("存储路径映射覆盖根目录及嵌套路径，并保留目录外路径", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")

  assert.equal(remapSkillStoragePath(previous, previous, next), next)
  assert.equal(
    remapSkillStoragePath(path.join(previous, "group", "demo"), previous, next),
    path.join(next, "group", "demo"),
  )
  assert.equal(
    remapSkillStoragePath(path.join(os.tmpdir(), "old-skills-backup", "demo"), previous, next),
    path.join(os.tmpdir(), "old-skills-backup", "demo"),
  )
})

test("别名与来源路径键迁移时优先保留目标路径已有记录", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const oldIdentity = path.join(previous, "demo")
  const newIdentity = path.join(next, "demo")

  assert.deepEqual(
    remapPathKeyedRecords({ [oldIdentity]: "旧别名" }, previous, next),
    { [newIdentity]: "旧别名" },
  )
  assert.deepEqual(
    remapPathKeyedRecords(
      { [oldIdentity]: "旧来源", [newIdentity]: "当前来源" },
      previous,
      next,
    ),
    { [newIdentity]: "当前来源" },
  )
})

test("集合路径迁移后去除同一 Skill 的重复路径", () => {
  const previous = path.join(os.tmpdir(), "old-skills")
  const next = path.join(os.tmpdir(), "new-skills")
  const oldIdentity = path.join(previous, "demo")
  const newIdentity = path.join(next, "demo")

  assert.deepEqual(
    remapSkillStoragePathList([oldIdentity, newIdentity], previous, next),
    [newIdentity],
  )
})

test("重复换盘时仍迁移最初保存在兼容入口下的记录", () => {
  const compatibilityRoot = path.join(os.tmpdir(), "compatibility-skills")
  const firstStorage = path.join(os.tmpdir(), "disk-d", "Skillbox Skills")
  const nextStorage = path.join(os.tmpdir(), "disk-e", "Skillbox Skills")
  const oldIdentity = path.join(compatibilityRoot, "demo")

  assert.equal(
    remapSkillStoragePathFromRoots(oldIdentity, [firstStorage, compatibilityRoot], nextStorage),
    path.join(nextStorage, "demo"),
  )

  let aliases = { [oldIdentity]: "保留的旧别名" }
  for (const previousRoot of [firstStorage, compatibilityRoot]) {
    aliases = remapPathKeyedRecords(aliases, previousRoot, nextStorage)
  }
  assert.deepEqual(aliases, { [path.join(nextStorage, "demo")]: "保留的旧别名" })
})
