import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { migrateDefaultSkillVersionStore, migrateSkillVersionStore, prepareSkillVersionPathMigration, SkillVersionStore } from "../src/main/skill-version-history"

test("迁移 Skill 实体位置后保留版本记录", async () => {
  const fixture = await createFixture("skillbox-version-path-")
  const newRoot = path.join(fixture.root, "new-skills")
  const newSkill = path.join(newRoot, "demo-skill")
  const store = new SkillVersionStore(fixture.storePath)
  try {
    await store.create(fixture.skillPath, "Demo", "manual")
    const prepared = await prepareSkillVersionPathMigration(
      fixture.storePath,
      fixture.root,
      newRoot,
    )
    await fs.mkdir(newRoot)
    await fs.rename(fixture.skillPath, newSkill)
    assert.equal((await store.list(newSkill, "Demo")).length, 1)
    await prepared.commit()
    assert.equal((await store.list(newSkill, "Demo")).length, 1)
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("目标位置已有版本记录时不覆盖", async () => {
  const fixture = await createFixture("skillbox-version-path-conflict-")
  const newRoot = path.join(fixture.root, "new-skills")
  const newSkill = path.join(newRoot, "demo-skill")
  const store = new SkillVersionStore(fixture.storePath)
  try {
    await fs.mkdir(newSkill, { recursive: true })
    await fs.writeFile(path.join(newSkill, "SKILL.md"), "目标版本")
    await store.create(fixture.skillPath, "Demo", "manual")
    await store.create(newSkill, "Demo", "manual")
    await assert.rejects(prepareSkillVersionPathMigration(fixture.storePath, fixture.root, newRoot))
    assert.equal((await store.list(fixture.skillPath, "Demo")).length, 1)
    assert.equal((await store.list(newSkill, "Demo")).length, 1)
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("版本迁移保留分组 Skill 与旧通用入口逻辑路径的历史", async () => {
  const fixture = await createFixture("skillbox-version-path-roots-")
  const oldRoot = path.join(fixture.root, "disk-d", "Skillbox Skills")
  const legacyRoot = path.join(fixture.root, ".agents", "skills")
  const newRoot = path.join(fixture.root, "disk-e", "Skillbox Skills")
  const directSkill = path.join(oldRoot, "direct")
  const nestedSkill = path.join(oldRoot, "group", "nested")
  const logicalSkill = path.join(legacyRoot, "logical")
  const store = new SkillVersionStore(fixture.storePath)
  try {
    for (const skillPath of [directSkill, nestedSkill, logicalSkill]) {
      await fs.mkdir(skillPath, { recursive: true })
      await fs.writeFile(path.join(skillPath, "SKILL.md"), `# ${path.basename(skillPath)}\n第一版`)
      await store.create(skillPath, path.basename(skillPath), "manual")
    }

    const prepared = await prepareSkillVersionPathMigration(
      fixture.storePath,
      oldRoot,
      newRoot,
      [legacyRoot],
    )
    await fs.mkdir(newRoot, { recursive: true })
    await fs.cp(oldRoot, newRoot, { recursive: true })
    await fs.cp(logicalSkill, path.join(newRoot, "logical"), { recursive: true })

    for (const skillPath of [
      path.join(newRoot, "direct"),
      path.join(newRoot, "group", "nested"),
      path.join(newRoot, "logical"),
    ]) {
      const versions = await store.list(skillPath, path.basename(skillPath))
      assert.equal(versions.length, 1)
      assert.match(await store.readFile(skillPath, path.basename(skillPath), versions[0].id), /第一版/)
      await fs.writeFile(path.join(skillPath, "SKILL.md"), "# Current\n当前版本")
      await store.restore(skillPath, path.basename(skillPath), versions[0].id)
      assert.match(await fs.readFile(path.join(skillPath, "SKILL.md"), "utf-8"), /第一版/)
    }

    await prepared.commit()
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

async function createFixture(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const skillPath = path.join(root, "demo-skill")
  const storePath = path.join(root, "version-store")
  await fs.mkdir(path.join(skillPath, "references"), { recursive: true })
  await fs.writeFile(path.join(skillPath, "SKILL.md"), "# Demo\n\n第一版\n", "utf-8")
  await fs.writeFile(path.join(skillPath, "references", "guide.md"), "guide v1\n", "utf-8")
  return { root, skillPath, storePath }
}

test("快照保存在 Skill 外部，并按完整目录内容去重", async () => {
  const fixture = await createFixture("skillbox-versions-")
  const store = new SkillVersionStore(fixture.storePath, 20)

  try {
    const first = await store.create(fixture.skillPath, "Demo", "manual")
    const duplicate = await store.create(fixture.skillPath, "Demo", "manual")
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.deepEqual((await fs.readdir(fixture.skillPath)).sort(), ["references", "SKILL.md"].sort())

    await fs.writeFile(path.join(fixture.skillPath, "SKILL.md"), "# Demo\n\n第二版\n", "utf-8")
    await fs.writeFile(path.join(fixture.skillPath, "references", "notes.md"), "new\n", "utf-8")
    await store.create(fixture.skillPath, "Demo", "edit")

    const versions = await store.list(fixture.skillPath, "Demo")
    assert.equal(versions.length, 2)
    assert.ok(versions[0].changes.some((change) => change.relativePath === "SKILL.md" && change.kind === "modified"))
    assert.ok(versions[0].changes.some((change) => change.relativePath === "references/notes.md" && change.kind === "added"))
    assert.ok((await fs.readdir(fixture.storePath)).includes(".skillbox-version-store"))

    await store.create(fixture.skillPath, "Renamed Demo", "manual")
    assert.equal((await store.list(fixture.skillPath, "Renamed Demo")).length, 2)
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("文件系统拒绝重命名时仍能保存和更新历史版本", async (context) => {
  const fixture = await createFixture("skillbox-versions-")
  const store = new SkillVersionStore(fixture.storePath)

  try {
    context.mock.method(fs, "rename", async () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" })
    })
    const first = await store.create(fixture.skillPath, "Demo", "manual")
    await fs.writeFile(path.join(fixture.skillPath, "SKILL.md"), "# Demo\n\n第二版\n", "utf-8")
    const second = await store.create(fixture.skillPath, "Demo", "manual")

    assert.equal(first.created, true)
    assert.equal(second.created, true)
    assert.equal((await store.list(fixture.skillPath, "Demo")).length, 2)
    assert.equal(await store.readFile(fixture.skillPath, "Demo", first.version.id), "# Demo\n\n第一版\n")
    assert.equal(await store.readFile(fixture.skillPath, "Demo", second.version.id), "# Demo\n\n第二版\n")
  } finally {
    context.mock.restoreAll()
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("降低保留数量会立即清理旧快照，且历史版本可完整恢复", async () => {
  const fixture = await createFixture("skillbox-versions-")
  const store = new SkillVersionStore(fixture.storePath, 10)

  try {
    for (let index = 1; index <= 5; index += 1) {
      await fs.writeFile(path.join(fixture.skillPath, "SKILL.md"), `# Demo\n\n版本 ${index}\n`, "utf-8")
      await store.create(fixture.skillPath, "Demo", "edit")
    }
    const before = await store.list(fixture.skillPath, "Demo")
    assert.equal(before.length, 5)
    const restoreTarget = before[3]

    const limited = new SkillVersionStore(fixture.storePath, 3)
    await limited.prune()
    assert.equal((await limited.list(fixture.skillPath, "Demo")).length, 3)
    assert.equal((await limited.list(fixture.skillPath, "Demo"))[0].number, 5)

    await fs.writeFile(path.join(fixture.skillPath, "SKILL.md"), "# Demo\n\n版本 6\n", "utf-8")
    await limited.create(fixture.skillPath, "Demo", "edit")
    assert.equal((await limited.list(fixture.skillPath, "Demo"))[0].number, 6)

    const kept = await limited.list(fixture.skillPath, "Demo")
    await limited.restore(fixture.skillPath, "Demo", kept[2].id)
    assert.equal(
      await fs.readFile(path.join(fixture.skillPath, "SKILL.md"), "utf-8"),
      await limited.readFile(fixture.skillPath, "Demo", kept[2].id, "SKILL.md"),
    )
    assert.ok(restoreTarget.id)
    assert.equal(await fs.readFile(path.join(fixture.skillPath, "references", "guide.md"), "utf-8"), "guide v1\n")
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("版本仓库可迁移到用户选择的外部位置", async () => {
  const fixture = await createFixture("skillbox-versions-")
  const store = new SkillVersionStore(fixture.storePath, 20)
  const nextStorePath = path.join(fixture.root, "external", "Skillbox Versions")

  try {
    await store.create(fixture.skillPath, "Demo", "manual")
    await migrateSkillVersionStore(fixture.storePath, nextStorePath)

    assert.equal(await fs.stat(fixture.storePath).then(() => true).catch(() => false), false)
    const migrated = new SkillVersionStore(nextStorePath, 20)
    assert.equal((await migrated.list(fixture.skillPath, "Demo")).length, 1)
    assert.equal(await migrated.readFile(
      fixture.skillPath,
      "Demo",
      (await migrated.list(fixture.skillPath, "Demo"))[0].id,
    ), "# Demo\n\n第一版\n")
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("默认版本仓库更名时保留已有快照", async () => {
  const fixture = await createFixture("skillbox-versions-")
  const brandedPath = path.join(fixture.root, "Skillbox", "skill-versions")
  try {
    const oldStore = new SkillVersionStore(fixture.storePath)
    const saved = await oldStore.create(fixture.skillPath, "Demo", "manual")
    assert.equal(await migrateDefaultSkillVersionStore(fixture.storePath, brandedPath), brandedPath)
    assert.equal(await fs.stat(fixture.storePath).then(() => true).catch(() => false), false)
    assert.equal(await new SkillVersionStore(brandedPath).readFile(fixture.skillPath, "Demo", saved.version.id), "# Demo\n\n第一版\n")
    assert.equal(await migrateDefaultSkillVersionStore(fixture.storePath, brandedPath), brandedPath)
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})

test("跨设备目录重命名失败时仍可迁移版本仓库", async (context) => {
  const fixture = await createFixture("skillbox-versions-")
  const nextStorePath = path.join(fixture.root, "Skillbox", "skill-versions")
  try {
    const oldStore = new SkillVersionStore(fixture.storePath)
    const saved = await oldStore.create(fixture.skillPath, "Demo", "manual")
    context.mock.method(fs, "rename", async () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" })
    })
    await migrateSkillVersionStore(fixture.storePath, nextStorePath)
    assert.equal(await fs.stat(fixture.storePath).then(() => true).catch(() => false), false)
    assert.equal(await new SkillVersionStore(nextStorePath).readFile(fixture.skillPath, "Demo", saved.version.id), "# Demo\n\n第一版\n")
  } finally {
    context.mock.restoreAll()
    await fs.rm(fixture.root, { recursive: true, force: true })
  }
})
