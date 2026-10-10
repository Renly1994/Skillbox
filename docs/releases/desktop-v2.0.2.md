# Skillbox v2.0.2 更新通告

Skill 装得越来越多，哪些经常用、哪些很久没用？v2.0.2 新增个人使用热度，让常用技能更好找，也方便整理技能库。

- **看清哪些 Skill 最常用**：技能列表和收藏列表新增火焰热度，按近期热度排序即可把常用技能放在前面。悬停可查看近 30 天、近 90 天的使用次数，以及最近一次使用记录。
- **找出用得少的 Skill**：选择近 30 天或近 90 天，设置次数上限，快速筛选低频技能。例如，上限设为 1，就能找到这段时间内已记录 1 次使用的技能。
- **整理长期闲置的 Skill**：筛出已观察满所选时间、没有使用记录的技能。新安装或记录不足的技能不会直接列入闲置。低频和闲置筛选默认排除收藏，也可取消排除。

## 火焰如何显示

按近 30 天的使用次数分档：

| 使用次数 | 列表显示 |
| --- | --- |
| 0–1 次 | 不显示热度图标 |
| 2–3 次 | 1 颗空心火苗 |
| 4–9 次 | 一档：1 颗实心火焰 |
| 10–29 次 | 二档：2 颗实心火焰 |
| 30 次及以上 | 三档：3 颗实心火焰 |

## 统计说明

当前根据 Codex CLI 和 Claude Code 已有的本地记录估算使用频率，同一会话内重复使用同一个 Skill 只计 1 次。Skillbox 内的预览和编辑不计入使用次数；缺少可用记录时显示「暂无数据」，不会直接当作零使用。

统计数据保存在你的电脑上，不上传对话内容或代码。整理结果由你决定，筛选不会自动停用或删除技能。

## 下载与安装

- [Windows 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.2/Skillbox-Setup-2.0.2.exe)
- [Mac Apple 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.2/Skillbox-2.0.2-arm64.dmg)
- [Mac Intel 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.2/Skillbox-2.0.2-x64.dmg)
- [Linux AppImage](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.2/Skillbox-2.0.2-x86_64.AppImage) · [Debian 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.2/Skillbox-2.0.2-amd64.deb)

安装新版本前，请完全退出 Skillbox，然后覆盖安装。现有 Skill 和本地数据保留。

## Mac 更新与首次打开

下载对应芯片的 DMG，将 `SkillboxApp.app` 拖入「应用程序」文件夹并替换旧版，再重新打开。未签名、未经 Apple 公证的安装包在应用内自动安装更新时仍有限制，请手动下载安装。

如果提示「已损坏」或无法验证开发者，请确认安装包来自本仓库的 Release，再打开「终端」执行：

```bash
xattr -dr com.apple.quarantine "/Applications/SkillboxApp.app"
```

随后在「应用程序」中右键点击 SkillboxApp，选择「打开」。此操作会移除该应用的下载隔离标记；安装包未经 Apple 签名与公证时，请勿对其他来源的文件执行此命令。
