interface SkillProjectFields {
  projectName?: string | null
  projectNames?: string[]
}

/** 兼容缓存、监听器或旧版本 IPC 返回的单项目结构。 */
export function normalizeInstalledSkills<T extends SkillProjectFields>(
  skills: T[] | null | undefined,
): Array<T & { projectNames: string[] }> {
  if (!Array.isArray(skills)) return []
  return skills.map((skill) => ({
    ...skill,
    projectNames: Array.isArray(skill.projectNames)
      ? [...skill.projectNames]
      : skill.projectName
        ? [skill.projectName]
        : [],
  }))
}
