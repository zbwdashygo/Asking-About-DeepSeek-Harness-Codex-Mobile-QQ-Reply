import { randomUUID } from 'node:crypto';
import { loadConfig, validateConfig, configPath } from './config.mjs';
import { allocateQuestionNumber } from './question-numbers.mjs';
import { Questions } from './questions.mjs';
import { normalizeMobileAnswer } from './coordinator.mjs';
import { validateCompletion } from './completion.mjs';
import { FileStore } from './files.mjs';
import { questionPolicy, writeQuestionDocument } from './question-document.mjs';
export class IsolatedQQ {
  constructor({ config, configFile, Socket = WebSocket } = {}) {
    this.config = config ? validateConfig(config) : loadConfig();
    this.configFile = configFile ?? (config ? undefined : configPath());
    this.Socket = Socket;
    const c = this.config;
    this.questions = new Questions(c); this.calls = new Map(); this.waiters = new Map(); this.completions = new Map(); this.listeners = new Set(); this.ready = false;
  }
  async connect() {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const c = this.config, url = new URL(`ws://127.0.0.1:${c.onebotPort}`); url.searchParams.set('access_token', c.token);
      const socket = this.socket = new this.Socket(url);
      const deadline = setTimeout(() => { reject(Error('独立 QQ 接口连接超时')); socket.close(); }, 10000);
      socket.addEventListener('open', async () => {
        if (socket !== this.socket) return;
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
        if (socket !== this.socket) return;
        try {
          const m = JSON.parse(data);
          const call = this.calls.get(m.echo);
          if (call) { clearTimeout(call.timer); this.calls.delete(m.echo); m.retcode === 0 && m.status === 'ok' ? call.resolve(m.data) : call.reject(Error('QQ 接口返回错误')); return; }
          if (m.post_type === 'meta_event' && String(m.self_id) === c.botId && Number.isFinite(m.time)) this.questions.sourceOffsetMs = m.time * 1000 - Date.now();
          if (!this.ready) return;
          for (const listener of this.listeners) { try { void Promise.resolve(listener(m)).catch(() => {}); } catch {} }
          // The numbered question still must match; choices are suggestions on QQ.
          const text = Array.isArray(m.message) ? m.message.filter(s => s.type === 'text').map(s => s.data?.text ?? '').join('').trim() : '';
          const parsed = /^([1-9][0-9]{0,8}|[A-F0-9]{10})\s+([\s\S]+)$/i.exec(text);
          const waiter = parsed && this.waiters.get(parsed[1].toUpperCase());
          if (!waiter) return;
          if (normalizeMobileAnswer(parsed[2], waiter.choices) === null) {
            if (m.post_type === 'message' && m.message_type === 'private' && m.sub_type === 'friend' && String(m.self_id) === c.botId && String(m.user_id) === c.contactId && !waiter.warned) {
              waiter.warned = true;
              this.notify(`【stella ${parsed[1].toUpperCase()}】这个数字没对上，选 1–${waiter.choices?.length ?? 6}，或直接说你的想法吧。记得带上问题编号。`);
            }
            return;
          }
          if (this.questions.receive(m)) {
            const item = this.questions.get(parsed[1].toUpperCase());
            clearTimeout(waiter.timer); this.waiters.delete(item.id); waiter.resolve(item.answer);
            // Do not delay delivery to Codex while waiting for QQ to send the receipt.
            this.notify(`【stella ${item.id}】收到啦，已转给电脑，不用再答一次。`);
          }
        } catch { /* Ignore malformed frames; do not log message text or tokens. */ }
      });
      socket.addEventListener('error', () => { if (socket !== this.socket) return; clearTimeout(deadline); reject(Error('独立 QQ 接口连接失败')); });
      socket.addEventListener('close', () => {
        if (socket !== this.socket) return;
        clearTimeout(deadline); this.ready = false; this.connecting = null;
        reject(Error('独立 QQ 连接断开')); this.questions.disconnect();
        for (const p of this.calls.values()) { clearTimeout(p.timer); p.reject(Error('QQ 连接断开')); } this.calls.clear();
        for (const p of this.waiters.values()) { clearTimeout(p.timer); p.reject(Error('QQ 连接断开')); } this.waiters.clear();
      });
    });
    const attempt = this.connecting;
    try { return await attempt; }
    catch (error) {
      // A failed WebSocket handshake need not emit close. Clear that rejected
      // promise so a later read-only login check can make a fresh connection.
      if (this.connecting === attempt) {
        this.connecting = null; this.ready = false;
        try { this.socket?.close(); } catch {}
      }
      throw error;
    }
  }
  call(action, params = {}, { timeoutMs = 10000 } = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('QQ 尚未连接'));
    return new Promise((resolve, reject) => {
      const echo = randomUUID(), timer = setTimeout(() => { this.calls.delete(echo); reject(Error('QQ 接口超时；不自动重发')); }, Math.min(60000, Math.max(1000, timeoutMs)));
      this.calls.set(echo, { resolve, reject, timer }); this.socket.send(JSON.stringify({ action, params, echo }));
    });
  }
  notify(text) {
    void this.call('send_private_msg', { user_id: Number(this.config.contactId), message: [{ type: 'text', data: { text } }] }).catch(() => {});
  }
  onMessage(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async sendText(text) {
    await this.connect();
    return this.call('send_private_msg', { user_id: Number(this.config.contactId), message: [{ type: 'text', data: { text } }] });
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
        message: [{ type: 'text', data: { text: `【stella · 工作完成】\n忙完啦。${summary}` } }]
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
    const policy = questionPolicy(this.configFile);
    const mobileRequired = question.mobileRequired ?? policy.mobileRequired;
    const document = question.document ?? policy.document;
    const text = question.question + (question.choices ? '\n' + question.choices.map((v, i) => `${i + 1}. ${v}`).join('\n') + '\n选数字或直接说都可以。' : '') + (mobileRequired ? '\n直接在手机 QQ 按编号回复就好。' : '\n电脑也能回答，两边先答先用。');
    const id = this.configFile ? await allocateQuestionNumber(this.configFile + '.question-numbers.json') : undefined;
    const { item } = this.questions.create({ text, context: question.context, timeoutSeconds: 480, ...(id ? { id } : {}) });
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
    // Do not hold a mobile answer behind a slow document-upload receipt.
    // The complete question and reply number are already in the QQ text.
    let documentReceipt;
    if (document) {
      documentReceipt = Promise.resolve().then(() => {
        const attachment = writeQuestionDocument(this.configFile, item);
        return new FileStore(this.configFile).send(this, { transferId: attachment.transferId, filePath: attachment.filePath }, attachment.root);
      }).catch(error => {
        this.notify('问题文档没发成功，直接按编号回答刚才那条消息也可以。');
        return { sent: false, error: String(error.message).slice(0,160) };
      });
    }
    return { id: item.id, documentReceipt, promise, cancel: () => { clearTimeout(timer); this.waiters.delete(item.id); if (['pending', 'sending'].includes(item.state)) item.state = 'cancelled'; reject(Error('此问题已在电脑完成或取消')); } };
  }
  close() { this.socket?.close(); }
}
