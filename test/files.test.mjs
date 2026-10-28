import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, safeName, MAX_FILE_BYTES } from '../app/bridge/files.mjs';
import { MobileFiles } from '../app/bridge/file-receiver.mjs';
import { MobileWake, WakeState, parseWake } from '../app/bridge/wake.mjs';
import { registerFileTools } from '../app/dsh/adapter.mjs';
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'stella-files-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const profile=join(dir,'profile'),cwd=join(dir,'project');mkdirSync(profile);mkdirSync(cwd);
 const store=new FileStore(join(profile,'relay.json')),calls=[],texts=[];
 const mobile={config:{botId:'111111',contactId:'222222'},ready:true,async connect(){},onMessage(){return()=>{};},async call(action,args){calls.push({action,args});if(action==='get_file')return{file:join(profile,'download.pptx')};return {file_id:'42',message_id:42};},async sendText(s){texts.push(s);}};
 writeFileSync(join(profile,'download.pptx'),'sample-pptx');
 return{dir,profile,cwd,store,mobile,calls,texts};
}
function event(extra={}){return{post_type:'message',message_type:'private',sub_type:'friend',self_id:'111111',user_id:'222222',message_id:'file1',time:Date.now()/1000,message:[{type:'file',data:{file:'报告.pptx',file_id:'opaque-id',file_size:11}}],...extra};}
test('图片和常见办公文件名可用，路径逃逸、设备名、可执行文件不可用',()=>{
 for(const n of ['图.png','报告.pptx','表格.xlsx','说明.docx','文档.pdf','压缩.zip'])assert.equal(safeName(n),n);
 for(const n of ['../a.pptx','x\\a.pdf','CON.pptx','x.exe','a.pdf:evil','a\n.pdf','a\u202e.pdf'])assert.throws(()=>safeName(n));
});
test('PPT 文件和图片发给唯一好友，快照不改变原文件，重启后相同传输不重复',async t=>{
 const f=fixture(t),source=join(f.cwd,'展示.pptx');writeFileSync(source,'sample');
 const args={transferId:'send-ppt',filePath:source};assert.equal((await f.store.send(f.mobile,args,f.cwd)).sent,true);
 assert.equal(f.calls[0].action,'upload_private_file');assert.equal(f.calls[0].args.user_id,'222222');assert.equal(readFileSync(source,'utf8'),'sample');
 assert.equal((await new FileStore(join(f.profile,'relay.json')).send(f.mobile,args,f.cwd)).sent,true);assert.equal(f.calls.length,1);
 const image=join(f.cwd,'图.png');writeFileSync(image,'test-image');await f.store.send(f.mobile,{transferId:'image',filePath:image},f.cwd);assert.equal(f.calls[1].action,'send_private_msg');assert.equal(f.calls[1].args.message[0].type,'image');
});
test('不发目录外文件、账号资料、超大文件；超时未知不自动重试',async t=>{
 const f=fixture(t),outside=join(f.dir,'outside.docx');writeFileSync(outside,'sample');
 await assert.rejects(f.store.send(f.mobile,{transferId:'outside',filePath:outside},f.cwd),/工作目录/);
 const secret=join(f.cwd,'.ssh');mkdirSync(secret);writeFileSync(join(secret,'keys.txt'),'secret');await assert.rejects(f.store.send(f.mobile,{transferId:'secret',filePath:join(secret,'keys.txt')},f.cwd),/普通文件/);
 const source=join(f.cwd,'说明.pdf');writeFileSync(source,'sample');let sent=0;f.mobile.call=async()=>{sent++;throw Error('timeout');};
 const args={transferId:'timeout',filePath:source};await assert.rejects(f.store.send(f.mobile,args,f.cwd),/timeout/);await assert.rejects(f.store.send(f.mobile,args,f.cwd),/不会自动重发/);assert.equal(sent,1);
});
test('只接收唯一好友的近期附件，同一消息跨重启只收一次',async t=>{
 const f=fixture(t);
 for(const extra of [{user_id:'other'},{self_id:'other'},{message_type:'group'},{time:1}])assert.equal(await f.store.receive(f.mobile,event(extra)),false);
 assert.equal(await f.store.receive(f.mobile,event()),true);await new FileStore(join(f.profile,'relay.json')).receive(f.mobile,event());
 assert.equal(f.calls.length,1);assert.equal(f.store.list().length,1);assert.equal(f.store.list()[0].name,'报告.pptx');assert.match(f.texts[0],/文件编号 1/);
 const file=await f.store.stage('1',f.cwd);assert.equal(readFileSync(file.path,'utf8'),'sample-pptx');assert.equal(await f.store.stage('1',f.cwd).then(r=>r.path),file.path);
 writeFileSync(file.path,'changed');await assert.rejects(f.store.stage('1',f.cwd),/未覆盖/);
});
test('接收超大文件、下载目录逃逸、恶意下载 URL 均拒绝',async t=>{
 const f=fixture(t);await f.store.receive(f.mobile,event({message:[{type:'file',data:{file:'大.pdf',file_size:MAX_FILE_BYTES+1}}]}));assert.equal(f.store.list().length,0);assert.equal(f.calls.length,0);
 const outside=join(f.dir,'outside.pdf');writeFileSync(outside,'sample');f.mobile.call=async()=>({file:outside});await f.store.receive(f.mobile,event({message_id:'escaped'}));assert.equal(f.store.list().length,0);
 f.mobile.call=async()=>({url:'http://127.0.0.1/private'});await f.store.receive(f.mobile,event({message_id:'bad-url'}));assert.equal(f.store.list().length,0);
});
test('项目收件目录为跳出工作区的 junction 时不写入附件',async t=>{
 const f=fixture(t);await f.store.receive(f.mobile,event());const outside=join(f.dir,'other');mkdirSync(outside);symlinkSync(outside,join(f.cwd,'.stella-inbox'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.store.stage('1',f.cwd),/对话以外/);assert.equal(existsSync(join(outside,'1')),false);
});
test('文件指令必须有平台、两字母对话代号与数字附件编号',()=>{
 assert.deepEqual(parseWake('文件 dsh ab 12 看看这个PPT'),{kind:'file',platform:'dsh',code:'AB',fileId:'12',note:'看看这个PPT'});
 assert.equal(parseWake('文件 codex 12 12'),null);assert.equal(parseWake('文件 codex AA ../x'),null);
});
test('文件路由保留稳定会话映射，只投递一次，忙碌会话不收文件',async t=>{
 const f=fixture(t),state=new WakeState(),row={id:'test',status:'idle',cwd:f.cwd};state.data.enabled=true;state.assignCodes([row]);let count=0;
 const wake=new MobileWake({platform:'codex',mobile:f.mobile,state,files:f.store,backend:{async list(){return[row];},async sendFile(r,id,note,store){assert.equal(r.id,'test');assert.equal(id,'1');assert.equal(note,'看看');assert.equal(store,f.store);count++;}}});wake.running=true;
 const msg=event({message:[{type:'text',data:{text:'文件 codex AA 1 看看'}}]});await wake.receive(msg);await wake.receive(msg);assert.equal(count,1);
 row.status='active';await wake.receive({...msg,message_id:'busy'});assert.equal(count,1);
});
test('收件箱使用独立接收者，不让其他好友查询或重复回复',async t=>{
 const f=fixture(t);await f.store.receive(f.mobile,event());f.texts.length=0;
 const receiver=new MobileFiles({mobile:f.mobile,store:f.store,lease:new WakeState()});receiver.running=true;
 const msg=event({message_id:'inbox',message:[{type:'text',data:{text:'收件箱'}}]});assert.equal(await receiver.receive({...msg,user_id:'other'}),false);await receiver.receive(msg);await receiver.receive(msg);assert.equal(f.texts.length,1);assert.match(f.texts[0],/报告.pptx/);
});
test('DSH 发文件取真实执行 agent 的 cwd，不能通过参数改目录或接收人',async t=>{
 const f=fixture(t),definitions=[];registerFileTools({tools:{register:d=>definitions.push(d)}},f.mobile,join(f.profile,'relay.json'));
 const tool=definitions.find(d=>d.name==='stella_send_file_to_mobile'),source=join(f.cwd,'说明.docx');writeFileSync(source,'sample');
 const exec={agent:{session:{header:{cwd:f.cwd}}}};await assert.rejects(tool.execute({filePath:source,transferId:'bad',cwd:f.dir},exec),/当前对话/);
 assert.equal((await tool.execute({filePath:source,transferId:'dsh'},exec)).sent,true);
 await assert.rejects(tool.execute({filePath:source,transferId:'none'},{}),/没有当前/);
});
