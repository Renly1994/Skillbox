import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { prepareUserDataPath } from "../src/main/user-data-path"

function withFixture(run: (paths: {
  appData: string
  home: string
  oldState: string
  newState: string
}) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillbox-user-data-"))
  const appData = path.join(root, "app-data")
  const home = path.join(root, "home")
  const oldState = path.join(appData, "@skillsgate", "desktop", "Local State")
  const newState = path.join(appData, "Skillbox", "Local State")
  fs.mkdirSync(path.dirname(oldState), { recursive: true })
  fs.writeFileSync(oldState, "old encryption state")
  try {
    run({ appData, home, oldState, newState })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("首次迁移用户数据目录时保留翻译密钥的解密状态", () => {
  withFixture(({ appData, home, newState }) => {
    assert.equal(prepareUserDataPath(appData, home, () => null), path.join(appData, "Skillbox"))
    assert.equal(fs.readFileSync(newState, "utf8"), "old encryption state")
  })
})

test("旧密文已复制但新目录生成了不同加密状态时恢复旧状态", () => {
  withFixture(({ appData, home, newState }) => {
    fs.mkdirSync(path.dirname(newState), { recursive: true })
    fs.writeFileSync(newState, "new encryption state")
    prepareUserDataPath(appData, home, (dbPath) =>
      dbPath.includes(".skillsgate") ? "same ciphertext" : "same ciphertext",
    )
    assert.equal(fs.readFileSync(newState, "utf8"), "old encryption state")
    assert.equal(fs.readFileSync(`${newState}.before-migration`, "utf8"), "new encryption state")
  })
})

test("用户已经重新设置翻译密钥时不覆盖新的加密状态", () => {
  withFixture(({ appData, home, newState }) => {
    fs.mkdirSync(path.dirname(newState), { recursive: true })
    fs.writeFileSync(newState, "new encryption state")
    prepareUserDataPath(appData, home, (dbPath) =>
      dbPath.includes(".skillsgate") ? "old ciphertext" : "new ciphertext",
    )
    assert.equal(fs.readFileSync(newState, "utf8"), "new encryption state")
    assert.equal(fs.existsSync(`${newState}.before-migration`), false)
  })
})

test("加密主密钥相同且其他状态有更新时保留新目录", () => {
  withFixture(({ appData, home, oldState, newState }) => {
    fs.writeFileSync(oldState, JSON.stringify({ os_crypt: { encrypted_key: "shared" }, setting: "old" }))
    fs.mkdirSync(path.dirname(newState), { recursive: true })
    const current = JSON.stringify({ os_crypt: { encrypted_key: "shared" }, setting: "new" })
    fs.writeFileSync(newState, current)
    prepareUserDataPath(appData, home, () => "same ciphertext")
    assert.equal(fs.readFileSync(newState, "utf8"), current)
  })
})
