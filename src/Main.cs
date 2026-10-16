using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Stella Relay")]
[assembly: System.Reflection.AssemblyDescription("Independent QQ question relay for Codex and DeepSeek Harness")]
[assembly: System.Reflection.AssemblyVersion("0.3.0.0")]

namespace StellaRelay {
  internal sealed class LoginWindow : Form {
    private PictureBox picture = new PictureBox(); private Label note = new Label(); private Timer timer = new Timer(); private Profile profile;
    public LoginWindow(Profile p) {
      profile = p; Text = "小号扫码登录 · " + p.botId; ClientSize = new Size(420, 420); StartPosition = FormStartPosition.CenterParent;
      Font = new Font("Microsoft YaHei UI", 10); BackColor = Color.White; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
      Controls.Add(new Label { Text = "请使用小号 " + p.botId + " 扫码并在手机确认", Bounds = new Rectangle(15, 15, 390, 40), TextAlign = ContentAlignment.MiddleCenter });
      picture.Bounds = new Rectangle(70, 65, 280, 280); picture.SizeMode = PictureBoxSizeMode.Zoom; Controls.Add(picture);
      note.Bounds = new Rectangle(20, 355, 380, 50); note.TextAlign = ContentAlignment.MiddleCenter; Controls.Add(note);
      timer.Interval = 1500; timer.Tick += delegate { RefreshQR(); }; Shown += delegate { timer.Start(); RefreshQR(); };
      FormClosed += delegate { timer.Dispose(); if (picture.Image != null) picture.Image.Dispose(); };
    }
    private void RefreshQR() {
      string path = Path.Combine(Backend.RuntimeFor(profile), "napcat", "cache", "qrcode.png");
      try {
        if (!File.Exists(path) || DateTime.UtcNow - File.GetLastWriteTimeUtc(path) > TimeSpan.FromSeconds(125)) {
          if (picture.Image != null) { picture.Image.Dispose(); picture.Image = null; }
          note.Text = "等待后台生成有效二维码…\n如有登录限制，请在手机 QQ 按提示处理。"; return;
        }
        using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) using (Image image = Image.FromStream(file)) {
          Image old = picture.Image; picture.Image = new Bitmap(image); if (old != null) old.Dispose();
        }
        note.Text = "二维码会自动刷新；请核对登录的是小号。";
      } catch { note.Text = "正在刷新二维码…"; }
    }
  }
  internal sealed class MainWindow : Form {
    private Profile profile; private TextBox bot = new TextBox(), contact = new TextBox(); private Label state = new Label();
    private Button save, prepare, import, start, stop, qr, attach, userAttach, dsh, remove; private Timer timer = new Timer(); private bool busy, checking;
    private static Color Teal = Color.FromArgb(16, 125, 119);
    public MainWindow() {
      Text = "Stella Relay · 手机问答"; ClientSize = new Size(680, 590); AutoScaleMode = AutoScaleMode.Dpi;
      FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
      Font = new Font("Microsoft YaHei UI", 10); BackColor = Color.FromArgb(244, 247, 250);
      try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
      Controls.Add(new Label { Text = "Stella Relay", Font = new Font("Segoe UI", 25, FontStyle.Bold), Bounds = new Rectangle(25, 15, 600, 55) });
      Controls.Add(new Label { Text = "电脑先提问，手机 QQ 也能回答", ForeColor = Color.DimGray, Bounds = new Rectangle(28, 77, 600, 28) });
      TabControl tabs = new TabControl { Bounds = new Rectangle(25, 120, 630, 385) }; Controls.Add(tabs);
      TabPage account = new TabPage("1  账号与登录"), integrations = new TabPage("2  连接客户端"), about = new TabPage("说明");
      foreach (TabPage page in new[] { account, integrations, about }) { page.BackColor = Color.White; tabs.TabPages.Add(page); }
      account.Controls.Add(new Label { Text = "专用 QQ 小号", Bounds = new Rectangle(20, 23, 130, 28) });
      bot.Bounds = new Rectangle(160, 20, 300, 30); bot.MaxLength = 12; account.Controls.Add(bot);
      account.Controls.Add(new Label { Text = "接收消息的大号", Bounds = new Rectangle(20, 68, 140, 28) });
      contact.Bounds = new Rectangle(160, 65, 300, 30); contact.MaxLength = 12; account.Controls.Add(contact);
      account.Controls.Add(new Label { Text = "两号需先互加好友。仅此大号的有效编号回复会被采用。", ForeColor = Color.DimGray, Bounds = new Rectangle(20, 109, 580, 30) });
      save = Button(account, "保存账号", 20, 153, async delegate { await Run(async () => { profile = await Task.Run(() => Backend.Save(bot.Text, contact.Text)); state.Text = "账号已保存，请准备独立环境"; }); });
      prepare = Button(account, "下载独立环境", 212, 153, async delegate { await Install(null); });
      import = Button(account, "导入原始 ZIP", 404, 153, async delegate { using (OpenFileDialog dialog = new OpenFileDialog { Filter = "上游运行包 (*.zip)|*.zip", Title = "选择 NapCat " + RuntimeManager.Version + " Windows Node 原始包" }) if (dialog.ShowDialog(this) == DialogResult.OK) await Install(dialog.FileName); });
      start = Button(account, "启动后台", 20, 210, async delegate { await Run(async () => { RequireProfile(); await Task.Run(() => Backend.TaskState(profile, "start")); state.Text = "后台已启动，需要时请打开登录二维码"; }); });
      stop = Button(account, "停止后台", 212, 210, async delegate { await Run(async () => { RequireProfile(); await Task.Run(() => Backend.TaskState(profile, "stop")); state.Text = "后台已停止"; }); });
      qr = Button(account, "登录二维码", 404, 210, delegate { try { RequireProfile(); using (LoginWindow window = new LoginWindow(profile)) window.ShowDialog(this); } catch (Exception e) { ShowError(e); } });
      account.Controls.Add(new Label { Text = "独立环境约 124 MB，仅从上游下载并核对 SHA-256。\n不读取已安装 QQ 的登录状态；退出本窗口后后台继续运行。", ForeColor = Color.DimGray, Bounds = new Rectangle(20, 274, 580, 56) });
      integrations.Controls.Add(new Label { Text = "Codex", Font = new Font(Font, FontStyle.Bold), Bounds = new Rectangle(20, 18, 550, 28) });
      integrations.Controls.Add(new Label { Text = "选择项目后写入项目配置并保留备份。按 Codex 提示信任该项目，\n重新加载 stella_relay，然后让助手测试电脑表单与 QQ。", Bounds = new Rectangle(20, 55, 580, 65) });
      attach = Button(integrations, "连接 Codex 项目", 20, 124, delegate { Attach(); });
      userAttach = Button(integrations, "Codex 全局启用", 212, 124, delegate {
        try { RequireProfile(); if (MessageBox.Show(this, "将备份后更新当前用户的 ~/.codex/config.toml 和 ~/.codex/AGENTS.md，让其他 Codex 项目也可使用普通问答转发工具。\n\n不修改项目信任或权限审批。已打开的聊天需要重新加载。是否继续？", "Codex 用户级启用", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
          Backend.AttachUser(profile); MessageBox.Show(this, "用户级配置已保存。请重新加载 Codex 的 stella_relay 和聊天指令，再从电脑提交首次测试表单。", "配置完成");
        } catch (Exception e) { ShowError(e); }
      });
      integrations.Controls.Add(new Label { Text = "DeepSeek Harness", Font = new Font(Font, FontStyle.Bold), Bounds = new Rectangle(20, 190, 550, 28) });
      integrations.Controls.Add(new Label { Text = "使用 DSH 原生提问插件。生成当前小号的插件配置后，\n按说明在 DSH 的插件管理页面安装本地组合包。", Bounds = new Rectangle(20, 226, 580, 55) });
      dsh = Button(integrations, "生成 DSH 配置", 20, 292, delegate { try { RequireProfile(); DshConfig.Export(profile); Open(Path.Combine(Backend.DirectoryFor(profile), "dsh-setup.txt")); } catch (Exception e) { ShowError(e); } });
      TextBox help = new TextBox { Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = Color.White, ScrollBars = ScrollBars.Vertical, Bounds = new Rectangle(20, 20, 580, 255), Text =
        "首次使用：保存账号 → 下载或导入运行包 → 启动后台 → 小号扫码 → 连接客户端。\r\n\r\n手机按“问题编号 你的回答”回复；文字和选项数字均可。先收到的有效答复生效，另一端待答失效。\r\n\r\n系统权限、沙箱审批仍在电脑处理。QQ 限制登录时须由使用者在手机恢复。\r\n\r\n本程序免费供非商业使用。QQ 运行组件由使用者从上游获取并遵守其许可。不要分享本机数据目录或运行日志。\r\n\r\n升级：停止后台，在原程序目录替换发行文件后重新启动。更换程序目录前先移除旧后台任务。" }; about.Controls.Add(help);
      remove = Button(about, "移除后台任务", 20, 290, async delegate { await Run(async () => { RequireProfile(); await Task.Run(() => Backend.TaskState(profile, "remove")); state.Text = "当前小号的后台任务已移除，登录数据已保留"; }); });
      state.Bounds = new Rectangle(28, 521, 620, 42); state.ForeColor = Teal; state.Text = "请填写你自己的小号和接收消息的大号"; Controls.Add(state);
      LinkLabel data = new LinkLabel { Text = "打开本机数据目录", AutoSize = true, Location = new Point(30, 566), LinkColor = Teal }; data.LinkClicked += delegate { Directory.CreateDirectory(Backend.DataRoot); Open(Backend.DataRoot); }; Controls.Add(data);
      profile = Backend.LastProfile(); if (profile != null) { bot.Text = profile.botId; contact.Text = profile.contactId; }
      timer.Interval = 3000; timer.Tick += async delegate { await RefreshStatus(); }; Shown += async delegate { timer.Start(); await RefreshStatus(); }; FormClosed += delegate { timer.Dispose(); };
    }
    private Button Button(Control parent, string text, int x, int y, EventHandler click) {
      Button button = new Button { Text = text, Bounds = new Rectangle(x, y, 174, 40), FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Teal }; button.Click += click; parent.Controls.Add(button); return button;
    }
    private void RequireProfile() { if (profile == null) throw new InvalidOperationException("请先保存账号配置。"); if (profile.botId != bot.Text.Trim() || profile.contactId != contact.Text.Trim()) throw new InvalidOperationException("请先保存修改后的账号配置。"); }
    private async Task Run(Func<Task> action) {
      if (busy) return; busy = true; SetEnabled(false);
      try { await action(); } catch (Exception e) { ShowError(e); } finally { busy = false; if (!IsDisposed) SetEnabled(true); }
    }
    private void SetEnabled(bool value) { foreach (Button button in new[] { save, prepare, import, start, stop, qr, attach, userAttach, dsh, remove }) if (button != null) button.Enabled = value; bot.Enabled = value; contact.Enabled = value; }
    private async Task Install(string file) {
      await Run(async () => { RequireProfile(); if (file == null && MessageBox.Show(this, "将从 NapCat 官方 GitHub 下载独立运行组件（约 124 MB）。仅供免费非商业使用，需遵守上游许可。是否继续？", "准备运行环境", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
        await RuntimeManager.Install(profile, file, new Progress<string>(text => { if (!IsDisposed) state.Text = text; })); });
    }
    private async Task RefreshStatus() { if (busy || checking || profile == null) return; checking = true; try { Status status = await Backend.Check(profile); if (!IsDisposed) state.Text = status.message; } catch { if (!IsDisposed) state.Text = "状态暂不可用，请检查后台任务或运行记录"; } finally { checking = false; } }
    private void Attach() {
      try { RequireProfile(); using (FolderBrowserDialog folder = new FolderBrowserDialog { Description = "选择要启用 Stella Relay 的 Codex 项目" }) {
        if (folder.ShowDialog(this) != DialogResult.OK) return;
        if (MessageBox.Show(this, "将连接以下项目，并备份后更新该目录的 Codex 配置和 AGENTS.md：\n\n" + folder.SelectedPath + "\n\n是否继续？", "连接项目", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
        Backend.AttachProject(profile, folder.SelectedPath); MessageBox.Show(this, "已连接。请回到 Codex，按应用提示信任此项目，再重新加载 stella_relay。让助手先测试电脑表单，再测试手机回复。", "连接完成");
      } } catch (Exception e) { ShowError(e); }
    }
    private void ShowError(Exception e) { state.Text = "操作未完成"; MessageBox.Show(this, e is InvalidOperationException ? e.Message : "操作失败，请检查网络、目录写入权限或本机运行环境。", "Stella Relay", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    private void Open(string path) { try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); } catch { MessageBox.Show(this, "无法打开，请手动查看：\n" + path); } }
  }
  internal static class Program {
    [STAThread] private static int Main(string[] args) {
      try {
        if (args.Length >= 2 && args[0] == "--worker") return Backend.Worker(args[1]);
        if (args.Length >= 2 && args[0] == "--self-test") return SelfTest.Run(args[1]);
        if (args.Length >= 2 && args[0] == "--verify-package") { RuntimeManager.Verify(args[1]); return 0; }
        if (args.Length >= 2 && args[0] == "--data-root") Backend.DataRoot = Path.GetFullPath(args[1]);
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new MainWindow()); return 0;
      } catch (Exception e) { if (args.Length > 0) return 2; MessageBox.Show(e is InvalidOperationException ? e.Message : "程序无法启动，请检查文件是否完整。", "Stella Relay"); return 2; }
    }
  }
}
