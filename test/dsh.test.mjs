import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { relayRequest } from '../app/dsh/adapter.mjs';
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); promise.catch(()=>{}); return { promise, resolve, reject, cancel() { reject(Error('cancelled')); } }; }
const request = () => ({ agent: { id: 'test-live-root' }, signal: new AbortController().signal, questions: [{ id: 'choice', question: '选什么？', options: [{ label: 'A' }, { label: 'B' }] }] });
test('DSH 原生电脑卡片先创建，手机自由答案返回同一请求并取消卡片', async () => {
  const log = [], phone = deferred(), native = deferred(), req = request(); let desktopSignal;
  const result = relayRequest(req, r => { log.push('desktop'); desktopSignal = r.signal; r.signal.addEventListener('abort', () => native.reject(Error('done'))); return native.promise; }, { async open() { log.push('qq'); return phone; } }, { mirrorDelayMs: 5 });
  assert.deepEqual(log, ['desktop']); await delay(15); assert.deepEqual(log, ['desktop','qq']);
  phone.resolve('自己的回答'); assert.deepEqual(await result, { answers: [{ id: 'choice', selected: [], custom: '自己的回答' }] });
  assert.equal(desktopSignal.aborted, true); assert.equal(req.signal.aborted, false);
});
test('DSH 电脑先答时手机作废，不修改原生结果', async () => {
  const native = deferred(); let mobileUsed = false;
  const result = relayRequest(request(), () => native.promise, { async open() { mobileUsed = true; throw Error('unexpected'); } }, { mirrorDelayMs: 20 });
  const answer = { answers: [{ id: 'choice', selected: ['A'] }] }; native.resolve(answer);
  assert.equal(await result, answer); await delay(25); assert.equal(mobileUsed, false);
});
test('DSH QQ 故障继续保留原生电脑卡片', async () => {
  const native = deferred(); const result = relayRequest(request(), () => native.promise, { async open() { throw Error('offline'); } }, { mirrorDelayMs: 1 });
  await delay(10); const answer = { answers: [{ id: 'choice', selected: ['B'] }] }; native.resolve(answer); assert.equal(await result, answer);
});
test('DSH 审阅意图及无存活 agent 的请求不发 QQ', async () => {
  for (const req of [{ ...request(), agent: undefined }, { ...request(), questions: [{ id:'review', intent:{kind:'plan-review'} }] }]) {
    let sent = false; const original = { answers: [] };
    assert.equal(await relayRequest(req, r => { assert.equal(r,req); return original; }, { open() { sent = true; } }), original); assert.equal(sent,false);
  }
});
