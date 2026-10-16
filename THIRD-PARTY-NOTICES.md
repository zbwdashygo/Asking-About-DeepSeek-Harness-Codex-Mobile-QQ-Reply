# 第三方组件

本 ZIP 只包含 Stella Relay 自有代码及 .NET Framework 程序，不附带 QQ、NapCat、Node.js、Codex 或 DeepSeek Harness 的二进制文件、源代码副本、账号和登录数据。MIT 许可仅适用于本仓库自有代码。

## NapCat 与独立 QQ 运行环境

- 上游：https://github.com/NapNeko/NapCatQQ
- 固定版本：v4.18.38
- 运行包：NapCat.Shell.Windows.Node.zip，由使用者自行从上游下载或导入。
- SHA-256：`b88007a373a30deefb387e7cf17911752ff900bce22c534b3da6b644f5c6d0ae`
- 上游许可：https://github.com/NapNeko/NapCatQQ/blob/v4.18.38/LICENSE

上游对商业使用及修改后的代码再公开发布有限制。本集成按免费非商业用途提供；其他用途须自行取得对应授权。安装器仅在使用者本机对已校验的原始运行包调整独立数据路径，发行包不包含调整后的第三方文件。上游运行包中其他组件遵循各自许可。

## 客户端

Codex 与 DeepSeek Harness 由使用者独立安装。DSH 适配器调用其公开插件 API，未附带 DSH 程序代码。当前适配目标为 0.2.0-rc.2。

本项目为社区工具，与 OpenAI、DeepSeek、腾讯及 NapCat 项目没有官方隶属关系。
