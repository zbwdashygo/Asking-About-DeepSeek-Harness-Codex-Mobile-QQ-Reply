export const completionSchema = {
  type: 'object', properties: {
    taskId: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 2000 }
  }, required: ['taskId', 'summary'], additionalProperties: false
};

export function validateCompletion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['taskId', 'summary'].includes(k))) throw Error('完成通知只接受任务编号与完成摘要，不能更改接收人');
  const { taskId, summary } = input;
  if (typeof taskId !== 'string' || !taskId.trim() || taskId.length > 120 || /[\r\n\x00-\x1f]/.test(taskId)) throw Error('无效任务编号');
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 2000) throw Error('完成摘要须为 1–2000 字符');
  return { taskId: taskId.trim(), summary: summary.trim() };
}
