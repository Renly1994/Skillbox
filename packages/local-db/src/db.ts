import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import type { SqliteDriver, LocalDb } from "./types.js"
import { runMigrations } from "./migrations.js"
import { SettingsStore } from "./models/settings.js"
import { RemoteServerStore } from "./models/remote-servers.js"
import { RemoteSkillStore } from "./models/remote-skills.js"

/** 默认数据库路径：~/.skillbox/skillbox.db */
export const DB_PATH = path.join(os.homedir(), ".skillbox", "skillbox.db")

/**
 * Open (or create) the local SQLite database.
 *
 * The caller provides a driver instance -- either bun:sqlite Database or
 * better-sqlite3 Database. This keeps the package runtime-agnostic.
 *
 * Usage with Bun:
 *   import { Database } from "bun:sqlite"
 *   import { openLocalDb, DB_PATH } from "@skillbox/local-db"
 *   const db = openLocalDb(new Database(DB_PATH))
 *
 * Usage with Node (better-sqlite3):
 *   import Database from "better-sqlite3"
 *   import { openLocalDb, DB_PATH } from "@skillbox/local-db"
 *   const db = openLocalDb(new Database(DB_PATH))
 */
export function openLocalDb(driver: SqliteDriver): LocalDb {
  // 确保 ~/.skillbox/ 目录存在
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  // Enable WAL mode for concurrent TUI + Desktop access
  driver.exec("PRAGMA journal_mode=WAL")
  driver.exec("PRAGMA foreign_keys=ON")

  runMigrations(driver)

  return {
    settings: new SettingsStore(driver),
    remoteServers: new RemoteServerStore(driver),
    remoteSkills: new RemoteSkillStore(driver),
    close: () => driver.close(),
  }
}
