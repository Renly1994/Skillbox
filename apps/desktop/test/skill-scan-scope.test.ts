import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { getScannedSkillScope } from "../src/main/skill-scan-scope"

test("Agent 全局目录迁移后，增量扫描仍识别为全局 Skill", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-scope-"))
  const physicalHome = path.join(root, "relocated-home")
  const agentHome = path.join(root, "user", ".codex")
  const skillName = "demo"

  try {
    await fs.mkdir(path.join(physicalHome, "skills", skillName), { recursive: true })
    await fs.mkdir(path.dirname(agentHome), { recursive: true })
    await fs.symlink(physicalHome, agentHome, process.platform === "win32" ? "junction" : "dir")

    const agentSkillsDir = path.join(agentHome, "skills")
    const skillPath = path.join(agentSkillsDir, skillName)
    const canonicalPath = await fs.realpath(skillPath)
    assert.notEqual(canonicalPath, skillPath)
    assert.equal(
      getScannedSkillScope({ path: skillPath, canonicalPath }, [agentSkillsDir]),
      "global",
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
