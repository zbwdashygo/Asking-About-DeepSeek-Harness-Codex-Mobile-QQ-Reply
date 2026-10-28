import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopToolsClient } from '../app/bridge/native-app.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, MAX_FILE_BYTES } from '../app/bridge/files.mjs';
test('文件上传超过大小限制时不联系 QQ',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stella-large-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const cwd=join(dir,'project');mkdirSync(cwd);const source=join(cwd,'大文件.pdf');writeFileSync(source,'x');truncateSync(source,MAX_FILE_BYTES+1);let called=false;await assert.rejects(new FileStore(join(dir,'relay.json')).send({connect(){called=true;}},{transferId:'large',filePath:source},cwd),/100 MB/);assert.equal(called,false);
});
test('Codex 附件复制到目标真实 cwd 后重新核对会话并发送，忙碌不复制',async()=>{
 const client=new DesktopToolsClient({callerThreadId:'fixture-caller',serverPath:fileURLToPath(new URL('./native-fixture.mjs',import.meta.url)),env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:'test-only'}});let staged=0,read=0;
 const row={id:'fixture-thread',cwd:'actual-workspace',status:'idle'};client.list=async()=>{read++;return[row];};
 try{const result=await client.sendFile(row,'1','总结', {async stage(id,cwd){assert.equal(id,'1');assert.equal(cwd,'actual-workspace');staged++;return {name:'报告.pptx',path:'actual-workspace/.stella-inbox/1/报告.pptx'};}});assert.equal(staged,1);assert.equal(read,2);assert.match(result.prompt,/本地附件：actual-workspace/);row.status='active';await assert.rejects(client.sendFile(row,'1','',{}),/还在忙/);assert.equal(staged,1);}finally{client.close();}
});
