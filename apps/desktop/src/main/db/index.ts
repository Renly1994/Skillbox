import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { runMigrations } from "./migrations"
import { legacyDatabasePath, prepareDatabasePath } from "./db-path"

// Use createRequire to load better-sqlite3 at runtime.
// This prevents Vite/Rollup from trying to bundle the native module.
const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

let _db: any = null

export function readEncryptedTranslationKey(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  let db: any
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = ?")
      .get("translation.api.key.encrypted") as { value: string } | undefined
    const value = row ? JSON.parse(row.value) : null
    return typeof value === "string" ? value : null
  } catch {
    return null
  } finally {
    db?.close()
  }
}

export function openDb(): any {
  if (_db) return _db

  let dbPath: string
  try {
    dbPath = prepareDatabasePath(os.homedir(), (filePath) => new Database(filePath, { readonly: true, fileMustExist: true }))
  } catch (error) {
    console.warn("Skillbox 数据库迁移失败，继续使用原数据库:", error)
    dbPath = legacyDatabasePath(os.homedir())
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  runMigrations(db)

  _db = db
  return db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
