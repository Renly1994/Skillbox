import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_LIBRARY_FILTERS, refineLibrarySkills, type LibraryFilters } from "../src/renderer/lib/skill-library-filters"

const skills = [
  { name: "video10", description: "视频", canonicalPath: "/a", sourceType: "github", versionMismatches: [], updatedAt: "2026-09-01", installedAt: "2026-08-01" },
  { name: "video2", description: "视频", canonicalPath: "/b", versionMismatches: [{ totalChanges: 1 }], updatedAt: "invalid", installedAt: "2026-09-09" },
  { name: "video2", description: "视频", canonicalPath: "/c", sourceType: "local", versionMismatches: [] },
  { name: "frontend-design", description: "设计", canonicalPath: "/d", sourceType: "github", versionMismatches: [] },
] as InstalledSkill[]

const run = (filters: Partial<LibraryFilters>) => refineLibrarySkills(skills, { ...DEFAULT_LIBRARY_FILTERS, ...filters }, { work: ["/b", "/missing"] }, new Set(["frontend-design"]))

test("类别与版本差异可叠加筛选", () => {
  assert.deepEqual(run({ category: "视频", mismatched: true }), [skills[1]])
  assert.deepEqual(run({ category: "设计", mismatched: true }), [])
})

test("未归入集合按路径识别同名技能，忽略失效成员", () => {
  assert.deepEqual(run({ uncollected: true }), [skills[0], skills[2], skills[3]])
})

test("名称排序支持自然数字顺序及反序", () => {
  assert.deepEqual(run({ sort: "name-asc" }), [skills[3], skills[1], skills[2], skills[0]])
  assert.deepEqual(run({ sort: "name-desc" }), [skills[0], skills[1], skills[2], skills[3]])
})

test("无效更新时间回退安装时间，无时间记录排后", () => {
  assert.deepEqual(run({ sort: "updated" }), [skills[1], skills[0], skills[3], skills[2]])
  assert.deepEqual(run({ sort: "installed" }), [skills[1], skills[0], skills[3], skills[2]])
})

test("收藏优先且排序不会改动输入，默认保留原顺序", () => {
  assert.equal(run({ sort: "favorites" })[0], skills[3])
  assert.equal(skills[0].canonicalPath, "/a")
  assert.deepEqual(run({}), skills)
})

 test("未归入集合和版本差异可独立叠加", () => {
   assert.deepEqual(run({uncollected: true, mismatched: true}), [])
   assert.deepEqual(run({mismatched: true}), [skills[1]])
 })
