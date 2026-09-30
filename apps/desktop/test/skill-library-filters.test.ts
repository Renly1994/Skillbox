import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_LIBRARY_FILTERS, refineLibrarySkills, type LibraryFilters } from "../src/renderer/lib/skill-library-filters"

const skills = [
  { name: "video10", description: "视频", canonicalPath: "/a", sourceType: "github", hasLinkedSource: true, versionMismatches: [], updatedAt: "2026-09-01", installedAt: "2026-08-01" },
  { name: "video2", description: "视频", canonicalPath: "/b", versionMismatches: [{ totalChanges: 1 }], updatedAt: "invalid", installedAt: "2026-09-09" },
  { name: "video2", description: "视频", canonicalPath: "/c", sourceType: "local", versionMismatches: [] },
  { name: "frontend-design", description: "设计", canonicalPath: "/d", sourceType: "github", hasLinkedSource: true, versionMismatches: [], updatedAt: "2026-08-30", installedAt: "2026-09-10" },
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

test("最近更新与最近添加使用独立时间，无时间记录排后", () => {
  assert.deepEqual(run({ sort: "updated" }), [skills[0], skills[3], skills[1], skills[2]])
  assert.deepEqual(run({ sort: "installed" }), [skills[3], skills[1], skills[0], skills[2]])
})

test("Agent 覆盖排序统计列表中的真实 Agent，通用目录不计数", () => {
  const adaptedSkills = [
    {
      ...skills[0], name: "alpha", agents: ["Claude Code", "通用 Skill 目录"],
      locations: [{ scope: "global", agents: ["Claude Code", "通用 Skill 目录"] }],
    },
    {
      ...skills[1], name: "beta", agents: ["Claude Code", "Zed"],
      locations: [{ scope: "global", agents: ["Claude Code", "Zed"] }],
    },
    {
      ...skills[2], name: "aardvark", agents: ["通用 Skill 目录"],
      locations: [{ scope: "global", agents: ["通用 Skill 目录"] }],
    },
    {
      ...skills[3], name: "delta", agents: ["Cursor"],
      locations: [{ scope: "project", agents: ["Cursor"] }],
    },
    {
      ...skills[0], name: "zulu", agents: ["Claude Code"],
      locations: [{ scope: "global", agents: ["Claude Code"] }],
    },
  ] as InstalledSkill[]

  const result = refineLibrarySkills(
    adaptedSkills,
    { ...DEFAULT_LIBRARY_FILTERS, sort: "coverage" },
    {},
    new Set(),
  )

  assert.deepEqual(result.map((skill) => skill.name), ["beta", "alpha", "zulu", "delta", "aardvark"])
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
