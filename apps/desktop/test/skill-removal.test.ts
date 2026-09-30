import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertSafePathSegment,
  isPathInside,
  removeSkillPath,
  resolveSkillRemovalRoots,
  selectAgentSkillRemovalTargets,
  validateSkillRemovalRequest,
} from "../src/main/skill-removal"

const root = path.join(os.tmpdir(), "skillbox-removal-root")

test("只允许删除授权根目录中的直接 Skill 目录，不能删除根目录本身", () => {
  const skillPath = path.join(root, "demo-skill")
  const request = validateSkillRemovalRequest({
    name: "demo-skill",
    targets: [{
      path: skillPath,
      canonicalPath: skillPath,
      scope: "custom",
    }],
  }, [root])

  assert.equal(request.targets[0].path, path.resolve(skillPath))
  assert.throws(() => validateSkillRemovalRequest({
    name: "demo-skill",
    targets: [{ path: root, canonicalPath: root, scope: "custom" }],
  }, [root]), /根目录/)
})

test("路径前缀相同的相邻目录不属于授权根目录", () => {
  assert.equal(isPathInside(root, path.join(root, "demo")), true)
  assert.equal(isPathInside(root, `${root}-other${path.sep}demo`), false)
})

test("显示路径合法但母本越界时同样拒绝删除", () => {
  const skillPath = path.join(root, "demo")
  assert.throws(() => validateSkillRemovalRequest({
    name: "demo",
    targets: [{
      path: skillPath,
      canonicalPath: path.join(os.tmpdir(), "outside", "demo"),
      scope: "global",
    }],
  }, [root]), /授权范围之外/)
})

test("授权目录本身为 Junction 时，同时授权其真实位置", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-removal-root-link-"))
  const physicalRoot = path.join(fixture, "physical", "skills")
  const linkedRoot = path.join(fixture, "linked-skills")
  await fs.mkdir(path.join(physicalRoot, "demo"), { recursive: true })
  await fs.symlink(physicalRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir")
  try {
    const request = {
      name: "demo",
      targets: [{
        path: path.join(linkedRoot, "demo"),
        canonicalPath: path.join(physicalRoot, "demo"),
        scope: "global" as const,
      }],
    }
    assert.throws(
      () => validateSkillRemovalRequest(request, [linkedRoot]),
      (error: unknown) => error instanceof Error && error.message.includes(path.join(physicalRoot, "demo")),
    )
    const roots = resolveSkillRemovalRoots([linkedRoot])
    assert.deepEqual(roots, [linkedRoot, physicalRoot])
    assert.doesNotThrow(() => validateSkillRemovalRequest(request, roots))
    assert.throws(() => validateSkillRemovalRequest({
      name: "demo",
      targets: [{ ...request.targets[0], canonicalPath: path.join(fixture, "outside", "demo") }],
    }, roots), /授权范围之外/)
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
})

test("关闭单个 Agent 适配时跳过无关 Agent 的旧路径，仍校验目标母本", () => {
  const masterRoot = path.join(root, "master")
  const agentRoot = path.join(root, "doubao")
  const unrelatedRoot = path.join(root, "codex-old")
  const master = path.join(masterRoot, "demo")
  const binding = path.join(agentRoot, "demo")
  const request = {
    name: "demo",
    targets: [
      { path: master, canonicalPath: master, scope: "global" as const },
      { path: path.join(unrelatedRoot, "demo"), canonicalPath: path.join(unrelatedRoot, "demo"), scope: "global" as const },
      { path: binding, canonicalPath: master, scope: "global" as const },
    ],
  }

  assert.throws(() => validateSkillRemovalRequest(request, [masterRoot, agentRoot]), /授权范围之外/)
  const scoped = selectAgentSkillRemovalTargets(request, [agentRoot], [masterRoot])
  assert.deepEqual(
    validateSkillRemovalRequest(scoped, [masterRoot, agentRoot]).targets.map((target) => target.path),
    [master, binding],
  )
  assert.throws(() => validateSkillRemovalRequest(
    selectAgentSkillRemovalTargets({
      name: "demo",
      targets: [{ path: binding, canonicalPath: path.join(unrelatedRoot, "demo"), scope: "global" }],
    }, [agentRoot], [masterRoot]),
    [masterRoot, agentRoot],
  ), /授权范围之外/)
})

test("拒绝空目录名、点目录和路径穿越，同时允许中文目录名", () => {
  for (const value of ["", ".", "..", `..${path.sep}demo`, "demo/child", "demo\\child"]) {
    assert.throws(() => assertSafePathSegment(value), /无效/)
  }
  assert.equal(assertSafePathSegment("中文技能"), "中文技能")
})

test("批量删除按真实路径去重，不会按同名 Skill 合并目标", () => {
  const first = path.join(root, "project-a", "same-name")
  const second = path.join(root, "project-b", "same-name")
  const request = validateSkillRemovalRequest({
    name: "same-name",
    targets: [
      { path: first, canonicalPath: first, scope: "project" },
      { path: first, canonicalPath: first, scope: "project" },
      { path: second, canonicalPath: second, scope: "project" },
    ],
  }, [root])

  assert.deepEqual(request.targets.map((target) => target.path), [
    path.resolve(first),
    path.resolve(second),
  ])
})

test("Junction 只解除链接，实体目录进入回收站", async () => {
  const calls: string[] = []
  const operations = {
    lstat: async () => ({ isSymbolicLink: () => true, isDirectory: () => true }),
    unlink: async (targetPath: string) => { calls.push(`unlink:${targetPath}`) },
    trash: async (targetPath: string) => { calls.push(`trash:${targetPath}`) },
  }
  await removeSkillPath("D:/skills/link", operations)
  assert.deepEqual(calls, ["unlink:D:/skills/link"])

  calls.length = 0
  operations.lstat = async () => ({ isSymbolicLink: () => false, isDirectory: () => true })
  await removeSkillPath("D:/skills/entity", operations)
  assert.deepEqual(calls, ["trash:D:/skills/entity"])
})

test("真实文件系统中删除 Junction 不会触碰母本", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-removal-link-"))
  const master = path.join(fixture, "master")
  const link = path.join(fixture, "link")
  await fs.mkdir(master)
  await fs.writeFile(path.join(master, "SKILL.md"), "master")
  await fs.symlink(master, link, process.platform === "win32" ? "junction" : "dir")
  try {
    const result = await removeSkillPath(link, {
      lstat: (targetPath) => fs.lstat(targetPath),
      unlink: (targetPath) => fs.unlink(targetPath),
      trash: async () => { throw new Error("Junction 不应进入实体目录删除分支") },
    })
    assert.equal(result, "link")
    await assert.rejects(fs.lstat(link))
    assert.equal(await fs.readFile(path.join(master, "SKILL.md"), "utf8"), "master")
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
})

test("真实实体 Skill 通过回收站操作完整移出原位置", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-removal-entity-"))
  const skillDir = path.join(fixture, "demo-skill")
  const recycleDir = path.join(fixture, "recycle", "demo-skill")
  await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "skill")
  await fs.writeFile(path.join(skillDir, "references", "guide.md"), "guide")
  try {
    const result = await removeSkillPath(skillDir, {
      lstat: (targetPath) => fs.lstat(targetPath),
      unlink: (targetPath) => fs.unlink(targetPath),
      trash: async (targetPath) => {
        await fs.mkdir(path.dirname(recycleDir), { recursive: true })
        await fs.rename(targetPath, recycleDir)
      },
    })
    assert.equal(result, "directory")
    await assert.rejects(fs.lstat(skillDir))
    assert.equal(await fs.readFile(path.join(recycleDir, "SKILL.md"), "utf8"), "skill")
    assert.equal(await fs.readFile(path.join(recycleDir, "references", "guide.md"), "utf8"), "guide")
  } finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
})
