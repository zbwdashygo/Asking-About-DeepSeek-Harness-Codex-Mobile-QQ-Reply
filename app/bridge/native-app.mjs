import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function findDesktopTools() {
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'plugins', 'cache', 'openai-bundled', 'codex-app-tools');
  if (!existsSync(root)) throw Error('未找到 Codex 自带桌面任务管理插件');
  const candidates = readdirSync(root).map(v => join(root, v, 'server.mjs')).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!candidates.length) throw Error('Codex 桌面工具入口不可用');
  return candidates[0];
}

export class DesktopToolsClient {
  constructor({ callerThreadId, serverPath, node = process.execPath, env = process.env } = {}) {
    if (!callerThreadId) throw Error('缺少已授权的 Codex 调用方对话');
    if (!env.CODEX_APP_TOOLS_PIPE_PATH) throw Error('Codex 未提供桌面工具连接；请在 Codex 中启用手机唤醒');
    this.callerThreadId = callerThreadId; this.serverPath = serverPath ?? findDesktopTools(); this.node = node; this.env = env;
    this.nextId = 1; this.pending = new Map();
  }
  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const child = this.child = spawn(this.node, [this.serverPath], { env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stderr.resume();
      child.on('error', () => this.fail(Error('Codex 桌面工具启动失败')));
      child.on('exit', () => { this.connecting = null; this.fail(Error('Codex 桌面工具连接已关闭')); });
      createInterface({ input: child.stdout }).on('line', line => {
        try { const m = JSON.parse(line), p = this.pending.get(m.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } catch {}
      });
      await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stella-mobile-wake', version: '0.4.0-beta.1' } });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const catalog = await this.request('tools/list', {});
      this.tools = new Set(catalog.tools.map(t => t.name));
      for (const tool of ['list_threads', 'send_message_to_thread']) if (!this.tools.has(tool)) throw Error('Codex 桌面工具版本不支持手机唤醒');
    })();
    const attempt = this.connecting;
    try { return await attempt; }
    catch (error) { if (this.connecting === attempt) this.connecting = null; this.child?.kill(); throw error; }
  }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Codex 桌面接口超时，状态未知；不自动重发')); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(Error('Codex 桌面接口写入失败')); } });
    });
  }
  async call(name, args) {
    await this.connect();
    if (!['list_threads', 'send_message_to_thread'].includes(name)) throw Error('手机唤醒只允许列出对话和发送任务');
    const response = await this.request('tools/call', { name, arguments: args, _meta: { 'openai/threadId': this.callerThreadId } });
    const text = response.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
    if (response.isError) throw Error(text || 'Codex 桌面操作失败');
    try { return JSON.parse(text); } catch { return { text }; }
  }
  async list() {
    const data = await this.call('list_threads', { limit: 50 });
    return [...(data.pinnedThreads ?? []), ...(data.threads ?? [])].filter(t => t.kind === 'codex' && (!t.hostId || t.hostId === 'local')).map(t => ({ id: t.id, title: t.title || t.id, status: t.status, hostId: t.hostId }));
  }
  async send(thread, prompt) {
    const current = (await this.list()).find(t => t.id === thread.id);
    if (!current || current.status === 'active') throw Error('对话已不再空闲或不再可见，未发送');
    return this.call('send_message_to_thread', { threadId: thread.id, ...(thread.hostId ? { hostId: thread.hostId } : {}), prompt });
  }
  close() { this.child?.kill(); this.fail(Error('手机唤醒已停止')); }
}
