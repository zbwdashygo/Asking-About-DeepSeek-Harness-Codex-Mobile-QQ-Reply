import { readSettings, saveSettings, settingsFile } from './wake-settings.mjs';
import { configPath, loadConfig } from './config.mjs';
import { IsolatedQQ } from './onebot.mjs';
import { DesktopToolsClient } from './native-app.mjs';
import { MobileWake, WakeState } from './wake.mjs';
const configFile = configPath(), config = loadConfig(), parentPid = process.argv.includes('--standalone') ? 0 : Number(process.env.STELLA_WAKE_PARENT_PID || process.ppid);
let service, mobile, fingerprint, busy = false, stopping = false;
async function reconcile() {
  if (busy || stopping) return; busy = true;
  try {
    if (parentPid > 0) { try { process.kill(parentPid, 0); } catch (error) { if (error.code === 'ESRCH') { stop(); process.exit(0); } } }
    const settings = readSettings(settingsFile(configFile, 'codex'));
    const next = settings.enabled && settings.pipe && settings.callerThreadId && settings.serverPath ? JSON.stringify(settings) : null;
    if (next === fingerprint) return;
    service?.stop(); mobile?.close(); service = mobile = undefined; fingerprint = null;
    if (!next) return;
    const state = new WakeState(configFile + '.codex-wake-ledger.json'); state.data.enabled = true;
    const backend = new DesktopToolsClient({ callerThreadId: settings.callerThreadId, serverPath: settings.serverPath, env: { ...process.env, CODEX_APP_TOOLS_PIPE_PATH: settings.pipe, CODEX_APP_TOOLS_CALLER_HOST_ID: 'local' }, onRecovered({ previousPipe, pipe, serverPath }) {
      const file = settingsFile(configFile, 'codex'), current = readSettings(file);
      if (!current.enabled || current.callerThreadId !== settings.callerThreadId || current.pipe !== previousPipe) throw Error('手机唤醒配置已改变，请重新发一条列表指令');
      const updated = { ...current, pipe, serverPath }; saveSettings(file, updated);
      fingerprint = JSON.stringify(updated);
    } });
    mobile = new IsolatedQQ({ config, configFile }); service = new MobileWake({ platform: 'codex', mobile, backend, state });
    await service.start(); fingerprint = next;
  } catch { service?.stop(); mobile?.close(); service = mobile = undefined; fingerprint = null; }
  finally { busy = false; }
}
const interval = setInterval(() => void reconcile(), 3000); await reconcile();
function stop() { stopping = true; clearInterval(interval); service?.stop(); mobile?.close(); }
process.on('SIGTERM', () => { stop(); process.exit(0); }); process.on('SIGINT', () => { stop(); process.exit(0); });
