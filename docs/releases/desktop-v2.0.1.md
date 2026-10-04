# Skillbox v2.0.1 更新通告

修复 WorkBuddy 国际版无法识别的问题，并补齐其他 Agent 的版本识别和配置目录适配。

- **支持 WorkBuddy AI 国际版**：国内版与国际版可单独安装或同时使用，分别识别各自的 Skill 和 MCP 配置，修改一版的 MCP 不会写入另一版。
- **支持 VS Code Insiders（Copilot）**：稳定版与 Insiders 可同时识别，共用 Copilot 用户级 Skill 目录，MCP 配置按版本独立管理。
- **补齐 TRAE、Qoder 国内版目录扫描**：自定义扫描能够正确识别专属 Skill 目录及其所属 Agent。
- **修正 Zed 跨平台目录适配**：修复 macOS MCP 配置读取路径，并补齐 Windows 命令行识别。

## 下载与安装

- [Windows 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.1/Skillbox-Setup-2.0.1.exe)
- [Mac Apple 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.1/Skillbox-2.0.1-arm64.dmg)
- [Mac Intel 芯片安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.1/Skillbox-2.0.1-x64.dmg)
- [Linux AppImage](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.1/Skillbox-2.0.1-x86_64.AppImage) · [Debian 安装包](https://github.com/Renly1994/Skillbox/releases/download/desktop-v2.0.1/Skillbox-2.0.1-amd64.deb)

安装新版本前，请完全退出 Skillbox，然后覆盖安装。现有 Skill 和本地数据保留。

## Mac 更新与首次打开

当前 Mac 安装包尚未完成 Apple 开发者签名与公证，应用内自动安装更新仍有限制。请下载对应芯片的 DMG，将 `SkillboxApp.app` 拖入“应用程序”文件夹并替换旧版，再重新打开。

如果提示“已损坏”或无法验证开发者，请确认安装包来自本仓库的 Release，再打开“终端”执行：

```bash
xattr -dr com.apple.quarantine "/Applications/SkillboxApp.app"
```

随后在“应用程序”中右键点击 SkillboxApp，选择“打开”。此操作会移除该应用的下载隔离标记；安装包未经 Apple 签名与公证，请勿对其他来源的文件执行此命令。
