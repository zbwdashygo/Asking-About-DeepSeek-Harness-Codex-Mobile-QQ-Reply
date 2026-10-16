import { readFileSync } from 'node:fs';
import { IsolatedQQ } from '../bridge/onebot.mjs';
import { normalizeMobileAnswer } from '../bridge/coordinator.mjs';
import { validateQuestion } from '../bridge/coordinator.mjs';

export const name = 'stella-relay-dsh';
export const inject = ['tools', 'userQuestions'];

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
  const mobile = new IsolatedQQ({ config: relayConfig });
  ctx.on('dispose', () => mobile.close());
  registerTools(ctx, mobile);
}

// The public registry accepts JSON-schema definitions directly. Avoid loading
// another copy of the host SDK through a profile's module-resolution map.
export function relayToolDefinition(options) {
  return { ...options, parameters: {
    type: 'object', properties: {
      question: { type: 'string', minLength: 1, maxLength: 10000 },
      choices: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 200 } },
      context: { type: 'string', maxLength: 500 }
    }, required: ['question'], additionalProperties: false
  }, output: { ...options.output, schema: { type: 'object', properties: {
    answers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, selected: { type: 'array', items: { type: 'string' } }, custom: { type: 'string' } }, required: ['id', 'selected'], additionalProperties: false } }
  }, required: ['answers'], additionalProperties: false } } };
}

export function registerTools(ctx, mobile, defineTool = relayToolDefinition) {
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
      if (test) verified = true;
      return result;
    }
  }));
}
