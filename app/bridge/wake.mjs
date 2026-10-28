import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export function recentRows(rows) {
  const time = row => { const value = row.updatedAt ?? row.createdAt ?? 0; return Number.isFinite(Number(value)) ? Number(value) : Date.parse(value) || 0; };
  return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => time(b) - time(a)).slice(0, 10);
}
export function parseWake(text) {
  if (typeof text !== 'string' || text.length > 11000) return null;
  text = text.trim();
  let m = /^(?:对话列表|列表)(?:\s+(codex|dsh))?(?:\s+([1-9][0-9]?))?$/i.exec(text);
  if (m) return { kind: 'list', platform: m[1]?.toLowerCase(), page: Number(m[2] ?? 1) };
  m = /^文件\s+(codex|dsh)\s+([a-z]{2})\s+([1-9]\d{0,8})(?:\s+([\s\S]+))?$/i.exec(text);
  if (m && (m[4]?.trim().length ?? 0) <= 10000) return { kind: 'file', platform: m[1].toLowerCase(), code: m[2].toUpperCase(), fileId: m[3], note: m[4]?.trim() ?? '' };
  m = /^(?:唤醒|发送)\s+(codex|dsh)\s+([a-z]{2}|[a-f0-9]{10})\s+([\s\S]+)$/i.exec(text);
  if (m && m[3].trim().length <= 10000) return { kind: 'send', platform: m[1].toLowerCase(), code: m[2].toUpperCase(), prompt: m[3].trim() };
  m = /^(?:唤醒帮助|唤醒状态)(?:\s+(codex|dsh))?$/i.exec(text);
  if (m) return { kind: 'help', platform: m[1]?.toLowerCase() };
  return null;
}
export class WakeState {
  constructor(file) {
    this.file = file; this.data = { enabled: false, seen: [], codes: {} };
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof data.enabled !== 'boolean' || !Array.isArray(data.seen)) throw Error('手机唤醒状态文件无效，请恢复备份');
      this.data = { ...data, codes: data.codes ?? {} };
      if (!this.data.codes || typeof this.data.codes !== 'object' || Array.isArray(this.data.codes) || Object.entries(this.data.codes).some(([code, id]) => !/^[A-Z]{2}$/.test(code) || typeof id !== 'string' || !id) || new Set(Object.values(this.data.codes)).size !== Object.keys(this.data.codes).length) throw Error('对话代号记录不完整，请先在电脑检查');
    }
  }
  assignCodes(rows) {
    const existing = new Map(Object.entries(this.data.codes).map(([code, id]) => [id, code])); let changed = false;
    const assigned = rows.map(row => {
      let code = existing.get(row.id);
      if (!code) {
        for (let i = 0; i < 676; i++) {
          const candidate = String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26);
          if (!Object.hasOwn(this.data.codes, candidate)) { code = candidate; break; }
        }
        if (!code) throw Error('两字母代号已用满，请先在电脑处理');
        this.data.codes[code] = row.id; existing.set(row.id, code); changed = true;
      }
      return { ...row, code };
    });
    // Never recycle aliases: an old QQ command must not target another chat.
    if (changed) this.save(); return assigned;
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600 }); renameSync(temporary, this.file);
  }
  reserve(id) {
    if (this.data.seen.some(v => v.id === id)) return false;
    this.data.seen.push({ id, at: Date.now(), state: 'reserved' }); this.data.seen = this.data.seen.slice(-1000); this.save(); return true;
  }
  settle(id, state) { const entry = this.data.seen.find(v => v.id === id); if (entry) { entry.state = state; this.save(); } }
  acquire() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    this.nonce = randomUUID(); this.lock = this.file + '.lock';
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const fd = openSync(this.lock, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: this.nonce })); closeSync(fd); return; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let old; try { old = JSON.parse(readFileSync(this.lock, 'utf8')); } catch { throw Error('手机唤醒锁文件无效'); }
        try { process.kill(old.pid, 0); throw Error('另一个同平台唤醒服务正在运行'); }
        catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
        unlinkSync(this.lock);
      }
    }
    throw Error('无法取得手机唤醒独占锁');
  }
  release() { if (!this.lock) return; try { if (JSON.parse(readFileSync(this.lock, 'utf8')).nonce === this.nonce) unlinkSync(this.lock); } catch {} }
}

export class MobileWake {
  constructor({ platform, mobile, backend, state, files }) {
    this.files = files; this.platform = platform; this.mobile = mobile; this.backend = backend; this.state = state; this.chain = Promise.resolve(); this.running = false;
  }
  async start() {
    if (this.running) return;
    this.state.acquire(); this.running = true;
    this.removeListener = this.mobile.onMessage(message => { this.chain = this.chain.then(() => this.receive(message)).catch(() => {}); });
    this.retry = setInterval(() => { if (this.running && !this.mobile.ready) void this.mobile.connect().catch(() => {}); }, 5000);
    this.retry.unref?.();
    try { await this.mobile.connect(); } catch (error) { this.stop(); throw error; }
  }
  stop() { this.running = false; clearInterval(this.retry); this.removeListener?.(); this.backend.close?.(); this.state.release(); }
  async reply(text) { try { await this.mobile.sendText(`【stella · ${this.platform}】\n${text}`); } catch {} }
  async receive(message) {
    if (!this.running || !this.state.data.enabled) return false;
    const c = this.mobile.config;
    if (message.post_type !== 'message' || message.message_type !== 'private' || message.sub_type !== 'friend' || String(message.self_id) !== c.botId || String(message.user_id) !== c.contactId || message.message_id == null) return false;
    if (!Number.isFinite(message.time) || Math.abs(message.time * 1000 - (Date.now() + (this.mobile.questions?.sourceOffsetMs ?? 0))) > 120000) return false;
    if (!Array.isArray(message.message) || message.message.some(segment => segment.type !== 'text')) return false;
    const command = parseWake(message.message.map(segment => segment.data?.text ?? '').join(''));
    if (!command || (command.platform && command.platform !== this.platform)) return false;
    const messageId = String(message.message_id); if (messageId.length > 120 || !this.state.reserve(messageId)) return false;
    try {
      if (command.kind === 'help') {
        await this.reply(`我在呢。\n看最近 10 个对话：列表 ${this.platform}\n发任务：唤醒 ${this.platform} AA 任务内容\n传附件：先发文件，再发“文件 ${this.platform} AA 文件编号 你的要求”\n权限确认还是在电脑上处理。`);
      } else {
        const available = [...new Map((await this.backend.list()).map(row => [row.id, row])).values()];
        const rows = command.kind === 'list' ? recentRows(available) : available;
        if (!this.running) throw Error('手机唤醒已关闭');
        if (command.kind === 'list') {
          if (command.page > 1) throw Error('现在只显示最近 10 个，不用翻页啦');
          const page = this.state.assignCodes(rows);
          const label = row => ['active', 'running', 'inProgress', 'waiting'].includes(row.status) ? '忙碌' : '空闲';
          await this.reply((page.length ? `最近活跃的 ${page.length} 个对话：\n` + page.map(row => `${row.code} · ${label(row)} · ${String(row.title).replace(/[\r\n\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 48)}`).join('\n') : '还没有可用对话，先在电脑打开一个吧。') + (page.length ? `\n\n发任务：唤醒 ${this.platform} ${page[0].code} 任务内容` : ''));
        } else {
          const matches = rows.filter(row => row.id === this.state.data.codes[command.code]);
          if (matches.length !== 1) throw Error(`代号没对上，发“列表 ${this.platform}”再看一下吧`);
          const row = matches[0];
          if (['active', 'running', 'inProgress', 'waiting'].includes(row.status)) throw Error('它还在忙，等这轮结束后再发吧');
          if (command.kind === 'file') {
            if (!this.files || !this.backend.sendFile) throw Error('文件功能还没加载，请重启 Stella 和对应客户端');
            await this.backend.sendFile(row, command.fileId, command.note, this.files);
          } else await this.backend.send(row, command.prompt);
          await this.reply(`好，已交给 ${command.code}，等它处理。`);
        }
      }
      this.state.settle(messageId, 'accepted');
    } catch (error) {
      this.state.settle(messageId, 'failed-or-unknown');
      await this.reply(`这次还没确认成功：${String(error.message).replace(/[a-f0-9]{64}/ig, '[hidden]').slice(0, 160)}。我不会自动重发。`);
    }
    return true;
  }
}
