import assert from "node:assert/strict"
import fs from "node:fs"
import fsp from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { PROJECT_PROBES, type AgentEntry } from "../src/main/agent-registry"
import { findCustomSkillLocations } from "../src/main/custom-skill-scanner"
import type { McpAgentConfigEntry } from "../src/main/mcp-registry"
import type { AgentConfig } from "../../../packages/cli/src/types"

const require = createRequire(import.meta.url)

function loadRegistries(platform: NodeJS.Platform, roots: string[]) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const home = platform === "win32" ? "C:\\用户" : "/home/用户"
  const directories = new Set(roots.map((root) => paths.join(home, root)))
  const bindings: Record<string, unknown> = {
    "node:os": { homedir: () => home },
    "node:path": paths,
    "node:fs/promises": {
      stat: async (target: string) => {
        if (!directories.has(target)) throw new Error("ENOENT")
        return { isDirectory: () => true, isFile: () => false }
      },
    },
    "../constants.js": { AGENTS_DIR: ".agents", SKILLS_SUBDIR: "skills" },
  }
  function load(relativePath: string) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8")
    const exports: Record<string, unknown> = {}
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, {
      exports,
      require: (name: string) => bindings[name] ?? require(name),
      process: { platform, env: {} },
    })
    return exports
  }
  const desktop = load("../src/main/agent-registry.ts")
  bindings["./agent-registry"] = desktop
  return {
    home,
    paths,
    desktop: desktop.agentRegistry as Record<string, AgentEntry>,
    probes: desktop.PROJECT_PROBES as { subpath: string; agentName: string | null }[],
    cli: load("../../../packages/cli/src/core/agents.ts").agents as Record<string, AgentConfig>,
    mcp: load("../src/main/mcp-registry.ts").mcpAgentRegistry as McpAgentConfigEntry[],
  }
}

for (const platform of ["win32", "darwin", "linux"] as const) {
  for (const roots of [[".workbuddy"], [".workbuddy-ai"], [".workbuddy", ".workbuddy-ai"]]) {
    test(`${platform}：WorkBuddy 单版与双版安装均独立识别`, async () => {
      const { home, paths, desktop, cli, mcp } = loadRegistries(platform, roots)
      for (const [id, root] of [["workbuddy", ".workbuddy"], ["workbuddy-ai", ".workbuddy-ai"]]) {
        for (const registry of [desktop, cli]) {
          const agent = registry[id]
          assert.ok(agent, `缺少 ${id} 入口`)
          assert.equal(await agent.detectInstalled(), roots.includes(root))
          assert.equal(agent.globalSkillsDir, paths.join(home, root, "skills"))
        }
        const adapter = mcp.find((agent) => agent.id === id)
        assert.ok(adapter, `缺少 ${id} MCP 入口`)
        assert.equal(adapter.configPath, paths.join(home, root, "mcp.json"))
        assert.equal(adapter.installedDir, paths.join(home, root))
        assert.equal(adapter.entryStyle, "workbuddy")
      }
    })
  }

  test(`${platform}：TRAE 与 Qoder 国内国际版共存时不会互相覆盖`, async () => {
    const roots = [".trae", ".trae-cn", ".qoder", ".qoder-cn"]
    const { desktop, cli } = loadRegistries(platform, roots)
    for (const registry of [desktop, cli]) {
      for (const id of ["trae", "trae-cn", "qoder", "qoder-cn"]) {
        assert.equal(await registry[id].detectInstalled(), true, id)
      }
      assert.notEqual(registry.trae.globalSkillsDir, registry["trae-cn"].globalSkillsDir)
      assert.notEqual(registry.qoder.globalSkillsDir, registry["qoder-cn"].globalSkillsDir)
    }
  })

  test(`${platform}：VS Code 稳定版与 Insiders 可单独安装或共存`, async () => {
    const config = platform === "win32" ? "AppData/Roaming"
      : platform === "darwin" ? "Library/Application Support" : ".config"
    for (const products of [["Code"], ["Code - Insiders"], ["Code", "Code - Insiders"]]) {
      const { home, paths, desktop, mcp } = loadRegistries(platform, products.map((name) => `${config}/${name}`))
      for (const [id, product] of [["vscode", "Code"], ["vscode-insiders", "Code - Insiders"]]) {
        assert.ok(desktop[id], `缺少 ${id} 入口`)
        assert.equal(await desktop[id].detectInstalled(), products.includes(product))
        assert.equal(desktop[id].globalSkillsDir, paths.join(home, ".copilot", "skills"))
        const adapter = mcp.find((agent) => agent.id === id)
        assert.ok(adapter, `缺少 ${id} MCP 入口`)
        assert.equal(adapter.configPath, paths.join(home, config, product, "User", "mcp.json"))
      }
    }
  })

  test(`${platform}：Zed 的 Skill 与 MCP 使用平台对应的配置目录`, async () => {
    const root = platform === "win32" ? "AppData/Roaming/Zed" : ".config/zed"
    const { home, paths, desktop, cli, mcp } = loadRegistries(platform, [root])
    assert.equal(await desktop.zed.detectInstalled(), true)
    assert.equal(await cli.zed.detectInstalled(), true)
    assert.equal(mcp.find((agent) => agent.id === "zed")?.configPath, paths.join(home, root, "settings.json"))
  })
}

test("自定义扫描可正确归属各版本的专属 Skill 目录", () => {
  const { probes } = loadRegistries("win32", [])
  for (const [root, id] of [
    [".workbuddy-ai", "workbuddy-ai"],
    [".trae-cn", "trae-cn"],
    [".qoder-cn", "qoder-cn"],
  ]) {
    assert.ok(probes.some((probe) => probe.subpath === `${root}/skills` && probe.agentName === id))
  }
})

test("同名 Skill 位于不同版本目录时，扫描保留各自的 Agent 归属", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "skillbox-agent-variants-"))
  const cases = [
    [".workbuddy", "workbuddy"],
    [".workbuddy-ai", "workbuddy-ai"],
    [".trae-cn", "trae-cn"],
    [".qoder-cn", "qoder-cn"],
  ]
  try {
    for (const [directory, id] of cases) {
      const skillDir = path.join(root, directory, "skills", "same-name")
      await fsp.mkdir(skillDir, { recursive: true })
      await fsp.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: same-name\n---\n${id}`)
    }
    const locations = await findCustomSkillLocations(root, PROJECT_PROBES)
    assert.deepEqual(locations.map((location) => location.agentName).sort(), cases.map(([, id]) => id).sort())
    assert.equal(new Set(locations.map((location) => location.canonicalPath)).size, cases.length)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})
