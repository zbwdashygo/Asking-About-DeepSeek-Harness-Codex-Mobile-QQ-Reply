import { IsolatedQQ } from './onebot.mjs';
import { FileStore } from './files.mjs';
import { WakeState } from './wake.mjs';

// One receiver per isolated profile; upload events are not tied to a chat until
// the verified phone user chooses a platform and a fixed conversation code.
export class MobileFiles {
  constructor({ mobile, store, lease }) { this.mobile = mobile; this.store = store; this.lease = lease; this.chain = Promise.resolve(); }
  async start() {
    this.lease.acquire(); this.running = true;
    this.remove = this.mobile.onMessage(event => { this.chain = this.chain.then(() => this.receive(event)).catch(() => {}); });
    this.retry = setInterval(() => { if (this.running && !this.mobile.ready) void this.mobile.connect().catch(() => {}); }, 5000); this.retry.unref?.();
    try { await this.mobile.connect(); } catch (error) { this.stop(); throw error; }
  }
  async receive(event) {
    if (!this.running) return false;
    if (await this.store.receive(this.mobile, event)) return true;
    const c = this.mobile.config;
    if (event.post_type !== 'message' || event.message_type !== 'private' || event.sub_type !== 'friend' || String(event.self_id) !== c.botId || String(event.user_id) !== c.contactId || event.message_id == null || String(event.message_id).length > 120 || !Number.isFinite(event.time) || Math.abs(event.time * 1000 - (Date.now() + (this.mobile.questions?.sourceOffsetMs ?? 0))) > 120000 || !Array.isArray(event.message) || event.message.some(s => s.type !== 'text')) return false;
    const text = event.message.map(s => s.data?.text ?? '').join('').trim();
    if (text !== '收件箱' || !this.lease.reserve(String(event.message_id))) return false;
    try {
      const rows = this.store.list();
      await this.mobile.sendText(rows.length ? '最近收到的文件：\n' + rows.map(r => `${r.id} · ${r.name} · ${Math.ceil(r.size / 1024)} KB`).join('\n') + '\n\n交给对话：文件 codex AA 文件编号 你的要求\nDSH 就把 codex 换成 dsh。' : '收件箱还是空的，把图片或文档发给我就好。');
      this.lease.settle(String(event.message_id), 'accepted');
    } catch { this.lease.settle(String(event.message_id), 'failed-or-unknown'); }
    return true;
  }
  stop() { this.running = false; clearInterval(this.retry); this.remove?.(); this.lease.release(); }
}
