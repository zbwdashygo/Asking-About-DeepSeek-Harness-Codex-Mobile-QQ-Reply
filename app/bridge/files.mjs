import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, copyFileSync, constants, createReadStream, createWriteStream, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, basename, extname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { allocateQuestionNumber } from './question-numbers.mjs';
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const extensions = new Set('.png .jpg .jpeg .gif .webp .bmp .ppt .pptx .doc .docx .xls .xlsx .pdf .txt .csv .md .rtf .odt .ods .odp .zip'.split(' '));
const imageExtensions = new Set('.png .jpg .jpeg .gif .webp .bmp'.split(' '));
export const fileSchema = { type:'object', properties:{ transferId:{type:'string',minLength:1,maxLength:120},filePath:{type:'string',minLength:1,maxLength:1000},threadId:{type:'string',minLength:1,maxLength:120} },required:['transferId','filePath'],additionalProperties:false };
export function within(root, file) { const rel = relative(root, file); return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel); }
export function safeName(name) {
  if(typeof name!=='string'||!name||name.length>240||/[. ]$/.test(name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||/[\u202a-\u202e\u2066-\u2069]/.test(name)||name!==basename(name)||/[\\/\x00-\x1f]/.test(name)||/[:<>"|?*]/.test(name))throw Error('这个文件名不合适，请改个名字再发');
  if(!extensions.has(extname(name).toLowerCase()))throw Error('暂时只收图片、办公文档、PDF、文字和 ZIP 文件');
  return name;
}
const digest = file => new Promise((resolve,reject)=>{const hash=createHash('sha256'),stream=createReadStream(file);stream.on('data',b=>hash.update(b));stream.on('error',reject);stream.on('end',()=>resolve(hash.digest('hex')));});
function saveJson(file,value){mkdirSync(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,file);}
export class FileStore {
 constructor(configFile){if(!isAbsolute(configFile))throw Error('缺少独立文件资料目录');this.profile=dirname(configFile);this.root=join(this.profile,'files');this.configFile=configFile;}
 list(){const dir=join(this.root,'incoming');if(!existsSync(dir))return[];return readdirSync(dir).filter(n=>/^\d+\.json$/.test(n)).map(n=>JSON.parse(readFileSync(join(dir,n),'utf8'))).sort((a,b)=>b.receivedAt-a.receivedAt).slice(0,10).map(({id,name,size,receivedAt})=>({id,name,size,receivedAt}));}
 get(id){if(!/^[1-9]\d{0,8}$/.test(String(id)))throw Error('文件编号没对上');const file=join(this.root,'incoming',id+'.json');if(!existsSync(file))throw Error('没找到这个文件，先发“收件箱”看看吧');return JSON.parse(readFileSync(file,'utf8'));}
 async stage(id,cwd){
  const record=this.get(String(id)),source=realpathSync(record.path),root=realpathSync(cwd);
  if(!within(realpathSync(this.profile),source)||await digest(source)!==record.sha256)throw Error('文件内容已改变，请重新上传');
  if(root===resolve(root,sep))throw Error('请先选择有工作目录的对话');
  const inbox=join(root,'.stella-inbox');
  if(!existsSync(inbox))mkdirSync(inbox);
  if(!within(root,realpathSync(inbox)))throw Error('收件目录指向了对话以外的位置');
  const dir=join(inbox,String(id));if(!existsSync(dir))mkdirSync(dir);
  if(!within(root,realpathSync(dir)))throw Error('收件目录指向了对话以外的位置');
  const target=join(dir,safeName(record.name));
  if(existsSync(target)){if(!within(root,realpathSync(target))||await digest(target)!==record.sha256)throw Error('同名收件文件有变化，未覆盖');}
  else copyFileSync(source,target,constants.COPYFILE_EXCL);
  return{...record,path:target};
 }
 async send(mobile,input,cwd){
  if(!input||Object.keys(input).some(k=>!['transferId','filePath','threadId'].includes(k))||typeof input.transferId!=='string'||!/^[^\x00-\x1f]{1,120}$/.test(input.transferId)||typeof input.filePath!=='string'||input.filePath.length>1000||!isAbsolute(input.filePath))throw Error('请提供本次传输编号和文件绝对路径');
  const root=realpathSync(cwd),source=realpathSync(input.filePath),name=safeName(basename(source));
  if(root===resolve(root,sep))throw Error('请先选择有工作目录的对话');
  if(!within(root,source)||/[\\/](?:\.codex|\.ssh|\.aws|\.git|qq-data|runtime|github-auth-private|installation-backups)(?:[\\/]|$)/i.test(source))throw Error('只能发送当前对话工作目录里的普通文件');
  const info=statSync(source);if(!info.isFile()||info.size<1||info.size>MAX_FILE_BYTES)throw Error('文件需要在 1 字节到 100 MB 之间');
  const hash=await digest(source),key=createHash('sha256').update(input.transferId).digest('hex'),ledger=join(this.root,'outgoing',key+'.json');mkdirSync(dirname(ledger),{recursive:true});
  const reservation={transferId:input.transferId,sha256:hash,name,size:info.size,state:'reserved'};
  try{writeFileSync(ledger,JSON.stringify(reservation),{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;let old;try{old=JSON.parse(readFileSync(ledger,'utf8'));}catch{throw Error('这次传输还在处理中，请别重复发');}if(old.sha256!==hash||old.name!==name)throw Error('这个传输编号已用过，请换一个');if(old.state==='sent')return old.receipt;throw Error('这次传输状态未确认，我不会自动重发');}
  try{
   const dir=join(this.root,'outgoing',key);mkdirSync(dir,{recursive:true});const snapshot=join(dir,name);copyFileSync(source,snapshot,constants.COPYFILE_EXCL);
   if(await digest(snapshot)!==hash)throw Error('发送前文件有变化，请重新确认');
   await mobile.connect();let response;
   if(imageExtensions.has(extname(name).toLowerCase()))response=await mobile.call('send_private_msg',{user_id:Number(mobile.config.contactId),message:[{type:'image',data:{file:pathToFileURL(snapshot).href}}]},{timeoutMs:60000});
   else response=await mobile.call('upload_private_file',{user_id:String(mobile.config.contactId),file:snapshot,name},{timeoutMs:60000});
   const remoteId=response?.message_id??response?.file_id;if(remoteId==null)throw Error('QQ 没确认文件已发出，我不会自动重发');
   const receipt={sent:true,transferId:input.transferId,fileName:name,bytes:info.size,remoteId:String(remoteId)};saveJson(ledger,{...reservation,state:'sent',receipt});return receipt;
  }catch(error){saveJson(ledger,{...reservation,state:'failed-or-unknown'});throw error;}
 }
 async receive(mobile,event){
  const c=mobile.config;
  if(event.post_type!=='message'||event.message_type!=='private'||event.sub_type!=='friend'||String(event.self_id)!==c.botId||String(event.user_id)!==c.contactId||event.message_id==null||String(event.message_id).length>120||!Number.isFinite(event.time)||Math.abs(event.time*1000-(Date.now()+(mobile.questions?.sourceOffsetMs??0)))>120000)return false;
  const attachments=(Array.isArray(event.message)?event.message:[]).filter(s=>['file','image'].includes(s.type));if(!attachments.length)return false;
  for(const [index,segment]of attachments.slice(0,5).entries()){
   const key=createHash('sha256').update(String(event.message_id)+':'+index).digest('hex'),claim=join(this.root,'received-events',key+'.json');mkdirSync(dirname(claim),{recursive:true});
   try{writeFileSync(claim,JSON.stringify({state:'reserved'}),{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')continue;throw error;}
   let partial;
   try{
    const data=segment.data??{},declared=Number(data.file_size??data.size??0);if(declared>MAX_FILE_BYTES)throw Error('文件超过 100 MB，先压小一点吧');
    let name=segment.type==='file'?(data.file??data.name):data.name??data.file;
    if(segment.type==='image'&&(!name||!extensions.has(extname(name).toLowerCase())))name='图片.png';name=safeName(name);
    const id=await allocateQuestionNumber(this.configFile+'.file-numbers.json'),dir=join(this.root,'incoming',id);mkdirSync(dir,{recursive:true});const target=join(dir,name);partial=target+'.part';
    const opaque=data.file_id??data.file;let resource;
    if(typeof opaque==='string'&&/^[a-z0-9_+=-][a-z0-9_+.=\/-]{0,1023}$/i.test(opaque)&&!opaque.includes('..'))try{resource=await mobile.call('get_file',{file:opaque},{timeoutMs:60000});}catch{}
    if(resource?.file&&isAbsolute(resource.file)&&existsSync(resource.file)){
     const local=realpathSync(resource.file);if(!within(realpathSync(this.profile),local)||statSync(local).size>MAX_FILE_BYTES)throw Error('下载文件不在独立收件环境中');copyFileSync(local,partial,constants.COPYFILE_EXCL);
    }else{
     let url=resource?.url??data.url;
     if(!url&&data.file_id)url=(await mobile.call('get_private_file_url',{user_id:Number(c.contactId),file_id:data.file_id},{timeoutMs:60000})).url;
     for(let hop=0;hop<4;hop++){
      const parsed=new URL(url);if(parsed.protocol!=='https:'&&parsed.protocol!=='http:'||!/(?:^|\.)(?:qq\.com|qq\.com\.cn|qpic\.cn|gtimg\.cn)$/.test(parsed.hostname))throw Error('下载地址暂不支持，请用 QQ 文件方式重新发');
      const response=await fetch(parsed,{redirect:'manual',signal:AbortSignal.timeout(60000)});
      if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),parsed).href;await response.body?.cancel();continue;}
      if(!response.ok||!response.body||Number(response.headers.get('content-length')??0)>MAX_FILE_BYTES)throw Error('文件下载没成功，请稍后重新发');
      let size=0;await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>MAX_FILE_BYTES?Error('文件超过 100 MB'):null,chunk);}}),createWriteStream(partial,{flags:'wx',mode:0o600}));break;
     }
     if(!existsSync(partial))throw Error('下载跳转太多，请重新发这个文件');
    }
    const size=statSync(partial).size;if(size<1||size>MAX_FILE_BYTES)throw Error('文件为空或超过 100 MB');renameSync(partial,target);partial=undefined;
    const record={id,name,path:target,size,sha256:await digest(target),receivedAt:Date.now()};saveJson(join(this.root,'incoming',id+'.json'),record);saveJson(claim,{state:'received',id});
    await mobile.sendText(`收到《${name}》啦，文件编号 ${id}。\n交给对话：文件 codex AA ${id} 你的要求\nDSH 就把 codex 换成 dsh。`);
   }catch(error){if(partial)try{unlinkSync(partial);}catch{}saveJson(claim,{state:'failed-or-unknown'});try{await mobile.sendText('这个附件没收好：'+String(error.message).slice(0,160));}catch{}}
  }
  return true;
 }
}
export function filePrompt(file,note=''){return `用户从手机发来了文件《${file.name}》。\n本地附件：${file.path}\n用户要求：${note||'请查看这个附件，告诉我你可以怎样帮助处理。'}`;}
