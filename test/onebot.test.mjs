import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { IsolatedQQ } from '../app/bridge/onebot.mjs';
import { coordinate } from '../app/bridge/coordinator.mjs';

const config = { botId: '1111111111', contactId: '2222222222', onebotPort: 24123, token: 'a'.repeat(64) };
const choices = ['电脑收到，测试成功', 'QQ 也已收到，测试成功'];
class Socket extends EventTarget {
  constructor() {
    super(); this.readyState = 0; this.sent = [];
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
  }
  frame(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  send(raw) {
    const message = JSON.parse(raw); this.sent.push(message);
    // Leave receipt calls unacknowledged: returning the answer must not wait for them.
    if (message.action === 'send_private_msg' && !message.params.message[0].data.text.includes('【stella ·')) return;
    const data = message.action === 'get_login_info' ? { user_id: Number(config.botId) }
      : message.action === 'get_friend_list' ? [{ user_id: Number(config.contactId) }] : { message_id: 1234 };
    queueMicrotask(() => this.frame({ status: 'ok', retcode: 0, echo: message.echo, data }));
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function incoming(id, answer, extra = {}) {
  return { post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: Number(config.botId), user_id: Number(config.contactId), message_id: Math.random().toString(), time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text: `${id} ${answer}` } }], ...extra };
}
async function open() {
  const qq = new IsolatedQQ({ config, Socket });
  const handle = await qq.open({ question: '测试', choices });
  const id = [...qq.waiters.keys()][0];
  return { qq, handle, id };
}

test('完成通知核对账号与好友、发送到唯一联系人，同任务并发只发一次', async () => {
  const qq = new IsolatedQQ({ config, Socket });
  try {
    const args = { taskId: 'release-test', summary: '构建完成，下载链接在当前聊天。' };
    const [a, b] = await Promise.all([qq.sendCompletion(args), qq.sendCompletion(args)]);
    assert.deepEqual(a, b); assert.equal(a.sent, true);
    const messages = qq.socket.sent.filter(m => m.action === 'send_private_msg');
    assert.equal(messages.length, 1); assert.equal(messages[0].params.user_id, Number(config.contactId));
    assert.match(messages[0].params.message[0].data.text, /工作完成/); assert.equal(qq.waiters.size, 0);
    await assert.rejects(qq.sendCompletion({ ...args, summary: '其他摘要' }), /其他完成摘要/);
    await assert.rejects(qq.sendCompletion({ ...args, contactId: '999999999' }), /不能更改接收人/);
  } finally { qq.close(); }
});

test('完成通知接口失败如实报错，同任务不会自动重发', async () => {
  class FailureSocket extends Socket {
    send(raw) {
      const m = JSON.parse(raw);
      if (m.action !== 'send_private_msg') return super.send(raw);
      this.sent.push(m); queueMicrotask(() => this.frame({ status: 'failed', retcode: 1, echo: m.echo }));
    }
  }
  const qq = new IsolatedQQ({ config, Socket: FailureSocket });
  try {
    const args = { taskId: 'failure', summary: '已完成' };
    await assert.rejects(qq.sendCompletion(args), /接口返回错误/);
    await assert.rejects(qq.sendCompletion(args), /接口返回错误/);
    assert.equal(qq.socket.sent.filter(m => m.action === 'send_private_msg').length, 1);
  } finally { qq.close(); }
});
test('真实接收分支采用带编号的自由文字，并只确认一次', async () => {
  const { qq, handle, id } = await open();
  try {
    const event = incoming(id, '测试成功'); qq.socket.frame(event);
    assert.equal(await handle.promise, '测试成功');
    assert.equal(qq.waiters.size, 0);
    const count = qq.socket.sent.length; qq.socket.frame(event); assert.equal(qq.socket.sent.length, count);
    assert.ok(qq.socket.sent.some(m => m.params?.message?.[0]?.data.text.includes('收到啦')));
  } finally { qq.close(); }
});
test('错误选项数字有提示且不消费请求，随后可以重新回答', async () => {
  const { qq, handle, id } = await open();
  try {
    qq.socket.frame(incoming(id, '9'));
    assert.equal(qq.questions.get(id).state, 'pending');
    assert.ok(qq.socket.sent.some(m => m.params?.message?.[0]?.data.text.includes('数字没对上')));
    qq.socket.frame(incoming(id, '2')); assert.equal(await handle.promise, '2');
  } finally { qq.close(); }
});
test('陌生人、群消息、旧问题及重复答复不产生确认或答案', async () => {
  const { qq, handle, id } = await open();
  try {
    const count = qq.socket.sent.length;
    qq.socket.frame(incoming(id, '测试成功', { user_id: 999 }));
    qq.socket.frame(incoming(id, '9', { user_id: 999 }));
    qq.socket.frame(incoming(id, '测试成功', { message_type: 'group' }));
    qq.socket.frame(incoming('0000000000', '测试成功'));
    qq.socket.frame(incoming(id, '测试成功', { time: Math.floor(Date.now() / 1000) - 100 }));
    assert.equal(qq.questions.get(id).state, 'pending'); assert.equal(qq.socket.sent.length, count);
    handle.cancel(); qq.socket.frame(incoming(id, '迟到答复'));
    assert.equal(qq.questions.get(id).state, 'cancelled'); assert.equal(qq.socket.sent.length, count);
  } finally { qq.close(); }
});
test('QQ 自由回答立即结束原表单，不等待 QQ 确认消息回执', async () => {
  const qq = new IsolatedQQ({ config, Socket }); let cancelled = 0, reject;
  const nativePromise = new Promise((_, r) => { reject = r; });
  const result = coordinate({ input: { question: '测试', choices }, mirrorDelayMs: 1,
    desktop: { request: () => ({ promise: nativePromise, cancel() { cancelled++; reject(Error('cancelled')); } }) },
    mobile: qq });
  try {
    for (let i = 0; !qq.waiters.size && i < 50; i++) await delay(2);
    const id = [...qq.waiters.keys()][0]; assert.ok(id); await delay(0);
    qq.socket.frame(incoming(id, '测试成功'));
    const timeout = new AbortController();
    try {
      const answer = await Promise.race([result, delay(300, null, { signal: timeout.signal }).then(() => { throw Error('答案被阻塞'); })]);
      assert.deepEqual(answer, { source: 'qq', answer: '测试成功' }); assert.equal(cancelled, 1);
    } finally { timeout.abort(); }
  } finally { qq.close(); }
});
