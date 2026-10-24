import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

function fixture(response: number) {
  const app = Object.assign(new EventEmitter(), { getLocale: () => "zh-CN", isPackaged: false })
  const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), hide: () => {} })
  const dialogs: Array<{ defaultId: number; cancelId: number }> = []
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const bindings: Record<string, unknown> = {
    electron: {
      app, Tray, Menu: { buildFromTemplate: () => [] },
      nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
      dialog: { showMessageBoxSync: (_window: unknown, options: typeof dialogs[number]) => { dialogs.push(options); return response } },
    },
    "node:path": path,
    "./db/index": { openDb: () => ({}) },
    "./db/settings": { SettingsStore: class { get() { return "tray" } } },
  }
  const exports: Record<string, any> = {}
  const source = fs.readFileSync(new URL("../src/main/close-behavior.ts", import.meta.url), "utf8")
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: (name: string) => bindings[name], __dirname: "fixture", process: { platform: "win32" } })
  exports.setupCloseBehavior(window)
  return { app, window, dialogs }
}

test("取消退出保留未保存内容，并恢复后续关闭窗口的托盘行为", () => {
  const { app, window, dialogs } = fixture(0)
  app.emit("before-quit")
  let unloadAllowed = false
  window.webContents.emit("will-prevent-unload", { preventDefault: () => { unloadAllowed = true } })
  assert.equal(unloadAllowed, false)
  assert.equal(dialogs[0].defaultId, 0)
  assert.equal(dialogs[0].cancelId, 0)
  let closePrevented = false
  window.emit("close", { preventDefault: () => { closePrevented = true } })
  assert.equal(closePrevented, true)
})

test("只有明确放弃修改才允许窗口卸载", () => {
  const { window } = fixture(1)
  let unloadAllowed = false
  window.webContents.emit("will-prevent-unload", { preventDefault: () => { unloadAllowed = true } })
  assert.equal(unloadAllowed, true)
})
