import { choose, effectVisible } from './policy.mjs';
import { Fault, ensure, safeError } from './errors.mjs';
export class Engine {
  constructor(store,api,{credentials,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
    this.store=store;this.api=api;this.credentials=credentials;this.now=now;this.sleep=sleep;
  }
  async tick() {
    const {store,api}=this;
    store.clock(this.now());
    const creds=this.credentials();
    const runtime=store.runtime();
    ensure(!runtime.account || runtime.account===creds.account,'ACCOUNT_CHANGED',
      'ZCode 账号已切换；请先停止，再使用 zwd start --accept-account 启用新账号。');
    const snapshot=await api.snapshot(creds);
    store.updateRuntime({account:creds.account,snapshot,heartbeat:this.now(),activeRevision:store.config().revision});
    let pending=store.pending(creds.account);
    if(pending) {
      if(pending.state==='APPLIED' && effectVisible(JSON.parse(pending.before),snapshot,pending.type)) {
        store.settle(pending.id,'CONFIRMED',this.now());
        store.event('RESET_CONFIRMED','上次用卡已确认恢复额度。',this.now());
      } else {
        // PREPARED after a crash is ambiguous too: it may already have reached the server.
        throw new Fault('RESET_PENDING','上次用卡仍待确认；自动消费已暂停，请运行 zwd reconcile。');
      }
    }
    if(store.runtime().desired!=='running')return;
    const config=store.config().value;
    const decision=choose(snapshot,config,{now:this.now(),previous:runtime.snapshot,
      lastAt:type=>store.lastAt(creds.account,type)});
    if(!decision.action && ((snapshot.quota.WEEK.usedPct>=config.weekThreshold && snapshot.cards.WEEK===0)
      || (snapshot.quota.FIVE_HOUR.usedPct>=config.fiveHourThreshold && snapshot.cards.FIVE_HOUR===0
        && !(snapshot.quota.WEEK.usedPct>=config.weekThreshold && snapshot.cards.WEEK>0))))
      throw new Fault('NO_CARDS','额度达到阈值，但没有可恢复该额度的重置卡。');
    store.updateRuntime({message:decision.reason});
    if(!decision.action)return;
    const op=store.reserve(creds.account,decision.action,snapshot,this.now());
    // A durable PREPARED row exists before the only POST. Never automatically retry it.
    try {await api.use(creds,op.type,op.id);}
    catch {
      store.settle(op.id,'UNKNOWN',this.now(),'REQUEST_RESULT_UNKNOWN');
      throw new Fault('RESET_PENDING','用卡结果不确定，未重发请求；请运行 zwd reconcile。');
    }
    store.settle(op.id,'APPLIED',this.now());
    store.event('RESET_APPLIED',op.type==='WEEK'?'已使用周卡，正在核对两个额度池。':'已使用五小时卡，正在核对额度。',this.now());
    for(let i=0;i<3;i++) {
      await this.sleep(2000*(i+1));
      const after=await api.snapshot(creds);
      store.updateRuntime({snapshot:after,heartbeat:this.now()});
      if(effectVisible(snapshot,after,op.type)) {
        store.settle(op.id,'CONFIRMED',this.now());
        store.updateRuntime({message:'重置已确认；下一轮使用新数据重新判断。'});
        return;
      }
    }
    throw new Fault('RESET_PENDING','服务端确认已用卡，但额度恢复尚未确认，暂停后续消费。');
  }
  async safeTick() {
    try {
      await this.tick();
      if(this.store.runtime().error)this.store.event('HEALTH_RECOVERED','检查已恢复正常。',this.now());
      this.store.updateRuntime({phase:'RUNNING',error:null});
      return true;
    }
    catch(e) {
      const fault=safeError(e);
      const old=this.store.runtime();
      if(old.error!==fault.code)this.store.event(fault.code,fault.message,this.now());
      this.store.updateRuntime({phase:'PAUSED',error:fault.code,message:fault.message,heartbeat:this.now()});
      return false;
    }
  }
}
