import assert from "node:assert/strict"
import test from "node:test"
import {
  createInstalledMarketplaceState,
  formatInstallProgress,
  hasSameNameMarketplaceSkill,
  isMarketplaceSkillInstalled,
  mergeInstallTask,
} from "../src/renderer/lib/marketplace-state"

test("市场侧栏统计使用技能条目数，不按名称去重", () => {
  const installed = createInstalledMarketplaceState([
    { name: "shared-skill", source: "owner/first/shared-skill" },
    { name: "shared-skill", source: "owner/second/shared-skill" },
  ])

  assert.equal(installed.count, 2)
  assert.equal(installed.names.size, 1)
})

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

test("旧版本仓库级记录仅在仓库和 Skill 名称都匹配时识别", () => {
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

test("不同仓库的同名 Skill 不会被误标为已安装", () => {
  const installed = createInstalledMarketplaceState([
    { name: "awesome-design", source: "owner-a/design/awesome-design" },
  ])

  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "awesome-design", source: "owner-a/design", skillId: "awesome-design",
  }), true)
  assert.equal(hasSameNameMarketplaceSkill(installed, {
    name: "awesome-design", source: "owner-a/design", skillId: "awesome-design",
  }), false)
  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "awesome-design", source: "owner-b/design", skillId: "awesome-design",
  }), false)
  assert.equal(hasSameNameMarketplaceSkill(installed, {
    name: "awesome-design", source: "owner-b/design", skillId: "awesome-design",
  }), true)
})

test("来源不明或只是发现线索的同名 Skill 不冒充市场安装记录", () => {
  const installed = createInstalledMarketplaceState([
    { name: "awesome-design" },
    { name: "other-design", source: "owner/design/other-design", hasLinkedSource: false },
  ])

  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "awesome-design", source: "owner/design", skillId: "awesome-design",
  }), false)
  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "other-design", source: "owner/design", skillId: "other-design",
  }), false)
})

test("仓库级旧记录仅匹配同一仓库且同名的 Skill", () => {
  const installed = createInstalledMarketplaceState([
    { name: "awesome-design", source: "owner/design" },
  ])

  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "awesome-design", source: "owner/design", skillId: "awesome-design",
  }), true)
  assert.equal(isMarketplaceSkillInstalled(installed, {
    name: "awesome-design", source: "another/design", skillId: "awesome-design",
  }), false)
})

test("中文名称不同的 Skill 不会被当成同名", () => {
  const installed = createInstalledMarketplaceState([{ name: "视频剪辑" }])
  assert.equal(hasSameNameMarketplaceSkill(installed, {
    name: "封面设计", source: "owner/design", skillId: "cover-design",
  }), false)
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
