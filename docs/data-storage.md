# 数据与备份

## 数据位置

便携版把数据保存在 `WWT.exe` 同目录的 `data/` 中。从源码运行时，数据位于仓库的 `user-data/`。

| 文件或目录 | 内容 |
| --- | --- |
| `gacha-records.json` | 抽卡记录 |
| `game-time.json` | 游玩时长 |
| `settings.json`、`app-settings.json` | 游戏路径、主题、窗口与应用设置 |
| `kujiequ-session.bin` | 加密的库街区登录会话 |
| `kujiequ-role-cache.json`、`kujiequ-query-cache.json` | 已查询的角色与业务数据 |
| `kujiequ-sign-history.json`、`kujiequ-challenge-history.json` | 签到与挑战历史 |
| `kujiequ-calculator-targets.json` | 已保存的养成目标 |
| `local-archive.json` | 本地档案与战斗日报 |
| `redemption-codes.json` | 兑换码缓存 |
| `image-cache/` | 角色、武器和材料等图片缓存 |
| `exports/` | 导出的抽卡文件 |
| `logs/` | 运行日志 |

## 备份和恢复

等待下载、安装等任务结束，退出助手后复制完整 `data/` 文件夹。恢复时先退出助手，再将备份放回程序目录。

迁移电脑时可带走记录、设置与缓存。库街区会话使用当前 Windows 用户加密，更换电脑或用户后需要重新登录。

图片缓存可以重新下载，抽卡记录、时长和历史档案建议定期备份。截图保存在游戏安装目录中，需要另行备份。

## 登录与隐私

库街区登录会话只保存在本机，查询账号数据时由助手发送到库街区。game-cal 提供公开兑换码列表，不需要库街区登录凭据。

反馈问题时，请勿附带 `kujiequ-session.bin`、Token、Did、短信验证码或抽卡完整链接。分享缓存、日志或截图前，先检查并遮住个人信息。

## 更新后的恢复

应用更新会保留 `data/`。建议在更新前另存一份备份。

升级中断导致程序无法启动时，先关闭助手，再运行相应 `.wwt-app-update-*` 工作区中的 `recover.cmd` 恢复程序文件。保留工作区，直到确认助手能够正常启动。

游戏更新缓存和恢复文件位于游戏目录，处理方式见[资源管理](resource-updates.md)。
