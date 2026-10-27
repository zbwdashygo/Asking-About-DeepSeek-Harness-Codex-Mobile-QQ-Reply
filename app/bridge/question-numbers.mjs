import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
let memoryNumber = 0;
export function nextMemoryNumber() { return String(++memoryNumber); }
export async function allocateQuestionNumber(file) {
  mkdirSync(dirname(file), { recursive: true });
  const lock = file + '.lock', nonce = randomUUID(), end = Date.now() + 3000; let fd;
  while (fd === undefined) {
    try { fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce })); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner; try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { await delay(20); }
      if (owner) {
        if (!Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== 'string') throw Error('问题编号记录异常，请先在电脑检查');
        try { process.kill(owner.pid, 0); }
        catch (alive) { if (alive.code === 'ESRCH') { try { if (JSON.parse(readFileSync(lock, 'utf8')).nonce === owner.nonce) unlinkSync(lock); } catch {} } }
      }
      if (Date.now() >= end) throw Error('问题编号暂时忙，请稍后再试');
      await delay(20);
    }
  }
  try {
    const last = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).last : 0;
    if (!Number.isSafeInteger(last) || last < 0 || last >= 999999999) throw Error('问题编号记录异常，请先在电脑检查');
    const temporary = file + '.' + nonce + '.tmp';
    writeFileSync(temporary, JSON.stringify({ last: last + 1 }), { mode: 0o600 }); renameSync(temporary, file);
    return String(last + 1);
  } finally {
    closeSync(fd);
    try { if (JSON.parse(readFileSync(lock, 'utf8')).nonce === nonce) unlinkSync(lock); } catch {}
  }
}
