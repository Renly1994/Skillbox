import assert from "node:assert/strict"
import test from "node:test"
import { changedSourceSkills, isSourceKindValid, sourceKindForSkill } from "../src/renderer/lib/skill-source-drafts"

const knownUnlinked = { name: "same", canonicalPath: "C:/a/same", source: "C:/source/same", sourceType: "local", hasLinkedSource: false } as InstalledSkill
const linked = { name: "same", canonicalPath: "C:/b/same", source: "owner/repo", sourceType: "github", hasLinkedSource: true } as InstalledSkill

test("发现来源但尚未关联时，填写相同地址仍应保存关联", () => {
  assert.deepEqual(changedSourceSkills([knownUnlinked], { [knownUnlinked.canonicalPath]: "C:/source/same" }), [knownUnlinked])
})

test("同名 Skill 按路径区分，已关联且未改动的来源不重复保存", () => {
  assert.deepEqual(changedSourceSkills([knownUnlinked, linked], {
    [knownUnlinked.canonicalPath]: "C:/source/same",
    [linked.canonicalPath]: "owner/repo",
  }), [knownUnlinked])
  assert.equal(sourceKindForSkill(knownUnlinked), "local")
  assert.equal(sourceKindForSkill(linked), "github")
})

test("GitHub 与本地目录输入不互相混用", () => {
  assert.equal(isSourceKindValid("github", "owner/repo"), true)
  assert.equal(isSourceKindValid("github", "https://github.com/owner/repo"), true)
  assert.equal(isSourceKindValid("github", "C:\\skills\\sample"), false)
  assert.equal(isSourceKindValid("local", "C:\\skills\\sample"), true)
  assert.equal(isSourceKindValid("local", "./skills/sample"), true)
  assert.equal(isSourceKindValid("local", "owner/repo"), false)
})
