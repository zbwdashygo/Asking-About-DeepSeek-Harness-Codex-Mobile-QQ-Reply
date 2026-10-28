import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
export function questionPolicy(configFile) {
  if (!configFile || !existsSync(configFile + '.question-policy.json')) return { mobileRequired: false, document: false };
  const value = JSON.parse(readFileSync(configFile + '.question-policy.json', 'utf8'));
  if (typeof value.mobileRequired !== 'boolean' || typeof value.document !== 'boolean') throw Error('问答方式设置无效，请在 Stella 重新保存');
  return { mobileRequired: value.mobileRequired, document: value.document };
}
export function writeQuestionDocument(configFile, item) {
  if (!configFile || !/^[1-9]\d{0,8}$/.test(item.id)) throw Error('缺少独立问题文档目录');
  const root = join(dirname(configFile), 'question-documents'); mkdirSync(root, { recursive: true });
  const filePath = join(root, 'Stella-question-' + item.id + '.txt');
  const text = `Stella · 问题 ${item.id}\r\n\r\n${item.context ? item.context + '\r\n\r\n' : ''}${item.text.replace(/\r?\n/g, '\r\n')}\r\n\r\n在手机 QQ 回复：${item.id} 你的回答\r\n有效期至：${new Date(item.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）\r\n只采用第一次有效答复；系统权限仍在电脑处理。\r\n`;
  writeFileSync(filePath, '\uFEFF' + text, { flag: 'wx', mode: 0o600 });
  return { root, filePath, transferId: 'question-document-' + item.id };
}
