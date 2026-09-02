export type MarketplaceInstallStage =
  | "preparing"
  | "resolving"
  | "downloading"
  | "fallback"
  | "installing"
  | "complete"
  | "failed"

export type MarketplaceInstallStatus = "running" | "completed" | "failed"

export interface MarketplaceInstallTask {
  key: string
  source: string
  skillId: string
  agentNames: string[]
  status: MarketplaceInstallStatus
  stage: MarketplaceInstallStage
  completed: number
  total: number
  downloadedBytes: number
  totalBytes: number
  error?: string
  startedAt: number
  updatedAt: number
}

export function marketplaceInstallTaskKey(source: string, skillId: string): string {
  return `${source}/${skillId}`.toLowerCase()
}

export class MarketplaceInstallTaskStore {
  private readonly tasks = new Map<string, MarketplaceInstallTask>()

  start(source: string, skillId: string, agentNames: string[] = []): MarketplaceInstallTask {
    const now = Date.now()
    const task: MarketplaceInstallTask = {
      key: marketplaceInstallTaskKey(source, skillId),
      source,
      skillId,
      agentNames: [...agentNames],
      status: "running",
      stage: "preparing",
      completed: 0,
      total: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      startedAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.key, task)
    return task
  }

  update(
    key: string,
    progress: Pick<
      MarketplaceInstallTask,
      "stage" | "completed" | "total" | "downloadedBytes" | "totalBytes"
    >,
  ): MarketplaceInstallTask | null {
    const current = this.tasks.get(key)
    if (!current) return null
    const task = { ...current, ...progress, updatedAt: Date.now() }
    this.tasks.set(key, task)
    return task
  }

  complete(key: string): MarketplaceInstallTask | null {
    const current = this.tasks.get(key)
    if (!current) return null
    const task: MarketplaceInstallTask = {
      ...current,
      status: "completed",
      stage: "complete",
      error: undefined,
      updatedAt: Date.now(),
    }
    this.tasks.set(key, task)
    return task
  }

  fail(key: string, error: string): MarketplaceInstallTask | null {
    const current = this.tasks.get(key)
    if (!current) return null
    const task: MarketplaceInstallTask = {
      ...current,
      status: "failed",
      stage: "failed",
      error,
      updatedAt: Date.now(),
    }
    this.tasks.set(key, task)
    return task
  }

  isRunning(key: string): boolean {
    return this.tasks.get(key)?.status === "running"
  }

  hasRunningTasks(): boolean {
    return [...this.tasks.values()].some((task) => task.status === "running")
  }

  list(): MarketplaceInstallTask[] {
    return [...this.tasks.values()]
  }

  dismiss(key: string): void {
    if (!this.isRunning(key)) this.tasks.delete(key)
  }
}
