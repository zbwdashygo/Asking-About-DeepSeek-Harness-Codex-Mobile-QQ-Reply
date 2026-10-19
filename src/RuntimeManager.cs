using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace StellaRelay {
  internal static class RuntimeManager {
    public const string Version = "4.18.38";
    public const string Digest = "b88007a373a30deefb387e7cf17911752ff900bce22c534b3da6b644f5c6d0ae";
    public const string DownloadUrl = "https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.38/NapCat.Shell.Windows.Node.zip";
    public static string Hash(string file) { using (SHA256 sha = SHA256.Create()) using (FileStream input = File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
    public static void Verify(string file) { if (!String.Equals(Hash(file), Digest, StringComparison.Ordinal)) throw new InvalidOperationException("运行包校验失败。请使用指定版本的上游原始 ZIP；没有运行其中的任何程序。"); }
    public static void Extract(string archive, string destination) {
      string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
      using (ZipArchive zip = ZipFile.OpenRead(archive)) {
        long total = 0; if (zip.Entries.Count > 20000) throw new InvalidOperationException("ZIP 条目过多。");
        foreach (ZipArchiveEntry entry in zip.Entries) {
          string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
          string target = Path.GetFullPath(Path.Combine(root, relative));
          if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase) || relative.Contains(":")) throw new InvalidOperationException("ZIP 中存在越界路径，已停止。");
          total += entry.Length; if (total > 1500000000L) throw new InvalidOperationException("运行包过大。");
          if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(target); continue; }
          Directory.CreateDirectory(Path.GetDirectoryName(target)); entry.ExtractToFile(target, false);
        }
      }
    }
    private static string ReplaceExactly(string text, string from, string to) {
      int start = text.IndexOf(from, StringComparison.Ordinal);
      if (start < 0 || text.IndexOf(from, start + from.Length, StringComparison.Ordinal) >= 0) throw new InvalidOperationException("上游隔离接口与已验证版本不符，已停止。");
      return text.Substring(0, start) + to + text.Substring(start + from.Length);
    }
    public static void Isolate(string runtime) {
      string file = Path.Combine(runtime, "napcat", "napcat.mjs"); string text = File.ReadAllText(file, Encoding.UTF8);
      text = ReplaceExactly(text, "this.context.wrapper.NodeQQNTWrapperUtil.getNTUserDataInfoConfig()", "stellaIsolatedDataRoot()");
      text = ReplaceExactly(text, "t.NodeQQNTWrapperUtil.getNTUserDataInfoConfig()", "stellaIsolatedDataRoot()");
      string guard = "// STELLA_ISOLATED_QQ_DATA: local-only installation adaptation; upstream v" + Version + "\n" +
        "function stellaIsolatedDataRoot() { const p = process.env.STELLA_QQ_DATA_ROOT; if (!p || !((p[1] === ':' && (p[2] === String.fromCharCode(92) || p[2] === '/')) || p.startsWith('/'))) throw new Error('Missing isolated QQ data root'); return p; }\n";
      File.WriteAllText(file, guard + text, Backend.Utf8);
      if (!File.Exists(Path.Combine(runtime, "node.exe")) || !File.Exists(Path.Combine(runtime, "index.js")) || !File.Exists(Path.Combine(runtime, "wrapper.node"))) throw new InvalidOperationException("运行包不完整。");
      File.WriteAllText(Path.Combine(runtime, "stella-isolated.txt"), Version + "\n" + Digest, Backend.Utf8);
    }
    public static async Task Install(Profile profile, string importedFile, IProgress<string> progress) {
      Backend.Validate(profile); if (Backend.TaskState(profile, "status")) throw new InvalidOperationException("请先停止当前小号后台再准备运行环境。");
      string home = Backend.DirectoryFor(profile); Directory.CreateDirectory(home);
      string archive = importedFile;
      if (String.IsNullOrEmpty(archive)) {
        archive = Path.Combine(home, "upstream-" + Version + ".zip");
        if (!File.Exists(archive) || Hash(archive) != Digest) {
          progress.Report("正在下载独立 QQ 运行环境（约 124 MB）…");
          string partial = archive + ".download"; ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
          using (WebClient client = new WebClient()) {
            client.Headers.Add("User-Agent", "StellaRelay/0.4.0-beta.1");
            client.DownloadProgressChanged += delegate(object sender, DownloadProgressChangedEventArgs e) { progress.Report("下载运行环境 " + e.ProgressPercentage + "%"); };
            await client.DownloadFileTaskAsync(new Uri(DownloadUrl), partial);
          }
          await Task.Run(() => Verify(partial));
          if (File.Exists(archive)) File.Delete(archive); File.Move(partial, archive);
        }
      }
      progress.Report("正在校验并创建全新独立环境…");
      string stage = Path.Combine(home, "runtime-stage-" + Guid.NewGuid().ToString("N"));
      try {
        await Task.Run(() => { Verify(archive); Extract(archive, stage); Isolate(stage); });
        string runtime = Backend.RuntimeFor(profile);
        if (Directory.Exists(runtime)) Directory.Move(runtime, runtime + ".previous-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff"));
        Directory.Move(stage, runtime); Backend.WriteRuntimeConfig(profile);
        progress.Report("独立运行环境已准备，点击启动并扫码登录");
      } finally {
        string resolved = Path.GetFullPath(stage), expected = Path.GetFullPath(home).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (Directory.Exists(resolved) && resolved.StartsWith(expected, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(resolved).StartsWith("runtime-stage-", StringComparison.Ordinal)) Directory.Delete(resolved, true);
      }
    }
  }
}
