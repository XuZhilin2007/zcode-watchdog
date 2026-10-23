import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Store } from './store.mjs';
import { locations, pipeName } from './paths.mjs';
import { request } from './control.mjs';
import { launch, scheduler } from './windows.mjs';
import { ZaiApi } from './api.mjs';
import { loadCredentials } from './credentials.mjs';
import { runWorker } from './worker.mjs';
import { choose } from './policy.mjs';
import { DEFAULTS, validateConfig } from './config.mjs';
import { Fault, ensure, safeError } from './errors.mjs';
export const VERSION='2.0.0-beta.1';
const HELP='ZCode Watchdog '+VERSION+'\n\n'
  +'zwd                       查看状态和最近额度（只读）\n'
  +'zwd start                 后台启动，关闭终端后继续运行\n'
  +'zwd stop                  停止；登录或保活不会重新启动\n'
  +'zwd config --init         首次创建本地配置和账本，不启动\n'
  +'zwd config                查看配置\n'
  +'zwd config --daily-limit unlimited   每日不限（也可填正整数）\n'
  +'zwd config --five-hour-threshold 90 --week-threshold 97\n'
  +'zwd config --autostart on  配置登录自启，不会自行启用消费\n'
  +'zwd --refresh             只读刷新官方额度，不使用卡片\n'
  +'zwd --dry-run             只读显示当前用卡决策\n'
  +'zwd logs                  查看最近本地事件\n'
  +'zwd doctor                离线诊断；--refresh 可只读检查接口\n'
  +'zwd reconcile             查看待确认操作\n'
  +'zwd reconcile --assume-used ID   停止后保守记为已消费，不退预算\n'
  +'zwd uninstall             停止并取消自启；保留配置和账本\n'
  +'zwd --json                输出 JSON（可与 status/config/doctor 使用）\n\n'
  +'Node.js >=24.15 <25，Windows 后台模式。安装不启动，不读取或迁移旧版状态。\n';
const optionDefs={
  help:{type:'boolean',short:'h'},version:{type:'boolean'},json:{type:'boolean'},
  init:{type:'boolean'},refresh:{type:'boolean'},'dry-run':{type:'boolean'},
  'daily-limit':{type:'string'},'five-hour-threshold':{type:'string'},'week-threshold':{type:'string'},
  'poll-seconds':{type:'string'},autostart:{type:'string'},notifications:{type:'string'},'assume-used':{type:'string'},
  'accept-account':{type:'boolean'},home:{type:'string'}
};
function parse(argv) {
  let parsed;
  try {parsed=parseArgs({args:argv,options:optionDefs,allowPositionals:true,strict:true});}
  catch{throw new Fault('ARGUMENT_ERROR','命令参数错误，请运行 zwd --help。');}
  const command=parsed.positionals[0]||'status',v=parsed.values;
  ensure(parsed.positionals.length<=1 && ['status','start','stop','config','logs','doctor','reconcile','uninstall','_worker','_scheduled'].includes(command),
    'ARGUMENT_ERROR','未知命令，请运行 zwd --help。');
  const allowed={
    status:['refresh','dry-run','json'],start:['accept-account'],stop:[],logs:['json'],
    config:['init','daily-limit','five-hour-threshold','week-threshold','poll-seconds','autostart','notifications','json'],
    doctor:['refresh','json'],reconcile:['assume-used','json'],uninstall:[],
    _worker:['home'],_scheduled:['home']
  }[command];
  for(const key of Object.keys(v))ensure(['help','version'].includes(key)||allowed.includes(key),
    'ARGUMENT_ERROR','该命令不接受此参数。');
  return {command,v};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function main(argv=process.argv.slice(2),io=console) {
  let store;
  try {
    const {command,v}=parse(argv);
    if(v.help){io.log(HELP);return 0;}if(v.version){io.log(VERSION);return 0;}
    const [major,minor]=process.versions.node.split('.').map(Number);
    ensure(major===24&&minor>=15,'NODE_VERSION','请使用 Node.js 24.15 或更新的 24.x 版本。');
    const paths=locations(v.home),endpoint=pipeName();
    if(command==='_worker'||command==='_scheduled'){await runWorker(paths,{scheduled:command==='_scheduled'});return 0;}
    const emit=value=>io.log(v.json?JSON.stringify(value,null,2):value);
    if(command==='config') {
      const map={'daily-limit':'dailyLimit','five-hour-threshold':'fiveHourThreshold','week-threshold':'weekThreshold','poll-seconds':'pollMs'};
      const patch={};
      for(const [arg,key] of Object.entries(map))if(v[arg]!=null) {
        ensure(v[arg]==='unlimited'&&key==='dailyLimit'||/^\d+(?:\.\d+)?$/.test(v[arg]),
          'ARGUMENT_ERROR','配置参数必须是合法数字；每日不限使用 unlimited。');
        patch[key]=v[arg]==='unlimited'?'unlimited':Number(v[arg])*(key==='pollMs'?1000:1);
      }
      if(v.autostart!=null){ensure(['on','off'].includes(v.autostart),'ARGUMENT_ERROR','autostart 使用 on 或 off。');patch.autostart=v.autostart==='on';}
      if(v.notifications!=null){ensure(['on','off'].includes(v.notifications),'ARGUMENT_ERROR','notifications 使用 on 或 off。');patch.notifications=v.notifications==='on';}
      try{validateConfig({...DEFAULTS,...patch});}catch{throw new Fault('ARGUMENT_ERROR','配置参数超出支持范围，请运行 zwd --help。');}
      const changing=!!v.init||Object.keys(patch).length>0;
      store=new Store(paths,{initialize:!!v.init,readOnly:!changing});
      const config=changing?store.configure(patch):store.config();
      if(v.autostart!=null)scheduler(paths,config.value.autostart?'install':'remove');
      if(v.json)emit(config);else {
        emit('配置（预算时区 Asia/Shanghai）：\n'+JSON.stringify(config.value,null,2));
        if(changing) {
          let message='已保存；后台未运行，下次启动生效。';
          try {
            await request(endpoint,paths.home,'reload');
            for(let i=0;i<10;i++){const r=await request(endpoint,paths.home);if(r.activeRevision>=config.revision){message='已保存并由后台确认生效。';break;}await sleep(100);}
            if(message.includes('后台未运行'))message='已保存；后台将在当前检查或请求完成后应用。';
          } catch{}
          emit(message);
        }
      }
      return 0;
    }
    if(command==='status'||command==='doctor') {
      let runtime={desired:'stopped',phase:'NOT_CONFIGURED'},config=null,storageError=null;
      if(fs.existsSync(paths.home))try{store=new Store(paths,{readOnly:true});runtime=store.runtime();config=store.config();}catch(e){storageError=safeError(e);}
      let live=null;
      try{live=await request(endpoint,paths.home);}catch{}
      const report={version:VERSION,dataDirectory:paths.home,process:live?'running':'not responding',
        runtime,config:config?.value||null,pending:store?.allPending()||[],storageError};
      if(store&&runtime.account)report.usedToday=store.count(runtime.account,Date.now());
      let failed=!!storageError;
      if(v.refresh||v['dry-run']) {
        try {
          const creds=loadCredentials();
          report.current=await new ZaiApi().snapshot(creds);
          if(v['dry-run']&&config)report.decision=choose(report.current,config.value,{
            lastAt:t=>store.lastAt(creds.account,t),usedToday:store.count(creds.account,Date.now()),
            pending:!!store.pending(creds.account)});
        }catch(e){report.queryError=safeError(e);failed=true;}
      }
      if(v.json)emit(report);
      else {
        emit('ZCode Watchdog '+VERSION+'\n后台：'+(live?'运行中':'未运行或无响应')
          +'\n自动重置：'+(runtime.desired==='running'&&live?(runtime.phase==='PAUSED'?'已暂停':'已启用'):'未启用')
          +'\n每日上限：'+(config?config.value.dailyLimit:'尚未配置')
          +'\n今日已用：'+(report.usedToday??0)+' 张\n'+(runtime.message||'首次使用：zwd config --init'));
        const snap=report.current||runtime.snapshot;
        if(snap)emit('五小时已用 '+snap.quota.FIVE_HOUR.usedPct+'%；周已用 '+snap.quota.WEEK.usedPct
          +'%；卡片 五小时 '+snap.cards.FIVE_HOUR+' / 周 '+snap.cards.WEEK
          +'\n数据时间：'+new Date(snap.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
          +(report.current?'（本次只读查询）':'（缓存；zwd --refresh 可刷新）'));
        if(report.pending.length)emit('存在 '+report.pending.length+' 条待确认操作：zwd reconcile');
        if(report.decision)emit('只读决策：'+report.decision.reason);
        for(const e of [report.storageError,report.queryError])if(e)emit(e.code+': '+e.message);
        if(command==='doctor')emit('数据目录：'+paths.home+'\n诊断不会安装任务、迁移状态或消费卡片。');
      }
      return failed?1:0;
    }
    try{store=new Store(paths);}catch(e){
      if(command==='stop'||command==='uninstall') {
        // Even a damaged ledger must not prevent requesting a graceful shutdown.
        try{await request(endpoint,paths.home,'stop');}catch{}
        if(process.platform==='win32')try{scheduler(paths,'remove');}catch{}
        throw new Fault('STOP_UNVERIFIED','已尝试停止后台并取消自启，但账本异常，无法确认完整停止状态。请检查进程和备份。');
      }
      throw e;
    }
    if(command==='logs'){const events=store.events();emit(v.json?events:events.map(e=>new Date(e.at).toISOString()+' '+e.code+' '+e.message).join('\n')||'暂无事件。');return 0;}
    if(command==='reconcile') {
      const pending=store.allPending();
      if(!v['assume-used']){emit(v.json?pending:JSON.stringify(pending,null,2)+'\n结果未知的请求不会重发。确认后可停止后台并使用 --assume-used ID 保守记为已消费。');return 0;}
      ensure(store.runtime().desired==='stopped','STOP_REQUIRED','请先运行 zwd stop，再处理待确认操作。');
      ensure(pending.some(p=>p.id===v['assume-used']),'ARGUMENT_ERROR','未找到该待确认操作。');
      const op=store.db.prepare('SELECT * FROM operations WHERE id=?').get(v['assume-used']);
      if(op.state==='PREPARED')store.settle(op.id,'UNKNOWN',Date.now(),'INTERRUPTED_REQUEST');
      store.settle(op.id,'CONFIRMED',Date.now(),'USER_ASSUMED_USED');
      store.event('MANUAL_RECONCILIATION','用户保守确认为已消费；预算未退回。');
      emit('已保守记为消费，不退回预算；下次启动重新检查额度。');return 0;
    }
    if(command==='stop'||command==='uninstall') {
      store.updateRuntime({desired:'stopped'});
      try{await request(endpoint,paths.home,'stop');}catch{}
      if(store.config().value.autostart||command==='uninstall')scheduler(paths,'remove');
      let alive=false;
      for(let i=0;i<25;i++){try{await request(endpoint,paths.home);alive=true;await sleep(1000);}catch{alive=false;break;}}
      ensure(!alive,'STOP_PENDING','停止意图已保存；当前请求仍在收尾，未强杀进程，请稍后查询状态。');
      if(command==='uninstall')store.configure({autostart:false});
      emit(command==='uninstall'?'后台与自启已停用；配置和账本保留。可移除 CLI 安装包。':'已停止；保活和登录不会重新启用。');
      return 0;
    }
    if(command==='start') {
      ensure(process.platform==='win32','WINDOWS_REQUIRED','后台模式目前只支持 Windows。');
      try{await request(endpoint,paths.home);emit('后台已经运行；未创建第二个实例。');return 0;}catch(e){if(e.code!=='NOT_RUNNING')throw e;}
      const creds=loadCredentials(),old=store.runtime();
      ensure(!old.account||old.account===creds.account||v['accept-account'],'ACCOUNT_CHANGED','检测到账号切换；确认后使用 zwd start --accept-account。');
      ensure(store.allPending().length===0||old.account===creds.account,'RESET_PENDING','原账号有待确认用卡，请先处理。');
      const snapshot=await new ZaiApi().snapshot(creds);
      store.updateRuntime({desired:'running',phase:'STARTING',account:creds.account,snapshot,error:null,message:'启动预检成功。'});
      try {
        if(store.config().value.autostart)scheduler(paths,'install');
        launch(paths);
        for(let i=0;i<30;i++){await sleep(100);try{await request(endpoint,paths.home);emit('后台已启动。运行 zwd 查看实际健康状态。');return 0;}catch{}}
        throw new Fault('START_FAILED','后台未能启动；请检查 Windows Script Host 和 zwd doctor。');
      } catch(e){store.updateRuntime({desired:'stopped'});throw e;}
    }
    return 0;
  }catch(e) {
    const fault=safeError(e);
    io.error(fault.code+': '+fault.message);
    return fault.code==='ARGUMENT_ERROR'?2:1;
  }finally{store?.close();}
}
