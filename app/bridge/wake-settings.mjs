import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findDesktopTools } from './native-app.mjs';
export function settingsFile(configFile, platform) { return configFile + `.mobile-${platform}.json`; }
export function readSettings(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { enabled: false }; }
export function saveSettings(file, value) {
  mkdirSync(dirname(file), { recursive: true }); const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, file);
}
export function bindDesktop(configFile, { enabled, callerThreadId } = {}) {
  const file = settingsFile(configFile, 'codex'), value = readSettings(file);
  if (enabled !== undefined) value.enabled = enabled;
  if (callerThreadId) value.callerThreadId = callerThreadId;
  if (value.enabled) {
    if (!value.callerThreadId || (!process.env.CODEX_APP_TOOLS_PIPE_PATH && !value.pipe)) throw Error('请在 Codex 桌面对话中启用手机唤醒');
    // Some Codex MCP processes do not receive the desktop pipe environment.
    // Preserve an existing authorized binding; the backend validates recovery.
    value.pipe = process.env.CODEX_APP_TOOLS_PIPE_PATH || value.pipe; value.serverPath = findDesktopTools();
  }
  saveSettings(file, value);
  return { enabled: value.enabled, requiresBackground: true, requiresDesktopOpen: true };
}
