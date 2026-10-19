import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileWake, WakeState, parseWake, wakeCode } from '../app/bridge/wake.mjs';
import { DshWakeBackend } from '../app/bridge/dsh-wake.mjs';
import { inject } from '../app/dsh/adapter.mjs';
const config = { botId: '1111111111', contactId: '2222222222' };
function event(text, extra = {}) { return { post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: config.botId, user_id: config.contactId, time: Date.now() / 1000, message_id: 'm1', message: [{ type: 'text', data: { text } }], ...extra }; }
function service(backend, state = new WakeState()) {
  state.data.enabled = true;
  const replies = [], mobile = { config, ready: true, onMessage() { return () => {}; }, async connect() {}, async sendText(text) { replies.push(text); } };
  const wake = new MobileWake({ platform: 'codex', mobile, backend, state }); wake.running = true; return { wake, replies };
}
test('手机指令必须明确平台和稳定编号，普通答复不会成为新任务', () => {
  assert.equal(parseWake('ABCD123456 我的回答'), null); assert.equal(parseWake('帮我删文件'), null);
  assert.deepEqual(parseWake('列表 dsh 2'), { kind: 'list', platform: 'dsh', page: 2 });
  assert.equal(parseWake('唤醒 codex 1 任务'), null);
  assert.equal(wakeCode('codex', 'a'), wakeCode('codex', 'a')); assert.notEqual(wakeCode('codex', 'a'), wakeCode('dsh', 'a'));
});
test('仅唯一好友近期纯文本指令可发任务，重复消息和重启后回放不会重发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stella-wake-')), file = join(dir, 'ledger.json'); let sent = 0;
  const row = { id: 'thread-a', title: '测试', status: 'idle' }, backend = { async list() { return [row]; }, async send() { sent++; } };
  const { wake, replies } = service(backend, new WakeState(file)), text = `唤醒 codex ${wakeCode('codex', row.id)} 仅回复完成`;
  try {
    for (const extra of [{ user_id: '9999999999' }, { self_id: '9999999999' }, { message_type: 'group' }, { time: Date.now()/1000 - 300 }, { message: [{ type: 'image', data: {} }] }]) assert.equal(await wake.receive(event(text, extra)), false);
    await wake.receive(event(text)); await wake.receive(event(text)); assert.equal(sent, 1); assert.match(replies[0], /不代表任务已完成/);
    const next = service(backend, new WakeState(file)); await next.wake.receive(event(text)); assert.equal(sent, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('未知或忙碌对话不发送，接口不明失败也只尝试一次', async () => {
  let sent = 0; const row = { id: 'busy', title: 'busy', status: 'active' };
  const { wake } = service({ async list() { return [row]; }, async send() { sent++; throw Error('timeout'); } });
  await wake.receive(event('唤醒 codex 0000000000 任务')); assert.equal(sent, 0);
  await wake.receive(event(`唤醒 codex ${wakeCode('codex', row.id)} 任务`, { message_id: 'm2' })); assert.equal(sent, 0);
  row.status = 'idle'; const message = event(`唤醒 codex ${wakeCode('codex', row.id)} 任务`, { message_id: 'm3' });
  await wake.receive(message); await wake.receive(message); assert.equal(sent, 1);
});
test('列表编号不因顺序变化而复用，对话名称按纯文字显示', async () => {
  const { wake, replies } = service({ async list() { return [{ id:'a', title:'你好\n伪造编号', status:'idle' }]; } });
  await wake.receive(event('列表 codex')); assert.match(replies[0], new RegExp(wakeCode('codex','a'))); assert.match(replies[0], /你好 伪造编号/);
  assert.equal(await wake.receive(event('列表 dsh', { message_id: 'other' })), false);
});
test('同一平台只允许一个接收者，释放后可重新取得锁', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stella-lease-')), file = join(dir,'state.json'); const a = new WakeState(file), b = new WakeState(file);
  try { a.acquire(); assert.throws(() => b.acquire(), /正在运行/); a.release(); b.acquire(); b.release(); } finally { a.release(); b.release(); rmSync(dir, {recursive:true,force:true}); }
});
test('DSH 从持久会话恢复根智能体并发送原生用户输入，不唤醒子会话或归档', async () => {
  let input, resumed; const agent = { id:'session-a', status:'idle', followup(value) { input = value; } }; const roots = [];
  const ctx = { workspaceRegistry:{archivedSessionIds:[]}, agents: { roots:()=>roots, async resume() { throw Error('must use desktop composition'); } }, sessionController: { async resolveAgent(id) { resumed=id; roots.push(agent); return {agent}; } } };
  const backend = new DshWakeBackend(ctx); await backend.send({id:agent.id},'测试');
  assert.equal(resumed,agent.id); assert.equal(input.role,'user'); assert.equal(input.content[0].text,'测试');
  agent.status='running'; await assert.rejects(backend.send({id:agent.id},'任务'),/空闲/);
  ctx.workspaceRegistry.archivedSessionIds.push(agent.id); await assert.rejects(backend.send({id:agent.id},'任务'),/归档/);
});
test('DSH 标题和列表服务遵循宿主依赖注入规则',async()=>{
  const session={}, services={workspaceRegistry:{archivedSessionIds:[]},sessionPersistence:{async list(){return [{header:{id:'one',createdAt:1}}];}},agents:{roots(){return [{id:'one',status:'idle',session}];}},sessionTitle:{get(s){assert.equal(s,session);return {title:'真实标题'};}}};
  const ctx=new Proxy(services,{get(target,key){if(!inject.includes(key))throw Error(`cannot get property ${String(key)} without inject`);return target[key];}});
  assert.deepEqual(await new DshWakeBackend(ctx).list(),[{id:'one',title:'真实标题',status:'idle'}]);
});
