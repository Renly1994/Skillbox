import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { getScopeForPath } from "../src/data/use-installed-skills"

test("迁移后的通用 Skill 实体路径仍归类为 global", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-tui-scope-"))
  const canonical = path.join(root, ".agents", "skills")
  const destination = path.join(root, "disk-d", "Skillbox Skills")
  const physicalSkillPath = path.join(destination, "demo")

  try {
    await fs.mkdir(physicalSkillPath, { recursive: true })
    await fs.writeFile(path.join(physicalSkillPath, "SKILL.md"), "# Demo")
    await fs.mkdir(path.dirname(canonical), { recursive: true })
    await fs.symlink(destination, canonical, process.platform === "win32" ? "junction" : "dir")

    assert.equal(
      getScopeForPath(
        await fs.realpath(path.join(canonical, "demo")),
        [await fs.realpath(canonical)],
      ),
      "global",
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
