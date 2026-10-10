import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SkillHeatReader } from "../src/main/skill-heat"

const now = Date.parse("2026-10-09T12:00:00Z")
const timestamp = (day = 9) => `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`
const skill = (root: string, name = "design", agents = ["Codex CLI"]) => ({
  name, path: path.join(root, name), canonicalPath: path.join(root, name), agents,
  locations: [{ path: path.join(root, name), canonicalPath: path.join(root, name), agents }],
})
const codex = (name: string, args: unknown, day = 9) => JSON.stringify({
  type: "response_item", timestamp: timestamp(day), payload: { type: "function_call", name, arguments: JSON.stringify(args) },
}) + "\n"
const claude = (name: string, input: unknown, day = 9, sessionId = "claude-session") => JSON.stringify({
  type: "assistant", timestamp: timestamp(day), sessionId, message: { content: [{ type: "tool_use", name, input }] },
}) + "\n"
const sessionMeta = (id: string) => JSON.stringify({ type: "session_meta", timestamp: timestamp(), payload: { id } }) + "\n"

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-heat-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const logs = path.join(root, "logs")
  await fs.mkdir(logs)
  return { root, logs, file: path.join(logs, "session.jsonl") }
}

test("缺少日志来源为暂无数据，有可读记录但未发现技能为暂无记录", async t => {
  const { root, logs, file } = await fixture(t)
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.level, null)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, null)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo hello" }))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.level, 0)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 0)
  assert.equal(reader.attach([skill(root, "other", ["Cursor"])])[0].heat.level, null)
})

test("只统计工具激活和读取，忽略目录、正文提及、搜索与写入", async t => {
  const { root, logs, file } = await fixture(t)
  const target = path.join(root, "design", "SKILL.md")
  await fs.writeFile(file, [
    codex("exec_command", { cmd: `ls '${target}'` }),
    codex("exec_command", { cmd: `echo cat '${target}'` }),
    codex("exec_command", { cmd: `rg 'Get-Content' '${target}'` }),
    codex("write_file", { path: target }),
    JSON.stringify({ type: "response_item", timestamp: timestamp(), payload: { type: "message", role: "user", content: target } }) + "\n",
    "broken json\n",
  ].join(""))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.level, 0)
  await fs.appendFile(file, codex("exec_command", { cmd: `Get-Content -LiteralPath '${target}'` }))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
})

test("Codex 自定义 exec 内的读取可识别，同一会话重复读取和重载缓存只计一次", async t => {
  const { root, logs, file } = await fixture(t)
  const target = path.join(root, "design", "SKILL.md")
  const input = `text(await tools.exec_command({cmd:${JSON.stringify(`cat '${target}'`)}}));`
  const line = JSON.stringify({ type: "response_item", timestamp: timestamp(), payload: { type: "custom_tool_call", name: "exec", input } }) + "\n"
  await fs.writeFile(file, line.repeat(20))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  const resumed = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }], JSON.parse(JSON.stringify(reader.cache)))
  await resumed.refresh(now)
  assert.equal(resumed.attach([skill(root)])[0].heat.usageCount, 1)
  await fs.appendFile(file, line.replace(timestamp(), timestamp(8)))
  await resumed.refresh(now)
  assert.equal(resumed.attach([skill(root)])[0].heat.usageCount, 1)
})

test("Claude 同一会话跨天激活只计一次，同名无法归属时不显示次数", async t => {
  const { root, logs, file } = await fixture(t)
  await fs.writeFile(file, [1,2,3].map(day => claude("Skill", { skill: "design" }, day)).join(""))
  const reader = new SkillHeatReader([{ root: logs, agent: "Claude Code", kind: "claude" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root, "design", ["Claude Code"])])[0].heat.usageCount, 1)
  await fs.appendFile(file, [4,5,6,7,8].map(day => claude("Skill", { skill: "design" }, day)).join(""))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root, "design", ["Claude Code"])])[0].heat.usageCount, 1)
  const ambiguous = reader.attach([skill(root, "design", ["Claude Code"]), { ...skill(root, "design", ["Claude Code"]), canonicalPath: path.join(root, "duplicate") }])[0].heat
  assert.equal(ambiguous.level, null)
  assert.equal(ambiguous.usageCount, null)
})

test("2–3 次未达一档，4、10、30 次达到一档、二档、三档", async t => {
  const { root, logs } = await fixture(t)
  const reader = new SkillHeatReader([{ root: logs, agent: "Claude Code", kind: "claude" }])
  const levels = new Map([[1, 0], [2, 0], [3, 0], [4, 1], [9, 1], [10, 2], [29, 2], [30, 3]])
  for (let count = 1; count <= 30; count++) {
    await fs.writeFile(path.join(logs, `${count}.jsonl`), claude("Skill", { skill: "design" }, 9, `session-${count}`))
    await reader.refresh(now)
    const heat = reader.attach([skill(root, "design", ["Claude Code"])])[0].heat
    assert.equal(heat.usageCount, count)
    if (levels.has(count)) assert.equal(heat.level, levels.get(count), `${count} 次使用的火焰档位`)
  }
})

test("Codex 归档副本按会话 ID 去重，移动日志和增量刷新不会增加次数", async t => {
  const { root, logs, file } = await fixture(t)
  const archived = path.join(root, "archived")
  await fs.mkdir(archived)
  const log = sessionMeta("codex-session") + codex("exec_command", { cmd: `cat '${path.join(root, "design", "SKILL.md")}'` })
  await fs.writeFile(file, log)
  await fs.writeFile(path.join(archived, "copy.jsonl"), log)
  const reader = new SkillHeatReader([
    { root: logs, agent: "Codex CLI", kind: "codex" },
    { root: archived, agent: "Codex CLI", kind: "codex" },
  ])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  await fs.unlink(file)
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  await fs.appendFile(path.join(archived, "copy.jsonl"), codex("exec_command", { cmd: `cat '${path.join(root, "design", "SKILL.md")}'` }))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
})

test("Claude 同一会话中的激活、文件读取和子代理记录合并计一次", async t => {
  const { root, logs, file } = await fixture(t)
  await fs.writeFile(file, claude("Skill", { skill: "design" }))
  await fs.writeFile(path.join(logs, "subagent.jsonl"), claude("Read", { file_path: path.join(root, "design", "SKILL.md") }))
  const reader = new SkillHeatReader([{ root: logs, agent: "Claude Code", kind: "claude" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root, "design", ["Claude Code"])])[0].heat.usageCount, 1)
})

test("增量读取保留未写完的行；过期、未来与无效日期不计热度", async t => {
  const { root, logs, file } = await fixture(t)
  const read = codex("exec_command", { cmd: `cat '${path.join(root, "design", "SKILL.md")}'` })
  await fs.writeFile(file, read.slice(0,-1))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.level, null)
  await fs.appendFile(file, "\n" + read.replace(timestamp(), "2026-08-01T10:00:00Z") + read.replace(timestamp(), "2026-10-10T10:00:00Z") + read.replace(timestamp(), "invalid"))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  await reader.refresh(now + 31 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.level, 0)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 0)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount90, 1)
  await reader.refresh(now + 91 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.level, null)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, null)
})

test("分别统计近 30 与 90 天的会话，超过 90 天的记录不计次数", async t => {
  const { root, logs } = await fixture(t)
  const read = codex("exec_command", { cmd: `cat '${path.join(root, "design", "SKILL.md")}'` })
  for (const age of [0, 40, 80, 91]) {
    await fs.writeFile(path.join(logs, `${age}.jsonl`), sessionMeta(`session-${age}`) + read.replace(timestamp(), new Date(now - age * 86_400_000).toISOString()))
  }
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  const heat = reader.attach([skill(root)])[0].heat
  assert.equal(heat.usageCount, 1)
  assert.equal(heat.usageCount90, 3)
})

test("观察时间从完整统计开始，旧安装时间不提前观察时间，新技能单独开始", async t => {
  const { root, logs, file } = await fixture(t)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo hello" }))
  const source = { root: logs, agent: "Codex CLI", kind: "codex" as const }
  const reader = new SkillHeatReader([source])
  await reader.refresh(now)
  const target = { ...skill(root), installedAt: "2020-01-01T00:00:00Z" }
  const heat = reader.attach([target])[0].heat
  assert.equal(heat.coverageComplete, true)
  assert.equal(heat.observedSince, new Date(now).toISOString())
  assert.equal(heat.observedDays, 0)
  const resumed = new SkillHeatReader([source], JSON.parse(JSON.stringify(reader.cache)))
  const cached = resumed.attach([target])[0].heat
  assert.equal(cached.coverageComplete, false)
  assert.equal(cached.observedSince, heat.observedSince)
  await resumed.refresh(now + 31 * 86_400_000)
  const later = resumed.attach([target, skill(root, "new-skill")])
  assert.equal(later[0].heat.observedSince, heat.observedSince)
  assert.equal(later[0].heat.observedDays, 31)
  assert.equal(later[1].heat.observedSince, new Date(now + 31 * 86_400_000).toISOString())
  assert.equal(later[1].heat.observedDays, 0)
})

test("未覆盖 Agent 或缺少记录时不认定观察完整", async t => {
  const { root, logs, file } = await fixture(t)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo hello" }))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  const result = reader.attach([
    skill(root, "design", ["Codex CLI", "Cursor"]),
    skill(root, "generic", ["通用 Skill 目录"]),
    skill(root, "supported", ["Codex CLI", "通用 Skill 目录"]),
  ])
  assert.equal(result[0].heat.coverageComplete, false)
  assert.equal(result[0].heat.observedSince, undefined)
  assert.equal(result[1].heat.coverageComplete, false)
  assert.equal(result[2].heat.coverageComplete, true)
})

test("未读完时保留观察起点但不能判定完整，读取失败后重新开始观察", async t => {
  const { root, logs, file } = await fixture(t)
  const line = codex("exec_command", { cmd: "echo hello" })
  await fs.writeFile(file, line)
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  const since = reader.attach([skill(root)])[0].heat.observedSince
  await fs.appendFile(file, line.repeat(3))
  await reader.refresh(now + 31 * 86_400_000, Buffer.byteLength(line))
  const partial = reader.attach([skill(root)])[0].heat
  assert.equal(partial.coverageComplete, false)
  assert.equal(partial.observedSince, since)
  const mock = t.mock.method(fs, "open", async () => { throw new Error("Access denied") })
  await reader.refresh(now + 32 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, undefined)
  mock.mock.restore()
  await reader.refresh(now + 33 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, new Date(now + 33 * 86_400_000).toISOString())
})

test("日志丢失或重写后重新观察，即使仍有其它可读日志也不沿用原起点", async t => {
  const { root, logs, file } = await fixture(t)
  const line = codex("exec_command", { cmd: "echo hello" })
  await fs.writeFile(file, line.repeat(3))
  await fs.writeFile(path.join(logs, "other.jsonl"), line)
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  reader.attach([skill(root)])
  await fs.writeFile(file, line)
  await reader.refresh(now + 30 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, new Date(now + 30 * 86_400_000).toISOString())
  await fs.unlink(file)
  await reader.refresh(now + 31 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, new Date(now + 31 * 86_400_000).toISOString())
})

test("旧日志自然超过保留期不会重置仍有可用记录的观察时间", async t => {
  const { root, logs, file } = await fixture(t)
  const line = codex("exec_command", { cmd: "echo hello" })
  const old = path.join(logs, "old.jsonl")
  await fs.writeFile(file, line)
  await fs.utimes(file, new Date(now), new Date(now))
  await fs.writeFile(old, line.replace(timestamp(), new Date(now - 60 * 86_400_000).toISOString()))
  await fs.utimes(old, new Date(now - 60 * 86_400_000), new Date(now - 60 * 86_400_000))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  const since = reader.attach([skill(root)])[0].heat.observedSince
  await reader.refresh(now + 31 * 86_400_000)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, since)
})

test("Agent 适配变化和重新安装都重新开始观察", async t => {
  const { root, logs, file } = await fixture(t)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo hello" }))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  reader.attach([skill(root)])
  await reader.refresh(now + 30 * 86_400_000)
  assert.equal(reader.attach([skill(root, "design", ["Codex CLI", "Cursor"])])[0].heat.observedSince, undefined)
  assert.equal(reader.attach([skill(root)])[0].heat.observedSince, new Date(now + 30 * 86_400_000).toISOString())
  const reinstalled = { ...skill(root), installedAt: new Date(now + 31 * 86_400_000).toISOString() }
  await reader.refresh(now + 32 * 86_400_000)
  assert.equal(reader.attach([reinstalled])[0].heat.observedSince, new Date(now + 32 * 86_400_000).toISOString())
})

test("读取预算内先保留缓存，后续刷新接着读取；日志截断可重建", async t => {
  const { root, logs, file } = await fixture(t)
  const first = codex("exec_command", { cmd: `cat '${path.join(root,"design","SKILL.md")}'` }, 1)
  await fs.writeFile(file, first + codex("exec_command", { cmd: `cat '${path.join(root,"design","SKILL.md")}'` }, 2))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now, Buffer.byteLength(first))
  assert.equal(reader.attach([skill(root)])[0].heat.partial, true)
  const reopened = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }], JSON.parse(JSON.stringify(reader.cache)))
  assert.equal(reopened.attach([skill(root)])[0].heat.partial, true)
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.partial, false)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo reset" }))
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.level, 0)
})

test("不同 Agent 的会话分别累计，日志删除后保留已观察记录", async t => {
  const { root, logs, file } = await fixture(t)
  const other = path.join(root, "claude")
  await fs.mkdir(other)
  await fs.writeFile(file, codex("exec_command", { cmd: `cat '${path.join(root,"design","SKILL.md")}'` }))
  await fs.writeFile(path.join(other,"claude.jsonl"), claude("Skill", { skill: "design" }))
  const reader = new SkillHeatReader([
    { root: logs, agent: "Codex CLI", kind: "codex" },
    { root: other, agent: "Claude Code", kind: "claude" },
  ])
  await reader.refresh(now)
  const target = skill(root, "design", ["Codex CLI", "Claude Code"])
  assert.equal(reader.attach([target])[0].heat.level, 0)
  assert.equal(reader.attach([target])[0].heat.usageCount, 2)
  assert.deepEqual(reader.attach([target])[0].heat.sources, ["Claude Code", "Codex CLI"])
  await fs.unlink(file)
  await reader.refresh(now)
  assert.equal(reader.attach([target])[0].heat.level, 0)
  assert.equal(reader.attach([target])[0].heat.usageCount, 2)
})

test("读取失败保留上次热度，下次刷新成功后清除失败提示", async t => {
  const { root, logs, file } = await fixture(t)
  const read = codex("exec_command", { cmd: `cat '${path.join(root,"design","SKILL.md")}'` })
  await fs.writeFile(file, read)
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  await reader.refresh(now)
  await fs.appendFile(file, read)
  const mock = t.mock.method(fs, "open", async () => { throw new Error("Access denied") })
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  assert.equal(reader.attach([skill(root)])[0].heat.stale, true)
  mock.mock.restore()
  await reader.refresh(now)
  assert.equal(reader.attach([skill(root)])[0].heat.stale, false)
})

test("读取预算分配给每个 Agent，不因第一个来源过大而饿死其它来源", async t => {
  const { root, logs, file } = await fixture(t)
  const other = path.join(root, "claude")
  await fs.mkdir(other)
  await fs.writeFile(file, codex("exec_command", { cmd: "echo " + "x".repeat(3000) }))
  await fs.writeFile(path.join(other,"claude.jsonl"), claude("Skill", { skill: "design" }))
  const reader = new SkillHeatReader([
    { root: logs, agent: "Codex CLI", kind: "codex" },
    { root: other, agent: "Claude Code", kind: "claude" },
  ])
  await reader.refresh(now, 1500)
  assert.equal(reader.attach([skill(root, "design", ["Claude Code"])])[0].heat.usageCount, 1)
})

test("超长图片输出不会卡住增量读取，其后的技能读取仍可识别", async t => {
  const { root, logs, file } = await fixture(t)
  const output = JSON.stringify({ type: "response_item", timestamp: timestamp(), payload: { type: "custom_tool_call_output", output: "x".repeat(3 * 1024 * 1024) } }) + "\n"
  await fs.writeFile(file, output + codex("exec_command", { cmd: `cat '${path.join(root,"design","SKILL.md")}'` }))
  const reader = new SkillHeatReader([{ root: logs, agent: "Codex CLI", kind: "codex" }])
  for (let i = 0; i < 3; i++) await reader.refresh(now, 1.5 * 1024 * 1024)
  assert.equal(reader.attach([skill(root)])[0].heat.usageCount, 1)
  assert.equal(reader.attach([skill(root)])[0].heat.partial, false)
})
