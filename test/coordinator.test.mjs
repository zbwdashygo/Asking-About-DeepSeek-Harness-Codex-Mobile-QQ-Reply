import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { coordinate, normalizeAnswer, normalizeMobileAnswer } from '../app/bridge/coordinator.mjs';
function deferred() {
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {});
  return { promise, resolve, reject, cancelled: 0, cancel() { this.cancelled++; reject(Error('cancelled')); } };
}
function fixture() {
  const log = [], form = deferred(), phone = deferred();
  return { log, form, phone, desktop: { request() { log.push('desktop'); return form; } }, mobile: { async open() { log.push('qq'); return phone; } } };
}
test('先请求电脑原生表单，之后才发送 QQ', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '选哪个？' }, mirrorDelayMs: 20 });
  assert.deepEqual(f.log, ['desktop']); await delay(35); assert.deepEqual(f.log, ['desktop', 'qq']);
  f.phone.resolve('方案 A'); assert.deepEqual(await p, { source: 'qq', answer: '方案 A' }); assert.equal(f.form.cancelled, 1);
});
test('电脑快速作答时不再发 QQ', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 30 });
  f.form.resolve({ action: 'accept', content: { answer: '电脑回答' } });
  assert.deepEqual(await p, { source: 'desktop', answer: '电脑回答' }); await delay(40); assert.deepEqual(f.log, ['desktop']);
});
test('电脑在 QQ 发出后回答，手机待答被取消', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1 });
  await delay(10); f.form.resolve({ action: 'accept', content: { answer: '电脑回答' } });
  assert.equal((await p).source, 'desktop'); assert.equal(f.phone.cancelled, 1);
});
test('迟到的另一端回答不能覆盖先完成的答复', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1 });
  await delay(10); f.phone.resolve('手机回答'); await delay(0); f.form.resolve({ action: 'accept', content: { answer: '迟到电脑回答' } });
  assert.equal((await p).answer, '手机回答');
});
test('QQ 断线时电脑仍能正常作答', async () => {
  const f = fixture(); f.mobile.open = async () => { throw Error('offline'); };
  const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1 }); await delay(10);
  assert.equal(f.form.cancelled, 0); f.form.resolve({ action: 'accept', content: { answer: '正常' } });
  const result = await p; assert.equal(result.answer, '正常'); assert.equal(result.qqWarning, 'offline');
});
test('客户端不支持原生表单时，QQ 不会被调用', () => {
  let sent = false;
  assert.throws(() => coordinate({ input: { question: '问题' }, desktop: { request() { throw Error('no forms'); } }, mobile: { open() { sent = true; } } }));
  assert.equal(sent, false);
});
test('用户在电脑取消，取消 QQ 待答', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1 }); await delay(10);
  f.form.resolve({ action: 'cancel' }); assert.deepEqual(await p, { source: 'desktop', cancelled: true }); assert.equal(f.phone.cancelled, 1);
});
test('超时后两端均取消', async () => {
  const f = fixture(); const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1, timeoutMs: 30 });
  await assert.rejects(p, /超时/); assert.equal(f.phone.cancelled, 1); assert.equal(f.form.cancelled, 1);
});
test('调用被中断时两端均取消', async () => {
  const f = fixture(), controller = new AbortController();
  const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1, signal: controller.signal }); await delay(10); controller.abort();
  await assert.rejects(p, /取消/); assert.equal(f.phone.cancelled, 1); assert.equal(f.form.cancelled, 1);
});
test('QQ 发送过程中电脑先答复，发送完成后马上废弃手机请求', async () => {
  const f = fixture(), opening = deferred(); f.mobile.open = () => opening.promise;
  const p = coordinate({ ...f, input: { question: '问题' }, mirrorDelayMs: 1 }); await delay(10);
  f.form.resolve({ action: 'accept', content: { answer: '电脑已答' } }); assert.equal((await p).source, 'desktop');
  opening.resolve(f.phone); await delay(0); assert.equal(f.phone.cancelled, 1);
});
test('选择题可用完整选项或数字回复，其他内容不生效', () => {
  assert.equal(normalizeAnswer('2', ['A', 'B']), 'B'); assert.equal(normalizeAnswer('A', ['A', 'B']), 'A'); assert.equal(normalizeAnswer('3', ['A', 'B']), null); assert.equal(normalizeAnswer('好的', ['A', 'B']), null);
});
test('手机可用自己的话回答选择题，电脑表单仍保持选项约束', async () => {
  const choices = ['电脑收到，测试成功', 'QQ 也已收到，测试成功'];
  assert.equal(normalizeAnswer('测试成功', choices), null);
  assert.equal(normalizeMobileAnswer('测试成功', choices), '测试成功');
  assert.equal(normalizeMobileAnswer('2', choices), choices[1]);
  assert.equal(normalizeMobileAnswer('8', choices), null);
  const f = fixture(); const p = coordinate({ ...f, input: { question: '测试', choices }, mirrorDelayMs: 1 });
  await delay(10); f.phone.resolve('手机端回答电脑端收不到或者响应太慢了');
  assert.deepEqual(await p, { source: 'qq', answer: '手机端回答电脑端收不到或者响应太慢了' });
  assert.equal(f.form.cancelled, 1);
});
test('不合法问题不会打开任一端', () => {
  const f = fixture(); assert.throws(() => coordinate({ ...f, input: { question: '' } })); assert.deepEqual(f.log, []);
});
