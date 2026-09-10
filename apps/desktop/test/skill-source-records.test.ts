import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSkillSourceResolver } from "../src/main/skill-source-records"

test("项目来源记录可补齐 Git 来源，不串用其它项目的同名记录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-source-"))
  try {
    const project = path.join(root, "project")
    await fs.mkdir(project)
    await fs.writeFile(path.join(project, "skills-lock.json"), JSON.stringify({version: 1, skills: { demo: {source: "team/repo", sourceType: "github"} }}))
    const resolve = createSkillSourceResolver()
    const location = path.join(project, ".agents", "skills", "demo")
    assert.deepEqual(await resolve({ name: "demo", path: location, canonicalPath: location }), {source: "team/repo", sourceType: "github"})
    const other = path.join(root, "other", ".agents", "skills", "demo")
    assert.equal(await resolve({name: "demo", path: other, canonicalPath: other}), undefined)
    assert.deepEqual(await resolve({name: "demo", path: other, canonicalPath: location}), {source: "team/repo", sourceType: "github"})
  } finally { await fs.rm(root, {recursive: true, force: true}) }
})

test("损坏记录不影响扫描，分组技能支持按声明名称匹配", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-source-"))
  try {
    await fs.mkdir(path.join(root, ".agents"))
    await fs.writeFile(path.join(root, ".agents", "skills-lock.json"), "invalid")
    await fs.writeFile(path.join(root, "skills-lock.json"), JSON.stringify({skills: { named: {source: "team/repo", sourceType: "github"} }}))
    const location = path.join(root, ".agents", "skills", "group", "folder")
    assert.deepEqual(await createSkillSourceResolver()({name: "named", path: location, canonicalPath: location}), {source: "team/repo", sourceType: "github"})
  } finally { await fs.rm(root, {recursive: true, force: true}) }
})
