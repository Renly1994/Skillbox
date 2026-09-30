import path from "node:path"

function pathKey(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function remapSkillStoragePath(value: string, previous: string, next: string): string {
  if (!path.isAbsolute(value)) return value
  const resolved = path.resolve(value)
  const relative = path.relative(path.resolve(previous), resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return value
  }
  return path.join(next, relative)
}

export function remapSkillStoragePathFromRoots(
  value: string,
  previousRoots: string[],
  next: string,
): string {
  return previousRoots.reduce(
    (current, previous) => remapSkillStoragePath(current, previous, next),
    value,
  )
}

export function remapPathKeyedRecords<T>(
  records: Record<string, T>,
  previous: string,
  next: string,
  remapValue: (value: T) => T = (value) => value,
): Record<string, T> {
  const entries = Object.entries(records).map(([key, value]) => ({
    key,
    nextKey: remapSkillStoragePath(key, previous, next),
    value: remapValue(value),
  }))
  const result: Record<string, T> = {}
  const occupied = new Set<string>()

  for (const entry of entries) {
    if (pathKey(entry.key) === pathKey(entry.nextKey)) {
      result[entry.nextKey] = entry.value
      occupied.add(pathKey(entry.nextKey))
    }
  }
  for (const entry of entries) {
    const nextKey = pathKey(entry.nextKey)
    if (pathKey(entry.key) !== nextKey && !occupied.has(nextKey)) {
      result[entry.nextKey] = entry.value
      occupied.add(nextKey)
    }
  }
  return result
}

export function planPathIdentityRemap(
  identities: string[],
  previous: string,
  next: string,
): { updates: Array<{ identity: string; nextIdentity: string }>; removals: string[] } {
  const pending = identities.flatMap((identity) => {
    const nextIdentity = remapSkillStoragePath(identity, previous, next)
    return nextIdentity === identity ? [] : [{ identity, nextIdentity }]
  })
  const moving = new Set(pending.map(({ identity }) => pathKey(identity)))
  const occupied = new Set(identities.map(pathKey).filter((identity) => !moving.has(identity)))
  const updates: Array<{ identity: string; nextIdentity: string }> = []
  const removals: string[] = []

  for (const entry of pending) {
    const nextKey = pathKey(entry.nextIdentity)
    if (occupied.has(nextKey)) {
      removals.push(entry.identity)
    } else {
      updates.push(entry)
      occupied.add(nextKey)
    }
  }
  return { updates, removals }
}

export function remapSkillStoragePathList(
  values: string[],
  previous: string,
  next: string,
): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => remapSkillStoragePath(value, previous, next))
    .filter((value) => {
      const key = pathKey(value)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
