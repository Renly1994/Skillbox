import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parse as parseJsonc } from "jsonc-parser"
import {
  addMcpServer,
  removeMcpServer,
  scanMcpLibrary,
  setMcpConnection,
  syncMcpServer,
  validateServerName,
} from "../src/main/mcp-config"
import type { McpAgentConfigEntry } from "../src/main/mcp-registry"
import { mcpAgentRegistry } from "../src/main/mcp-registry"

interface Fixture {
  root: string
  backupsDir: string
  registry: McpAgentConfigEntry[]
  paths: Record<string, string>
}

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-mcp-"))
  const backupsDir = path.join(root, "backups")
  const paths: Record<string, string> = {
    "agent-a": path.join(root, "a", "config.json"),
    "agent-b": path.join(root, "b", "mcp.json"),
    "agent-codex": path.join(root, "codex", "config.toml"),
    "agent-broken": path.join(root, "broken", "mcp.json"),
  }
  const registry: McpAgentConfigEntry[] = [
    {
      id: "agent-a",
      displayName: "Agent A",
      shortCode: "AA",
      configPath: paths["agent-a"],
      format: "json-mcpServers",
      installedDir: path.join(root, "a"),
      writable: true,
    },
    {
      id: "agent-b",
      displayName: "Agent B",
      shortCode: "AB",
      configPath: paths["agent-b"],
      format: "json-mcpServers",
      installedDir: path.join(root, "b"),
      writable: true,
    },
    {
      id: "agent-codex",
      displayName: "Codex",
      shortCode: "CX",
      configPath: paths["agent-codex"],
      format: "codex-toml",
      installedDir: path.join(root, "codex"),
      writable: false,
    },
    {
      id: "agent-broken",
      displayName: "Broken",
      shortCode: "BR",
      configPath: paths["agent-broken"],
      format: "json-mcpServers",
      installedDir: path.join(root, "broken"),
      writable: true,
    },
  ]
  for (const agent of registry) {
    await fs.mkdir(agent.installedDir, { recursive: true })
  }
  try {
    await run({ root, backupsDir, registry, paths })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function writeJson(filePath: string, doc: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2), "utf-8")
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>
}

test("同名 server 的凭据不同时检出配置漂移,且 env 值不离开主进程", async () => {
  await withFixture(async ({ registry, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: {
        fs: { command: "npx", args: ["-y", "mcp-fs", "/data"], env: { API_KEY: "secret-a" } },
      },
    })
    await writeJson(paths["agent-b"], {
      mcpServers: {
        fs: { command: "npx", args: ["-y", "mcp-fs", "/data"], env: { API_KEY: "secret-b" } },
      },
    })

    const library = await scanMcpLibrary(registry)
    assert.equal(library.errors.length, 0)

    const entry = library.servers.find((s) => s.name === "fs")
    assert.ok(entry)
    assert.equal(entry.consistent, false)
    assert.equal(entry.connections.length, 2)
    assert.notEqual(entry.connections[0].signature, entry.connections[1].signature)
    assert.equal(entry.hasEnv, true)

    const connA = entry.connections.find((c) => c.agentId === "agent-a")
    assert.ok(connA)
    assert.deepEqual(connA.envKeys, ["API_KEY"])
    assert.ok(connA.raw.includes("••••"))
    assert.ok(!connA.raw.includes("secret-a"))
    // env values must never leave the main process in any field
    assert.ok(!JSON.stringify(library).includes("secret-a"))
    assert.ok(!JSON.stringify(library).includes("secret-b"))
  })
})

test("URL、headers、环境变量和启动参数中的假凭据不会进入扫描结果", async () => {
  await withFixture(async ({ registry, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: {
        remote: {
          url: "https://example.com/mcp?access_token=FAKE_URL_CREDENTIAL&region=west",
          headers: { Authorization: "Bearer FAKE_HEADER_CREDENTIAL" },
        },
        local: {
          command: "node",
          args: [
            "server.js",
            "--api-key",
            "FAKE_ARG_CREDENTIAL",
            "--token=FAKE_INLINE_CREDENTIAL",
            "--endpoint",
            "https://example.com/?token=FAKE_NESTED_CREDENTIAL",
          ],
          env: { MCP_SECRET: "FAKE_ENV_CREDENTIAL" },
        },
      },
    })

    const library = await scanMcpLibrary(registry)
    for (const fake of [
      "FAKE_URL_CREDENTIAL",
      "FAKE_HEADER_CREDENTIAL",
      "FAKE_ARG_CREDENTIAL",
      "FAKE_INLINE_CREDENTIAL",
      "FAKE_NESTED_CREDENTIAL",
      "FAKE_ENV_CREDENTIAL",
    ]) {
      const leakedFields: string[] = []
      const findLeak = (value: unknown, field: string) => {
        if (typeof value === "string" && value.includes(fake)) leakedFields.push(field)
        else if (Array.isArray(value)) value.forEach((item, index) => findLeak(item, `${field}[${index}]`))
        else if (value && typeof value === "object") {
          Object.entries(value).forEach(([key, item]) => findLeak(item, `${field}.${key}`))
        }
      }
      findLeak(library, "library")
      assert.ok(leakedFields.length === 0, `scan output leaked through ${leakedFields.join(", ")}`)
    }
    assert.ok(library.servers.find((server) => server.name === "remote")?.url?.includes("region=west"))
  })
})

test("配置文件损坏时记入 errors 并继续扫描其他 agent", async () => {
  await withFixture(async ({ registry, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: { ok: { command: "npx" } },
    })
    await fs.writeFile(paths["agent-broken"], "{ not valid json", "utf-8")

    const library = await scanMcpLibrary(registry)
    assert.equal(library.errors.length, 1)
    assert.equal(library.errors[0].agentId, "agent-broken")
    assert.equal(library.errors[0].configPath, paths["agent-broken"])

    const brokenInfo = library.agents.find((a) => a.id === "agent-broken")
    assert.ok(brokenInfo?.parseError)
    assert.equal(brokenInfo.configExists, true)

    // other agents are still scanned
    assert.ok(library.servers.some((s) => s.name === "ok"))

    // missing config file is not an error
    const codexInfo = library.agents.find((a) => a.id === "agent-codex")
    assert.equal(codexInfo?.configExists, false)
    assert.equal(codexInfo?.parseError, undefined)
  })
})

test("配置不一致时必须显式选择来源,写入后生成备份并保留未知键", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    // majority shape: args ["/data"] (agent-a and codex), agent-b drifts
    await writeJson(paths["agent-a"], {
      mcpServers: { fs: { command: "npx", args: ["/data"] } },
    })
    await writeJson(paths["agent-b"], {
      mcpServers: { fs: { command: "npx", args: ["/other"] } },
      otherSetting: { keep: "me" },
    })
    const codexDir = path.dirname(paths["agent-codex"])
    await fs.mkdir(codexDir, { recursive: true })
    await fs.writeFile(
      paths["agent-codex"],
      ['[mcp_servers.fs]', 'command = "npx"', 'args = ["/data"]', ""].join("\n"),
      "utf-8",
    )
    const before = await fs.readFile(paths["agent-b"], "utf-8")

    const ambiguous = await setMcpConnection("fs", "agent-b", true, undefined, {
      registry,
      backupsDir,
    })
    assert.equal(ambiguous.ok, false)
    assert.match(ambiguous.error ?? "", /choose a source agent/)

    const unchanged = await readJson(paths["agent-b"])
    assert.deepEqual((unchanged.mcpServers as Record<string, { args: string[] }>).fs.args, ["/other"])

    const enable = await setMcpConnection("fs", "agent-b", true, "agent-a", {
      registry,
      backupsDir,
    })
    assert.equal(enable.ok, true, enable.error)
    assert.deepEqual(enable.written, [paths["agent-b"]])
    assert.equal(enable.backups.length, 1)

    const backupContent = await fs.readFile(enable.backups[0], "utf-8")
    assert.equal(backupContent, before)

    const doc = await readJson(paths["agent-b"])
    assert.deepEqual(doc.otherSetting, { keep: "me" })
    const servers = doc.mcpServers as Record<string, { args?: string[] }>
    assert.deepEqual(servers.fs.args, ["/data"])

    const disable = await setMcpConnection("fs", "agent-b", false, undefined, {
      registry,
      backupsDir,
    })
    assert.equal(disable.ok, true, disable.error)
    const after = await readJson(paths["agent-b"])
    assert.deepEqual(after.mcpServers, {})
    assert.deepEqual(after.otherSetting, { keep: "me" })

    // read-only agent is rejected
    const readOnly = await setMcpConnection("fs", "agent-codex", true, undefined, {
      registry,
      backupsDir,
    })
    assert.equal(readOnly.ok, false)
    assert.match(readOnly.error ?? "", /read-only/)
  })
})

test("多目标同步部分失败时保留成功目标、逐目标报错并恢复失败目标备份", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], { mcpServers: { fs: { command: "npx", args: ["tool"] } } })
    await writeJson(paths["agent-b"], { mcpServers: {}, keep: true })
    const previousCodex = '[mcp_servers.fs]\ncommand = "old"\n'
    await fs.writeFile(paths["agent-codex"], previousCodex, "utf-8")
    const codex = registry.find((agent) => agent.id === "agent-codex")
    assert.ok(codex)
    codex.writable = true
    codex.writeStrategy = "codex-cli"

    const result = await syncMcpServer("fs", "agent-a", ["agent-b", "agent-codex"], {
      registry,
      backupsDir,
      commandRunner: async () => {
        throw new Error("simulated CLI failure")
      },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(result.written, [paths["agent-b"]])
    assert.match(result.error ?? "", /Codex.*simulated CLI failure/)
    assert.deepEqual((await readJson(paths["agent-b"])).keep, true)
    assert.equal(await fs.readFile(paths["agent-codex"], "utf-8"), previousCodex)
    assert.equal(result.backups.length, 1)
    assert.equal(await fs.readFile(result.backups[0], "utf-8"), JSON.stringify({ mcpServers: {}, keep: true }, null, 2))
    const failedTargetBackups = await fs.readdir(path.join(backupsDir, "agent-codex"))
    assert.equal(failedTargetBackups.length, 1)
    const failedBackupPath = path.join(backupsDir, "agent-codex", failedTargetBackups[0])
    assert.ok(result.error?.includes(failedBackupPath), "failed target backup must be visible for recovery")
    assert.equal(await fs.readFile(failedBackupPath, "utf-8"), previousCodex)
  })
})

test("含不支持字段的配置在写入前明确拒绝且不丢字段", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: { fs: { command: "npx", disabled: true } },
    })
    await writeJson(paths["agent-b"], { mcpServers: { fs: { command: "old" } }, keep: true })
    const before = await fs.readFile(paths["agent-b"], "utf-8")

    const result = await syncMcpServer("fs", "agent-a", ["agent-b"], {
      registry,
      backupsDir,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? "", /不支持的字段：disabled/)
    assert.equal(await fs.readFile(paths["agent-b"], "utf-8"), before)
    assert.deepEqual(result.written, [])
  })
})

test("损坏的 JSON 配置拒绝写入", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: { fs: { command: "npx", args: ["/data"] } },
    })
    await fs.writeFile(paths["agent-broken"], "{ broken", "utf-8")

    const result = await setMcpConnection("fs", "agent-broken", true, undefined, {
      registry,
      backupsDir,
    })
    assert.equal(result.ok, false)
    assert.match(result.error ?? "", /not valid JSON/)
    // file is left untouched and no backup/write happened
    assert.equal(await fs.readFile(paths["agent-broken"], "utf-8"), "{ broken")
    assert.deepEqual(result.written, [])
    assert.deepEqual(result.backups, [])
  })
})

test("codex TOML 受限解析器读取 mcp_servers 表", async () => {
  await withFixture(async ({ registry, paths }) => {
    await fs.writeFile(
      paths["agent-codex"],
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.wiki]",
        'command = "npx"',
        'args = ["-y", \'@wiki/mcp\', \'D:\\Temp\\skillbox-mcp\']',
        "startup_timeout_sec = 10",
        "",
        "[mcp_servers.wiki.env]",
        'TOKEN = "codex-secret"',
        "",
        "[mcp_servers.remote]",
        'url = "https://example.com/mcp"',
        "",
        "[other_section]",
        'key = "value"',
        "",
      ].join("\n"),
      "utf-8",
    )

    const library = await scanMcpLibrary(registry)
    assert.equal(library.errors.length, 0)

    const wiki = library.servers.find((s) => s.name === "wiki")
    assert.ok(wiki)
    assert.equal(wiki.type, "stdio")
    assert.equal(wiki.command, "npx")
    assert.deepEqual(wiki.args, ["-y", "@wiki/mcp", "D:\\Temp\\skillbox-mcp"])
    assert.deepEqual(wiki.connections[0].envKeys, ["TOKEN"])
    assert.ok(!JSON.stringify(library).includes("codex-secret"))

    const remote = library.servers.find((s) => s.name === "remote")
    assert.ok(remote)
    assert.equal(remote.type, "http")
    assert.equal(remote.url, "https://example.com/mcp")

    // malformed content inside an mcp_servers table is a parse error
    await fs.writeFile(
      paths["agent-codex"],
      ['[mcp_servers.bad]', "this is not toml", ""].join("\n"),
      "utf-8",
    )
    const broken = await scanMcpLibrary(registry)
    assert.equal(broken.errors.length, 1)
    assert.equal(broken.errors[0].agentId, "agent-codex")
  })
})

test("addMcpServer 校验 server 名并写入选中 agent", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    for (const bad of ["", "a/b", "a\\b", "..", "a..b", "has space", "x".repeat(65)]) {
      assert.ok(validateServerName(bad) !== null, `expected "${bad}" to be rejected`)
      const result = await addMcpServer(
        { name: bad, type: "stdio", command: "npx" },
        ["agent-a"],
        { registry, backupsDir },
      )
      assert.equal(result.ok, false, `expected "${bad}" to fail`)
    }
    assert.equal(validateServerName("mcp-fs_1.2"), null)

    const ok = await addMcpServer(
      {
        name: "mcp-fs_1.2",
        type: "stdio",
        command: "npx",
        args: ["-y", "mcp-fs"],
        env: { KEY: "v" },
      },
      ["agent-a", "agent-b"],
      { registry, backupsDir },
    )
    assert.equal(ok.ok, true, ok.error)
    assert.equal(ok.written.length, 2)

    const docA = await readJson(paths["agent-a"])
    assert.deepEqual(docA.mcpServers, {
      "mcp-fs_1.2": { command: "npx", args: ["-y", "mcp-fs"], env: { KEY: "v" } },
    })

    // duplicate name in an agent is rejected without clobbering
    const dup = await addMcpServer(
      { name: "mcp-fs_1.2", type: "stdio", command: "other" },
      ["agent-a"],
      { registry, backupsDir },
    )
    assert.equal(dup.ok, false)
    const stillA = await readJson(paths["agent-a"])
    assert.equal(
      (stillA.mcpServers as Record<string, { command: string }>)["mcp-fs_1.2"].command,
      "npx",
    )

    // stdio without command / http without url are rejected
    const noCmd = await addMcpServer(
      { name: "valid", type: "stdio" } as never,
      ["agent-a"],
      { registry, backupsDir },
    )
    assert.equal(noCmd.ok, false)
    const noUrl = await addMcpServer({ name: "valid", type: "http" }, ["agent-a"], {
      registry,
      backupsDir,
    })
    assert.equal(noUrl.ok, false)
  })
})

test("syncMcpServer 以 source 为准写入 target,removeMcpServer 从所有可写 agent 删除", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: { fs: { command: "npx", args: ["/data"], env: { K: "1" } } },
    })
    await writeJson(paths["agent-b"], {
      mcpServers: { fs: { command: "old", args: [] } },
    })

    const sync = await syncMcpServer("fs", "agent-a", ["agent-b"], {
      registry,
      backupsDir,
    })
    assert.equal(sync.ok, true, sync.error)
    const docB = await readJson(paths["agent-b"])
    assert.deepEqual(docB.mcpServers, {
      fs: { command: "npx", args: ["/data"], env: { K: "1" } },
    })
    assert.equal(sync.backups.length, 1)

    // source missing the server -> error, nothing written
    const missing = await syncMcpServer("nope", "agent-a", ["agent-b"], {
      registry,
      backupsDir,
    })
    assert.equal(missing.ok, false)

    const removed = await removeMcpServer("fs", { registry, backupsDir })
    assert.equal(removed.ok, true, removed.error)
    assert.equal(removed.written.length, 2)
    assert.deepEqual((await readJson(paths["agent-a"])).mcpServers, {})
    assert.deepEqual((await readJson(paths["agent-b"])).mcpServers, {})
    // codex is read-only and was never created
    await assert.rejects(fs.stat(paths["agent-codex"]))
  })
})

test("同一 Agent 的并发写入会串行合并且备份名不冲突", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: {
        one: { command: "one" },
        two: { command: "two" },
      },
    })
    await writeJson(paths["agent-b"], { mcpServers: {} })

    const [one, two] = await Promise.all([
      setMcpConnection("one", "agent-b", true, "agent-a", { registry, backupsDir }),
      setMcpConnection("two", "agent-b", true, "agent-a", { registry, backupsDir }),
    ])

    assert.equal(one.ok, true, one.error)
    assert.equal(two.ok, true, two.error)
    assert.deepEqual((await readJson(paths["agent-b"])).mcpServers, {
      one: { command: "one" },
      two: { command: "two" },
    })
    assert.equal(new Set([...one.backups, ...two.backups]).size, 2)
  })
})

test("Codex 适配器通过官方 CLI 定向更新并保留写入前备份", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: {
        fs: { command: "npx", args: ["-y", "mcp-fs"], env: { API_KEY: "secret" } },
      },
    })
    await fs.writeFile(
      paths["agent-codex"],
      ['model = "gpt-5"', "", "[mcp_servers.fs]", 'command = "old"', ""].join("\n"),
      "utf-8",
    )

    const codex = registry.find((agent) => agent.id === "agent-codex")
    assert.ok(codex)
    codex.writable = true
    codex.writeStrategy = "codex-cli"

    const calls: Array<{ command: string; args: string[] }> = []
    const codexHomes: Array<string | undefined> = []
    const result = await syncMcpServer("fs", "agent-a", ["agent-codex"], {
      registry,
      backupsDir,
      commandRunner: async (command, args, env) => {
        calls.push({ command, args })
        codexHomes.push(env?.CODEX_HOME)
        if (args[1] === "add") {
          await fs.writeFile(
            paths["agent-codex"],
            [
              'model = "gpt-5"',
              "",
              "[mcp_servers.fs]",
              'command = "npx"',
              'args = ["-y", "mcp-fs"]',
              "",
              "[mcp_servers.fs.env]",
              'API_KEY = "secret"',
              "",
            ].join("\n"),
            "utf-8",
          )
        }
      },
    })

    assert.equal(result.ok, true, result.error)
    assert.deepEqual(calls, [
      { command: "codex", args: ["mcp", "remove", "fs"] },
      {
        command: "codex",
        args: [
          "mcp",
          "add",
          "--env",
          "API_KEY=secret",
          "fs",
          "--",
          "npx",
          "-y",
          "mcp-fs",
        ],
      },
    ])
    assert.deepEqual(result.written, [paths["agent-codex"]])
    assert.deepEqual(codexHomes, [path.dirname(paths["agent-codex"]), path.dirname(paths["agent-codex"])])
    assert.equal(result.backups.length, 1)
    assert.equal(
      await fs.readFile(result.backups[0], "utf-8"),
      ['model = "gpt-5"', "", "[mcp_servers.fs]", 'command = "old"', ""].join("\n"),
    )
  })
})

test("Codex HTTP bearer_token_env_var 扫描及同步后保留 JSON Authorization", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await fs.writeFile(
      paths["agent-codex"],
      [
        '[mcp_servers.remote]',
        'url = "https://example.com/mcp"',
        'bearer_token_env_var = "MCP_TOKEN"',
        "",
      ].join("\n"),
      "utf-8",
    )
    await writeJson(paths["agent-a"], {
      mcpServers: {
        remote: {
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${MCP_TOKEN}" },
        },
      },
    })

    const before = await scanMcpLibrary(registry)
    assert.equal(before.servers.find((server) => server.name === "remote")?.consistent, true)

    await writeJson(paths["agent-a"], {
      mcpServers: {
        remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer old" } },
      },
    })
    const result = await syncMcpServer("remote", "agent-codex", ["agent-a"], {
      registry,
      backupsDir,
    })

    assert.equal(result.ok, true, result.error)
    const written = await readJson(paths["agent-a"])
    assert.deepEqual(
      (written.mcpServers as Record<string, { headers?: Record<string, string> }>).remote.headers,
      { Authorization: "Bearer ${MCP_TOKEN}" },
    )
    const after = await scanMcpLibrary(registry)
    assert.equal(after.servers.find((server) => server.name === "remote")?.consistent, true)
  })
})

test("注册表只启用已确认配置契约的多 Agent 适配器", () => {
  const ids = mcpAgentRegistry.map((agent) => agent.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of [
    "kiro",
    "cline",
    "junie",
    "codebuddy",
    "iflow-cli",
    "qwen-code",
    "kimi-code",
    "zcode",
    "copilot-cli",
    "qoder",
    "vscode",
    "zed",
    "amp",
    "openclaw",
    "roo-code",
    "kilo-code",
    "mimo-code",
    "workbuddy",
  ]) {
    assert.ok(ids.includes(id), `missing MCP adapter: ${id}`)
  }
  for (const unsupported of ["minimax-code", "trae", "trae-cn", "continue"]) {
    assert.ok(!ids.includes(unsupported), `unverified adapter must stay disabled: ${unsupported}`)
  }
  assert.ok(!ids.includes("pi"), "Pi 没有内置 MCP 配置格式")
})

test("WorkBuddy 用户级 MCP 配置可读写本地与远程服务", async () => {
  const agent = mcpAgentRegistry.find((item) => item.id === "workbuddy")
  assert.ok(agent)
  assert.equal(agent.configPath, path.join(os.homedir(), ".workbuddy", "mcp.json"))

  await withFixture(async ({ root, backupsDir }) => {
    const configPath = path.join(root, "workbuddy", "mcp.json")
    const registry = [{ ...agent, configPath, installedDir: path.dirname(configPath) }]
    await fs.mkdir(path.dirname(configPath), { recursive: true })

    const local = await addMcpServer(
      { name: "local-tool", type: "stdio", command: "node", args: ["server.js"] },
      ["workbuddy"],
      { registry, backupsDir },
    )
    const remote = await addMcpServer(
      { name: "remote-tool", type: "http", url: "https://example.com/mcp" },
      ["workbuddy"],
      { registry, backupsDir },
    )
    assert.equal(local.ok, true, local.error)
    assert.equal(remote.ok, true, remote.error)
    assert.deepEqual((await readJson(configPath)).mcpServers, {
      "local-tool": { type: "stdio", command: "node", args: ["server.js"] },
      "remote-tool": { type: "streamableHttp", url: "https://example.com/mcp" },
    })
    const scanned = await scanMcpLibrary(registry)
    assert.deepEqual(scanned.servers.map((server) => server.name), ["local-tool", "remote-tool"])
  })
})

test("各 Agent 的官方用户级配置样例均能识别 MCP 服务", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-mcp-contracts-"))
  const stdio = { command: "node", args: ["server.js"] }
  const cases: Record<string, unknown> = {
    "claude-code": { mcpServers: { sample: stdio } },
    cursor: { mcpServers: { sample: stdio } },
    windsurf: { mcpServers: { sample: { serverUrl: "https://example.com/mcp" } } },
    "gemini-cli": { mcpServers: { sample: { httpUrl: "https://example.com/mcp" } } },
    zcode: { mcp: { servers: { sample: { type: "stdio", ...stdio } } } },
    opencode: { mcp: { sample: { type: "local", command: ["node", "server.js"] } } },
    kiro: { mcpServers: { sample: stdio } },
    cline: { mcpServers: { sample: stdio } },
    junie: { mcpServers: { sample: stdio } },
    codebuddy: { mcpServers: { sample: stdio } },
    workbuddy: { mcpServers: { sample: { type: "stdio", ...stdio } } },
    "iflow-cli": { mcpServers: { sample: stdio } },
    "qwen-code": { mcpServers: { sample: { httpUrl: "https://example.com/mcp" } } },
    "kimi-code": { mcpServers: { sample: stdio } },
    "copilot-cli": { mcpServers: { sample: { type: "local", ...stdio } } },
    qoder: { mcpServers: { sample: stdio } },
    vscode: { servers: { sample: { type: "stdio", ...stdio } } },
    zed: { context_servers: { sample: stdio } },
    amp: { "amp.mcpServers": { sample: stdio } },
    openclaw: { mcp: { servers: { sample: stdio } } },
    "roo-code": { mcpServers: { sample: stdio } },
    "kilo-code": { mcp: { sample: { type: "local", command: ["node", "server.js"] } } },
    "mimo-code": { mcp: { sample: { type: "local", command: ["node", "server.js"] } } },
  }
  try {
    const registry = mcpAgentRegistry.map((agent) => ({
      ...agent,
      configPath: path.join(root, agent.id, "config.json"),
      installedDir: path.join(root, agent.id),
      alternateConfigPaths: [],
      alternateInstalledDirs: [],
      detectInstalled: undefined,
    }))
    for (const agent of registry) {
      await fs.mkdir(agent.installedDir, { recursive: true })
      const content = agent.id === "codex"
        ? '[mcp_servers.sample]\ncommand = "node"\nargs = ["server.js"]\n'
        : JSON.stringify(cases[agent.id])
      assert.ok(content, `缺少 ${agent.id} 的配置样例`)
      await fs.writeFile(agent.configPath, content, "utf-8")
    }
    const result = await scanMcpLibrary(registry)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(
      result.servers.find((server) => server.name === "sample")?.connections.map((connection) => connection.agentId).sort(),
      registry.map((agent) => agent.id).sort(),
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("Cline 优先读取当前共享 MCP 配置，兼容旧版 VS Code 路径", () => {
  const cline = mcpAgentRegistry.find((agent) => agent.id === "cline")
  assert.ok(cline)
  assert.equal(cline.configPath, path.join(os.homedir(), ".cline", "data", "settings", "cline_mcp_settings.json"))
  assert.ok(cline.alternateConfigPaths?.some((item) => item.includes("globalStorage")))
})

test("MCP Agent 可用命令检测排除只有配置目录的假安装", async () => {
  await withFixture(async ({ registry }) => {
    const agent = registry.find((entry) => entry.id === "agent-a")
    assert.ok(agent)
    agent.detectInstalled = async () => false
    const library = await scanMcpLibrary(registry)
    assert.equal(library.agents.find((entry) => entry.id === "agent-a")?.installed, false)
  })
})

test("ZCode 按用户级 mcp.servers 读取并保留其他配置", async () => {
  await withFixture(async ({ root, backupsDir }) => {
    const zcode = mcpAgentRegistry.find((agent) => agent.id === "zcode")
    assert.ok(zcode)
    const configPath = path.join(root, "zcode", "cli", "config.json")
    const registry = [{ ...zcode, configPath, installedDir: path.join(root, "zcode") }]
    await writeJson(configPath, {
      hooks: { enabled: true },
      mcp: { servers: { docs: { type: "http", url: "https://example.com/mcp" } } },
    })
    const before = await scanMcpLibrary(registry)
    assert.deepEqual(before.servers.map((server) => server.name), ["docs"])

    const added = await addMcpServer(
      { name: "local", type: "stdio", command: "npx", args: ["tool"] },
      ["zcode"],
      { registry, backupsDir },
    )
    assert.equal(added.ok, true, added.error)
    const after = await readJson(configPath)
    assert.deepEqual(after.hooks, { enabled: true })
    assert.deepEqual(after.mcp, {
      servers: {
        docs: { type: "http", url: "https://example.com/mcp" },
        local: { type: "stdio", command: "npx", args: ["tool"] },
      },
    })
  })
})

test("JSONC 嵌套配置定点更新并保留注释和同级设置", async () => {
  await withFixture(async ({ root, backupsDir, registry, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: { fs: { command: "npx", args: ["-y", "mcp-fs"], cwd: "C:/tools" } },
    })
    const nestedPath = path.join(root, "nested", "settings.jsonc")
    const nestedAgent: McpAgentConfigEntry = {
      id: "nested",
      displayName: "Nested",
      shortCode: "NE",
      configPath: nestedPath,
      format: "json-mcpServers",
      containerPath: ["mcp", "servers"],
      installedDir: path.dirname(nestedPath),
      writable: true,
    }
    registry.push(nestedAgent)
    await fs.mkdir(path.dirname(nestedPath), { recursive: true })
    await fs.writeFile(
      nestedPath,
      ['{', '  // 用户自己的设置', '  "theme": "dark",', '  "mcp": { "servers": {} },', '}'].join("\n"),
      "utf-8",
    )

    const result = await syncMcpServer("fs", "agent-a", ["nested"], { registry, backupsDir })
    assert.equal(result.ok, true, result.error)
    const content = await fs.readFile(nestedPath, "utf-8")
    assert.match(content, /用户自己的设置/)
    const parsed = parseJsonc(content) as Record<string, unknown>
    assert.equal(parsed.theme, "dark")
    assert.deepEqual(parsed.mcp, {
      servers: { fs: { command: "npx", args: ["-y", "mcp-fs"], cwd: "C:/tools" } },
    })
  })
})

test("不同 Agent 的键名和 entry schema 按注册表转换", async () => {
  await withFixture(async ({ root, backupsDir }) => {
    const qwenPath = path.join(root, "qwen", "settings.json")
    const vscodePath = path.join(root, "vscode", "mcp.json")
    const opencodePath = path.join(root, "opencode", "opencode.jsonc")
    const registry: McpAgentConfigEntry[] = [
      {
        id: "qwen",
        displayName: "Qwen",
        shortCode: "QW",
        configPath: qwenPath,
        format: "json-mcpServers",
        entryStyle: "qwen",
        installedDir: path.dirname(qwenPath),
        writable: true,
      },
      {
        id: "vscode",
        displayName: "VS Code",
        shortCode: "VS",
        configPath: vscodePath,
        format: "json-mcpServers",
        containerPath: ["servers"],
        entryStyle: "vscode",
        installedDir: path.dirname(vscodePath),
        writable: true,
      },
      {
        id: "opencode",
        displayName: "OpenCode",
        shortCode: "OC",
        configPath: opencodePath,
        format: "opencode-json",
        entryStyle: "opencode",
        installedDir: path.dirname(opencodePath),
        writable: true,
      },
    ]
    await Promise.all(registry.map((agent) => fs.mkdir(agent.installedDir, { recursive: true })))

    const remote = await addMcpServer(
      {
        name: "docs",
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer secret" },
      },
      ["qwen", "vscode"],
      { registry, backupsDir },
    )
    assert.equal(remote.ok, true, remote.error)
    assert.deepEqual((await readJson(qwenPath)).mcpServers, {
      docs: {
        httpUrl: "https://example.com/mcp",
        headers: { Authorization: "Bearer secret" },
      },
    })
    assert.deepEqual((await readJson(vscodePath)).servers, {
      docs: {
        url: "https://example.com/mcp",
        type: "http",
        headers: { Authorization: "Bearer secret" },
      },
    })

    const local = await addMcpServer(
      { name: "local", type: "stdio", command: "npx", args: ["-y", "tool"], env: { TOKEN: "x" } },
      ["opencode"],
      { registry, backupsDir },
    )
    assert.equal(local.ok, true, local.error)
    assert.deepEqual((await readJson(opencodePath)).mcp, {
      local: {
        type: "local",
        command: ["npx", "-y", "tool"],
        environment: { TOKEN: "x" },
      },
    })

    const library = await scanMcpLibrary(registry)
    const docs = library.servers.find((server) => server.name === "docs")
    assert.ok(docs)
    assert.equal(docs.consistent, true)
    assert.ok(!JSON.stringify(library).includes("Bearer secret"))
    assert.deepEqual(docs.connections[0].headerKeys, ["Authorization"])
  })
})

test("优先使用已经存在的兼容配置路径", async () => {
  await withFixture(async ({ root, backupsDir, registry, paths }) => {
    await writeJson(paths["agent-a"], { mcpServers: { fs: { command: "npx" } } })
    const primary = path.join(root, "alternate", "new.json")
    const legacy = path.join(root, "alternate", "legacy.json")
    const alternateAgent: McpAgentConfigEntry = {
      id: "alternate",
      displayName: "Alternate",
      shortCode: "AL",
      configPath: primary,
      alternateConfigPaths: [legacy],
      format: "json-mcpServers",
      installedDir: path.dirname(primary),
      writable: true,
    }
    registry.push(alternateAgent)
    await writeJson(legacy, { mcpServers: {} })

    const before = await scanMcpLibrary(registry)
    assert.equal(before.agents.find((agent) => agent.id === "alternate")?.configPath, legacy)
    const result = await syncMcpServer("fs", "agent-a", ["alternate"], { registry, backupsDir })
    assert.equal(result.ok, true, result.error)
    assert.deepEqual((await readJson(legacy)).mcpServers, { fs: { command: "npx" } })
    await assert.rejects(fs.stat(primary))
  })
})

test("OpenClaw 通过官方 CLI 更新 JSON5 配置", async () => {
  await withFixture(async ({ root, backupsDir, registry, paths }) => {
    await writeJson(paths["agent-a"], { mcpServers: { fs: { command: "npx", args: ["tool"] } } })
    const configPath = path.join(root, "openclaw", "openclaw.json")
    const openclaw: McpAgentConfigEntry = {
      id: "openclaw",
      displayName: "OpenClaw",
      shortCode: "OA",
      configPath,
      format: "json-mcpServers",
      containerPath: ["mcp", "servers"],
      entryStyle: "openclaw",
      json5: true,
      installedDir: path.dirname(configPath),
      writable: true,
      writeStrategy: "openclaw-cli",
    }
    registry.push(openclaw)
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, "{ mcp: { servers: {} } }", "utf-8")
    const calls: Array<{ command: string; args: string[] }> = []

    const result = await syncMcpServer("fs", "agent-a", ["openclaw"], {
      registry,
      backupsDir,
      commandRunner: async (command, args) => {
        calls.push({ command, args })
        if (args[1] === "set") {
          await fs.writeFile(
            configPath,
            "{ mcp: { servers: { fs: { command: 'npx', args: ['tool'] } } } }",
            "utf-8",
          )
        }
      },
    })
    assert.equal(result.ok, true, result.error)
    assert.deepEqual(calls, [
      {
        command: "openclaw",
        args: ["mcp", "set", "fs", '{"command":"npx","args":["tool"]}'],
      },
    ])
    assert.equal(result.backups.length, 1)
  })
})

test("Codex 远程 MCP 只安全转换环境变量形式的 Bearer Token", async () => {
  await withFixture(async ({ registry, backupsDir, paths }) => {
    await writeJson(paths["agent-a"], {
      mcpServers: {
        safe: {
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${MCP_TOKEN}" },
        },
        unsafe: {
          url: "https://example.com/private",
          headers: { Authorization: "Bearer literal-secret" },
        },
      },
    })
    await fs.writeFile(paths["agent-codex"], 'model = "gpt-5"\n', "utf-8")
    const codex = registry.find((agent) => agent.id === "agent-codex")
    assert.ok(codex)
    codex.writable = true
    codex.writeStrategy = "codex-cli"
    const calls: Array<{ command: string; args: string[] }> = []
    const options = {
      registry,
      backupsDir,
      commandRunner: async (command: string, args: string[]) => {
        calls.push({ command, args })
        if (args[1] === "add") {
          await fs.writeFile(
            paths["agent-codex"],
            [
              "[mcp_servers.safe]",
              'url = "https://example.com/mcp"',
              'bearer_token_env_var = "MCP_TOKEN"',
              "",
            ].join("\n"),
            "utf-8",
          )
        }
      },
    }

    const safe = await syncMcpServer("safe", "agent-a", ["agent-codex"], options)
    assert.equal(safe.ok, true, safe.error)
    const safeAfter = await scanMcpLibrary(registry)
    assert.equal(safeAfter.servers.find((server) => server.name === "safe")?.consistent, true)
    assert.deepEqual(calls, [
      {
        command: "codex",
        args: [
          "mcp",
          "add",
          "safe",
          "--url",
          "https://example.com/mcp",
          "--bearer-token-env-var",
          "MCP_TOKEN",
        ],
      },
    ])

    const unsafe = await syncMcpServer("unsafe", "agent-a", ["agent-codex"], options)
    assert.equal(unsafe.ok, false)
    assert.match(unsafe.error ?? "", /无法安全复制当前请求头/)
    assert.equal(calls.length, 1)
  })
})
