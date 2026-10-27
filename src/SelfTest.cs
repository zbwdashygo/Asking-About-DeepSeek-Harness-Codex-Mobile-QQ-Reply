using System;
using System.IO;
using System.IO.Compression;
using System.Text;
namespace StellaRelay {
  internal static class SelfTest {
    private static int checks;
    private static void Assert(bool result, string name) { checks++; if (!result) throw new InvalidOperationException("Self-test failed: " + name); }
    public static int Run(string root) {
      root = Path.GetFullPath(root); Directory.CreateDirectory(root); Backend.DataRoot = Path.Combine(root, "data");
      try {
        Assert(!Backend.ValidId("../bad"), "reject path as ID"); Assert(!Backend.ValidId("12"), "reject short ID");
        Profile first = Backend.Save("1111111111", "2222222222"), second = Backend.Save("3333333333", "4444444444");
        Assert(first.token != second.token, "separate tokens"); Assert(first.onebotPort != first.webPort, "separate ports");
        Assert(Backend.Read(Backend.ConfigFor(first)).contactId == first.contactId, "config round trip");
        Assert(Backend.DirectoryFor(first) != Backend.DirectoryFor(second), "separate data roots");
        Assert(Backend.IsDedicatedRuntime(first, Path.Combine(Backend.RuntimeFor(first), "node.exe")), "cleanup accepts only own runtime executable");
        Assert(!Backend.IsDedicatedRuntime(first, Path.Combine(Backend.RuntimeFor(second), "node.exe")) && !Backend.IsDedicatedRuntime(first, "C:\\Program Files\\Tencent\\QQNT\\QQ.exe"), "cleanup excludes other profiles and personal QQ");
        File.WriteAllText(Path.Combine(Backend.DirectoryFor(first), "runtime.log"), "NapCat Shell App Loading...\n当前账号已登录,无法重复登录\nprivate token not for UI");
        Assert(Backend.LoginHint(first).Contains("重复登录") && !Backend.LoginHint(first).Contains("private token"), "login error hint does not reveal logs");
        File.AppendAllText(Path.Combine(Backend.DirectoryFor(first), "runtime.log"), "\nNapCat Shell App Loading...\n正在快速登录");
        Assert(Backend.LoginHint(first).Contains("已有登录"), "latest startup supersedes older login error");
        Backend.SetMobileWake(first, true);
        Assert(File.ReadAllText(Backend.ConfigFor(first) + ".mobile-codex.json").Contains("true") && File.ReadAllText(Backend.ConfigFor(first) + ".mobile-dsh.json").Contains("true"), "both mobile wake switches enabled");
        Backend.SetMobileWake(first, false);
        Assert(File.ReadAllText(Backend.ConfigFor(first) + ".mobile-codex.json").Contains("false"), "mobile wake can be disabled");
        Assert(Backend.Save("1111111111", "5555555555").token == first.token, "stable token when editing contact");
        Directory.CreateDirectory(Backend.RuntimeFor(first)); File.WriteAllText(Path.Combine(Backend.RuntimeFor(first), "node.exe"), "test stub"); Backend.WriteRuntimeConfig(first);
        string onebot = File.ReadAllText(Path.Combine(Backend.RuntimeFor(first), "napcat", "config", "onebot11_" + first.botId + ".json"));
        Assert(onebot.Contains("127.0.0.1") && !onebot.Contains("0.0.0.0"), "loopback only");
        string project = Path.Combine(root, "project with spaces 中文"); Directory.CreateDirectory(Path.Combine(project, ".codex"));
        string configFile = Path.Combine(project, ".codex", "config.toml"), agentsFile = Path.Combine(project, "AGENTS.md");
        File.WriteAllText(configFile, "model = \"example\"\n"); File.WriteAllText(agentsFile, "User instructions\n");
        Backend.AttachProject(first, project); string attached = File.ReadAllText(configFile);
        Assert(attached.Contains("model = \"example\"") && attached.Contains("mcp_servers.stella_relay"), "preserve project config");
        Backend.AttachProject(first, project); Assert(attached == File.ReadAllText(configFile), "idempotent attachment");
        Assert(File.ReadAllText(agentsFile).Contains("User instructions"), "preserve instructions");
        Assert(Directory.GetFiles(Path.Combine(project, ".codex"), "*.bak").Length >= 1, "backups created");
        string userScope = Path.Combine(root, "test-user-scope", ".codex"); Directory.CreateDirectory(userScope);
        File.WriteAllText(Path.Combine(userScope, "config.toml"), "approval_policy = \"on-request\"\n");
        File.WriteAllText(Path.Combine(userScope, "AGENTS.md"), "Existing user instructions\n");
        Backend.AttachUser(first, userScope);
        Assert(File.ReadAllText(Path.Combine(userScope, "config.toml")).Contains("approval_policy = \"on-request\"") && File.ReadAllText(Path.Combine(userScope, "config.toml")).Contains("mcp_servers.stella_relay"), "user scope preserves approval policy");
        Assert(File.ReadAllText(Path.Combine(userScope, "AGENTS.md")).Contains("Existing user instructions"), "user scope preserves instructions");
        Assert(!File.ReadAllText(Path.Combine(userScope, "config.toml")).Contains("trust_level"), "user scope does not grant trust");
        DshConfig.Export(first); string dsh = Path.Combine(Backend.DirectoryFor(first), "dsh-plugin");
        Assert(File.Exists(Path.Combine(dsh, "app", "dsh", "adapter.mjs")) && File.Exists(Path.Combine(dsh, "package.json")), "DSH local bundle generated");
        Assert(File.ReadAllText(Path.Combine(dsh, "cordis.patch.yml")).StartsWith("- insert:"), "DSH bundle inserts its plugin");
        Assert(!File.ReadAllText(Path.Combine(dsh, "package.json")).Contains(first.token), "no token in bundle manifest");
        Assert(File.ReadAllText(Path.Combine(dsh, "package.json")).Contains("0.2.0-rc.2 || 0.2.1-rc.2") && !File.ReadAllText(Path.Combine(dsh, "package.json")).Contains("dsh-tools"), "DSH verified versions without external SDK peer");
        string archive = Path.Combine(root, "bad.zip");
        using (ZipArchive zip = ZipFile.Open(archive, ZipArchiveMode.Create)) { ZipArchiveEntry entry = zip.CreateEntry("../escape.txt"); using (StreamWriter writer = new StreamWriter(entry.Open())) writer.Write("bad"); }
        bool rejected = false; try { RuntimeManager.Extract(archive, Path.Combine(root, "extract")); } catch (InvalidOperationException) { rejected = true; }
        Assert(rejected && !File.Exists(Path.Combine(root, "escape.txt")), "ZIP traversal rejected");
        rejected = false; try { RuntimeManager.Verify(archive); } catch (InvalidOperationException) { rejected = true; } Assert(rejected, "wrong upstream hash rejected");
        string runtime = Path.Combine(root, "patch-fixture"); Directory.CreateDirectory(Path.Combine(runtime, "napcat"));
        foreach (string file in new[] { "node.exe", "index.js", "wrapper.node" }) File.WriteAllText(Path.Combine(runtime, file), "fixture");
        string bundle = Path.Combine(runtime, "napcat", "napcat.mjs"); File.WriteAllText(bundle, "const a = this.context.wrapper.NodeQQNTWrapperUtil.getNTUserDataInfoConfig();\nconst b = t.NodeQQNTWrapperUtil.getNTUserDataInfoConfig();\n");
        RuntimeManager.Isolate(runtime); string patched = File.ReadAllText(bundle);
        Assert(patched.StartsWith("// STELLA_ISOLATED_QQ_DATA") && !patched.Contains("getNTUserDataInfoConfig()"), "native data discovery replaced");
        rejected = false; try { RuntimeManager.Isolate(runtime); } catch (InvalidOperationException) { rejected = true; } Assert(rejected, "unknown/already modified runtime rejected");
        File.WriteAllText(Path.Combine(root, "self-test.json"), "{\"passed\":" + checks + ",\"taskCreated\":false,\"qqStarted\":false}", Backend.Utf8); return 0;
      } catch (Exception e) { File.WriteAllText(Path.Combine(root, "self-test-error.txt"), e.ToString(), Backend.Utf8); return 2; }
    }
  }
}
