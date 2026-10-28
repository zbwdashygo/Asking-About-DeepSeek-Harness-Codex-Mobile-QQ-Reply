import { readFileSync } from 'node:fs';
import { IsolatedQQ } from '../bridge/onebot.mjs';
import { normalizeMobileAnswer } from '../bridge/coordinator.mjs';
import { validateQuestion } from '../bridge/coordinator.mjs';
import { validateCompletion } from '../bridge/completion.mjs';
import { dshMobileWake } from '../bridge/dsh-wake.mjs';
import { FileStore, fileSchema } from '../bridge/files.mjs';

export const name = 'stella-relay-dsh';
export const inject = ['tools', 'userQuestions', 'agents', 'sessionPersistence', 'workspaceRegistry', 'sessionTitle', 'sessionController'];

// The relay tool calls the host's native question service with its live caller.
// Existing question/permission handlers are never intercepted or replaced.
export async function relayRequest(request, next, mobile, { mirrorDelayMs = 1000 } = {}) {
  if (!request.agent || !Array.isArray(request.questions) || !request.questions.length || request.questions.some(q => q.intent)) return next(request);
  const originalSignal = request.signal;
  if (originalSignal?.aborted) return next(request);
  const local = new AbortController();
  const desktopRequest = { ...request, signal: originalSignal ? AbortSignal.any([originalSignal, local.signal]) : local.signal };
  const handles = []; let timer, settled = false;
  try {
    const desktop = Promise.resolve(next(desktopRequest)); // Invoke the real native answerer first.
    const phone = new Promise(resolve => {
      timer = setTimeout(async () => {
        try {
          const answers = await Promise.all(request.questions.map(async q => {
            const choices = q.options?.map(v => v.label);
            const handle = await mobile.open({ question: q.question + (q.detail ? '\n' + q.detail : ''), context: 'DeepSeek Harness 普通提问', choices });
            handles.push(handle); if (settled) { handle.cancel(); return null; }
            const answer = normalizeMobileAnswer(await handle.promise, choices);
            if (answer === null) return null;
            return { id: q.id, selected: choices?.includes(answer) ? [answer] : [], ...(choices?.includes(answer) ? {} : { custom: answer }) };
          }));
          if (!settled && answers.every(Boolean)) resolve({ source: 'qq', answer: { answers } });
        } catch { /* QQ failure leaves the original desktop answerer usable. */ }
      }, mirrorDelayMs);
    });
    const result = await Promise.race([desktop.then(answer => ({ source: 'desktop', answer })), phone]);
    settled = true;
    if (result.source === 'qq') local.abort(Error('此问题已由 QQ 回答'));
    return result.answer;
  } finally {
    settled = true; clearTimeout(timer); for (const handle of handles) handle.cancel();
  }
}

export async function apply(ctx, config = {}) {
  const location = config.configFile ?? JSON.parse(readFileSync(new URL('./relay-location.json', import.meta.url), 'utf8')).configFile;
  const relayConfig = JSON.parse(readFileSync(location, 'utf8'));
  const mobile = new IsolatedQQ({ config: relayConfig, configFile: location });
  ctx.on('dispose', () => mobile.close());
  const configure = dshMobileWake(ctx, mobile, location);
  ctx.tools.register({ name: 'stella_configure_mobile_wake', description: '按用户要求启用或关闭手机 QQ 主动唤醒 DSH 对话。发送“列表 dsh”查看编号，再发送“唤醒 dsh 编号 任务内容”；保留原生审批，忙碌对话不自动打断。DSH 需保持运行。', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false }, timeoutMs: 30000, output: { schema: { type: 'object', properties: { enabled: { type: 'boolean' }, running: { type: 'boolean' }, requiresDshOpen: { type: 'boolean' } }, required: ['enabled', 'running', 'requiresDshOpen'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute(args) { if (!args || typeof args.enabled !== 'boolean' || Object.keys(args).some(k => k !== 'enabled')) throw Error('仅接受 enabled 开关'); return configure(args.enabled); } });
  registerFileTools(ctx, mobile, location);
  registerTools(ctx, mobile);
}

// The public registry accepts JSON-schema definitions directly. Avoid loading
// another copy of the host SDK through a profile's module-resolution map.
export function relayToolDefinition(options) {
  return { ...options, parameters: {
    type: 'object', properties: {
      question: { type: 'string', description: '需要用户回答的问题，1–10000 字符' },
      choices: { type: 'array', items: { type: 'string' }, description: '可选的 2–6 个选项，每项最多 200 字符' },
      context: { type: 'string', description: '背景说明，最多 500 字符' }
    }, required: ['question'], additionalProperties: false
  }, output: { ...options.output, schema: { type: 'object', properties: {
    answers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, selected: { type: 'array', items: { type: 'string' } }, custom: { type: 'string' } }, required: ['id', 'selected'], additionalProperties: false } }
  }, required: ['answers'], additionalProperties: false } } };
}

export function registerTools(ctx, mobile, defineTool = relayToolDefinition) {
  ctx.tools.register({
    name: 'stella_notify_completion',
    description: '用户要求工作完成后发送 QQ 通知时调用。仅在实际完成后发送一次简短结果或下载链接给已配置唯一联系人，不提问、不等待回复，不发送日常进度。失败如实报告，不自动重发。',
    parameters: { type: 'object', properties: { taskId: { type: 'string', description: '本次工作的唯一编号，1–120 字符' }, summary: { type: 'string', description: '完成摘要，1–2000 字符' } }, required: ['taskId', 'summary'], additionalProperties: false }, timeoutMs: 30000,
    output: { schema: { type: 'object', properties: { sent: { type: 'boolean' }, taskId: { type: 'string' }, messageId: { type: 'string' } }, required: ['sent', 'taskId', 'messageId'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => mobile.sendCompletion(validateCompletion(args))
  });
  let verified = false;
  for (const test of [true, false]) ctx.tools.register(defineTool({
    name: test ? 'stella_test_desktop_form' : 'stella_ask_on_desktop',
    description: test ? '验证 DSH 原生电脑提问卡片，请先在电脑提交一次。' : '普通澄清与方案选择：先显示 DSH 原生电脑卡片，一秒后发 QQ 副本。手机按编号回复自由文字或选项数字。不能代替系统权限审批。',
    parameters: {
      question: { type: 'string', required: true, description: '需要用户回答的问题' },
      choices: { type: 'array', items: { type: 'string' }, description: '可选的 2–6 个选项' },
      context: { type: 'string', description: '简短背景' }
    },
    timeoutMs: 600000,
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!test && !verified) throw Error('请先调用 stella_test_desktop_form，并在电脑真实提交一次');
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !['question', 'choices', 'context'].includes(k))) throw Error('无效提问参数');
      const input = validateQuestion(args);
      const request = { agent: exec.agent, signal: exec.signal, wait: { callId: exec.callId }, questions: [{ id: 'answer', question: input.question, ...(input.context ? { detail: input.context } : {}), ...(input.choices ? { options: input.choices.map(label => ({ label })) } : {}) }] };
      const result = test ? await ctx.userQuestions.ask(request) : await relayRequest(request, native => ctx.userQuestions.ask(native), mobile);
      // A skipped or empty native card is not proof that the user answered it.
      if (test) verified = Boolean(result?.answers?.some(answer => answer.id === 'answer' && (answer.selected?.length || (typeof answer.custom === 'string' && answer.custom.trim()))));
      return result;
    }
  }));
}

export function registerFileTools(ctx, mobile, configFile) {
  const store = new FileStore(configFile);
  const receiptSchema = { type: 'object', properties: { sent: { type: 'boolean' }, transferId: { type: 'string' }, fileName: { type: 'string' }, bytes: { type: 'number' }, remoteId: { type: 'string' } }, required: ['sent', 'transferId', 'fileName', 'bytes', 'remoteId'], additionalProperties: false };
  ctx.tools.register({ name: 'stella_send_file_to_mobile', description: '按用户要求把当前 DSH 工作目录的图片、PPT、Word、Excel、PDF 等文件发送给手机 QQ 唯一好友。每次使用唯一 transferId，失败不自动重发。', parameters: { type: 'object', properties: { transferId: { type: 'string' }, filePath: { type: 'string' } }, required: ['transferId', 'filePath'], additionalProperties: false }, timeoutMs: 90000, output: { schema: receiptSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, async execute(args, exec) {
    if (!exec?.agent?.session?.header?.cwd) throw Error('没有当前 DSH 对话的工作目录');
    if (args && Object.keys(args).some(k => !['transferId','filePath'].includes(k))) throw Error('只能发送当前对话的文件');
    return store.send(mobile, args, exec.agent.session.header.cwd);
  } });
  ctx.tools.register({ name: 'stella_list_mobile_files', description: '查看手机 QQ 发来的最近 10 个附件；使用文件编号和对话代号指定交给哪个对话。', parameters: { type: 'object', properties: {}, additionalProperties: false }, timeoutMs: 10000, output: { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, size: { type: 'number' }, receivedAt: { type: 'number' } }, required: ['id','name','size','receivedAt'], additionalProperties: false } } }, required: ['files'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute(args) { if (args && Object.keys(args).length) throw Error('收件箱不接受其他参数'); return { files: store.list() }; } });
}
