import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { applyPush, planPush } from "../src/main/db/push"
import { migrateSkillStorage } from "../src/main/skill-storage-migration"

test("迁移后的本地 Skill 保留在普通和镜像推送计划中", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillbox-push-migration-"))
  const canonical = path.join(root, ".agents", "skills")
  const destination = path.join(root, "disk-d", "Skillbox Skills")
  const skillPath = path.join(destination, "demo")
  const stableSkillPath = path.join(destination, "stable")
  const newSkillPath = path.join(destination, "new-skill")
  const remoteBase = "/srv/skills"
  const server = {
    id: "test",
    label: "模拟服务器",
    host: "127.0.0.1",
    port: 22,
    username: "test",
    skillsBasePath: remoteBase,
    sshKeyPath: null,
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: "",
  }
  const deleted: string[] = []
  const uploaded: string[] = []

  try {
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true })
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "本地版本")
    await fs.mkdir(path.join(canonical, "stable"), { recursive: true })
    await fs.writeFile(path.join(canonical, "stable", "SKILL.md"), "稳定版本")
    await fs.mkdir(path.join(canonical, "new-skill"), { recursive: true })
    await fs.writeFile(path.join(canonical, "new-skill", "SKILL.md"), "新 Skill")
    const migration = await migrateSkillStorage(canonical, destination)
    const canonicalSkillPath = await fs.realpath(skillPath)
    const canonicalStablePath = await fs.realpath(stableSkillPath)
    const canonicalNewSkillPath = await fs.realpath(newSkillPath)
    const dependencies = {
      storageRoot: canonical,
      localSkills: [
        {
          scope: "global" as const,
          canonicalPath: canonicalSkillPath,
          folderName: "demo",
          name: "Demo",
        },
        {
          scope: "global" as const,
          canonicalPath: canonicalStablePath,
          folderName: "stable",
          name: "Stable",
        },
        {
          scope: "global" as const,
          canonicalPath: canonicalNewSkillPath,
          folderName: "new-skill",
          name: "New Skill",
        },
      ],
      scanRemote: async () => [
        {
          name: "Demo",
          description: null,
          remotePath: `${remoteBase}/demo/SKILL.md`,
          content: "远端旧版本",
          contentHash: "different-hash",
        },
        {
          name: "Stable",
          description: null,
          remotePath: `${remoteBase}/stable/SKILL.md`,
          content: "稳定版本",
          contentHash: crypto.createHash("sha256").update("稳定版本", "utf-8").digest("hex"),
        },
        {
          name: "Remote only",
          description: null,
          remotePath: `${remoteBase}/remote-only/SKILL.md`,
          content: "远端独有",
          contentHash: "remote-hash",
        },
      ],
    }

    const ordinary = await planPush(server, { mirror: false }, dependencies)
    assert.deepEqual(ordinary.toAdd.map((entry) => entry.folderName), ["new-skill"])
    assert.equal(ordinary.toUpdate[0]?.localPath, canonicalSkillPath)
    assert.deepEqual(ordinary.unchanged.map((entry) => entry.folderName), ["stable"])
    assert.deepEqual(ordinary.toDelete, [])

    const mirror = await planPush(server, { mirror: true }, dependencies)
    assert.deepEqual(mirror.toAdd.map((entry) => entry.folderName), ["new-skill"])
    assert.deepEqual(mirror.toUpdate.map((entry) => entry.folderName), ["demo"])
    assert.deepEqual(mirror.unchanged.map((entry) => entry.folderName), ["stable"])
    assert.deepEqual(mirror.toDelete.map((entry) => entry.folderName), ["remote-only"])

    await applyPush(server, mirror, {
      upload: async (_server, localRoot, folderName) => {
        uploaded.push(path.join(localRoot, folderName))
      },
      delete: async (_server, remoteDir) => { deleted.push(remoteDir) },
    })
    assert.deepEqual(uploaded, [canonicalNewSkillPath, canonicalSkillPath])
    assert.deepEqual(deleted, [`${remoteBase}/remote-only`])
    assert.equal(migration.path, destination)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
