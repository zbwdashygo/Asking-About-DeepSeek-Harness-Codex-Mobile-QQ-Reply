using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace StellaRelay {
  public sealed class Profile {
    public string botId, contactId, token, installId;
    public int onebotPort, webPort;
  }
  public sealed class Status {
    public bool running, connected, contactReady;
    public string message;
  }
  internal static class Backend {
    public static string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StellaRelay");
    public static readonly string AppRoot = AppDomain.CurrentDomain.BaseDirectory;
    public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    public static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    public static bool ValidId(string value) { return value != null && Regex.IsMatch(value, "^[1-9][0-9]{4,11}$"); }
    public static string DirectoryFor(Profile p) { return Path.Combine(DataRoot, "profiles", p.botId); }
    public static string ConfigFor(Profile p) { return Path.Combine(DirectoryFor(p), "relay.json"); }
    public static string RuntimeFor(Profile p) { return Path.Combine(DirectoryFor(p), "runtime"); }
    public static string TaskName(Profile p) { return "StellaRelay-" + p.installId; }
    public static string RandomToken() {
      byte[] data = new byte[32]; using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(data);
      return BitConverter.ToString(data).Replace("-", "").ToLowerInvariant();
    }
    public static void Validate(Profile p) {
      if (p == null || !ValidId(p.botId) || !ValidId(p.contactId) || p.botId == p.contactId || p.token == null ||
          !Regex.IsMatch(p.token, "^[a-f0-9]{64}$") || p.installId == null || !Regex.IsMatch(p.installId, "^[a-f0-9]{24}$") ||
          p.onebotPort < 1024 || p.onebotPort > 65535 || p.webPort < 1024 || p.webPort > 65535 || p.onebotPort == p.webPort) throw new InvalidOperationException("账号配置不完整或无效。");
    }
    public static Profile Read(string file) { Profile p = Json.Deserialize<Profile>(File.ReadAllText(file, Encoding.UTF8)); Validate(p); return p; }
    public static Profile LastProfile() {
      try { string bot = File.ReadAllText(Path.Combine(DataRoot, "last-profile.txt")).Trim(); if (ValidId(bot)) return Read(Path.Combine(DataRoot, "profiles", bot, "relay.json")); } catch { }
      return null;
    }
    private static int FreePort() {
      TcpListener listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
      try { return ((IPEndPoint)listener.LocalEndpoint).Port; } finally { listener.Stop(); }
    }
    public static Profile Save(string bot, string contact) {
      bot = bot.Trim(); contact = contact.Trim();
      if (!ValidId(bot) || !ValidId(contact) || bot == contact) throw new InvalidOperationException("请填写不同的小号和大号 QQ 号码（5–12 位数字）。");
      string file = Path.Combine(DataRoot, "profiles", bot, "relay.json");
      Profile p = File.Exists(file) ? Read(file) : new Profile { botId = bot, contactId = contact, token = RandomToken(), installId = Guid.NewGuid().ToString("N").Substring(0, 24), onebotPort = FreePort(), webPort = FreePort() };
      while (p.webPort == p.onebotPort) p.webPort = FreePort();
      if (TaskState(p, "status")) throw new InvalidOperationException("请先停止这个小号的后台，再保存账号设置。");
      p.contactId = contact; Validate(p); Directory.CreateDirectory(DirectoryFor(p));
      File.WriteAllText(file, Json.Serialize(p), Utf8); File.WriteAllText(Path.Combine(DataRoot, "last-profile.txt"), bot, Utf8);
      if (Directory.Exists(RuntimeFor(p))) WriteRuntimeConfig(p);
      return p;
    }
    public static void WriteRuntimeConfig(Profile p) {
      string dir = Path.Combine(RuntimeFor(p), "napcat", "config"); Directory.CreateDirectory(dir);
      object ws = new { name = "stella-relay", enable = true, host = "127.0.0.1", port = p.onebotPort, messagePostFormat = "array", reportSelfMessage = false, token = p.token, debug = false, heartInterval = 15000 };
      object config = new { network = new { httpServers = new object[0], httpClients = new object[0], websocketServers = new object[] { ws }, websocketClients = new object[0] }, enableLocalFile2Url = false, parseMultMsg = false, musicSignUrl = "" };
      File.WriteAllText(Path.Combine(dir, "onebot11_" + p.botId + ".json"), Json.Serialize(config), Utf8);
      File.WriteAllText(Path.Combine(dir, "webui.json"), Json.Serialize(new { host = "127.0.0.1", port = p.webPort, token = p.token, loginRate = 3 }), Utf8);
    }
    private static void Release(object obj) { if (obj != null && Marshal.IsComObject(obj)) Marshal.FinalReleaseComObject(obj); }
    public static bool TaskState(Profile p, string operation) {
      Validate(p); object serviceObject = null, folderObject = null, taskObject = null;
      try {
        serviceObject = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service", true)); dynamic service = serviceObject; service.Connect();
        folderObject = service.GetFolder("\\"); dynamic folder = folderObject;
        try { taskObject = folder.GetTask(TaskName(p)); }
        catch (Exception e) { if ((uint)e.HResult != 0x80070002 && (uint)e.HResult != 0x80070003 && (uint)e.HResult != 0x8004130F) throw; }
        string exe = Path.Combine(AppRoot, "StellaRelay.exe");
        string arguments = "--worker \"" + ConfigFor(p) + "\"";
        string description = "Stella Relay isolated profile " + p.installId;
        if (taskObject == null && operation == "start") {
          if (!File.Exists(Path.Combine(RuntimeFor(p), "stella-isolated.txt"))) throw new InvalidOperationException("请先准备独立运行环境。");
          dynamic definition = service.NewTask(0); definition.RegistrationInfo.Description = description;
          definition.Principal.LogonType = 3; definition.Principal.RunLevel = 0;
          definition.Settings.Enabled = true; definition.Settings.ExecutionTimeLimit = "PT0S";
          definition.Settings.MultipleInstances = 2; definition.Settings.DisallowStartIfOnBatteries = false; definition.Settings.StopIfGoingOnBatteries = false;
          dynamic action = definition.Actions.Create(0); action.Path = exe; action.Arguments = arguments; action.WorkingDirectory = AppRoot;
          taskObject = folder.RegisterTaskDefinition(TaskName(p), definition, 6, System.Security.Principal.WindowsIdentity.GetCurrent().Name, null, 3, null);
        }
        if (taskObject == null) return false;
        dynamic task = taskObject; dynamic actionCheck = task.Definition.Actions.Item(1);
        if ((string)task.Definition.RegistrationInfo.Description != description || !String.Equals((string)actionCheck.Path, exe, StringComparison.OrdinalIgnoreCase) || (string)actionCheck.Arguments != arguments) throw new InvalidOperationException("发现不属于当前安装目录的同名后台任务，未操作。请从原安装目录停止后台。");
        int state = (int)task.State;
        if (operation == "start" && state != 4 && state != 2) task.Run(null);
        if (operation == "stop" && (state == 4 || state == 2)) task.Stop(0);
        if (operation == "remove") { if (state == 4 || state == 2) task.Stop(0); folder.DeleteTask(TaskName(p), 0); return false; }
        return (int)task.State == 4 || (int)task.State == 2;
      } finally { Release(taskObject); Release(folderObject); Release(serviceObject); }
    }
    public static int Worker(string configFile) {
      Profile p = Read(configFile);
      // The explicit config determines the profile root, never the installed QQ.
      DataRoot = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(configFile))));
      if (!String.Equals(Path.GetFullPath(configFile), Path.GetFullPath(ConfigFor(p)), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Profile path mismatch");
      if (!File.Exists(Path.Combine(RuntimeFor(p), "stella-isolated.txt"))) throw new InvalidOperationException("Isolation guard missing");
      string bootstrap = Path.Combine(AppRoot, "app", "bootstrap.cjs");
      ProcessStartInfo info = new ProcessStartInfo(Path.Combine(RuntimeFor(p), "node.exe"), "\"" + bootstrap + "\" -q " + p.botId);
      info.WorkingDirectory = RuntimeFor(p); info.UseShellExecute = false; info.CreateNoWindow = true;
      info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
      info.EnvironmentVariables["STELLA_RELAY_CONFIG"] = configFile;
      string log = Path.Combine(DirectoryFor(p), "runtime.log"); object logLock = new object();
      using (Process child = new Process()) {
        child.StartInfo = info;
        DataReceivedEventHandler record = delegate(object sender, DataReceivedEventArgs e) { if (e.Data == null) return; lock (logLock) { try { File.AppendAllText(log, e.Data + Environment.NewLine, Utf8); } catch { } } };
        child.OutputDataReceived += record; child.ErrorDataReceived += record;
        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine(); child.WaitForExit(); return child.ExitCode;
      }
    }
    public static void SetMobileWake(Profile p, bool enabled) {
      Validate(p);
      foreach (string platform in new[] { "codex", "dsh" }) {
        string file = ConfigFor(p) + ".mobile-" + platform + ".json";
        Dictionary<string, object> value = File.Exists(file) ? Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) : new Dictionary<string, object>();
        value["enabled"] = enabled;
        Directory.CreateDirectory(DirectoryFor(p)); string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporary, Json.Serialize(value), Utf8);
        if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
      }
    }
    private static async Task<Dictionary<string, object>> Api(ClientWebSocket socket, string action, CancellationToken cancellation) {
      string echo = Guid.NewGuid().ToString("N"); byte[] request = Encoding.UTF8.GetBytes(Json.Serialize(new { action = action, @params = new { }, echo = echo }));
      await socket.SendAsync(new ArraySegment<byte>(request), WebSocketMessageType.Text, true, cancellation).ConfigureAwait(false);
      byte[] buffer = new byte[8192];
      for (int i = 0; i < 40; i++) using (MemoryStream output = new MemoryStream()) {
        WebSocketReceiveResult frame;
        do { frame = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellation).ConfigureAwait(false); if (frame.MessageType == WebSocketMessageType.Close) return null; output.Write(buffer, 0, frame.Count); if (output.Length > 4194304) return null; } while (!frame.EndOfMessage);
        Dictionary<string, object> m = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(output.ToArray()));
        object value; if (!m.TryGetValue("echo", out value) || Convert.ToString(value) != echo) continue;
        return Convert.ToString(m["status"]) == "ok" && Convert.ToInt32(m["retcode"]) == 0 ? m : null;
      }
      return null;
    }
    public static async Task<Status> Check(Profile p) {
      Status result = new Status { message = "请先保存账号配置" }; if (p == null) return result;
      result.running = await Task.Run(() => TaskState(p, "status")); result.message = result.running ? "后台已启动，等待扫码或连接" : "后台已停止";
      if (!result.running) return result;
      try {
        using (CancellationTokenSource timeout = new CancellationTokenSource(2500)) using (ClientWebSocket socket = new ClientWebSocket()) {
          await socket.ConnectAsync(new Uri("ws://127.0.0.1:" + p.onebotPort + "/?access_token=" + p.token), timeout.Token).ConfigureAwait(false);
          Dictionary<string, object> login = await Api(socket, "get_login_info", timeout.Token).ConfigureAwait(false);
          Dictionary<string, object> user = login == null ? null : login["data"] as Dictionary<string, object>;
          if (user == null || Convert.ToString(user["user_id"]) != p.botId) { result.message = "登录账号不匹配，连接已拒绝"; return result; }
          result.connected = true;
          Dictionary<string, object> friends = await Api(socket, "get_friend_list", timeout.Token).ConfigureAwait(false);
          System.Collections.IEnumerable list = friends == null ? null : friends["data"] as System.Collections.IEnumerable;
          if (list != null) foreach (object entry in list) { Dictionary<string, object> friend = entry as Dictionary<string, object>; if (friend != null && Convert.ToString(friend["user_id"]) == p.contactId) result.contactReady = true; }
          result.message = result.contactReady ? "已就绪 · 小号已登录，大号好友已核验" : "小号已登录，请先将大号添加为好友";
        }
      } catch { /* Do not expose a credential-bearing endpoint. */ }
      return result;
    }
    private static string MergeBlock(string original, string begin, string end, string block) {
      int first = original.IndexOf(begin, StringComparison.Ordinal), last = original.IndexOf(end, StringComparison.Ordinal);
      if (first < 0 && last < 0) return original.TrimEnd() + (original.Length > 0 ? "\r\n\r\n" : "") + begin + "\r\n" + block + "\r\n" + end + "\r\n";
      if (first < 0 || last < first || original.IndexOf(begin, first + begin.Length, StringComparison.Ordinal) >= 0 || original.IndexOf(end, last + end.Length, StringComparison.Ordinal) >= 0) throw new InvalidOperationException("项目中的 Stella 配置标记不完整，请先检查现有文件。");
      return original.Substring(0, first) + begin + "\r\n" + block + "\r\n" + end + original.Substring(last + end.Length);
    }
    public static void AttachProject(Profile p, string project) {
      if (!Directory.Exists(project)) throw new InvalidOperationException("项目目录不存在。");
      AttachConfiguration(p, Path.Combine(Path.GetFullPath(project), ".codex"), Path.Combine(project, "AGENTS.md"), "project-instructions.md");
    }
    public static void AttachUser(Profile p, string codexDirectory = null) {
      string directory = codexDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
      AttachConfiguration(p, Path.GetFullPath(directory), Path.Combine(directory, "AGENTS.md"), "user-instructions.md");
    }
    private static void AttachConfiguration(Profile p, string folder, string agents, string instructionFile) {
      Validate(p);
      if (!File.Exists(Path.Combine(RuntimeFor(p), "node.exe"))) throw new InvalidOperationException("请先准备独立运行环境。");
      string config = Path.Combine(folder, "config.toml");
      string oldConfig = File.Exists(config) ? File.ReadAllText(config, Encoding.UTF8) : "", oldAgents = File.Exists(agents) ? File.ReadAllText(agents, Encoding.UTF8) : "";
      const string begin = "# STELLA RELAY CONFIG START", end = "# STELLA RELAY CONFIG END";
      if (!oldConfig.Contains(begin) && Regex.IsMatch(oldConfig, @"(?m)^\s*\[mcp_servers\.(?:stella_relay|""stella_relay"")\]")) throw new InvalidOperationException("项目已有 stella_relay 服务配置，未覆盖。请先检查。");
      string node = Json.Serialize(Path.Combine(RuntimeFor(p), "node.exe").Replace('\\', '/'));
      string server = Json.Serialize(Path.Combine(AppRoot, "app", "bridge", "server.mjs").Replace('\\', '/'));
      string local = Json.Serialize(ConfigFor(p).Replace('\\', '/'));
      string block = "[mcp_servers.stella_relay]\r\ncommand = " + node + "\r\nargs = [" + server + ", \"--config\", " + local + "]\r\nstartup_timeout_sec = 10\r\ntool_timeout_sec = 600";
      string newConfig = MergeBlock(oldConfig, begin, end, block);
      string instructions = File.ReadAllText(Path.Combine(AppRoot, "app", instructionFile), Encoding.UTF8);
      string newAgents = MergeBlock(oldAgents, "<!-- STELLA RELAY PUBLIC START -->", "<!-- STELLA RELAY PUBLIC END -->", instructions.Trim());
      Directory.CreateDirectory(folder); string stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
      if (File.Exists(config)) File.Copy(config, config + ".stella-" + stamp + ".bak");
      if (File.Exists(agents)) File.Copy(agents, agents + ".stella-" + stamp + ".bak");
      try { File.WriteAllText(config, newConfig, Utf8); File.WriteAllText(agents, newAgents, Utf8); }
      catch { if (oldConfig.Length > 0) File.WriteAllText(config, oldConfig, Utf8); if (oldAgents.Length > 0) File.WriteAllText(agents, oldAgents, Utf8); throw; }
    }
  }
}
