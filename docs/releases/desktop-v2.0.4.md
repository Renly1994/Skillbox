# Skillbox v2.0.4 更新通告

本次更新修复 Skill 历史版本达到保留上限时，恢复最旧快照可能失败并提前删除该快照的问题。

- **历史已满也可恢复旧版本**：恢复成功后才按设置的上限清理历史，恢复前的内容会保留为可还原的快照。
- **失败时保留原有数据**：如果快照无法读取或恢复过程写入失败，不会提前清理原有历史。若文件已恢复、只是列表刷新失败，会单独提示刷新。

## 下载与安装

- [Windows 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.4/Skillbox-Setup-2.0.4.exe)
- [Mac Apple 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.4/Skillbox-2.0.4-arm64.dmg)
- [Mac Intel 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.4/Skillbox-2.0.4-x64.dmg)
- [Linux AppImage](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.4/Skillbox-2.0.4-x86_64.AppImage) · [Debian 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.4/Skillbox-2.0.4-amd64.deb)

安装新版本前，请完全退出 Skillbox，然后覆盖安装。现有 Skill 和本地数据保留。

## Mac 更新与首次打开

下载对应芯片的 DMG，将 `SkillboxApp.app` 拖入「应用程序」文件夹并替换旧版，再重新打开。当前 Mac 安装包尚未完成 Apple 开发者签名与公证，应用内自动安装更新仍有限制，请手动下载安装。

如果提示「已损坏」或无法验证开发者，请确认安装包来自本仓库的 Release，再打开「终端」执行：

```bash
xattr -dr com.apple.quarantine "/Applications/SkillboxApp.app"
```

随后在「应用程序」中右键点击 SkillboxApp，选择「打开」。此操作会移除该应用的下载隔离标记；安装包未经 Apple 签名与公证时，请勿对其他来源的文件执行此命令。
