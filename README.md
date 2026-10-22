# 鸣潮助手

用于《鸣潮》国服的 Windows 桌面工具，支持官服和 B 服。

本项目参考 [Leck 的 WutheringWavesTool](https://github.com/leck995/WutheringWavesTool) 的功能与实现，使用 TypeScript 和 Bun 编写。感谢原作者和贡献者开放源码。两个项目分别维护，问题反馈请提交到本仓库。

## 功能

- 启动游戏、记录游玩时长，管理资源更新、校验、修复和预下载。
- 查询、导入和导出抽卡记录，按玩家与卡池统计保底和五星历史。
- 登录库街区，查看每日数据、角色装备、挑战历史与资源简报，执行手动或自动签到。
- 计算角色和武器养成材料，同步当前练度，保存养成目标。
- 导入原版助手的数据，查看本地档案、战斗日志和游戏截图。
- 从 game-cal 获取国服前瞻兑换码，查看有效期并复制。

## 安装与启动

支持 Windows 10、Windows 11 x64 系统。便携包已附带所需的 Microsoft Visual C++ 运行库。

从 [GitHub Releases](https://github.com/wallpap/WWT/releases/latest) 下载 `WWT-版本号-windows-x64.zip`。同页提供 SHA-256 校验文件。

解压便携包后运行 `WWT.exe`，保留所有 DLL、`hpatchz.exe` 和其他附带文件。程序目录需要可写，建议放在自己的工具目录中。

启动时会检查 Microsoft Edge WebView2 Runtime。缺失时，按提示打开微软官方下载页，安装 Evergreen（常青版）运行时后重新启动助手。

首次启动时，在“启动器”选择游戏主程序及资源档位。需要查询账号数据时，再到“库街区账号”登录并选择绑定角色。游戏下载、修复与渠道切换的操作见[资源管理](docs/resource-updates.md)。

## 使用说明

- [使用指南](docs/usage.md)：抽卡、签到、角色、挑战、养成计算和应用设置。
- [原版数据导入](docs/migration.md)：导入 XLSX、SQLite 和设置文件。
- [数据与备份](docs/data-storage.md)：数据位置、账号登录和备份恢复。
- [资源管理](docs/resource-updates.md)：游戏下载、更新、修复、预下载与渠道切换。

养成计算默认将角色、武器和技能目标设为满级。可分别计算，也可点击“计算角色＋武器合计材料”。挑战页面按塔区、难度或模式分列，并显示所选周期的截止时间。

兑换码来源主要覆盖前瞻活动。页面显示的有效期来自来源数据，最终兑换结果以游戏为准。

## 从源码运行

安装 Bun 1.4 或更新版本、Microsoft Visual C++ x64 运行库和 WebView2 Runtime，在 Windows 上执行：

```sh
bun install
bun run dev
```

生成 Windows x64 便携包：

```sh
bun run build:portable
```

输出位于 `dist/`，包含 ZIP、SHA-256 校验文件和更新清单。构建结果不会自动上传。

## 问题反馈

请在 [Issues](https://github.com/wallpap/WWT/issues) 中说明操作步骤、预期结果、实际提示，以及应用版本和 Windows 版本。截图前遮住手机号、玩家 ID 和其他个人信息。抽卡完整链接、Token、Did 和账号会话文件请保留在本机。

## 致谢与许可

感谢 [Leck / WutheringWavesTool](https://github.com/leck995/WutheringWavesTool)、[Bun](https://bun.sh/)、[webview-bun](https://github.com/tr1ckydev/webview-bun)、[HDiffPatch](https://github.com/sisong/HDiffPatch)、[Encore](https://api.encore.moe) 和 [game-cal](https://github.com/cyrahs/game-cal)。各项目在本工具中的用途见[致谢](ACKNOWLEDGMENTS.md)。

Copyright (c) 2026 WWT contributors。

项目代码使用 [GNU GPL 3.0](LICENSE)（`GPL-3.0-only`）。第三方组件遵循各自许可证，便携包附带 `THIRD-PARTY-NOTICES/`。游戏名称、角色、图像和其他游戏资源的权利归相应权利人所有。本项目为第三方工具，与库洛游戏无隶属关系。
