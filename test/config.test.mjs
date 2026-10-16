import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../app/bridge/config.mjs';
test('任意使用者自己的不同 QQ 号可配置，令牌和端口须有效', () => {
  const config = { botId: '5555555555', contactId: '6666666666', onebotPort: 29871, token: 'f'.repeat(64) };
  assert.equal(validateConfig(config), config);
  for (const patch of [{ botId: '../file' }, { contactId: config.botId }, { onebotPort: 0 }, { token: 'bad' }]) assert.throws(() => validateConfig({ ...config, ...patch }));
});
