import { randomUUID } from 'node:crypto';
import { MobileWake, WakeState } from './wake.mjs';
import { readSettings, saveSettings, settingsFile } from './wake-settings.mjs';

export class DshWakeBackend {
  constructor(ctx) { this.ctx = ctx; this.titles = new Map(); }
  async list() {
    const ctx = this.ctx, archived = new Set(ctx.workspaceRegistry.archivedSessionIds ?? []);
    const snapshots = await ctx.sessionPersistence.list();
    const roots = new Map(ctx.agents.roots().map(agent => [agent.id, agent]));
    const headers = snapshots.map(s => s.header).filter(h => h?.id && h.origin !== 'subagent' && !h.delegationDepth && !archived.has(h.id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    const rows = [];
    for (const header of headers) {
      const live = roots.get(header.id);
      let title = live && ctx.sessionTitle?.get(live.session)?.title;
      if (!title) title = this.titles.get(header.id);
      if (!title) {
        let handle;
        try {
          handle = await ctx.sessionPersistence.open(header.id, 'read');
          const { events } = await handle.read(0, 32);
          title = events.findLast(e => e.type === 'session/title')?.data?.title;
          if (title) this.titles.set(header.id, title);
        } finally { await handle?.close(); }
      }
      rows.push({ id: header.id, title: title || `${header.cwd ?? 'DSH'} · ${header.id}`, status: live?.status ?? 'notLoaded' });
    }
    return rows;
  }
  async send(row, prompt) {
    const ctx = this.ctx;
    if (ctx.workspaceRegistry.archivedSessionIds.includes(row.id)) throw Error('该对话已归档');
    let agent = ctx.agents.roots().find(a => a.id === row.id);
    if (!agent) {
      // The desktop controller restores the selected model, agent preset and
      // scoped capabilities. Bare agents.resume() omits this composition.
      const resolved = await ctx.sessionController.resolveAgent(row.id);
      if (resolved.error) throw resolved.error;
      agent = resolved.agent;
    }
    if (!ctx.agents.roots().includes(agent) || agent.status !== 'idle') throw Error('该对话不是空闲的根对话，未发送');
    agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
    return { accepted: true };
  }
}
export function dshMobileWake(ctx, mobile, configFile) {
  const file = settingsFile(configFile, 'dsh'); let service, busy = false, closing = false, lastError;
  async function reconcile() {
    if (busy || closing) return; busy = true;
    try {
      const enabled = readSettings(file).enabled === true;
      if (enabled && !service) {
        const state = new WakeState(configFile + '.dsh-wake-ledger.json'); state.data.enabled = true;
        service = new MobileWake({ platform: 'dsh', mobile, backend: new DshWakeBackend(ctx), state });
        await service.start();
      } else if (!enabled && service) { service.stop(); service = undefined; }
    } catch (error) { lastError = error.message; service?.stop(); service = undefined; }
    finally { busy = false; }
  }
  const interval = setInterval(() => void reconcile(), 3000); interval.unref?.();
  ctx.on('dispose', () => { closing = true; clearInterval(interval); service?.stop(); });
  void reconcile();
  return async enabled => { saveSettings(file, { ...readSettings(file), enabled }); await reconcile(); if (enabled && !service?.running) throw Error(lastError || '手机唤醒尚未就绪'); return { enabled, running: Boolean(service?.running), requiresDshOpen: true }; };
}
