import { writeFileSync } from 'node:fs';
import { configPath } from './config.mjs';
import { IsolatedQQ } from './onebot.mjs';
import { FileStore } from './files.mjs';
import { WakeState } from './wake.mjs';
import { MobileFiles } from './file-receiver.mjs';
const file = configPath(), mobile = new IsolatedQQ(), store = new FileStore(file);
const service = new MobileFiles({ mobile, store, lease: new WakeState(file + '.file-receiver-ledger.json') });
const parent = Number(process.env.STELLA_WAKE_PARENT_PID || process.ppid); let busy = false, stopping = false;
async function reconcile() {
  if (busy || stopping) return; busy = true;
  try {
    try { process.kill(parent, 0); } catch (e) { if (e.code === 'ESRCH') { stop(); process.exit(0); } throw e; }
    if (!service.running) { await service.start(); writeFileSync(file + '.file-receiver-status.json', JSON.stringify({ running: true, at: Date.now() }), { mode: 0o600 }); }
  } catch (error) { service.stop(); try { writeFileSync(file + '.file-receiver-status.json', JSON.stringify({ running: false, error: String(error.message).slice(0,200), at: Date.now() }), { mode: 0o600 }); } catch {} }
  finally { busy = false; }
}
const timer = setInterval(() => void reconcile(), 3000); await reconcile();
function stop() { stopping = true; clearInterval(timer); service.stop(); mobile.close(); }
process.on('SIGTERM', () => { stop(); process.exit(0); }); process.on('SIGINT', () => { stop(); process.exit(0); });
