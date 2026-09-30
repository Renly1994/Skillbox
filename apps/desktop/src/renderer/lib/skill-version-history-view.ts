const emptyVersions: never[] = []

export function getVersionsForSkill<T>(
  history: { skillPath: string; versions: T[] } | null,
  skillPath: string | undefined,
): T[] {
  return history && history.skillPath === skillPath ? history.versions : emptyVersions
}

export function skillVersionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ""
  const detail = message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
  if (/^(EACCES|EPERM):/u.test(detail)) return "版本仓库没有写入权限，请在设置中更换存储位置"
  if (/^ENOSPC:/u.test(detail)) return "磁盘空间不足，无法保存当前版本"
  if (/^EXDEV:/u.test(detail)) return "版本仓库无法保存文件，请在设置中更换存储位置"
  // 英文文件系统错误可能包含中文路径，不应将路径直接展示给用户。
  return /^(?:[\u3400-\u9fff]|Skill\b.*[\u3400-\u9fff])/u.test(detail) ? detail : fallback
}
