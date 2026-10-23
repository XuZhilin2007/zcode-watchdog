import { Fault, ensure } from './errors.mjs';
const QUOTA='https://api.z.ai/api/monitor/usage/quota/limit';
const RESET='https://zcode.z.ai/api/v1/coding-plan/reset';
const shape = condition => ensure(condition,'PROTOCOL_CHANGED','服务端响应不兼容，自动用卡已暂停。');
const number = x => typeof x==='number' && Number.isFinite(x);
export function parseQuota(body,now) {
  shape(body?.code===200 && Array.isArray(body.data?.limits));
  const result={};
  for(const [unit,type] of [[3,'FIVE_HOUR'],[6,'WEEK']]) {
    const entries=body.data.limits.filter(x=>x?.unit===unit);
    shape(entries.length===1);
    const l=entries[0];
    shape(number(l.percentage)&&l.percentage>=0&&l.percentage<=100);
    shape(number(l.remaining)&&l.remaining>=0 && number(l.usage)&&l.usage>0 && l.remaining<=l.usage);
    shape(Number.isSafeInteger(l.nextResetTime)&&l.nextResetTime>now && l.nextResetTime<=now+35*86400000);
    // Percentage may be rounded by the server; contradictory pools are unsafe.
    shape(Math.abs(l.percentage-(1-l.remaining/l.usage)*100)<=2);
    result[type]={usedPct:l.percentage,remaining:l.remaining,total:l.usage,nextResetTime:l.nextResetTime};
  }
  return result;
}
export function parseCards(body,now) {
  shape(body?.code===0 && body.data && typeof body.data==='object');
  const out={};
  for(const [field,type] of [['available_five_hour_resets','FIVE_HOUR'],['available_week_resets','WEEK']]) {
    shape(Array.isArray(body.data[field]));
    shape(body.data[field].every(r=>r && Number.isSafeInteger(r.expire_at) && r.expire_at>1e12));
    out[type]=body.data[field].filter(r=>r.expire_at>now).length;
  }
  return out;
}
export class ZaiApi {
  constructor({ fetchImpl=fetch, now=()=>Date.now() }={}) {this.fetch=fetchImpl;this.now=now;}
  async request(url,init={}) {
    let res;
    try {res=await this.fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch {throw new Fault('NETWORK_ERROR','网络连接失败或超时，请稍后检查。');}
    if(res.status===401||res.status===403)throw new Fault('AUTH_OR_PLAN_UNAVAILABLE','登录、权限或套餐不可用，请在 ZCode 中检查。');
    if(res.status===429)throw new Fault('RATE_LIMITED','服务端限流，稍后重试。');
    if(!res.ok)throw new Fault('UPSTREAM_ERROR','服务端暂时不可用。');
    try {return await res.json();}catch{throw new Fault('PROTOCOL_CHANGED','服务端未返回可识别的数据。');}
  }
  headers(creds) {
    return {Authorization:creds.jwt.startsWith('Bearer ')?creds.jwt:'Bearer '+creds.jwt,
      'X-Bigmodel-Authorization':creds.oauth,'Bigmodel-Target-Type':'PERSONAL'};
  }
  async snapshot(creds) {
    const q=await this.request(QUOTA,{headers:{authorization:creds.oauth}});
    const s=await this.request(RESET+'/status',{headers:this.headers(creds)});
    const now=this.now();
    return {quota:parseQuota(q,now),cards:parseCards(s,now),fetchedAt:now};
  }
  async use(creds,type,id) {
    const body=await this.request(RESET+'/use',{method:'POST',
      headers:{...this.headers(creds),'content-type':'application/json'},
      body:JSON.stringify({reset_type:type,idempotency_key:id})});
    ensure(body?.code===0 && body.data?.used===true,'RESET_UNKNOWN','服务端没有明确确认用卡结果。');
  }
}
