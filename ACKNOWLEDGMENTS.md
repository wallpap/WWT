# 致谢

## 原项目

[WutheringWavesTool](https://github.com/leck995/WutheringWavesTool) 由 [Leck](https://github.com/leck995) 创建并开源。本项目参考了原项目的功能组织、游戏资源处理、库街区接口使用和数据格式，使用 TypeScript 与 Bun 编写 Windows 客户端，并支持导入原版助手的数据。

感谢 Leck 和原项目贡献者投入的工作与开放的源码。原项目的使用文档见 [wave.999758.xyz](https://wave.999758.xyz/)。本项目由本仓库维护，与原项目分别发布和处理问题反馈。

## 组件与数据来源

| 项目 | 用途 |
| --- | --- |
| [Bun](https://bun.sh/) | 应用运行时与可执行程序构建 |
| [webview-bun](https://github.com/tr1ckydev/webview-bun) | Windows 桌面窗口与 WebView 界面 |
| Microsoft Visual C++ Runtime | 随包提供 WebView 原生组件所需的 x64 运行库 |
| [HDiffPatch / HPatchZ](https://github.com/sisong/HDiffPatch) | 游戏资源差分更新 |
| [Encore](https://api.encore.moe) | 角色、武器、声骸和材料图片目录 |
| [game-cal](https://github.com/cyrahs/game-cal) | 国服前瞻兑换码数据服务 |
| 库街区与鸣潮官方服务 | 账号查询、签到、游戏资源与业务数据 |

感谢这些项目的维护者和贡献者。webview-bun、Microsoft Visual C++ Runtime、HPatchZ 及其附带组件的许可声明随便携包放在 `THIRD-PARTY-NOTICES/`。仓库中的对应声明位于 `vendor/`。

游戏名称、角色、图像、图标和其他游戏资源归相应权利人所有。项目代码的 GPL 3.0 许可不改变这些资源的权利归属。
