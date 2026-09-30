import fs from "node:fs"
import path from "node:path"

function encryptionKeyIn(filePath: string): string | null {
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      os_crypt?: { encrypted_key?: unknown }
    }
    return typeof state.os_crypt?.encrypted_key === "string" ? state.os_crypt.encrypted_key : null
  } catch {
    return null
  }
}

export function prepareUserDataPath(
  appData: string,
  home: string,
  readEncryptedKey: (dbPath: string) => string | null,
): string {
  const previousState = path.join(appData, "@skillsgate", "desktop", "Local State")
  const nextDirectory = path.join(appData, "Skillbox")
  const nextState = path.join(nextDirectory, "Local State")
  fs.mkdirSync(nextDirectory, { recursive: true })
  if (!fs.existsSync(previousState)) return nextDirectory

  if (!fs.existsSync(nextState)) {
    fs.copyFileSync(previousState, nextState, fs.constants.COPYFILE_EXCL)
    return nextDirectory
  }

  if (fs.readFileSync(previousState).equals(fs.readFileSync(nextState))) return nextDirectory
  const previousEncryptionKey = encryptionKeyIn(previousState)
  if (previousEncryptionKey && previousEncryptionKey === encryptionKeyIn(nextState)) return nextDirectory
  const previousKey = readEncryptedKey(path.join(home, ".skillsgate", "skillsgate.db"))
  const nextKey = readEncryptedKey(path.join(home, ".skillbox", "skillbox.db"))
  if (previousKey && previousKey === nextKey) {
    const backup = `${nextState}.before-migration`
    if (!fs.existsSync(backup)) fs.copyFileSync(nextState, backup, fs.constants.COPYFILE_EXCL)
    fs.copyFileSync(previousState, nextState)
  }
  return nextDirectory
}
