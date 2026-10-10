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

test("热度排序按使用次数排序，同次数稳定，暂无数据排最后且不修改原列表", () => {
  const heatSkills = [
    { ...skills[0], heat: undefined },
    { ...skills[1], heat: { level: 0, usageCount: 3 } },
    { ...skills[2], heat: { level: 2, usageCount: 21 } },
    { ...skills[3], heat: { level: 0, usageCount: 0 } },
    { ...skills[0], canonicalPath: "/e", heat: { level: 2, usageCount: 12 } },
    { ...skills[1], canonicalPath: "/f", heat: { level: 3, usageCount: 30 } },
    { ...skills[2], canonicalPath: "/g", heat: { level: null, usageCount: null } },
    { ...skills[0], canonicalPath: "/h", heat: { level: 2, usageCount: 18 } },
    { ...skills[0], canonicalPath: "/i", heat: { level: 2, usageCount: 12 } },
  ] as InstalledSkill[]
  const original = [...heatSkills]
  const sorted = refineLibrarySkills(heatSkills, { ...DEFAULT_LIBRARY_FILTERS, sort: "heat" }, {}, new Set())
  assert.deepEqual(sorted.map(skill => skill.canonicalPath), ["/f", "/c", "/h", "/e", "/i", "/b", "/d", "/a", "/g"])
  assert.deepEqual(heatSkills, original)
})

 test("未归入集合和版本差异可独立叠加", () => {
   assert.deepEqual(run({uncollected: true, mismatched: true}), [])
   assert.deepEqual(run({mismatched: true}), [skills[1]])
 })

const observedNow = Date.parse("2026-10-09T12:00:00Z")
const usageSkill = (name: string, count: number, count90 = count, observedDays = 90) => ({
  ...skills[0], name, canonicalPath: "/" + name,
  heat: { level: count >= 30 ? 3 : count >= 10 ? 2 : count >= 4 ? 1 : 0, usageCount: count, usageCount90: count90, coverageComplete: true, observedSince: new Date(observedNow - observedDays * 86_400_000).toISOString(), partial: false, stale: false, sources: ["Codex CLI"] },
}) as InstalledSkill
const usageRun = (items: InstalledSkill[], filters: Partial<LibraryFilters> = {}, favorites = new Set<string>()) =>
  refineLibrarySkills(items, { ...DEFAULT_LIBRARY_FILTERS, usage: "low", ...filters }, {}, favorites, observedNow)

test("低频使用和长期闲置互斥，30 与 90 天使用各自次数", () => {
  const items = [usageSkill("idle", 0, 0), usageSkill("low", 1, 3), usageSkill("recent-idle", 0, 5), usageSkill("frequent", 4, 10)]
  assert.deepEqual(usageRun(items).map(s => s.name), ["low"])
  assert.deepEqual(usageRun(items, { usage: "idle" }).map(s => s.name), ["idle"])
  assert.deepEqual(usageRun(items, { usage: "idle", usageDays: 30 }).map(s => s.name), ["idle", "recent-idle"])
  assert.deepEqual(usageRun(items, { usageMax: 5 }).map(s => s.name), ["low", "recent-idle"])
})

test("近 30 天上限 1 次按已记录次数匹配，不要求观察满 30 天", () => {
  const once = usageSkill("once", 1, 4, 0)
  once.heat = { ...once.heat!, coverageComplete: false, partial: true, observedSince: undefined }
  const items = [once, usageSkill("twice", 2, 2, 0), usageSkill("zero", 0, 0, 0), { ...usageSkill("unknown", 0), heat: undefined }]
  assert.deepEqual(usageRun(items, { usageDays: 30, usageMax: 1 }).map(s => s.name), ["once"])
  assert.deepEqual(usageRun(items, { usageDays: 90, usageMax: 1 }), [])
  assert.deepEqual(usageRun(items, { usageDays: 90, usageMax: 4 }).map(s => s.name), ["once", "twice"])
})

test("低频筛选允许已知次数的缓存和未完成记录，未知次数仍排除", () => {
  const items = [
    ...[{ partial: true }, { stale: true }, { coverageComplete: false }, { observedSince: "invalid" }].map((patch, index) => {
      const target = usageSkill(`known-${index}`, 1, 1, 0)
      return { ...target, heat: { ...target.heat!, ...patch } }
    }),
    { ...usageSkill("unknown", 1), heat: { ...usageSkill("unknown", 1).heat!, usageCount90: null } },
  ] as InstalledSkill[]
  assert.deepEqual(usageRun(items, { usageMax: 1 }).map(s => s.name), ["known-0", "known-1", "known-2", "known-3"])
})

test("观察不足、记录缺失、未统计完与读取失败都不列为清理候选", () => {
  const good = usageSkill("good", 0)
  const items = [
    good, usageSkill("new", 0, 0, 89),
    { ...good, name: "unknown", heat: undefined },
    ...[
      { coverageComplete: false }, { partial: true }, { stale: true },
      { observedSince: "invalid" }, { observedSince: undefined }, { usageCount90: null },
    ].map((patch, index) => ({ ...good, name: `incomplete-${index}`, heat: { ...good.heat!, ...patch } })),
  ] as InstalledSkill[]
  assert.deepEqual(usageRun(items, { usage: "idle" }).map(s => s.name), ["good"])
  assert.deepEqual(usageRun([usageSkill("29-days", 0, 0, 29)], { usage: "idle", usageDays: 30 }), [])
  assert.equal(usageRun([usageSkill("30-days", 0, 0, 30)], { usage: "idle", usageDays: 30 }).length, 1)
})

test("默认排除收藏，允许取消，并与原有类别和版本筛选叠加", () => {
  const items = [usageSkill("kept", 1), { ...usageSkill("changed", 2), versionMismatches: [{ totalChanges: 1 }] }] as InstalledSkill[]
  const favorites = new Set(["kept"])
  assert.deepEqual(usageRun(items, {}, favorites).map(s => s.name), ["changed"])
  assert.deepEqual(usageRun(items, { excludeFavorites: false }, favorites), items)
  assert.deepEqual(usageRun(items, { category: "视频", mismatched: true }, favorites).map(s => s.name), ["changed"])
  assert.deepEqual(usageRun(items, { category: "设计" }, favorites), [])
})

test("无效低频阈值不产生候选，恢复全部时不排除收藏和记录不足技能", () => {
  const items = [usageSkill("kept", 1), { ...usageSkill("unknown", 0), heat: undefined }]
  for (const usageMax of [0, -1, 1.5, NaN]) assert.deepEqual(usageRun(items, { usageMax }), [])
  assert.deepEqual(usageRun(items, { usage: "all" }, new Set(["kept"])), items)
})
