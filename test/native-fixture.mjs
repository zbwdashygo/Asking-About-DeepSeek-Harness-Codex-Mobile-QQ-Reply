import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id, result })+'\n');
const row = { id:'fixture-thread', kind:'codex', hostId:'local', title:'测试对话', status:'idle' };
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line); if(m.id===undefined)return;
  if(m.method==='initialize')return reply(m.id,{protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'fixture',version:'1'}});
  if(m.method==='tools/list')return reply(m.id,{tools:['list_threads','send_message_to_thread'].map(name=>({name}))});
  if(m.method==='tools/call'){
    if(process.env.STELLA_FIXTURE_LOG) appendFileSync(process.env.STELLA_FIXTURE_LOG,m.params.name+'\n');
    if(m.params._meta['openai/threadId']!=='fixture-caller')throw Error('wrong caller');
    if(m.params.name==='list_threads') {
      if(process.env.CODEX_APP_TOOLS_PIPE_PATH==='stale')return reply(m.id,{isError:true,content:[{type:'text',text:'connect ENOENT old desktop endpoint'}]});
      if(m.params.arguments.limit>50)throw Error('bad limit');
      const caller=process.env.CODEX_APP_TOOLS_PIPE_PATH.startsWith('live-')?[{...row,id:'fixture-caller'}]:[];
      return reply(m.id,{content:[{type:'text',text:JSON.stringify({threads:[row,...caller,{...row,id:'remote',hostId:'other'},{...row,id:'chatgpt',kind:'chatgpt'}]})}]});
    }
    if(Object.keys(m.params.arguments).some(key=>!['threadId','hostId','prompt'].includes(key)))throw Error('unexpected policy override');
    if(process.env.STELLA_FIXTURE_SEND_FAIL)return reply(m.id,{isError:true,content:[{type:'text',text:'connect ENOENT while sending; outcome unknown'}]});
    return reply(m.id,{content:[{type:'text',text:JSON.stringify({accepted:true,prompt:m.params.arguments.prompt})}]});
  }
});
