import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { resolveSkillTimestamps } from "../src/main/skill-timestamps"

test("把目录首次出现时间和内容最后修改时间分开", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-timestamps-"))
  const skillDir = path.join(root, "demo-skill")
  const nestedDir = path.join(skillDir, "references")

  try {
    await fs.mkdir(nestedDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Demo\n")
    await fs.writeFile(path.join(nestedDir, "guide.md"), "guide\n")
    await fs.utimes(path.join(skillDir, "SKILL.md"), new Date("2026-01-02"), new Date("2026-01-02"))
    await fs.utimes(path.join(nestedDir, "guide.md"), new Date("2026-02-03"), new Date("2026-02-03"))

    const timestamps = await resolveSkillTimestamps(skillDir, {
      installedAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2026-01-10T00:00:00.000Z",
    })

    assert.equal(timestamps.installedAt, "2025-12-01T00:00:00.000Z")
    assert.equal(timestamps.updatedAt, "2026-02-03T00:00:00.000Z")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("没有安装记录的外部 Skill 也能生成可排序时间", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-timestamps-"))
  const skillDir = path.join(root, "external-skill")

  try {
    await fs.mkdir(skillDir)
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# External\n")

    const timestamps = await resolveSkillTimestamps(skillDir)

    assert.ok(Number.isFinite(Date.parse(timestamps.installedAt!)))
    assert.ok(Number.isFinite(Date.parse(timestamps.updatedAt!)))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
