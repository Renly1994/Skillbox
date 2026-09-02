import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import {
  isRequestedMarketplaceContent,
  marketplaceSourceKey,
  selectMarketplaceSkill,
} from "../src/main/marketplace-install"

test("仓库降级下载后只选择用户点击的 Skill", () => {
  const sourceDir = path.resolve("D:/temp/repository")
  const selected = selectMarketplaceSkill(
    [
      {
        name: "find-skills",
        filePath: path.join(sourceDir, "skills", "find-skills", "SKILL.md"),
      },
      {
        name: "other-skill",
        filePath: path.join(sourceDir, "skills", "other-skill", "SKILL.md"),
      },
    ],
    sourceDir,
    "find-skills",
  )

  assert.equal(selected?.name, "find-skills")
})

test("仓库内没有目标 Skill 时不拿其他 Skill 顶替", () => {
  const sourceDir = path.resolve("D:/temp/repository")
  const selected = selectMarketplaceSkill(
    [
      {
        name: "other-skill",
        filePath: path.join(sourceDir, "skills", "other-skill", "SKILL.md"),
      },
      {
        name: "another-skill",
        filePath: path.join(sourceDir, "skills", "another-skill", "SKILL.md"),
      },
    ],
    sourceDir,
    "find-skills",
  )

  assert.equal(selected, null)
})

test("仓库只有一个无关 Skill 时也不会误装", () => {
  const sourceDir = path.resolve("D:/temp/repository")
  const discovered = [{
    name: "other-skill",
    filePath: path.join(sourceDir, "other-skill", "SKILL.md"),
  }]

  assert.equal(
    selectMarketplaceSkill(discovered, sourceDir, "find-skills"),
    null,
  )
  assert.equal(
    selectMarketplaceSkill(discovered, sourceDir, "find-skills", true),
    discovered[0],
  )
})

test("市场来源记录精确到仓库中的具体 Skill", () => {
  assert.equal(
    marketplaceSourceKey("vercel-labs", "skills", "find-skills"),
    "vercel-labs/skills/find-skills",
  )
})

test("仓库根目录的预览内容必须与用户点击的 Skill 一致", () => {
  const content = `---\nname: root-skill\ndescription: Root\n---\n`

  assert.equal(
    isRequestedMarketplaceContent("nested-skill", "SKILL.md", content),
    false,
  )
  assert.equal(
    isRequestedMarketplaceContent("root-skill", "SKILL.md", content),
    true,
  )
  assert.equal(
    isRequestedMarketplaceContent("nested-skill", "skills/nested-skill/SKILL.md", content),
    true,
  )
})
