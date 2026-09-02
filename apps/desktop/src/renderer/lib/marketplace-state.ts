interface InstalledMarketplaceSkill {
  name: string
  source?: string
}

interface CatalogMarketplaceSkill {
  name: string
  source: string
  skillId: string
}

export interface InstalledMarketplaceState {
  names: Set<string>
  sourceKeys: Set<string>
}

interface InstallProgress {
  stage: "preparing" | "resolving" | "downloading" | "fallback" | "installing" | "complete" | "failed"
  completed: number
  total: number
  downloadedBytes: number
  totalBytes: number
}

interface InstallTask extends InstallProgress {
  key: string
}

export type InstallTaskState<T extends InstallTask = InstallTask> = Record<string, T>

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function marketplaceKey(source: string, skillId: string): string {
  return `${source}/${skillId}`.toLowerCase()
}

export function mergeInstallTask<T extends InstallTask>(
  state: InstallTaskState<T>,
  task: T,
): InstallTaskState<T> {
  return { ...state, [task.key]: task }
}

export function createInstalledMarketplaceState(
  installed: InstalledMarketplaceSkill[],
): InstalledMarketplaceState {
  return {
    names: new Set(installed.map((skill) => normalizeSkillName(skill.name))),
    sourceKeys: new Set(
      installed
        .map((skill) => skill.source?.trim().toLowerCase())
        .filter((source): source is string => Boolean(source)),
    ),
  }
}

export function isMarketplaceSkillInstalled(
  installed: InstalledMarketplaceState,
  skill: CatalogMarketplaceSkill,
): boolean {
  return (
    installed.names.has(normalizeSkillName(skill.name)) ||
    installed.names.has(normalizeSkillName(skill.skillId)) ||
    installed.sourceKeys.has(marketplaceKey(skill.source, skill.skillId))
  )
}

export function formatInstallProgress(progress: InstallProgress): string {
  switch (progress.stage) {
    case "preparing":
      return "Preparing download..."
    case "resolving":
      return "Reading repository..."
    case "downloading":
      if (progress.total <= 0) return "Downloading Skill..."
      return progress.totalBytes > 0
        ? `Downloading ${progress.completed}/${progress.total} files · ${formatBytes(progress.downloadedBytes)}/${formatBytes(progress.totalBytes)}`
        : `Downloading ${progress.completed}/${progress.total} files`
    case "fallback":
      return "Trying another download method..."
    case "installing":
      return "Installing to selected Agents..."
    case "complete":
      return "Installation complete"
    case "failed":
      return "Installation failed"
  }
}
