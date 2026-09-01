interface VersionMismatch {
  agentPath: string
}

interface MergeableSkill {
  name: string
  agents: string[]
  agentShortCodes: string[]
  scope: "global" | "project" | "custom"
  versionMismatches: VersionMismatch[]
}

/**
 * 项目级位置是全局母版的适配位置，不是第二个逻辑 Skill。
 * 仅在不存在同名全局母版时，才保留项目 Skill 的独立行。
 */
export function mergeProjectSkillsIntoGlobal<T extends MergeableSkill>(skills: T[]): T[] {
  const copies = skills.map((skill) => ({
    ...skill,
    agents: [...skill.agents],
    agentShortCodes: [...skill.agentShortCodes],
    versionMismatches: [...skill.versionMismatches],
  })) as T[]
  const globalByName = new Map<string, T>()

  for (const skill of copies) {
    if (skill.scope !== "global") continue
    const key = skill.name.trim().toLowerCase()
    if (!globalByName.has(key)) globalByName.set(key, skill)
  }

  return copies.filter((skill) => {
    if (skill.scope !== "project" || skill.agents.length === 0) return true
    const master = globalByName.get(skill.name.trim().toLowerCase())
    if (!master) return true

    skill.agents.forEach((agent, index) => {
      if (master.agents.includes(agent)) return
      master.agents.push(agent)
      const shortCode = skill.agentShortCodes[index]
      if (shortCode) master.agentShortCodes.push(shortCode)
    })

    const knownMismatchPaths = new Set(
      master.versionMismatches.map((mismatch) => mismatch.agentPath),
    )
    for (const mismatch of skill.versionMismatches) {
      if (knownMismatchPaths.has(mismatch.agentPath)) continue
      master.versionMismatches.push(mismatch)
      knownMismatchPaths.add(mismatch.agentPath)
    }

    return false
  })
}
