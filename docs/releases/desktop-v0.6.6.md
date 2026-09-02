发布日期：2026 年 9 月 2 日

这是 v0.6.5 的 Agent 识别热修复版本。

### Agent 识别

- 修复部分 IDE 组件创建 `~/.copilot` 后，即使没有安装 GitHub Copilot CLI，侧栏仍会错误显示 GitHub Copilot 的问题。
- GitHub Copilot 现在以可执行的 `copilot` 命令作为安装判断，不再仅凭数据目录判断。
- 文件监听器不再主动创建尚不存在的 Agent Skill 目录，避免空目录造成 Agent 误识别或卸载后残留显示。

本次更新不会删除、移动或修改现有 Skill，也不影响 v0.6.5 已优化的全局与自定义目录扫描。
