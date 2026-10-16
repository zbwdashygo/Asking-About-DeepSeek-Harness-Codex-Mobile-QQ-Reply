import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
function client(capabilities) {
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../app/bridge/server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  const received = [], waiting = [];
  let diagnostics = '';
  proc.stderr.on('data', d => { diagnostics += String(d); });
  proc.on('error', e => { diagnostics += e.message; });
  proc.on('exit', code => { diagnostics += ` [exit ${code}]`; });
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    const msg = JSON.parse(line); received.push(msg);
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].matches(msg)) { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(msg); }
  });
  const send = m => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const wait = matches => {
    const existing = received.find(matches); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('MCP 测试超时：' + diagnostics)), 3000); waiting.push({ matches, resolve, timer }); });
  };
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities, clientInfo: { name: 'test', version: '1' } } });
  return { proc, send, wait, received };
}
test('MCP 原生表单请求真实使用 elicitation/create，电脑回答回到原工具调用', async () => {
  const c = client({ elicitation: {} });
  try {
    await c.wait(m => m.id === 1); c.send({ method: 'notifications/initialized' });
    c.send({ id: 2, method: 'tools/call', params: { name: 'test_desktop_form', arguments: { question: '电脑测试', choices: ['看到窗口', '未看到窗口'] } } });
    const form = await c.wait(m => m.method === 'elicitation/create'); assert.equal(form.params.requestedSchema.type, 'object');
    c.send({ id: form.id, result: { action: 'accept', content: { answer: '看到窗口' } } });
    const response = await c.wait(m => m.id === 2); assert.equal(JSON.parse(response.result.content[0].text).source, 'desktop'); assert.equal(response.result.isError, undefined);
  } finally { c.proc.kill(); }
});
test('缺少原生表单能力时返回错误而不是 QQ 独占提问', async () => {
  const c = client({});
  try {
    await c.wait(m => m.id === 1); c.send({ id: 2, method: 'tools/call', params: { name: 'test_desktop_form', arguments: { question: '问题' } } });
    const response = await c.wait(m => m.id === 2); assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /没有声明原生表单/);
    assert.equal(c.received.some(m => m.method === 'elicitation/create'), false);
  } finally { c.proc.kill(); }
});
test('未在当前客户端验证电脑表单之前不启用 QQ 镜像', async () => {
  const c = client({ elicitation: { form: {} } });
  try {
    await c.wait(m => m.id === 1); c.send({ id: 2, method: 'tools/call', params: { name: 'ask_on_desktop', arguments: { question: '问题' } } });
    const response = await c.wait(m => m.id === 2); assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /先运行 test_desktop_form/);
    assert.equal(c.received.some(m => m.method === 'elicitation/create'), false);
  } finally { c.proc.kill(); }
});
test('客户端取消调用时向原生表单发出相同请求编号的取消通知', async () => {
  const c = client({ elicitation: { form: {} } });
  try {
    await c.wait(m => m.id === 1); c.send({ id: 2, method: 'tools/call', params: { name: 'test_desktop_form', arguments: { question: '取消测试' } } });
    const form = await c.wait(m => m.method === 'elicitation/create'); c.send({ method: 'notifications/cancelled', params: { requestId: 2 } });
    const cancel = await c.wait(m => m.method === 'notifications/cancelled'); assert.equal(cancel.params.requestId, form.id);
    assert.equal((await c.wait(m => m.id === 2)).result.isError, true);
  } finally { c.proc.kill(); }
});
