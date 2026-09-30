import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const iconPath = fileURLToPath(new URL("../resources/icon.ico", import.meta.url))
const icon = readFileSync(iconPath)

if (icon.length < 6 || icon.readUInt16LE(0) !== 0 || icon.readUInt16LE(2) !== 1) {
  throw new Error("resources/icon.ico 不是有效的 Windows ICO 文件")
}

const count = icon.readUInt16LE(4)
const sizes = new Set()

for (let index = 0; index < count; index += 1) {
  const entryOffset = 6 + index * 16
  if (entryOffset + 16 > icon.length) throw new Error("resources/icon.ico 的目录数据不完整")

  const width = icon[entryOffset] || 256
  const height = icon[entryOffset + 1] || 256
  const bitsPerPixel = icon.readUInt16LE(entryOffset + 6)
  const dataLength = icon.readUInt32LE(entryOffset + 8)
  const dataOffset = icon.readUInt32LE(entryOffset + 12)

  if (width !== height || bitsPerPixel !== 32 || dataOffset + dataLength > icon.length) {
    throw new Error(`resources/icon.ico 包含无效图层：${width}×${height} / ${bitsPerPixel}bpp`)
  }
  sizes.add(width)
}

const requiredSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const missingSizes = requiredSizes.filter((size) => !sizes.has(size))
if (missingSizes.length > 0) {
  throw new Error(`resources/icon.ico 缺少 Windows 图层：${missingSizes.join(", ")}`)
}

console.log(`Windows ICO 校验通过：${[...sizes].sort((a, b) => a - b).join(", ")} px`)
