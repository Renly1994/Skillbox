import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

interface VacuumDatabase {
  exec(sql: string): void
  close(): void
}

export function prepareDatabasePath(
  home: string,
  openLegacy: (filePath: string) => VacuumDatabase,
): string {
  const previous = legacyDatabasePath(home)
  const next = path.join(home, ".skillbox", "skillbox.db")
  if (fs.existsSync(next) || !fs.existsSync(previous)) return next

  fs.mkdirSync(path.dirname(next), { recursive: true })
  const staging = path.join(path.dirname(next), `.skillbox-db-migrate-${crypto.randomUUID()}.db`)
  const legacy = openLegacy(previous)
  try {
    try {
      legacy.exec(`VACUUM INTO '${staging.replace(/'/g, "''")}'`)
    } finally {
      legacy.close()
    }
    try {
      fs.renameSync(staging, next)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
      try {
        fs.copyFileSync(staging, next, fs.constants.COPYFILE_EXCL)
      } catch (copyError) {
        if (fs.existsSync(next)) fs.unlinkSync(next)
        throw copyError
      }
    }
  } finally {
    if (fs.existsSync(staging)) fs.unlinkSync(staging)
  }
  return next
}

export function legacyDatabasePath(home: string): string {
  return path.join(home, ".skillsgate", "skillsgate.db")
}
