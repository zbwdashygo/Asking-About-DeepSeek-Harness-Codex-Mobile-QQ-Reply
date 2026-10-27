import { nextMemoryNumber } from './question-numbers.mjs';

export class Questions {
  constructor({ botId, contactId, now = Date.now }) {
    this.botId = String(botId); this.contactId = String(contactId); this.now = now;
    this.items = new Map(); this.keys = new Map(); this.seen = new Set();
    this.sourceOffsetMs = 0;
  }
  create({ text, kind = 'question', context = '', key = '', timeoutSeconds = 480, id = nextMemoryNumber() }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw Error('问题应为 1–12000 个字符');
    if (!['question', 'approval'].includes(kind)) throw Error('无效问题类型');
    if (typeof context !== 'string' || context.length > 1000 || typeof key !== 'string' || key.length > 1000) throw Error('无效上下文或请求标识');
    if (key && this.keys.has(key)) {
      const old = this.items.get(this.keys.get(key));
      if (old.text !== text || old.kind !== kind || old.context !== context) throw Error('请求标识冲突');
      return { item: old, fresh: false };
    }
    const seconds = Number(timeoutSeconds);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 1800) throw Error('等待时间应为 1–1800 秒');
    if (!/^[1-9][0-9]{0,8}$/.test(id) || this.items.has(id)) throw Error('问题编号重复或无效');
    const item = { id, text, kind, context, key, createdAt: this.now(), expiresAt: this.now() + seconds * 1000, state: 'sending' };
    this.items.set(id, item); if (key) this.keys.set(key, id);
    return { item, fresh: true };
  }
  message(item) {
    const suffix = item.kind === 'approval' ? `回复：${item.id} 同意 / 拒绝` : `回复：${item.id} 你的回答`;
    return `【stella · 问你一下】\n${item.context ? item.context + '\n' : ''}${item.text}\n\n${suffix}\n${new Date(item.expiresAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' })} 前有效（北京时间）`;
  }
  get(id) {
    const item = this.items.get(id);
    if (item && ['sending', 'pending'].includes(item.state) && this.now() >= item.expiresAt) item.state = 'expired';
    return item;
  }
  receive(event) {
    if (event.post_type !== 'message' || event.message_type !== 'private' || event.sub_type !== 'friend' || String(event.self_id) !== this.botId || String(event.user_id) !== this.contactId) return false;
    if (!event.message_id || !Number.isFinite(event.time)) return false;
    const segments = Array.isArray(event.message) ? event.message : null;
    if (!segments || segments.some(s => !['text', 'reply'].includes(s.type))) return false;
    const text = segments.filter(s => s.type === 'text').map(s => s.data?.text ?? '').join('').trim();
    const match = /^([1-9][0-9]{0,8}|[A-F0-9]{10})\s+([\s\S]+)$/i.exec(text);
    if (!match) return false;
    const item = this.get(match[1].toUpperCase());
    if (!item || item.state !== 'pending') return false;
    // QQ timestamps have second precision. Reject stale and future events.
    if (event.time < Math.floor((item.sentAt + this.sourceOffsetMs) / 1000) - 2 || event.time > Math.floor((this.now() + this.sourceOffsetMs) / 1000) + 30) return false;
    const messageKey = `${event.self_id}:${event.message_id}`;
    if (this.seen.has(messageKey)) return false;
    const answer = match[2].trim();
    if (!answer || answer.length > 12000) return false;
    if (item.kind === 'approval' && !['同意', '拒绝'].includes(answer)) return false;
    this.seen.add(messageKey);
    item.state = 'answered'; item.answer = answer; item.answeredAt = this.now();
    return true;
  }
  disconnect() {
    for (const item of this.items.values()) if (['sending', 'pending'].includes(item.state)) item.state = 'disconnected';
  }
  prune() {
    for (const [id, item] of this.items) {
      this.get(id);
      if (this.now() - item.expiresAt > 3600000) {
        this.items.delete(id); if (item.key) this.keys.delete(item.key);
      }
    }
    if (this.seen.size > 10000) this.seen.clear();
  }
}
