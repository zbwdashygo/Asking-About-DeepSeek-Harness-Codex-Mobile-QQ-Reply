import { randomUUID } from 'node:crypto';
import { loadConfig, validateConfig } from './config.mjs';
import { Questions } from './questions.mjs';
import { normalizeMobileAnswer } from './coordinator.mjs';
import { validateCompletion } from './completion.mjs';
export class IsolatedQQ {
  constructor({ config, Socket = WebSocket } = {}) {
    this.config = config ? validateConfig(config) : loadConfig();
    this.Socket = Socket;
    const c = this.config;
    this.questions = new Questions(c); this.calls = new Map(); this.waiters = new Map(); this.completions = new Map(); this.ready = false;
  }
  async connect() {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const c = this.config, url = new URL(`ws://127.0.0.1:${c.onebotPort}`); url.searchParams.set('access_token', c.token);
      const socket = this.socket = new this.Socket(url);
      const deadline = setTimeout(() => { reject(Error('独立 QQ 接口连接超时')); socket.close(); }, 10000);
      socket.addEventListener('open', async () => {
        try {
          const login = await this.call('get_login_info');
          if (String(login.user_id) !== c.botId) throw Error('QQ 登录账号不匹配');
          const friends = await this.call('get_friend_list');
          if (!friends.some(f => String(f.user_id) === c.contactId)) throw Error('唯一接收人不在好友列表');
          if (socket.readyState !== WebSocket.OPEN) throw Error('QQ 连接断开');
          this.ready = true; clearTimeout(deadline); resolve();
        } catch (e) { clearTimeout(deadline); reject(e); socket.close(); }
      });
      socket.addEventListener('message', ({ data }) => {
        try {
          const m = JSON.parse(data);
          const call = this.calls.get(m.echo);
          if (call) { clearTimeout(call.timer); this.calls.delete(m.echo); m.retcode === 0 && m.status === 'ok' ? call.resolve(m.data) : call.reject(Error('QQ 接口返回错误')); return; }
          if (m.post_type === 'meta_event' && String(m.self_id) === c.botId && Number.isFinite(m.time)) this.questions.sourceOffsetMs = m.time * 1000 - Date.now();
          if (!this.ready) return;
          // The numbered question still must match; choices are suggestions on QQ.
          const text = Array.isArray(m.message) ? m.message.filter(s => s.type === 'text').map(s => s.data?.text ?? '').join('').trim() : '';
          const parsed = /^([A-F0-9]{10})\s+([\s\S]+)$/i.exec(text);
          const waiter = parsed && this.waiters.get(parsed[1].toUpperCase());
          if (!waiter) return;
          if (normalizeMobileAnswer(parsed[2], waiter.choices) === null) {
            if (m.post_type === 'message' && m.message_type === 'private' && m.sub_type === 'friend' && String(m.self_id) === c.botId && String(m.user_id) === c.contactId && !waiter.warned) {
              waiter.warned = true;
              this.notify(`【stella ${parsed[1].toUpperCase()}】回答未采用：请选择 1–${waiter.choices?.length ?? 6}，或用文字回答。请保留本题编号。`);
            }
            return;
          }
          if (this.questions.receive(m)) {
            const item = this.questions.get(parsed[1].toUpperCase());
            clearTimeout(waiter.timer); this.waiters.delete(item.id); waiter.resolve(item.answer);
            // Do not delay delivery to Codex while waiting for QQ to send the receipt.
            this.notify(`【stella ${item.id}】回复已接收，正在返回 Codex；无需再在电脑提交。若电脑仍停留在表单，请在本聊天报告。`);
          }
        } catch { /* Ignore malformed frames; do not log message text or tokens. */ }
      });
      socket.addEventListener('error', () => { clearTimeout(deadline); reject(Error('独立 QQ 接口连接失败')); });
      socket.addEventListener('close', () => {
        clearTimeout(deadline); this.ready = false; this.connecting = null;
        reject(Error('独立 QQ 连接断开')); this.questions.disconnect();
        for (const p of this.calls.values()) { clearTimeout(p.timer); p.reject(Error('QQ 连接断开')); } this.calls.clear();
        for (const p of this.waiters.values()) { clearTimeout(p.timer); p.reject(Error('QQ 连接断开')); } this.waiters.clear();
      });
    });
    return this.connecting;
  }
  call(action, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('QQ 尚未连接'));
    return new Promise((resolve, reject) => {
      const echo = randomUUID(), timer = setTimeout(() => { this.calls.delete(echo); reject(Error('QQ 接口超时；不自动重发')); }, 10000);
      this.calls.set(echo, { resolve, reject, timer }); this.socket.send(JSON.stringify({ action, params, echo }));
    });
  }
  notify(text) {
    void this.call('send_private_msg', { user_id: Number(this.config.contactId), message: [{ type: 'text', data: { text } }] }).catch(() => {});
  }
  async sendCompletion(input) {
    const { taskId, summary } = validateCompletion(input);
    const previous = this.completions.get(taskId);
    if (previous) {
      if (previous.summary !== summary) throw Error('相同任务编号已用于其他完成摘要');
      return previous.promise;
    }
    const promise = (async () => {
      await this.connect();
      const response = await this.call('send_private_msg', {
        user_id: Number(this.config.contactId),
        message: [{ type: 'text', data: { text: `【stella · 工作完成】\n任务：${taskId}\n${summary}\n\n此消息为完成通知，无需回复。` } }]
      });
      if (response?.message_id == null) throw Error('QQ 未返回消息编号，送达状态未知；不会自动重发');
      return { sent: true, taskId, messageId: String(response.message_id) };
    })();
    // Retain failed/uncertain attempts too: retrying could duplicate a delivered message.
    this.completions.set(taskId, { summary, promise });
    return promise;
  }
  async open(question) {
    await this.connect(); this.questions.prune();
    const text = question.question + (question.choices ? '\n' + question.choices.map((v, i) => `${i + 1}. ${v}`).join('\n') + '\n可回复选项数字，也可用自己的话回答。' : '') + '\n\n电脑上的 Codex 原生表单也可回答，系统只采用一次答复。';
    const { item } = this.questions.create({ text, context: question.context, timeoutSeconds: 480 });
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    promise.catch(() => {}); // Early cancellation may happen before the coordinator takes ownership.
    const timer = setTimeout(() => { this.waiters.delete(item.id); this.questions.get(item.id); reject(Error('QQ 提问已超时')); }, 481000);
    this.waiters.set(item.id, { resolve, reject, timer, choices: question.choices });
    try {
      await this.call('send_private_msg', { user_id: Number(this.config.contactId), message: [{ type: 'text', data: { text: this.questions.message(item) } }] });
      if (!this.ready || item.state !== 'sending') throw Error('QQ 发送期间连接断开');
      item.sentAt = Date.now(); item.state = 'pending';
    } catch (e) { clearTimeout(timer); this.waiters.delete(item.id); item.state = 'send_failed'; reject(e); throw e; }
    return { promise, cancel: () => { clearTimeout(timer); this.waiters.delete(item.id); if (['pending', 'sending'].includes(item.state)) item.state = 'cancelled'; reject(Error('此问题已在电脑完成或取消')); } };
  }
  close() { this.socket?.close(); }
}
