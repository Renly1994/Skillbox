import assert from "node:assert/strict"
import test from "node:test"
import { installSkillEditGuard } from "../src/renderer/lib/skill-edit-guard"

function fixture() {
  const document = new EventTarget()
  const window = new EventTarget()
  const state = { pending: true, accept: false, inside: false, prompts: 0 }
  const cleanup = installSkillEditGuard(
    { contains: () => state.inside } as unknown as HTMLElement,
    () => state.pending,
    () => { state.prompts++; return state.accept },
    { document, window } as unknown as { document: Document; window: Window },
  )
  return { document, window, state, cleanup }
}

test("取消离开时阻止切换技能或页面的点击处理", () => {
  const { document, state, cleanup } = fixture()
  let navigated = false
  document.addEventListener("click", () => { navigated = true })
  const event = new Event("click", { cancelable: true })
  document.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(navigated, false)
  assert.equal(state.prompts, 1)
  cleanup()
})

test("明确放弃后继续执行原来的操作", () => {
  const { document, state, cleanup } = fixture()
  state.accept = true
  let navigated = false
  document.addEventListener("click", () => { navigated = true })
  const event = new Event("click", { cancelable: true })
  document.dispatchEvent(event)
  assert.equal(event.defaultPrevented, false)
  assert.equal(navigated, true)
  assert.equal(state.prompts, 1)
  cleanup()
})

test("编辑区内部操作和未修改内容都不触发离开确认", () => {
  const { document, state, cleanup } = fixture()
  state.inside = true
  document.dispatchEvent(new Event("click"))
  state.inside = false
  state.pending = false
  document.dispatchEvent(new Event("click"))
  assert.equal(state.prompts, 0)
  cleanup()
})

test("窗口关闭或刷新时保护未保存内容，保存后正常离开", () => {
  const { window, state, cleanup } = fixture()
  const pending = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(pending)
  assert.equal(pending.defaultPrevented, true)
  state.pending = false
  const saved = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(saved)
  assert.equal(saved.defaultPrevented, false)
  cleanup()
})

test("退出编辑模式后清理监听，不阻拦后续导航和窗口关闭", () => {
  const { document, window, state, cleanup } = fixture()
  cleanup()
  const click = new Event("click", { cancelable: true })
  const unload = new Event("beforeunload", { cancelable: true })
  document.dispatchEvent(click)
  window.dispatchEvent(unload)
  assert.equal(click.defaultPrevented, false)
  assert.equal(unload.defaultPrevented, false)
  assert.equal(state.prompts, 0)
})
