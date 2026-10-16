import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { coordinate } from './coordinator.mjs';
import { IsolatedQQ } from './onebot.mjs';
const forms = new Map(), active = new Map();
let clientCapabilities = {}, qq, desktopVerified = false;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const desktop = {
  request({ question, context, choices }) {
    const elicitation = clientCapabilities.elicitation;
    if (!elicitation || (Object.keys(elicitation).length > 0 && !elicitation.form)) throw Error('当前客户端没有声明原生表单能力。不会转成 QQ 独占提问，请用电脑原有提问工具。');
    const id = `stella-form-${randomUUID()}`;
    let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
    forms.set(id, { resolve, reject });
    const requestedSchema = { type: 'object', properties: { answer: { type: 'string', title: '你的回答', ...(choices ? { enum: choices } : {}) } }, required: ['answer'] };
    send({ id, method: 'elicitation/create', params: { message: [context, question].filter(Boolean).join('\n'), requestedSchema } });
    return { promise, cancel(reason) { if (!forms.has(id)) return; forms.delete(id); send({ method: 'notifications/cancelled', params: { requestId: id, reason } }); reject(Error(reason)); } };
  }
};
const schema = { type: 'object', properties: { question: { type: 'string', maxLength: 10000 }, choices: { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 2, maxItems: 6 }, context: { type: 'string', maxLength: 500 } }, required: ['question'], additionalProperties: false };
const tools = [
  { name: 'test_desktop_form', description: '兼容性测试：只显示 Codex 原生表单并返回电脑回答，不联系 QQ。先通过本测试才能启用双端提问。', inputSchema: schema, annotations: { readOnlyHint: true } },
  { name: 'ask_on_desktop', description: '先请求显示 Codex 原生表单，1 秒后向独立 stella 专用号的唯一好友发送问题副本。电脑可直接回答；只采用两端的第一次有效答复，撤销另一端待答。仅用于澄清问题和方案选择，不代替系统权限审批。当前应用是否显示及关闭表单仍需实测。', inputSchema: schema, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
];
async function handle(m) {
  if (!m.method && m.id !== undefined) {
    const p = forms.get(m.id); if (!p) return; forms.delete(m.id);
    m.error ? p.reject(Error('Codex 拒绝了原生表单请求：' + m.error.message)) : p.resolve(m.result); return;
  }
  if (m.method === 'notifications/cancelled') { active.get(m.params?.requestId)?.abort(); return; }
  if (m.id === undefined) return;
  let result;
  try {
    if (m.method === 'initialize') {
      clientCapabilities = m.params?.capabilities ?? {};
      result = { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stella-relay', version: '0.3.0' }, instructions: '所有提问先使用 Codex 原生表单。先运行 test_desktop_form 验证客户端；不支持表单时用电脑原有提问工具，不能退化成只靠 QQ。不要用本服务批准沙箱或系统权限请求。' };
    } else if (m.method === 'ping') result = {};
    else if (m.method === 'tools/list') result = { tools };
    else if (m.method === 'tools/call') {
      const controller = new AbortController(); active.set(m.id, controller);
      try {
        if (!['test_desktop_form', 'ask_on_desktop'].includes(m.params?.name)) throw Error('未知工具');
        if (m.params.name === 'ask_on_desktop' && !desktopVerified) throw Error('先运行 test_desktop_form 并在电脑提交一次，才能启用 QQ 副本。');
        const input = m.params.arguments ?? {};
        if (Object.keys(input).some(k => !['question', 'choices', 'context'].includes(k))) throw Error('不允许更改账号或接收人');
        const mobile = m.params.name === 'ask_on_desktop' ? { open: q => { qq ??= new IsolatedQQ(); return qq.open(q); } } : null;
        const answer = await coordinate({ input, desktop, mobile, signal: controller.signal });
        if (m.params.name === 'test_desktop_form' && answer.source === 'desktop' && answer.answer) desktopVerified = true;
        result = { content: [{ type: 'text', text: JSON.stringify(answer) }] };
      } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
      finally { active.delete(m.id); }
    } else { send({ id: m.id, error: { code: -32601, message: 'Method not found' } }); return; }
    send({ id: m.id, result });
  } catch { send({ id: m.id, error: { code: -32603, message: 'Internal error' } }); }
}
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => { if (line.length > 100000) return; try { void handle(JSON.parse(line)); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); } });
input.on('close', () => { for (const c of active.values()) c.abort(); qq?.close(); });
