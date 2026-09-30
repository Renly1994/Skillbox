import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { resolveWatchDirectories } from "../src/main/watch-directories"
import { migrateSkillStorage } from "../src/main/skill-storage-migration"

test("文件监听只创建通用目录，不创建尚不存在的 Agent 目录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-watch-"))
  const canonicalDir = path.join(root, ".agents", "skills")
  const existingAgentDir = path.join(root, ".claude", "skills")
  const missingAgentDir = path.join(root, ".copilot", "skills")

  try {
    await fs.mkdir(existingAgentDir, { recursive: true })
    await fs.mkdir(path.dirname(missingAgentDir), { recursive: true })

    const directories = await resolveWatchDirectories(
      canonicalDir,
      [existingAgentDir, missingAgentDir],
    )

    assert.ok(directories.includes(await fs.realpath(canonicalDir)))
    assert.ok(directories.includes(await fs.realpath(existingAgentDir)))
    await assert.rejects(fs.stat(missingAgentDir))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("更换通用存储位置后监听新实体目录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-watch-migration-"))
  const canonicalDir = path.join(root, ".agents", "skills")
  const firstStorage = path.join(root, "disk-d", "Skillbox Skills")
  const secondStorage = path.join(root, "disk-e", "Skillbox Skills")

  try {
    await fs.mkdir(path.join(canonicalDir, "demo"), { recursive: true })
    await fs.writeFile(path.join(canonicalDir, "demo", "SKILL.md"), "# Demo")
    await migrateSkillStorage(canonicalDir, firstStorage)
    assert.ok((await resolveWatchDirectories(canonicalDir, [])).includes(await fs.realpath(firstStorage)))

    await migrateSkillStorage(canonicalDir, secondStorage, { removePreviousTarget: true })
    assert.ok((await resolveWatchDirectories(canonicalDir, [])).includes(await fs.realpath(secondStorage)))
    await assert.rejects(fs.stat(firstStorage), { code: "ENOENT" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
