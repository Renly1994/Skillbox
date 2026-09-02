import assert from "node:assert/strict"
import test from "node:test"
import {
  createInstalledMarketplaceState,
  formatInstallProgress,
  isMarketplaceSkillInstalled,
  mergeInstallTask,
} from "../src/renderer/lib/marketplace-state"

test("同仓库只把实际安装的 Skill 标记为已安装", () => {
  const installed = createInstalledMarketplaceState([
    { name: "find-skills", source: "vercel-labs/skills/find-skills" },
  ])

  assert.equal(
    isMarketplaceSkillInstalled(installed, {
      name: "find-skills",
      source: "vercel-labs/skills",
      skillId: "find-skills",
    }),
    true,
  )
  assert.equal(
    isMarketplaceSkillInstalled(installed, {
      name: "other-skill",
      source: "vercel-labs/skills",
      skillId: "other-skill",
    }),
    false,
  )
})

test("旧版本安装记录仍可通过 Skill 名称识别", () => {
  const installed = createInstalledMarketplaceState([
    { name: "find-skills", source: "vercel-labs/skills" },
  ])

  assert.equal(
    isMarketplaceSkillInstalled(installed, {
      name: "find-skills",
      source: "vercel-labs/skills",
      skillId: "find-skills",
    }),
    true,
  )
  assert.equal(
    isMarketplaceSkillInstalled(installed, {
      name: "other-skill",
      source: "vercel-labs/skills",
      skillId: "other-skill",
    }),
    false,
  )
})

test("长时间下载会显示当前文件进度", () => {
  assert.equal(
    formatInstallProgress({
      stage: "downloading",
      completed: 12,
      total: 189,
      downloadedBytes: 5 * 1024 * 1024,
      totalBytes: 20 * 1024 * 1024,
    }),
    "Downloading 12/189 files · 5.0 MB/20.0 MB",
  )
  assert.equal(
    formatInstallProgress({
      stage: "installing",
      completed: 0,
      total: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    }),
    "Installing to selected Agents...",
  )
})

test("市场页保留安装任务，关闭详情后可继续显示", () => {
  const task: SkillInstallProgress = {
    key: "alchaincyf/huashu-design/huashu-design",
    source: "alchaincyf/huashu-design",
    skillId: "huashu-design",
    status: "running",
    stage: "downloading",
    completed: 28,
    total: 189,
    downloadedBytes: 4 * 1024 * 1024,
    totalBytes: 30 * 1024 * 1024,
    startedAt: 1,
    updatedAt: 2,
  }

  const state = mergeInstallTask({}, task)
  assert.equal(state[task.key], task)
  assert.equal(formatInstallProgress(state[task.key]), "Downloading 28/189 files · 4.0 MB/30.0 MB")
})
