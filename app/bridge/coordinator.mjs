// The desktop request is created first. Whichever side finishes first wins.
export function validateQuestion(input) {
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 10000) throw Error('问题长度必须为 1–10000 字符');
  if (input.context !== undefined && (typeof input.context !== 'string' || input.context.length > 500)) throw Error('上下文过长');
  if (input.choices !== undefined && (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 6 || input.choices.some(v => typeof v !== 'string' || !v.trim() || v.length > 200) || new Set(input.choices).size !== input.choices.length)) throw Error('选项须为 2–6 个不同的非空文本');
  return { question: input.question, context: input.context ?? '', choices: input.choices };
}
export function normalizeAnswer(answer, choices) {
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 12000) return null;
  const value = answer.trim();
  if (!choices) return value;
  if (choices.includes(value)) return value;
  if (/^[1-6]$/.test(value)) return choices[Number(value) - 1] ?? null;
  return null;
}
// Desktop enums are strict. QQ may contain a clarification in the user's own
// words even when the desktop offers choices; never silently discard it.
export function normalizeMobileAnswer(answer, choices) {
  const value = normalizeAnswer(answer);
  if (value === null) return null;
  if (choices && /^[0-9]+$/.test(value)) return normalizeAnswer(value, choices);
  return normalizeAnswer(value, choices) ?? value;
}
export function coordinate({ input, desktop, mobile, mirrorDelayMs = 1000, timeoutMs = 480000, signal }) {
  const question = validateQuestion(input);
  const native = desktop.request(question); // Throws before QQ is contacted if unsupported.
  return new Promise((resolve, reject) => {
    let done = false, remote, mirrorTimer, timeoutTimer, qqWarning;
    const cleanup = (source) => {
      clearTimeout(mirrorTimer); clearTimeout(timeoutTimer); signal?.removeEventListener('abort', abort);
      if (source !== 'desktop') native.cancel('此提问已在其他端完成或取消');
      if (source !== 'qq') remote?.cancel();
    };
    const finish = (source, value, error) => {
      if (done) return; done = true; cleanup(source);
      if (error) reject(error); else resolve({ source, ...value, ...(qqWarning ? { qqWarning } : {}) });
    };
    const abort = () => finish('cancelled', null, Error('当前提问已被客户端取消'));
    native.promise.then(result => {
      if (result?.action !== 'accept') return finish('desktop', { cancelled: true });
      const answer = normalizeAnswer(result.content?.answer, question.choices);
      if (answer === null) return finish('desktop', null, Error('电脑表单返回的回答不符合问题格式'));
      finish('desktop', { answer });
    }, error => finish('desktop', null, error));
    if (mobile) mirrorTimer = setTimeout(async () => {
      try {
        const handle = await mobile.open(question);
        if (done) { handle.cancel(); return; }
        remote = handle;
        handle.promise.then(answer => {
          const normalized = normalizeMobileAnswer(answer, question.choices);
          if (normalized !== null) finish('qq', { answer: normalized });
        }, error => { qqWarning = error?.message ?? 'QQ 连接失效'; });
      } catch (error) { qqWarning = error?.message ?? 'QQ 副本发送失败'; }
    }, mirrorDelayMs);
    timeoutTimer = setTimeout(() => finish('timeout', null, Error('提问超时，请在电脑重新提问')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
