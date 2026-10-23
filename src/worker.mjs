import { Store } from './store.mjs';
import { listen, request } from './control.mjs';
import { pipeName } from './paths.mjs';
import { ZaiApi } from './api.mjs';
import { loadCredentials } from './credentials.mjs';
import { Engine } from './engine.mjs';
import { safeError } from './errors.mjs';
import { notifyWindows } from './notify.mjs';
export async function runWorker(paths,{endpoint=pipeName(),api=new ZaiApi(),credentials=loadCredentials,
  scheduled=false,interval=null,notify=notifyWindows}={}) {
  const store=new Store(paths);let server;
  let stopping=false,wakeResolve=null;
  const wake=()=>{wakeResolve?.();wakeResolve=null;};
  const stop=()=>{stopping=true;try{store.updateRuntime({desired:'stopped'});}finally{wake();}};
  const signal=()=>stop();
  try {
    if(store.runtime().desired!=='running' || (scheduled&&!store.config().value.autostart))return;
    if(scheduled) {
      const runtime=store.runtime(),now=Date.now();
      if(runtime.heartbeat && now-runtime.heartbeat>Math.max(store.config().value.pollMs*2+60000,360000)
        && now-(runtime.lastHeartbeatAlert||0)>3600000) {
        store.event('HEARTBEAT_STALE','后台心跳超时，请检查 zwd doctor。',now);
        store.updateRuntime({lastHeartbeatAlert:now});
        if(store.config().value.notifications)notify('HEARTBEAT_STALE');
      }
      try{await request(endpoint,paths.home);return;}catch{}
    }
    server=await listen(endpoint,store,{stop,wake});
    store.updateRuntime({pid:process.pid,phase:'STARTING',error:null,heartbeat:Date.now()});
    const engine=new Engine(store,api,{credentials});
    process.on('SIGTERM',signal);process.on('SIGINT',signal);
    let failures=0;
    while(!stopping && store.runtime().desired==='running') {
      const before=store.runtime();
      const success=await engine.safeTick();
      const after=store.runtime();
      if(store.config().value.notifications && (before.error!==after.error))
        notify(after.error||'HEALTH_RECOVERED');
      const transient=['NETWORK_ERROR','RATE_LIMITED','UPSTREAM_ERROR','AUTH_REQUIRED','AUTH_OR_PLAN_UNAVAILABLE'].includes(after.error);
      failures=success||!transient?0:Math.min(failures+1,4);
      if(stopping || store.runtime().desired!=='running')break;
      const delay=interval??Math.min(store.config().value.pollMs*Math.max(1,2**failures),300000);
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{wakeResolve=null;resolve();},delay);
        wakeResolve=()=>{clearTimeout(timer);resolve();};
      });
    }
  } catch(e) {
    if(e.code==='ALREADY_RUNNING')return;
    const fault=safeError(e);
    try {store.updateRuntime({phase:'PAUSED',error:fault.code,message:fault.message});}catch{}
    throw e;
  } finally {
    process.off('SIGTERM',signal);process.off('SIGINT',signal);
    if(server) {
      try{store.updateRuntime({pid:null,phase:stopping?'STOPPED':'EXITED',heartbeat:Date.now()});}catch{}
      await new Promise(resolve=>server.close(resolve));
    }
    store.close();
  }
}
