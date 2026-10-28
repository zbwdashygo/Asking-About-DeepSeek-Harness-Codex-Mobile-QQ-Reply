import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { coordinateRequiredMobile } from '../app/bridge/coordinator.mjs';
import { writeQuestionDocument, questionPolicy } from '../app/bridge/question-document.mjs';
import { registerTools } from '../app/dsh/adapter.mjs';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject,cancel(){reject(Error('cancelled'));}};}
test('手机必达模式不需要电脑表单，可用 QQ 回答',async()=>{const phone=deferred();let used;const result=coordinateRequiredMobile({input:{question:'手机能回答吗？'},mobile:{async open(q){used=q;return phone;}}});await delay(0);phone.resolve('可以');assert.deepEqual(await result,{source:'qq',answer:'可以'});assert.equal(used.mobileRequired,true);});
test('电脑窗口失败不取消手机提问；手机回复只消费一次',async()=>{const phone=deferred();let closed=0;const result=coordinateRequiredMobile({input:{question:'test'},desktop:{request(){return{promise:Promise.reject(Error('native unavailable')),cancel(){closed++;}};}},mobile:{async open(){return phone;}}});await delay(0);phone.resolve('手机回答');assert.deepEqual(await result,{source:'qq',answer:'手机回答'});assert.equal(closed,1);});
test('电脑先答也必须先确认手机问题已发出，之后取消待答',async()=>{const phone=deferred(),opening=deferred(),native=deferred();let settled=false,cancelled=false;phone.cancel=()=>{cancelled=true;phone.reject(Error('cancelled'));};const result=coordinateRequiredMobile({input:{question:'test'},desktop:{request(){return{promise:native.promise,cancel(){}};}},mobile:{open(){return opening.promise;}}});result.then(()=>{settled=true;});native.resolve({action:'accept',content:{answer:'电脑回答'}});await delay(5);assert.equal(settled,false);opening.resolve(phone);assert.deepEqual(await result,{source:'desktop',answer:'电脑回答'});assert.equal(cancelled,true);});
test('QQ 发送失败不退化成电脑独占；取消和超时撤销手机待答',async()=>{
 await assert.rejects(coordinateRequiredMobile({input:{question:'test'},mobile:{open(){throw Error('offline');}}}),/offline/);
 const phone=deferred(),controller=new AbortController();const result=coordinateRequiredMobile({input:{question:'test'},mobile:{async open(){return phone;}},signal:controller.signal});await delay(0);controller.abort();await assert.rejects(result,/取消/);
 const another=deferred();await assert.rejects(coordinateRequiredMobile({input:{question:'test'},mobile:{async open(){return another;}},timeoutMs:5}),/超时/);
});
test('问题文档是可直接打开的 UTF-8 TXT，包含准确编号和完整回复方式',t=>{
 const dir=mkdtempSync(join(tmpdir(),'stella-question-doc-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const config=join(dir,'relay.json');assert.deepEqual(questionPolicy(config),{mobileRequired:false,document:false});writeFileSync(config+'.question-policy.json',JSON.stringify({mobileRequired:true,document:true}));assert.equal(questionPolicy(config).mobileRequired,true);
 const item={id:'12',text:'选择哪一个？\n1. 继续\n2. 暂停',context:'手机测试',expiresAt:Date.now()+480000};const doc=writeQuestionDocument(config,item),text=readFileSync(doc.filePath,'utf8');assert.ok(text.startsWith('\uFEFF'));assert.match(text,/问题 12/);assert.match(text,/12 你的回答/);assert.match(text,/继续/);assert.match(text,/暂停/);assert.throws(()=>writeQuestionDocument(config,{...item,id:'../x'}));assert.throws(()=>writeQuestionDocument(config,item),/EEXIST/);
});
test('DSH 手机必达模式无需电脑验证，手机答案返回原工具',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stella-dsh-question-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const configFile=join(dir,'relay.json');writeFileSync(configFile+'.question-policy.json',JSON.stringify({mobileRequired:true,document:true}));const definitions=[];registerTools({tools:{register:d=>definitions.push(d)},userQuestions:{ask(){throw Error('不得只显示电脑');}}},{configFile,async open(){return{promise:Promise.resolve('手机可答'),cancel(){}};}});const result=await definitions.find(d=>d.name==='stella_ask_on_desktop').execute({question:'测试'},{agent:{id:'real-exec'},signal:new AbortController().signal,callId:'test'});assert.equal(result.answers[0].custom,'手机可答');
});
