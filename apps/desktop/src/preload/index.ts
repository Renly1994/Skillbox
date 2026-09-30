import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

async function invokeWithLogging<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    console.error(`[preload] ${channel} failed`, error)
    throw error
  }
}

function subscribe<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  setAppLanguage: (locale: "zh-CN" | "en-US") =>
    ipcRenderer.send("app:set-language", locale),

  // Agents
  detectAgents: () => ipcRenderer.invoke("agents:detect"),

  // Skills
  listInstalled: () => ipcRenderer.invoke("skills:list-installed"),
  rescanSkills: () => ipcRenderer.invoke("skills:rescan"),
  exportSkillsPackage: (request: {
    scope: "selected" | "all" | "global" | "project"
    selectedPaths?: string[]
  }) => ipcRenderer.invoke("skills:export-package", request),
  inspectImportSkillsPackage: () => ipcRenderer.invoke("skills:inspect-import-package"),
  importSkillsPackage: (archivePath: string) =>
    ipcRenderer.invoke("skills:import-package", archivePath),
  installSkill: (source: string, skillId: string, agents: string[], scope: string) =>
    ipcRenderer.invoke("skills:install", source, skillId, agents, scope),
  listSkillInstallTasks: () => ipcRenderer.invoke("skills:list-install-tasks"),
  dismissSkillInstallTask: (key: string) =>
    ipcRenderer.invoke("skills:dismiss-install-task", key),
  installSkillViaCli: (source: string) =>
    invokeWithLogging("skills:install-via-cli", source),
  searchCatalog: (query: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke("skills:search-catalog", query, limit, offset),
  fetchTrending: () => ipcRenderer.invoke("skills:fetch-trending"),
  fetchSkillSummary: (source: string, skillId: string) =>
    ipcRenderer.invoke("skills:fetch-summary", source, skillId),
  fetchSkillContent: (source: string, skillId: string) =>
    ipcRenderer.invoke("skills:fetch-content", source, skillId),
  createSkill: (data: {
    name: string
    description?: string
    content?: string
    agentNames?: string[]
  }) => ipcRenderer.invoke("skills:create", data),
  removeSkill: (request: {
    name: string
    targets: Array<{
      path: string
      canonicalPath: string
      scope: "global" | "project" | "custom"
      projectName?: string | null
    }>
  }) => ipcRenderer.invoke("skills:remove", request),
  linkSkillSources: (skills: Array<{ name: string; canonicalPath: string; source: string }>) =>
    ipcRenderer.invoke("skills:link-sources", { skills }),
  chooseSkillSourceDirectory: () => ipcRenderer.invoke("skills:choose-source-directory"),
  listLinkedSkillSources: (skills: Array<{ name: string; canonicalPath: string }>) =>
    ipcRenderer.invoke("skills:list-linked-sources", skills),
  checkSkillUpdate: (skill: { name: string; canonicalPath: string }) =>
    ipcRenderer.invoke("skills:check-update", skill),
  updateSkill: (skill: { name: string; canonicalPath: string }) =>
    ipcRenderer.invoke("skills:update", skill),
  listSkillVersions: (skill: { name: string; canonicalPath: string }) =>
    ipcRenderer.invoke("skill-versions:list", skill),
  createSkillVersion: (
    skill: { name: string; canonicalPath: string },
    reason: "initial" | "edit" | "update" | "restore" | "manual" = "manual",
  ) => ipcRenderer.invoke("skill-versions:create", skill, reason),
  readSkillVersionFile: (
    skill: { name: string; canonicalPath: string },
    versionId: string,
    relativePath?: string,
  ) => ipcRenderer.invoke("skill-versions:read-file", skill, versionId, relativePath),
  restoreSkillVersion: (
    skill: { name: string; canonicalPath: string },
    versionId: string,
  ) => ipcRenderer.invoke("skill-versions:restore", skill, versionId),
  skillVersionStorageInfo: () => ipcRenderer.invoke("skill-versions:storage-info"),
  chooseSkillVersionStorage: () => ipcRenderer.invoke("skill-versions:choose-storage"),
  setSkillVersionRetention: (value: number) =>
    ipcRenderer.invoke("skill-versions:set-retention", value),
  openSkillVersionStorage: () => ipcRenderer.invoke("skill-versions:open-storage"),
  skillStorageInfo: () => ipcRenderer.invoke("skill-storage:info"),
  chooseSkillStorage: () => ipcRenderer.invoke("skill-storage:choose"),
  openSkillStorage: () => ipcRenderer.invoke("skill-storage:open"),
  readSkillContent: (skillPath: string) =>
    ipcRenderer.invoke("skill:read-content", skillPath),
  listSupportingFiles: (skillPath: string) =>
    ipcRenderer.invoke("skill:list-supporting-files", skillPath),
  readSupportingFile: (skillPath: string, relativePath: string) =>
    ipcRenderer.invoke("skill:read-supporting-file", skillPath, relativePath),
  writeSkillContent: (filePath: string, content: string) =>
    ipcRenderer.invoke("skill:write-content", filePath, content),
  openInFinder: (filePath: string) =>
    ipcRenderer.invoke("skill:open-in-finder", filePath),
  removeFromAgent: (request: {
    name: string
    targets: Array<{
      path: string
      canonicalPath: string
      scope: "global" | "project" | "custom"
      projectName?: string | null
    }>
  }, agentName: string) =>
    ipcRenderer.invoke("skills:remove-from-agent", request, agentName),
  addToAgent: (skillName: string, canonicalPath: string, agentName: string) =>
    ipcRenderer.invoke("skills:add-to-agent", skillName, canonicalPath, agentName),
  syncAgentCopyToMaster: (skillName: string, masterPath: string, agentName: string, agentPath: string) =>
    ipcRenderer.invoke("skills:sync-agent-copy-to-master", skillName, masterPath, agentName, agentPath),

  // Remote servers
  serversList: () => ipcRenderer.invoke("servers:list"),
  serversCreate: (data: {
    label: string
    host: string
    port?: number
    username: string
    skillsBasePath?: string
    sshKeyPath?: string | null
  }) => ipcRenderer.invoke("servers:create", data),
  serversUpdate: (
    id: string,
    fields: {
      label?: string
      host?: string
      port?: number
      username?: string
      skillsBasePath?: string
      sshKeyPath?: string | null
    },
  ) => ipcRenderer.invoke("servers:update", id, fields),
  serversDelete: (id: string) => ipcRenderer.invoke("servers:delete", id),
  serversTest: (id: string) => ipcRenderer.invoke("servers:test", id),
  serversSync: (id: string) => ipcRenderer.invoke("servers:sync", id),
  serversSkills: (serverId: string) =>
    ipcRenderer.invoke("servers:skills", serverId),
  serversReadSkill: (serverId: string, remotePath: string) =>
    ipcRenderer.invoke("servers:read-skill", serverId, remotePath),
  serversWriteSkill: (serverId: string, remotePath: string, content: string) =>
    ipcRenderer.invoke("servers:write-skill", serverId, remotePath, content),
  serversCount: () => ipcRenderer.invoke("servers:count"),
  serversPushPreview: (serverId: string, mirror: boolean) =>
    ipcRenderer.invoke("servers:push-preview", serverId, mirror),
  serversPushApply: (serverId: string, preview: unknown) =>
    ipcRenderer.invoke("servers:push-apply", serverId, preview),

  // Settings
  settingsGet: (key: string, defaultValue: unknown) =>
    ipcRenderer.invoke("settings:get", key, defaultValue),
  settingsSet: (key: string, value: unknown) =>
    ipcRenderer.invoke("settings:set", key, value),
  settingsAll: () => ipcRenderer.invoke("settings:all"),

  // Translation
  translationGetConfig: () => ipcRenderer.invoke("translation:get-config"),
  translationRevealApiKey: () => ipcRenderer.invoke("translation:reveal-api-key"),
  translationSaveConfig: (config: {
    preset: "deepseek" | "openai" | "anthropic" | "custom"
    name: string
    baseUrl: string
    apiFormat: "openai-chat" | "anthropic-messages"
    model: string
    apiKey?: string
  }) => ipcRenderer.invoke("translation:save-config", config),
  translationClearConfig: () => ipcRenderer.invoke("translation:clear-config"),
  translationGetState: (input: { identity: string; content: string }) =>
    ipcRenderer.invoke("translation:get-state", input),
  translationListViews: () => ipcRenderer.invoke("translation:list-views"),
  translationSetView: (input: {
    identity: string
    content: string
    cacheKey: string
    sourceDescription?: string | null
    translatedDescription?: string | null
    showTranslation: boolean
  }) => ipcRenderer.invoke("translation:set-view", input),
  translateSkillContent: (content: string) =>
    ipcRenderer.invoke("translation:translate", content),

  // Favorites
  favoritesList: () => ipcRenderer.invoke("favorites:list"),
  favoritesToggle: (name: string) =>
    ipcRenderer.invoke("favorites:toggle", name),
  favoritesAddMany: (names: string[]) =>
    ipcRenderer.invoke("favorites:add-many", names),

  // Updates
  updatesGetState: () => ipcRenderer.invoke("updates:get-state"),
  updatesCheck: () => ipcRenderer.invoke("updates:check"),
  updatesDownload: () => ipcRenderer.invoke("updates:download"),
  updatesInstall: () => ipcRenderer.invoke("updates:install"),
  updatesReleaseNotes: () => ipcRenderer.invoke("updates:release-notes"),
  appGetVersion: () => ipcRenderer.invoke("app:get-version"),

  // MCP library
  mcpListLibrary: () => ipcRenderer.invoke("mcp:list-library"),
  mcpSetConnection: (
    serverName: string,
    agentId: string,
    enable: boolean,
    sourceAgentId?: string,
  ) => ipcRenderer.invoke("mcp:set-connection", serverName, agentId, enable, sourceAgentId),
  mcpSyncServer: (
    serverName: string,
    sourceAgentId: string,
    targetAgentIds: string[],
  ) => ipcRenderer.invoke("mcp:sync-server", serverName, sourceAgentId, targetAgentIds),
  mcpAddServer: (input: unknown, agentIds: string[]) =>
    ipcRenderer.invoke("mcp:add-server", input, agentIds),
  mcpRemoveServer: (serverName: string) =>
    ipcRenderer.invoke("mcp:remove-server", serverName),
  mcpOpenConfig: (configPath: string) =>
    ipcRenderer.invoke("mcp:open-config", configPath),

  // Activity log
  activityList: (limit?: number) => ipcRenderer.invoke("activity:list", limit),

  // Events
  onSkillsUpdated: (callback: (skills: unknown[]) => void) => {
    return subscribe("skills:updated", callback)
  },
  onMigrationProgress: (callback: (progress: unknown) => void) => {
    return subscribe("skills:migration-progress", callback)
  },
  onSkillInstallProgress: (callback: (progress: unknown) => void) => {
    return subscribe("skills:install-progress", callback)
  },
  onPendingAgentRestored: (callback: (result: unknown) => void) => {
    return subscribe("skills:pending-agent-restored", callback)
  },
  onUpdateState: (callback: (state: unknown) => void) => {
    return subscribe("updates:state", callback)
  },
  onMcpUpdated: (callback: (library: unknown) => void) => {
    return subscribe("mcp:updated", callback)
  },
})
