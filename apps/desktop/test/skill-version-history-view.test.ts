import assert from "node:assert/strict"
import test from "node:test"
import { getVersionsForSkill, skillVersionErrorMessage } from "../src/renderer/lib/skill-version-history-view"

test("切换 Skill 时不会使用上一条 Skill 的历史版本", () => {
  const previous = { skillPath: "C:/skills/first", versions: [{ id: "old-version" }] }
  assert.deepEqual(getVersionsForSkill(null, undefined), [])
  assert.deepEqual(getVersionsForSkill(previous, "C:/skills/second"), [])
  assert.deepEqual(getVersionsForSkill(previous, "C:/skills/first"), previous.versions)
})

test("历史版本错误不显示 Electron 的英文调用前缀", () => {
  const error = new Error("Error invoking remote method 'skill-versions:read-file': Error: 找不到这个历史版本")
  assert.equal(skillVersionErrorMessage(error, "读取版本正文失败"), "找不到这个历史版本")
  assert.equal(skillVersionErrorMessage(new Error("Error invoking remote method 'skill-versions:read-file': Error: ENOENT"), "读取版本正文失败"), "读取版本正文失败")
  assert.equal(skillVersionErrorMessage(new Error("ENOENT: D:/中文目录/history.json"), "读取版本正文失败"), "读取版本正文失败")
  assert.equal(skillVersionErrorMessage(new Error("Error invoking remote method 'skill-versions:create': Error: EXDEV: rename failed"), "保存当前版本失败"), "版本仓库无法保存文件，请在设置中更换存储位置")
  assert.equal(skillVersionErrorMessage(new Error("ENOSPC: disk full"), "保存当前版本失败"), "磁盘空间不足，无法保存当前版本")
})
