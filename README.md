# Stella Relay

让 Codex 和 DeepSeek Harness 的普通澄清问题先显示在电脑，再通过独立 QQ 小号发给自己的大号。手机回复会返回同一次提问；电脑和手机只采用一次有效答复。

**Windows 10/11 x64 · .NET Framework 4.8 · 免费非商业集成 · 0.3.0-beta.3**

## 下载和首次使用

从本仓库 Releases 下载 `StellaRelay-0.3.0-beta.3-windows-x64.zip`，解压到固定、可写目录，双击 `StellaRelay.exe`。不要仅复制 EXE；保留旁边的 `app` 文件夹。

1. 填写自己的专用 QQ 小号和接收消息的大号。两个号码需要事先互加好友。点击“保存账号”。
2. 点击“下载独立环境”，或导入上游 v4.18.38 的 `NapCat.Shell.Windows.Node.zip`。程序核对 SHA-256 后创建独立运行环境。
3. 点击“启动后台”，再点“登录二维码”，使用小号扫码并在手机确认。不会读取已安装 QQ 的登录状态或凭据。
4. 状态显示小号登录且大号好友核验成功后，进入“连接客户端”。

首次下载约 124 MB，需能访问 GitHub。QQ 若限制登录，请在手机按 QQ 提示恢复；程序不处理验证码或绕过账号限制。

## Codex

点击“连接 Codex 项目”仅启用选定目录；或点击“Codex 全局启用”，把普通问答工具与规则安装到当前用户的 `~/.codex/config.toml` 和 `~/.codex/AGENTS.md`，供其他项目加载。两种方式均保留原内容并生成备份，不修改审批设置或自动信任项目。已打开的聊天需要重新加载 MCP 与指令；只有实际调用转发工具的问题才会同步 QQ。

回到 Codex，按客户端提示信任自己选择的项目，然后加载或 Restart `stella_relay`。对助手说：

> 先调用 stella_relay 的 test_desktop_form 验证电脑表单；之后普通澄清和选择题使用 ask_on_desktop。再发一个问题让我从手机 QQ 回答。

每个新 MCP 连接需先在电脑真实提交一次表单；不支持原生表单时，保留电脑原有提问方式，不会退化为 QQ 独占。

## DeepSeek Harness

当前适配目标为 **0.2.0-rc.2**。点击“生成 DSH 配置”，按打开的说明，在 DSH 侧边栏的“插件”页面安装生成的本地组合包路径，启用后重新加载。

对 DSH 助手说：

> 先调用 stella_test_desktop_form，让我在电脑提交。后续普通澄清和选择题优先使用 stella_ask_on_desktop，权限审批沿用原机制。现在发一个问题让我从手机回答。

适配器调用 DSH 的原生 `userQuestions` 服务。原有 `ask_user_question` 和系统审批没有被拦截；只有使用转发工具的普通提问有 QQ 副本。其他版本须先验证兼容性，不建议添加版本豁免。

## 工作完成通知

已连接的 Codex 聊天在工作实际完成后调用 `notify_completion`，DSH 调用 `stella_notify_completion`，向配置的唯一大号发送一次简短结果与必要下载链接，无需回复。不会把日常进度当作完成通知。

升级后重新连接项目或点击“Codex 全局启用”以更新规则，并重新加载 MCP 与聊天指令；DSH 重新生成并加载插件后，按生成说明启用完成通知。该功能依赖助手调用专用工具，不是对全部客户端完成事件的自动监听。接口确认成功仅代表 QQ 服务已接收，不代表手机已读；失败或超时不会自动重发。

## 手机怎么回答

按消息末尾的格式发送：`问题编号 你的回答`。选择题可以回复选项数字，也可以用自己的话回答。必须保留本题编号。

有效回复会收到“回复已接收”的 QQ 确认，答案不等待确认消息发送完成。电脑先答或取消后，手机问题编号失效。迟到、重复、过期或非配置大号的回复不会用于其他问题。

系统权限、沙箱审批、自动审核拒绝和 DSH 计划审阅仍由电脑原机制处理。本工具不能代答这些审批。

## 本机数据与后台

每个小号的数据保存到 `%LOCALAPPDATA%\StellaRelay\profiles\<小号>`，包含本机令牌、独立登录信息和运行日志。**不要上传或分享这个目录。** 程序不收集 QQ 密码，不把问题发送给配置大号以外的联系人。

后台使用当前用户的普通权限任务，无开机或登录触发器。关闭窗口后后台继续运行；Windows 重启后重新打开程序并点击“启动后台”。点击“停止后台”可暂停。卸载前在“说明”页移除后台任务，再删除程序目录；登录数据会保留，需自行决定是否删除。

升级前先停止后台，在原程序目录替换发行文件。程序换目录后需移除旧目录登记的后台任务并重新连接客户端。

## 构建与测试

需要 Windows x64、.NET Framework 4.8 自带 C# 编译器、Node.js 22 或更新版本。没有 npm 依赖。

```powershell
node --test test/*.test.mjs
./build.ps1
```

构建执行 Node 回归测试和 Windows 程序自检，再从固定白名单打包。产物位于 `dist`，同时生成 `SHA256SUMS.txt`。第三方 QQ 组件不打入 ZIP。

本仓库不启用 GitHub Actions 自动构建。`examples/optional-release-workflow.yml` 仅供将来明确授权后自行配置，不会因发布标签自动运行。

## 验证范围

本发布是测试版。仓库包含账号参数校验、来源及编号校验、自由回答、双端竞争、MCP 协议、DSH 原生服务适配逻辑及 Windows 文件配置测试。测试中的虚拟客户端不等于真实桌面联调；新使用者必须在自己的客户端完成电脑和手机各一次实测。

2026-10-16 已在一台 Windows 电脑完成真实 Codex 和 DSH 0.2.0-rc.2 联调：电脑原生卡片先显示，手机 QQ 回答返回原问题，DSH 待答卡片关闭。该结果不代表其他客户端版本均兼容。

## 许可和上游资料

自有代码为 MIT；使用 QQ 运行环境须遵守其上游许可，本集成按免费非商业方式提供。详见 [第三方说明](THIRD-PARTY-NOTICES.md)。

- [OpenAI：MCP 服务器与表单](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI：项目插件与配置](https://developers.openai.com/plugins/build/plugins)
- [NapCat 上游](https://github.com/NapNeko/NapCatQQ)
- DSH 的适配契约来自使用者安装版本自带的 `dsh-user-questions`、`dsh-tool-ask-user`、`dsh-plugin-manager` 文档。
