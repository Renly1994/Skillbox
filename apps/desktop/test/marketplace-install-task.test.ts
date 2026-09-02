import assert from "node:assert/strict"
import test from "node:test"
import { MarketplaceInstallTaskStore } from "../src/main/marketplace-install-task"

test("安装任务在详情面板没有订阅者时仍保留进度", () => {
  const store = new MarketplaceInstallTaskStore()
  const started = store.start("alchaincyf/huashu-design", "huashu-design")

  store.update(started.key, {
    stage: "downloading",
    completed: 28,
    total: 189,
    downloadedBytes: 4 * 1024 * 1024,
    totalBytes: 30 * 1024 * 1024,
  })

  assert.deepEqual(store.list(), [{
    ...started,
    stage: "downloading",
    completed: 28,
    total: 189,
    downloadedBytes: 4 * 1024 * 1024,
    totalBytes: 30 * 1024 * 1024,
    updatedAt: store.list()[0].updatedAt,
  }])
  assert.equal(store.isRunning(started.key), true)
  assert.equal(store.hasRunningTasks(), true)
})

test("完成与失败结果可在重新进入市场后查询", () => {
  const store = new MarketplaceInstallTaskStore()
  const completed = store.start("vercel-labs/skills", "find-skills")
  store.complete(completed.key)

  const failed = store.start("owner/repo", "large-skill")
  store.fail(failed.key, "网络连接已中断")

  assert.deepEqual(
    store.list().map((task) => ({
      key: task.key,
      status: task.status,
      stage: task.stage,
      error: task.error,
    })),
    [
      {
        key: "vercel-labs/skills/find-skills",
        status: "completed",
        stage: "complete",
        error: undefined,
      },
      {
        key: "owner/repo/large-skill",
        status: "failed",
        stage: "failed",
        error: "网络连接已中断",
      },
    ],
  )

  store.dismiss(failed.key)
  assert.equal(store.list().some((task) => task.key === failed.key), false)
  assert.equal(store.hasRunningTasks(), false)
})
