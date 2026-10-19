import { readFileSync } from 'node:fs';
export function validateConfig(c) {
  if (!c || !/^[1-9][0-9]{4,11}$/.test(c.botId) || !/^[1-9][0-9]{4,11}$/.test(c.contactId) || c.botId === c.contactId ||
      !Number.isInteger(c.onebotPort) || c.onebotPort < 1024 || c.onebotPort > 65535 || !/^[a-f0-9]{64}$/.test(c.token)) throw Error('请在 Stella Relay 中保存有效的小号、大号及独立连接配置');
  return c;
}
export function configPath() {
  const index = process.argv.indexOf('--config');
  const file = index >= 0 ? process.argv[index + 1] : process.env.STELLA_RELAY_CONFIG;
  if (!file) throw Error('未指定 Stella Relay 配置，请从程序连接 Codex 项目');
  return file;
}
export function loadConfig() { return validateConfig(JSON.parse(readFileSync(configPath(), 'utf8'))); }
