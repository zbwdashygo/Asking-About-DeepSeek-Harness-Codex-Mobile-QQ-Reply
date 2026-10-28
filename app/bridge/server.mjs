import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { coordinate } from './coordinator.mjs';
import { IsolatedQQ } from './onebot.mjs';
import { completionSchema } from './completion.mjs';
import { FileStore, fileSchema } from './files.mjs';
import { DesktopToolsClient } from './native-app.mjs';
import { configPath } from './config.mjs';
import { bindDesktop, readSettings, settingsFile } from './wake-settings.mjs';
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
  { name: 'send_file_to_mobile', description: '用户要求把当前工作目录的图片、PPT、Word、Excel、PDF 或其他常见文档发到手机 QQ 时调用。仅发送给已配置唯一好友；每次使用唯一 transferId，状态未知时不重试。请传当前实际对话 threadId（若客户端未提供调用方元数据）；不允许发送账号资料或工作目录外文件。', inputSchema: fileSchema, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'list_mobile_files', description: '查看手机 QQ 发来的最近 10 个附件的文件编号、名称与大小。用户发“文件 codex AA 文件编号 要求”后，附件才会交给指定对话。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'configure_mobile_wake', description: '用户明确要求手机主动发起任务时启用，或按用户要求关闭。仅使用独立小号与唯一联系人；后台及 Codex 桌面需保持运行。手机可发送“列表 codex”和“唤醒 codex 对话编号 任务内容”；运行中的对话不自动打断，系统审批仍留在电脑。', inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'notify_completion', description: '用户要求工作完成后发送一次 QQ 通知时调用。仅在实际完成后发送简短结果或下载链接到已配置唯一联系人，不提问、不等待手机回复，不转发日常进度。相同任务编号在当前连接内只发送一次；接口失败如实报告，不自动重试。', inputSchema: completionSchema, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
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
      result = { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stella-relay', version: '0.4.0-beta.3' }, instructions: '所有提问先使用 Codex 原生表单。先运行 test_desktop_form 验证客户端；不支持表单时用电脑原有提问工具，不能退化成只靠 QQ。不要用本服务批准沙箱或系统权限请求。' };
    } else if (m.method === 'ping') result = {};
    else if (m.method === 'tools/list') result = { tools };
    else if (m.method === 'tools/call') {
      const controller = new AbortController(); active.set(m.id, controller);
      try {
        if (!['test_desktop_form', 'ask_on_desktop', 'notify_completion', 'configure_mobile_wake', 'send_file_to_mobile', 'list_mobile_files'].includes(m.params?.name)) throw Error('未知工具');
        if (m.params.name === 'send_file_to_mobile' || m.params.name === 'list_mobile_files') {
          const args = m.params.arguments ?? {}, store = new FileStore(configPath());
          let value;
          if (m.params.name === 'list_mobile_files') {
            if (Object.keys(args).length) throw Error('收件箱不接受其他参数');
            value = { files: store.list() };
          } else {
            const meta = m.params._meta ?? {}, actualCaller = meta['openai/threadId'] ?? meta['openai/thread_id'] ?? process.env.CODEX_THREAD_ID;
            if (actualCaller && args.threadId && args.threadId !== actualCaller) throw Error('文件只能从当前对话发送');
            const callerThreadId = actualCaller ?? args.threadId;
            if (!callerThreadId) throw Error('请提供当前 Codex 对话的 threadId');
            const settings = readSettings(settingsFile(configPath(), 'codex'));
            const client = new DesktopToolsClient({ callerThreadId, serverPath: settings.serverPath, env: { ...process.env, CODEX_APP_TOOLS_PIPE_PATH: process.env.CODEX_APP_TOOLS_PIPE_PATH || settings.pipe, CODEX_APP_TOOLS_CALLER_HOST_ID: 'local' } });
            try {
              const current = (await client.list()).find(row => row.id === callerThreadId);
              if (!current?.cwd) throw Error('当前对话没有可用的本机工作目录');
              qq ??= new IsolatedQQ(); value = await store.send(qq, args, current.cwd);
            } finally { client.close(); }
          }
          send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }); return;
        }
        if (m.params.name === 'configure_mobile_wake') {
          const args = m.params.arguments;
          if (!args || typeof args.enabled !== 'boolean' || Object.keys(args).some(k => k !== 'enabled')) throw Error('仅接受 enabled 开关');
          const meta = m.params._meta ?? {};
          const callerThreadId = meta['openai/threadId'] ?? meta['openai/thread_id'] ?? process.env.CODEX_THREAD_ID;
          const status = bindDesktop(configPath(), { enabled: args.enabled, callerThreadId });
          send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(status) }] } }); return;
        }
        if (m.params.name === 'notify_completion') {
          qq ??= new IsolatedQQ();
          const receipt = await qq.sendCompletion(m.params.arguments);
          result = { content: [{ type: 'text', text: JSON.stringify(receipt) }] };
          send({ id: m.id, result }); return;
        }
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
try { if (readSettings(settingsFile(configPath(), 'codex')).enabled) bindDesktop(configPath(), { callerThreadId: process.env.CODEX_THREAD_ID }); } catch { /* The explicit enable tool reports setup errors. */ }
