import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { findSkillDirectories } from "../src/main/skill-directory-scanner"
import { migrateSkillStorage } from "../src/main/skill-storage-migration"

test("迁移通用 Skill 后，原入口和新位置指向同一份文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-"))
  const canonical = path.join(root, ".agents", "skills")
  const agentSkill = path.join(root, ".codex", "skills", "demo")
  const first = path.join(root, "disk-d", "Skillbox Skills")
  const second = path.join(root, "disk-e", "Skillbox Skills")
  const marketplaceSource = path.join(root, "market-source", "market-skill")
  const importStaging = path.join(root, "import-staging", "imported-skill")
  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    const skillContent = "---\nname: demo\ndescription: 迁移识别测试\n---\n\n# Demo\n"
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), skillContent)
    await fs.mkdir(path.dirname(agentSkill), { recursive: true })
    await fs.symlink(path.join(canonical, "demo"), agentSkill, process.platform === "win32" ? "junction" : "dir")
    await migrateSkillStorage(canonical, first)
    assert.equal(await fs.realpath(canonical), await fs.realpath(first))
    assert.equal(await fs.realpath(agentSkill), await fs.realpath(path.join(first, "demo")))
    assert.deepEqual(
      (await findSkillDirectories(canonical)).map((skill) => skill.canonicalPath),
      [await fs.realpath(path.join(first, "demo"))],
    )
    assert.deepEqual(
      (await findSkillDirectories(path.dirname(agentSkill))).map((skill) => skill.canonicalPath),
      [await fs.realpath(path.join(first, "demo"))],
    )
    assert.equal(await fs.readFile(path.join(agentSkill, "SKILL.md"), "utf-8"), skillContent)
    await fs.mkdir(path.join(canonical, "new-skill"))
    await fs.writeFile(path.join(canonical, "new-skill", "SKILL.md"), "第二版")
    await fs.mkdir(marketplaceSource, { recursive: true })
    await fs.writeFile(path.join(marketplaceSource, "SKILL.md"), "市场安装")
    await fs.cp(marketplaceSource, path.join(canonical, "market-skill"), { recursive: true })
    await fs.mkdir(importStaging, { recursive: true })
    await fs.writeFile(path.join(importStaging, "SKILL.md"), "迁移包导入")
    await fs.rename(importStaging, path.join(await fs.realpath(canonical), "imported-skill"))
    assert.equal(await fs.readFile(path.join(first, "new-skill", "SKILL.md"), "utf-8"), "第二版")
    assert.deepEqual(
      (await findSkillDirectories(canonical)).map((skill) => skill.canonicalPath).sort(),
      [
        await fs.realpath(path.join(first, "demo")),
        await fs.realpath(path.join(first, "imported-skill")),
        await fs.realpath(path.join(first, "market-skill")),
        await fs.realpath(path.join(first, "new-skill")),
      ].sort(),
    )

    await migrateSkillStorage(canonical, second, { removePreviousTarget: true })
    assert.equal(await fs.realpath(canonical), await fs.realpath(second))
    assert.equal(await fs.realpath(agentSkill), await fs.realpath(path.join(second, "demo")))
    assert.equal(await fs.readFile(path.join(second, "demo", "SKILL.md"), "utf-8"), skillContent)
    assert.equal(await fs.readFile(path.join(second, "market-skill", "SKILL.md"), "utf-8"), "市场安装")
    assert.equal(await fs.readFile(path.join(second, "imported-skill", "SKILL.md"), "utf-8"), "迁移包导入")
    assert.equal(await fs.readFile(path.join(second, "new-skill", "SKILL.md"), "utf-8"), "第二版")
    assert.deepEqual(
      (await findSkillDirectories(path.dirname(agentSkill))).map((skill) => skill.canonicalPath),
      [await fs.realpath(path.join(second, "demo"))],
    )
    await assert.rejects(fs.stat(first), { code: "ENOENT" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("迁移时保留指向目录内外的 Skill 链接", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-links-"))
  const canonical = path.join(root, "skills")
  const destination = path.join(root, "disk-d", "Skillbox Skills")
  const external = path.join(root, "external-skill")
  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    await fs.mkdir(external)
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "内部")
    await fs.writeFile(path.join(external, "SKILL.md"), "外部")
    await fs.symlink(path.join(canonical, "demo"), path.join(canonical, "internal-link"), process.platform === "win32" ? "junction" : "dir")
    await fs.symlink(external, path.join(canonical, "external-link"), process.platform === "win32" ? "junction" : "dir")

    await migrateSkillStorage(canonical, destination)
    assert.equal(await fs.realpath(path.join(destination, "internal-link")), await fs.realpath(path.join(destination, "demo")))
    assert.equal(await fs.realpath(path.join(destination, "external-link")), await fs.realpath(external))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("旧通用目录本身是链接时，迁移失败仍保留旧入口", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-existing-link-"))
  const canonical = path.join(root, "skills")
  const oldStorage = path.join(root, "old-storage")
  try {
    await fs.mkdir(path.join(oldStorage, "demo"), { recursive: true })
    await fs.writeFile(path.join(oldStorage, "demo", "SKILL.md"), "原件")
    await fs.symlink(oldStorage, canonical, process.platform === "win32" ? "junction" : "dir")
    context.mock.method(fs, "symlink", async () => { throw new Error("链接失败") })
    await assert.rejects(migrateSkillStorage(canonical, path.join(root, "new", "Skillbox Skills")))
    assert.equal(await fs.realpath(canonical), await fs.realpath(oldStorage))
    assert.equal(await fs.readFile(path.join(canonical, "demo", "SKILL.md"), "utf-8"), "原件")
  } finally {
    context.mock.restoreAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("目标非空或位于旧目录内时拒绝迁移，保留原文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-"))
  const canonical = path.join(root, "skills")
  const destination = path.join(root, "occupied")
  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "原件")
    await fs.mkdir(destination)
    await fs.writeFile(path.join(destination, "keep.txt"), "保留")
    await assert.rejects(migrateSkillStorage(canonical, destination))
    await assert.rejects(migrateSkillStorage(canonical, path.join(canonical, "nested")))
    assert.equal(await fs.readFile(path.join(canonical, "demo", "SKILL.md"), "utf-8"), "原件")
    assert.equal(await fs.readFile(path.join(destination, "keep.txt"), "utf-8"), "保留")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("目标经目录链接落回旧目录时拒绝迁移", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-alias-"))
  const canonical = path.join(root, "skills")
  const alias = path.join(root, "alias")
  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "原件")
    await fs.symlink(canonical, alias, process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(migrateSkillStorage(canonical, path.join(alias, "nested")))
    assert.equal(await fs.readFile(path.join(canonical, "demo", "SKILL.md"), "utf-8"), "原件")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("目录链接建立失败时恢复原目录", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-storage-"))
  const canonical = path.join(root, "skills")
  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "原件")
    context.mock.method(fs, "symlink", async () => { throw new Error("链接失败") })
    await assert.rejects(migrateSkillStorage(canonical, path.join(root, "new", "Skillbox Skills")))
    assert.equal((await fs.lstat(canonical)).isDirectory(), true)
    assert.equal(await fs.readFile(path.join(canonical, "demo", "SKILL.md"), "utf-8"), "原件")
  } finally {
    context.mock.restoreAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})
