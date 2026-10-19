import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export function wakeCode(platform, id) { return createHash('sha256').update(platform + ':' + id).digest('hex').slice(0, 10).toUpperCase(); }
export function parseWake(text) {
  if (typeof text !== 'string' || text.length > 11000) return null;
  text = text.trim();
  let m = /^(?:对话列表|列表)(?:\s+(codex|dsh))?(?:\s+([1-9][0-9]?))?$/i.exec(text);
  if (m) return { kind: 'list', platform: m[1]?.toLowerCase(), page: Number(m[2] ?? 1) };
  m = /^(?:唤醒|发送)\s+(codex|dsh)\s+([a-f0-9]{10})\s+([\s\S]+)$/i.exec(text);
  if (m && m[3].trim().length <= 10000) return { kind: 'send', platform: m[1].toLowerCase(), code: m[2].toUpperCase(), prompt: m[3].trim() };
  m = /^(?:唤醒帮助|唤醒状态)(?:\s+(codex|dsh))?$/i.exec(text);
  if (m) return { kind: 'help', platform: m[1]?.toLowerCase() };
  return null;
}
export class WakeState {
  constructor(file) {
    this.file = file; this.data = { enabled: false, seen: [] };
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof data.enabled !== 'boolean' || !Array.isArray(data.seen)) throw Error('手机唤醒状态文件无效，请恢复备份');
      this.data = data;
    }
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
  constructor({ platform, mobile, backend, state }) {
    this.platform = platform; this.mobile = mobile; this.backend = backend; this.state = state; this.chain = Promise.resolve(); this.running = false;
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
  async reply(text) { try { await this.mobile.sendText(`【stella · ${this.platform} 手机唤醒】\n${text}`); } catch {} }
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
        await this.reply(`服务在线。查看对话：列表 ${this.platform}\n翻页：列表 ${this.platform} 2\n发送任务：唤醒 ${this.platform} 对话编号 任务内容\n工作中的对话暂不打断；权限确认仍在电脑处理。`);
      } else {
        const rows = [...new Map((await this.backend.list()).map(row => [row.id, row])).values()].slice(0, 50);
        if (!this.running) throw Error('手机唤醒已关闭');
        if (command.kind === 'list') {
          const count = Math.max(1, Math.ceil(rows.length / 10));
          if (command.page > count) throw Error(`没有第 ${command.page} 页，当前共 ${count} 页`);
          const page = rows.slice((command.page - 1) * 10, command.page * 10);
          await this.reply(`对话列表 ${command.page}/${count}（最多显示最近 50 个）\n` + (page.length ? page.map(row => `${wakeCode(this.platform, row.id)} · ${row.status ?? '未知'}\n${String(row.title).replace(/[\r\n\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 100)}`).join('\n\n') : '暂无可用对话') + `\n\n唤醒 ${this.platform} 编号 任务内容`);
        } else {
          const matches = rows.filter(row => wakeCode(this.platform, row.id) === command.code);
          if (matches.length !== 1) throw Error('对话编号不存在或冲突，请重新获取列表');
          const row = matches[0];
          if (['active', 'running', 'inProgress', 'waiting'].includes(row.status)) throw Error('此对话仍在工作或等待回答，本次未打断；请结束后重新发一条指令');
          await this.backend.send(row, command.prompt);
          await this.reply(`已向 ${command.code} 发送新任务。电脑原对话会继续工作；这条回执不代表任务已完成。`);
        }
      }
      this.state.settle(messageId, 'accepted');
    } catch (error) {
      this.state.settle(messageId, 'failed-or-unknown');
      await this.reply(`本次未确认发送成功：${String(error.message).replace(/[a-f0-9]{64}/ig, '[hidden]').slice(0, 240)}。不会自动重发。`);
    }
    return true;
  }
}
