import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DesktopToolsClient } from '../app/bridge/native-app.mjs';
test('Codex 通过原生桌面工具列出并发送，过滤其他来源，不注入权限模式',async()=>{
  const client=new DesktopToolsClient({callerThreadId:'fixture-caller',serverPath:fileURLToPath(new URL('./native-fixture.mjs',import.meta.url)),env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:'test-only'}});
  try { const rows=await client.list(); assert.equal(rows.length,1); const result=await client.send(rows[0],'literal `prompt` $()'); assert.equal(result.prompt,'literal `prompt` $()'); await assert.rejects(client.call('set_permissions',{}),/只允许/); }
  finally{client.close();}
});
test('没有桌面连接上下文时拒绝启动，不能降级成独立执行器',()=>{
  assert.throws(()=>new DesktopToolsClient({callerThreadId:'fixture',serverPath:'unused',env:{}}),/未提供/);
});
