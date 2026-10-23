import net from 'node:net';
import fs from 'node:fs';
import { Fault, ensure } from './errors.mjs';
export async function request(endpoint,home,action='ping',timeout=1500) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(endpoint);let buffer='';
    socket.setTimeout(timeout);
    socket.on('connect',()=>socket.write(JSON.stringify({home,action})+'\n'));
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(buffer.length>8192){socket.destroy();reject(new Fault('CONTROL_ERROR','后台响应不合法。'));return;}
      if(buffer.includes('\n')) {
        socket.end();
        try {const r=JSON.parse(buffer.split('\n')[0]);if(r.error)reject(new Fault('CONTROL_ERROR','后台拒绝控制请求，请检查运行数据目录。'));else resolve(r);}
        catch{reject(new Fault('CONTROL_ERROR','后台响应无法识别。'));}
      }
    });
    socket.on('timeout',()=>socket.destroy(new Error('timeout')));
    socket.on('close',()=>reject(new Fault('NOT_RUNNING','后台连接已关闭。')));
    socket.on('error',()=>reject(new Fault('NOT_RUNNING','后台未运行或暂时无响应。')));
  });
}
export async function listen(endpoint,store,{stop,wake}) {
  if(process.platform!=='win32' && fs.existsSync(endpoint)) {
    try {await request(endpoint,store.paths.home);throw new Fault('ALREADY_RUNNING','后台已运行。');}
    catch(e){if(e.code!=='NOT_RUNNING')throw e;fs.unlinkSync(endpoint);}
  }
  const server=net.createServer(socket=>{
    let buffer='';socket.setTimeout(1500,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(buffer.length>4096){socket.destroy();return;}
      if(!buffer.includes('\n'))return;
      try {
        const r=JSON.parse(buffer.split('\n')[0]);
        ensure(r.home===store.paths.home,'CONTROL_ERROR','后台正在使用另一运行数据目录。');
        ensure(['ping','stop','reload'].includes(r.action),'CONTROL_ERROR','不支持的控制命令。');
        if(r.action==='stop')stop();
        if(r.action==='reload')wake();
        const state=store.runtime();
        socket.end(JSON.stringify({pid:process.pid,home:store.paths.home,phase:state.phase,
          activeRevision:state.activeRevision,desired:state.desired})+'\n');
      } catch{socket.end(JSON.stringify({error:'控制请求失败；请确认运行数据目录和账本状态。'})+'\n');}
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',()=>reject(new Fault('ALREADY_RUNNING','已有后台实例或本地控制通道不可用。')));
    server.listen({path:endpoint,exclusive:true},resolve);
  });
  if(process.platform!=='win32')fs.chmodSync(endpoint,0o600);
  return server;
}
