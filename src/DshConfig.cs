using System;
using System.IO;
namespace StellaRelay {
  internal static class DshConfig {
    public static void Export(Profile p) {
      Backend.Validate(p); string root = Path.Combine(Backend.DirectoryFor(p), "dsh-plugin");
      Directory.CreateDirectory(root); Directory.CreateDirectory(Path.Combine(root, "app", "bridge")); Directory.CreateDirectory(Path.Combine(root, "app", "dsh"));
      foreach (string file in Directory.GetFiles(Path.Combine(Backend.AppRoot, "app", "bridge"), "*.mjs")) File.Copy(file, Path.Combine(root, "app", "bridge", Path.GetFileName(file)), true);
      File.Copy(Path.Combine(Backend.AppRoot, "app", "dsh", "adapter.mjs"), Path.Combine(root, "app", "dsh", "adapter.mjs"), true);
      File.WriteAllText(Path.Combine(root, "app", "dsh", "relay-location.json"), Backend.Json.Serialize(new { configFile = Backend.ConfigFor(p) }), Backend.Utf8);
      File.WriteAllText(Path.Combine(root, "package.json"), "{\"name\":\"stella-relay-dsh\",\"version\":\"0.4.0-beta.4\",\"type\":\"module\",\"main\":\"app/dsh/adapter.mjs\",\"description\":\"Stella Relay 手机 QQ 问答\",\"peerDependencies\":{\"@deepseek-ai/dsh\":\"0.2.0-rc.2 || 0.2.1-rc.2\"},\"dsh\":{\"bundle\":{\"patch\":\"cordis.patch.yml\"}}}", Backend.Utf8);
      File.WriteAllText(Path.Combine(root, "cordis.patch.yml"), "- insert:\n    - id: stella-relay-dsh\n      name: stella-relay-dsh\n", Backend.Utf8);
      string setup = "Stella Relay · DeepSeek Harness\r\n\r\n可先在 Stella 的“连接客户端 → 手机文档问答”选择手机必达模式：普通问题发 QQ 并附 TXT，不再要求先提交电脑测试。手机直接按编号回答，权限审批仍在电脑。\r\n\r\n在 DSH 侧边栏“插件”中安装本地组合包，填入以下绝对路径：\r\n" + root +
        "\r\n\r\n安装并启用后，在 DSH 对助手说：\r\n“电脑优先模式先调用 stella_test_desktop_form；手机必达模式直接使用提问工具。之后普通澄清和选择题使用 stella_ask_on_desktop；权限审批沿用原机制。工作实际完成后调用 stella_notify_completion 发送一次 QQ 完成通知。需要手机主动发起任务时，调用 stella_configure_mobile_wake 并设 enabled 为 true。”\r\n\r\n手机主动唤醒启用后：保持 DSH 和独立 QQ 后台运行，手机发送“列表 dsh”，再发送“唤醒 dsh 列表编号 任务内容”。接收回执不代表任务完成，系统审批仍在电脑处理。\r\n\r\n电脑优先模式先显示 DSH 卡片，再发 QQ；手机必达模式直接发 QQ 及问题文档，不受电脑卡片影响。\r\n先在电脑提交测试，再让 DSH 提普通测试问题，在手机按编号回复，确认电脑卡片结束且模型收到答案。\r\n\r\n已验证的 DSH 版本：0.2.0-rc.2、0.2.1-rc.2。其他版本须先验证，不要添加版本豁免。\r\n\r\n原有 ask_user_question 和权限审批不被拦截。此配置仅指向本机小号资料，不包含密码。\r\n此本机插件目录含本机路径，不要作为公共发行包上传。\r\n";
      File.WriteAllText(Path.Combine(Backend.DirectoryFor(p), "dsh-setup.txt"), setup, Backend.Utf8);
    }
  }
}
