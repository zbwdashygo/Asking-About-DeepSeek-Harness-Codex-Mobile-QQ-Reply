import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { relayRequest, registerTools } from '../app/dsh/adapter.mjs';
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
test('DSH 工具直接注册 JSON Schema，不依赖外部 SDK，仍须先通过电脑验证', async () => {
  const tools = []; let asks = 0;
  const ctx = { tools: { register: t => tools.push(t) }, userQuestions: { async ask() { asks++; return { answers: [{ id: 'answer', selected: [], custom: '看到表单' }] }; } } };
  registerTools(ctx, { open() { throw Error('test must not contact QQ'); } });
  const completion = tools.splice(tools.findIndex(t => t.name === 'stella_notify_completion'), 1)[0];
  assert.deepEqual(completion.parameters.required, ['taskId', 'summary']);
  assert.equal(tools.length, 2); assert.equal(tools[0].parameters.type, 'object'); assert.deepEqual(tools[0].parameters.required, ['question']);
  assert.equal(tools[0].parameters.additionalProperties, false); assert.equal(tools[0].output.schema.required[0], 'answers');
  const exec = { agent: { id: 'root' }, signal: new AbortController().signal, callId: 'test' };
  await assert.rejects(tools[1].execute({question:'test'}, exec), /先调用/);
  assert.equal(asks, 0); assert.equal((await tools[0].execute({question:'test'}, exec)).answers[0].custom, '看到表单');
  await assert.rejects(tools[0].execute({question:'test', contactId:'different'}, exec), /无效/);
  assert.equal(asks, 1);
});

test('DSH 完成通知不打开用户提问或等待电脑验证', async () => {
  const tools = []; let sent;
  registerTools({ tools: { register: t => tools.push(t) }, userQuestions: { ask() { throw Error('不得提问'); } } }, { async sendCompletion(args) { sent = args; return { sent: true, taskId: args.taskId, messageId: '42' }; } });
  const args = { taskId: 'dsh-test', summary: '已完成' };
  assert.equal((await tools.find(t => t.name === 'stella_notify_completion').execute(args)).sent, true);
  assert.deepEqual(sent, args);
  assert.throws(() => tools.find(t => t.name === 'stella_notify_completion').execute({ ...args, contactId: 'other' }), /不能更改接收人/);
});

test('DSH Schema 使用宿主支持的子集，长度与数量约束在执行前仍生效', async () => {
  const definitions = [];
  registerTools({ tools: { register: t => definitions.push(t) }, userQuestions: { ask() { throw Error('无效参数不应打开卡片'); } } }, {});
  const check = schema => {
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) assert.equal(key in schema, false);
    for (const child of Object.values(schema.properties ?? {})) check(child);
    if (schema.items) check(schema.items);
  };
  for (const t of definitions) { check(t.parameters); check(t.output.schema); }
  const testTool = definitions.find(t => t.name === 'stella_test_desktop_form');
  await assert.rejects(testTool.execute({ question: 'x'.repeat(10001) }, {}), /问题/);
  await assert.rejects(testTool.execute({ question: 'test', choices: ['only'] }, {}), /选项/);
  const notify = definitions.find(t => t.name === 'stella_notify_completion');
  assert.throws(() => notify.execute({ taskId: 'test', summary: 'x'.repeat(2001) }), /摘要/);
});

test('DSH 跳过或空答电脑测试时不启用 QQ，保留真实调用方及取消信号', async () => {
  for (const answers of [[], [{ id: 'answer', selected: [] }], [{ id: 'answer', selected: [], custom: ' ' }]]) {
    const definitions = []; let nativeRequest;
    registerTools({ tools: { register: t => definitions.push(t) }, userQuestions: { async ask(r) { nativeRequest = r; return { answers }; } } }, { open() { throw Error('不得发QQ'); } });
    const exec = { agent: { id: 'live-root' }, signal: new AbortController().signal, callId: 'native-call' };
    await definitions.find(t => t.name === 'stella_test_desktop_form').execute({ question: '电脑测试' }, exec);
    assert.equal(nativeRequest.agent, exec.agent); assert.equal(nativeRequest.signal, exec.signal);
    assert.equal(nativeRequest.wait.callId, exec.callId);
    await assert.rejects(definitions.find(t => t.name === 'stella_ask_on_desktop').execute({ question: '双端' }, exec), /先调用/);
  }
});
