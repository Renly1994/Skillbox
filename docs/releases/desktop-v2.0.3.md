# Skillbox v2.0.3 更新通告

本次更新修复 Skill 编辑时的内容保护，并统一 Codex 的自定义配置目录识别。

- **离开编辑前确认未保存的修改**：切换 Skill、切换页面、取消编辑或关闭窗口时，尚未保存的修改会得到保护；取消离开后可继续编辑。
- **保存失败后保留输入**：保存失败时继续保留当前内容，修复问题后可再次保存。保存过程中继续输入的内容也不会被提前关闭。
- **后台刷新不覆盖正在编辑的内容**：技能列表或本地文件刷新时，保留编辑器中的当前输入。
- **修复 Codex 自定义配置目录**：配置 `CODEX_HOME` 后，Skill 与 MCP 使用同一个配置根目录，MCP 的读取、修改和备份跟随实际配置位置。
- **修复部分目录的技能库迁移失败**：通过目录链接或系统路径别名访问技能库时，迁移后的内部链接按真实路径校验，避免误报链接无效。

## 下载与安装

- [Windows 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.3/Skillbox-Setup-2.0.3.exe)
- [Mac Apple 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.3/Skillbox-2.0.3-arm64.dmg)
- [Mac Intel 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.3/Skillbox-2.0.3-x64.dmg)
- [Linux AppImage](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.3/Skillbox-2.0.3-x86_64.AppImage) · [Debian 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.3/Skillbox-2.0.3-amd64.deb)

安装新版本前，请完全退出 Skillbox，然后覆盖安装。现有 Skill 和本地数据保留。

## Mac 更新与首次打开

下载对应芯片的 DMG，将 `SkillboxApp.app` 拖入「应用程序」文件夹并替换旧版，再重新打开。当前 Mac 安装包尚未完成 Apple 开发者签名与公证，应用内自动安装更新仍有限制，请手动下载安装。

如果提示「已损坏」或无法验证开发者，请确认安装包来自本仓库的 Release，再打开「终端」执行：

```bash
xattr -dr com.apple.quarantine "/Applications/SkillboxApp.app"
```

随后在「应用程序」中右键点击 SkillboxApp，选择「打开」。此操作会移除该应用的下载隔离标记；安装包未经 Apple 签名与公证时，请勿对其他来源的文件执行此命令。
