import readline from 'node:readline';
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id, result })+'\n');
const row = { id:'fixture-thread', kind:'codex', hostId:'local', title:'测试对话', status:'idle' };
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line); if(m.id===undefined)return;
  if(m.method==='initialize')return reply(m.id,{protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'fixture',version:'1'}});
  if(m.method==='tools/list')return reply(m.id,{tools:['list_threads','send_message_to_thread'].map(name=>({name}))});
  if(m.method==='tools/call'){
    if(m.params._meta['openai/threadId']!=='fixture-caller')throw Error('wrong caller');
    if(m.params.name==='list_threads') {
      if(m.params.arguments.limit>50)throw Error('bad limit');
      return reply(m.id,{content:[{type:'text',text:JSON.stringify({threads:[row,{...row,id:'remote',hostId:'other'},{...row,id:'chatgpt',kind:'chatgpt'}]})}]});
    }
    if(Object.keys(m.params.arguments).some(key=>!['threadId','hostId','prompt'].includes(key)))throw Error('unexpected policy override');
    return reply(m.id,{content:[{type:'text',text:JSON.stringify({accepted:true,prompt:m.params.arguments.prompt})}]});
  }
});
