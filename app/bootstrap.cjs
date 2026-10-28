const path = require('node:path');
const fs = require('node:fs');
const file = process.env.STELLA_RELAY_CONFIG;
if (!file || !path.isAbsolute(file)) throw Error('Missing isolated profile');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!/^[1-9][0-9]{4,11}$/.test(config.botId)) throw Error('Invalid dedicated account');
const profile = path.dirname(file);
process.env.STELLA_QQ_DATA_ROOT = path.join(profile, 'qq-data');
process.env.NAPCAT_DISABLE_PIPE = '1';
process.chdir(path.join(profile, 'runtime'));
const { spawn } = require('node:child_process');
const helpers = ['wake-daemon.mjs', 'file-daemon.mjs'].map(name => {
  const child = spawn(process.execPath, [path.join(__dirname, 'bridge', name)], { env: { ...process.env, STELLA_WAKE_PARENT_PID: String(process.pid) }, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); return child;
});
process.on('exit', () => { for (const child of helpers) child.kill(); });
require(path.join(profile, 'runtime', 'index.js'));
