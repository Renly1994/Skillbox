import assert from "node:assert/strict"
import test from "node:test"
import { mergeProjectSkillsIntoGlobal } from "../src/main/skill-display-merge"

function createSkill(
  canonicalPath: string,
  scope: "global" | "project",
  agents: string[],
  versionMismatches: Array<{
    agentName: string
    agentDisplayName: string
    agentPath: string
    changes: Array<{
      relativePath: string
      kind: "modified" | "only-agent" | "only-master"
    }>
    totalChanges: number
  }> = [],
) {
  return {
    name: "finesse-ui",
    canonicalPath,
    agents,
    agentShortCodes: agents.map((agent) => agent === "Claude Code" ? "CC" : "UA"),
    scope,
    versionMismatches,
  }
}

test("同名项目副本与全局母版聚合为一行并汇总 Agent", () => {
  const merged = mergeProjectSkillsIntoGlobal([
    createSkill("C:/Users/test/.agents/skills/finesse-ui", "global", ["通用 Skill 目录"]),
    createSkill("D:/project/.claude/skills/finesse-ui", "project", ["Claude Code"]),
  ])

  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].agents, ["通用 Skill 目录", "Claude Code"])
  assert.deepEqual(merged[0].agentShortCodes, ["UA", "CC"])
})

test("同名项目副本内容不同时仍为一行，并保留版本差异", () => {
  const mismatch = {
    agentName: "claude-code",
    agentDisplayName: "Claude Code",
    agentPath: "D:/project/.claude/skills/finesse-ui",
    changes: [{ relativePath: "SKILL.md", kind: "modified" as const }],
    totalChanges: 1,
  }
  const merged = mergeProjectSkillsIntoGlobal([
    createSkill("C:/Users/test/.agents/skills/finesse-ui", "global", ["通用 Skill 目录"]),
    createSkill(
      "D:/project/.claude/skills/finesse-ui",
      "project",
      ["Claude Code"],
      [mismatch],
    ),
  ])

  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].versionMismatches, [mismatch])
})

test("没有全局母版时不擅自合并不同项目中的同名 Skill", () => {
  const merged = mergeProjectSkillsIntoGlobal([
    createSkill("D:/project-a/.claude/skills/finesse-ui", "project", ["Claude Code"]),
    createSkill("D:/project-b/.claude/skills/finesse-ui", "project", ["Claude Code"]),
  ])

  assert.equal(merged.length, 2)
})

test("没有 Agent 归属的项目内容不作为适配副本合并", () => {
  const merged = mergeProjectSkillsIntoGlobal([
    createSkill("C:/Users/test/.agents/skills/finesse-ui", "global", ["通用 Skill 目录"]),
    createSkill("D:/project/.cursor/rules/finesse-ui", "project", []),
  ])

  assert.equal(merged.length, 2)
})
