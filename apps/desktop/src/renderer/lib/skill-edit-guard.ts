export function installSkillEditGuard(
  panel: HTMLElement,
  hasPendingChanges: () => boolean,
  confirmLeave: () => boolean,
  targets = { document, window },
): () => void {
  const handleClick = (event: MouseEvent) => {
    if (!hasPendingChanges() || panel.contains(event.target as Node)) return
    if (!confirmLeave()) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasPendingChanges()) return
    event.preventDefault()
    event.returnValue = ""
  }
  targets.document.addEventListener("click", handleClick, { capture: true })
  targets.window.addEventListener("beforeunload", handleBeforeUnload)
  return () => {
    targets.document.removeEventListener("click", handleClick, { capture: true })
    targets.window.removeEventListener("beforeunload", handleBeforeUnload)
  }
}
