import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopToolsClient } from '../app/bridge/native-app.mjs';
import { bindDesktop, saveSettings, readSettings, settingsFile } from '../app/bridge/wake-settings.mjs';
test('Codex 通过原生桌面工具列出并发送，过滤其他来源，不注入权限模式',async()=>{
  const client=new DesktopToolsClient({callerThreadId:'fixture-caller',serverPath:fileURLToPath(new URL('./native-fixture.mjs',import.meta.url)),env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:'test-only'}});
  try { const rows=await client.list(); assert.equal(rows.length,1); const result=await client.send(rows[0],'literal `prompt` $()'); assert.equal(result.prompt,'literal `prompt` $()'); await assert.rejects(client.call('set_permissions',{}),/只允许/); }
  finally{client.close();}
});
test('没有桌面连接上下文时拒绝启动，不能降级成独立执行器',()=>{
  assert.throws(()=>new DesktopToolsClient({callerThreadId:'fixture',serverPath:'unused',env:{}}),/未提供/);
});

function recoveryClient(extra={}) { return new DesktopToolsClient({callerThreadId:'fixture-caller',serverPath:fileURLToPath(new URL('./native-fixture.mjs',import.meta.url)),env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:'stale'},...extra}); }
test('旧桌面地址失效时只读核验唯一活动连接和原调用方，保存后恢复',async()=>{
  let binding; const client=recoveryClient({discover:()=>['foreign','live-one'],onRecovered:value=>{binding=value;}});
  try { const rows=await client.list();assert.equal(rows.length,2);assert.equal(binding.previousPipe,'stale');assert.equal(binding.pipe,'live-one');assert.equal(client.env.CODEX_APP_TOOLS_PIPE_PATH,'live-one');assert.equal((await client.list()).length,2); }
  finally {client.close();}
});
test('没有匹配调用方或多个匹配窗口时不自动选择桌面',async()=>{
  for(const pipes of [[],['foreign'],['live-one','live-two']]){
    let rebound=false;const client=recoveryClient({discover:()=>pipes,onRecovered:()=>{rebound=true;}});
    try {await assert.rejects(client.list(),/失效|多个/);assert.equal(rebound,false);assert.equal(client.env.CODEX_APP_TOOLS_PIPE_PATH,'stale');}
    finally{client.close();}
  }
});
test('发送任务期间断线不重试，不把不明状态的任务发第二次',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'stella-native-retry-')),log=join(dir,'calls.txt');let discoveries=0;
  const client=recoveryClient({env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:'live-one',STELLA_FIXTURE_SEND_FAIL:'1',STELLA_FIXTURE_LOG:log},discover:()=>{discoveries++;return ['live-two'];}});
  try {await assert.rejects(client.send({id:'fixture-thread'},'只发送一次'),/outcome unknown/);assert.equal(discoveries,0);assert.equal(readFileSync(log,'utf8').split('\n').filter(x=>x==='send_message_to_thread').length,1);}
  finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
test('关闭接收器期间发现连接不会重新启用或写入绑定',async()=>{
  let client;let rebound=false;client=recoveryClient({discover:()=>{client.close();return ['live-one'];},onRecovered:()=>{rebound=true;}});
  await assert.rejects(client.list(),/停止/);assert.equal(rebound,false);
});
test('MCP 未注入桌面地址时保留已有授权绑定，首次无绑定仍拒绝',()=>{
  const dir=mkdtempSync(join(tmpdir(),'stella-binding-')), config=join(dir,'relay.json');
  const oldPipe=process.env.CODEX_APP_TOOLS_PIPE_PATH,oldHome=process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME=dir;delete process.env.CODEX_APP_TOOLS_PIPE_PATH;
    const server=join(dir,'plugins/cache/openai-bundled/codex-app-tools/test/server.mjs');mkdirSync(join(server,'..'),{recursive:true});writeFileSync(server,'');
    assert.throws(()=>bindDesktop(config,{enabled:true,callerThreadId:'fixture-caller'}),/请在 Codex/);
    saveSettings(settingsFile(config,'codex'),{enabled:true,callerThreadId:'fixture-caller',pipe:'old-authorized',serverPath:server});
    assert.equal(bindDesktop(config,{enabled:true}).enabled,true);assert.equal(readSettings(settingsFile(config,'codex')).pipe,'old-authorized');
  } finally {
    if(oldPipe===undefined)delete process.env.CODEX_APP_TOOLS_PIPE_PATH;else process.env.CODEX_APP_TOOLS_PIPE_PATH=oldPipe;
    if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;
    rmSync(dir,{recursive:true,force:true});
  }
});
