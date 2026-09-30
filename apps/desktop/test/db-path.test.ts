import assert from "node:assert/strict"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { prepareDatabasePath } from "../src/main/db/db-path"

test("数据库改名时连同未检查点的 WAL 数据一起迁移", async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "skillbox-db-"))
  const oldPath = path.join(home, ".skillsgate", "skillsgate.db")
  const newPath = path.join(home, ".skillbox", "skillbox.db")
  await fsp.mkdir(path.dirname(oldPath), { recursive: true })
  const source = new DatabaseSync(oldPath)
  try {
    source.exec("PRAGMA journal_mode=WAL; CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('theme', 'dark')")
    assert.equal(prepareDatabasePath(home, (filePath) => new DatabaseSync(filePath, { readOnly: true })), newPath)
    const migrated = new DatabaseSync(newPath, { readOnly: true })
    try {
      assert.equal(migrated.prepare("SELECT value FROM settings WHERE key = 'theme'").get()?.value, "dark")
      assert.equal(migrated.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok")
    } finally {
      migrated.close()
    }
    assert.equal(prepareDatabasePath(home, () => { throw new Error("不应重复迁移") }), newPath)
  } finally {
    source.close()
    assert.equal(fs.existsSync(oldPath), true)
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test("旧数据库损坏时保留原文件且不留下迁移目标", async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "skillbox-db-"))
  const oldPath = path.join(home, ".skillsgate", "skillsgate.db")
  await fsp.mkdir(path.dirname(oldPath), { recursive: true })
  await fsp.writeFile(oldPath, "broken database")
  try {
    assert.throws(() => prepareDatabasePath(home, (filePath) => new DatabaseSync(filePath, { readOnly: true })))
    assert.equal(fs.existsSync(oldPath), true)
    assert.equal(fs.existsSync(path.join(home, ".skillbox", "skillbox.db")), false)
    assert.deepEqual(await fsp.readdir(path.join(home, ".skillbox")), [])
  } finally {
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test("跨盘复制中断后不把半成品数据库当成迁移结果", async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "skillbox-db-"))
  const oldPath = path.join(home, ".skillsgate", "skillsgate.db")
  const newPath = path.join(home, ".skillbox", "skillbox.db")
  await fsp.mkdir(path.dirname(oldPath), { recursive: true })
  const source = new DatabaseSync(oldPath)
  source.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('theme', 'dark')")
  source.close()
  const renameSync = fs.renameSync
  const copyFileSync = fs.copyFileSync
  try {
    fs.renameSync = (() => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }) }) as typeof fs.renameSync
    fs.copyFileSync = ((_source, destination) => {
      fs.writeFileSync(destination, "partial")
      throw new Error("copy interrupted")
    }) as typeof fs.copyFileSync
    assert.throws(
      () => prepareDatabasePath(home, (filePath) => new DatabaseSync(filePath, { readOnly: true })),
      /copy interrupted/,
    )
    assert.equal(fs.existsSync(newPath), false)
    assert.equal(fs.existsSync(oldPath), true)
  } finally {
    fs.renameSync = renameSync
    fs.copyFileSync = copyFileSync
    await fsp.rm(home, { recursive: true, force: true })
  }
})
