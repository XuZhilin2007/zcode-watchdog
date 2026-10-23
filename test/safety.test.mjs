import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { choose } from '../src/policy.mjs';
import { DEFAULTS, validateConfig, dayKey } from '../src/config.mjs';
import { parseQuota,parseCards,ZaiApi } from '../src/api.mjs';
import { parseCredentials } from '../src/credentials.mjs';
import { tempStore,snapshot,fakeCreds,NOW } from './helpers.mjs';
import { removeFixture } from '../scripts/temp.mjs';

test('timeout after server acceptance stays charged and never resends, including restart',async()=>{
  const fixture=tempStore({dailyLimit:1});let posts=0;
  const api={snapshot:async()=>snapshot(),use:async()=>{posts++;throw new Error('accepted then disconnected');}};
  const engine=new Engine(fixture.store,api,{credentials:fakeCreds,now:()=>NOW,sleep:async()=>{}});
  try {
    assert.equal(await engine.safeTick(),false);
    assert.equal(fixture.store.pending('account-a').state,'UNKNOWN');
    assert.equal(fixture.store.count('account-a',NOW),1);
    const second=new Store(fixture.paths);
    await new Engine(second,api,{credentials:fakeCreds,now:()=>NOW+86400000,sleep:async()=>{}}).safeTick();
    assert.equal(posts,1);
    assert.equal(second.pending('account-a').state,'UNKNOWN');
    second.close();
  }finally{fixture.cleanup();}
});

test('two store connections atomically reserve one operation under unlimited budget',()=>{
  const f=tempStore({dailyLimit:'unlimited'}),other=new Store(f.paths);
  try {
    const op=f.store.reserve('account-a','FIVE_HOUR',snapshot(),NOW);
    assert.throws(()=>other.reserve('account-a','FIVE_HOUR',snapshot(),NOW),{code:'RESET_PENDING'});
    assert.equal(other.count('account-a',NOW),1);
    f.store.settle(op.id,'APPLIED',NOW);
    assert.throws(()=>other.reserve('account-a','WEEK',snapshot(),NOW),{code:'RESET_PENDING'});
  }finally{other.close();f.cleanup();}
});

test('PREPARED is persisted before POST; write failure prevents network side effects',async()=>{
  const f=tempStore();let posts=0;
  try {
    const api={snapshot:async()=>snapshot(),use:async(_c,_t,id)=>{
      posts++;assert.equal(f.store.pending('account-a').id,id);
      assert.equal(f.store.count('account-a',NOW),1);
    }};
    const reserve=f.store.reserve.bind(f.store);
    f.store.reserve=()=>{throw new Error('disk full');};
    await new Engine(f.store,api,{credentials:fakeCreds,now:()=>NOW}).safeTick();
    assert.equal(posts,0);
    f.store.reserve=reserve;
    const op=f.store.reserve('account-a','FIVE_HOUR',snapshot(),NOW);
    assert.equal(op.id,f.store.pending('account-a').id);
  }finally{f.cleanup();}
});

test('crash between response and commit leaves PREPARED and blocks restart',async()=>{
  const f=tempStore();let posts=0;
  try {
    f.store.reserve('account-a','FIVE_HOUR',snapshot(),NOW);
    await new Engine(f.store,{snapshot:async()=>snapshot(),use:async()=>posts++},
      {credentials:fakeCreds,now:()=>NOW,sleep:async()=>{}}).safeTick();
    assert.equal(posts,0);
    assert.equal(f.store.pending('account-a').state,'PREPARED');
  }finally{f.cleanup();}
});

test('week card resets both pools and does not consume a five-hour card',async()=>{
  const f=tempStore({dailyLimit:'unlimited'});const types=[];let current=snapshot({five:99,week:99});
  try {
    const api={snapshot:async()=>current,use:async(_c,t)=>{types.push(t);current=snapshot({five:0,week:0});}};
    const engine=new Engine(f.store,api,{credentials:fakeCreds,now:()=>NOW,sleep:async()=>{}});
    assert.equal(await engine.safeTick(),true);
    assert.deepEqual(types,['WEEK']);
    assert.equal(f.store.count('account-a',NOW),1);
    assert.equal(f.store.lastAt('account-a','FIVE_HOUR'),NOW);
    assert.equal(await engine.safeTick(),true);
    assert.deepEqual(types,['WEEK']);
  }finally{f.cleanup();}
});

test('no week card and depleted week pool never spends five-hour card',()=>{
  assert.equal(choose(snapshot({five:100,week:100,weekCards:0}),DEFAULTS,{now:NOW}).action,null);
  assert.equal(choose(snapshot({five:95,week:30}),DEFAULTS,{now:NOW}).action,'FIVE_HOUR');
});

test('continuity: depletion near free reset is eligible; measured sufficient runway can wait',()=>{
  assert.equal(choose(snapshot({five:100,reset5:NOW+9*60000}),DEFAULTS,{now:NOW}).action,'FIVE_HOUR');
  const old=snapshot({five:94.9,now:NOW-60000,reset5:NOW+9*60000});
  const fresh=snapshot({five:95,reset5:NOW+9*60000});
  assert.equal(choose(fresh,DEFAULTS,{now:NOW,previous:old}).action,null);
});

test('malformed config does not fall back to auto/unlimited',async()=>{
  for(const dailyLimit of [0,-1,NaN,null,'invalid',true])assert.throws(()=>validateConfig({...DEFAULTS,dailyLimit}));
  for(const fiveHourThreshold of [null,'90',NaN,Infinity,0,101])assert.throws(()=>validateConfig({...DEFAULTS,fiveHourThreshold}));
  const f=tempStore();let posts=0;
  try {
    f.store.db.prepare('UPDATE settings SET value=?').run('{ broken json');
    assert.equal(await new Engine(f.store,{snapshot:async()=>snapshot(),use:async()=>posts++},
      {credentials:fakeCreds,now:()=>NOW}).safeTick(),false);
    assert.equal(posts,0);
    assert.throws(()=>new Store(f.paths),{code:'CONFIG_INVALID'});
  }finally{f.cleanup();}
});

test('missing/corrupt existing ledger is never reinitialized by config --init',()=>{
  const f=tempStore();const paths=f.paths;
  f.store.close();fs.writeFileSync(paths.db,'broken database');
  assert.throws(()=>new Store(paths,{initialize:true}));
  fs.rmSync(paths.db);
  assert.throws(()=>new Store(paths,{initialize:true}),{code:'STATE_MISSING'});
  removeFixture(f.parent);
});

test('budget uses Shanghai calendar, pending survives date change, completion charges new date too',()=>{
  assert.equal(dayKey(Date.parse('2026-10-22T17:00:00Z')),'2026-10-23');
  const f=tempStore({dailyLimit:1});
  try {
    const before=Date.parse('2026-10-23T15:59:59Z'),after=before+2000;
    const op=f.store.reserve('account-a','WEEK',snapshot(),before);
    assert.throws(()=>f.store.reserve('account-a','FIVE_HOUR',snapshot(),after),{code:'RESET_PENDING'});
    f.store.settle(op.id,'APPLIED',after);f.store.settle(op.id,'CONFIRMED',after);
    assert.equal(f.store.count('account-a',before),1);assert.equal(f.store.count('account-a',after),1);
    assert.throws(()=>f.store.reserve('account-a','FIVE_HOUR',snapshot(),after+3600000),{code:'BUDGET_EXHAUSTED'});
  }finally{f.cleanup();}
});

test('clock rollback blocks new consumption and stop does not reset accounting',()=>{
  const f=tempStore();
  try {
    f.store.clock(NOW);
    assert.throws(()=>f.store.clock(NOW-60000),{code:'CLOCK_ROLLBACK'});
    f.store.updateRuntime({desired:'stopped'});
    assert.throws(()=>f.store.reserve('account-a','WEEK',snapshot(),NOW),{code:'STOPPED'});
  }finally{f.cleanup();}
});

test('success followed by local commit failure never repeats the accepted POST',async()=>{
  const f=tempStore();let posts=0;
  const settle=f.store.settle.bind(f.store);
  const api={snapshot:async()=>snapshot(),use:async()=>posts++};
  const engine=new Engine(f.store,api,{credentials:fakeCreds,now:()=>NOW,sleep:async()=>{}});
  try {
    f.store.settle=()=>{throw new Error('disk full after accepted request');};
    assert.equal(await engine.safeTick(),false);
    assert.equal(f.store.pending('account-a').state,'PREPARED');
    f.store.settle=settle;
    assert.equal(await engine.safeTick(),false);
    assert.equal(posts,1);
  }finally{f.cleanup();}
});

test('repeated fault does not create recovery/error spam; genuine recovery records once',async()=>{
  const f=tempStore();let fail=true;
  const api={snapshot:async()=>{if(fail)throw new Error('do not expose');return snapshot({five:0,week:0});}};
  const engine=new Engine(f.store,api,{credentials:fakeCreds,now:()=>NOW});
  try {
    await engine.safeTick();await engine.safeTick();
    assert.equal(f.store.events().length,1);
    fail=false;assert.equal(await engine.safeTick(),true);await engine.safeTick();
    assert.equal(f.store.events().length,2);
    assert.equal(f.store.events()[1].code,'HEALTH_RECOVERED');
  }finally{f.cleanup();}
});

function quotaBody() {
  return {code:200,data:{limits:[{unit:3,percentage:95,remaining:100,usage:2000,nextResetTime:NOW+3600000},
    {unit:6,percentage:99,remaining:100,usage:10000,nextResetTime:NOW+86400000}]}};
}
test('quota schema rejects guessed types, invalid percentages/timestamps, duplicate pools and business errors',()=>{
  assert.equal(parseQuota(quotaBody(),NOW).WEEK.usedPct,99);
  for(const mutate of [b=>b.code=500,b=>b.data.limits[0].unit=99,
    b=>b.data.limits[0].percentage='95',b=>b.data.limits[0].percentage=NaN,
    b=>b.data.limits[0].nextResetTime=NOW-1,b=>b.data.limits[0].nextResetTime=NOW/1000,
    b=>b.data.limits.push(b.data.limits[0]),b=>b.data.limits[0].remaining=1800]) {
    const b=quotaBody();mutate(b);assert.throws(()=>parseQuota(b,NOW),{code:'PROTOCOL_CHANGED'});
  }
  assert.throws(()=>parseCards({code:0,data:{}},NOW),{code:'PROTOCOL_CHANGED'});
  assert.equal(parseCards({code:0,data:{available_five_hour_resets:[],available_week_resets:[{expire_at:NOW+1000},{expire_at:NOW-1}]}},NOW).WEEK,1);
});

test('API uses fixed official origins, rejects redirects, never retries, and does not echo upstream secrets',async()=>{
  let calls=0;
  const api=new ZaiApi({fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'https://zcode.z.ai/api/v1/coding-plan/reset/use');
    assert.equal(init.redirect,'error');
    assert.equal(JSON.parse(init.body).idempotency_key,'durable-id');
    throw new Error('SECRET-should-not-leak');
  }});
  await assert.rejects(()=>api.use(fakeCreds(),'WEEK','durable-id'),e=>e.code==='NETWORK_ERROR'&&!e.message.includes('SECRET'));
  assert.equal(calls,1);
});

test('account identity is stable over token refresh and never picks a stale provider key',()=>{
  const token=c=>'header.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.signature';
  const raw={zcodejwttoken:token({sub:'A',user_id:'A',iat:1}),
    'oauth:zai:access_token':token({user_id:'provider-A',customer_id:'customer-A',api_key:'fake-A'}),
    'oauth:zai:user_info':JSON.stringify({user_id:'A'}),
    'account-provider:coding-plan:account:zai-individual-coding-plan:B':'stale-B'};
  const first=parseCredentials(raw,'test');
  const second=parseCredentials({...raw,zcodejwttoken:token({sub:'A',user_id:'A',iat:2})},'test');
  assert.equal(first.account,second.account);
  assert.equal('apiKey' in first,false);
  assert.notEqual(first.account,parseCredentials({...raw,'oauth:zai:access_token':token({user_id:'provider-B'})},'test').account);
  assert.throws(()=>parseCredentials({...raw,'oauth:zai:user_info':JSON.stringify({user_id:'B'})},'test'),{code:'ACCOUNT_AMBIGUOUS'});
});

test('account switch blocks POST; APPLIED operation with stale quota blocks another card',async()=>{
  const f=tempStore();let posts=0;
  try {
    f.store.updateRuntime({account:'other-account'});
    await new Engine(f.store,{snapshot:async()=>snapshot(),use:async()=>posts++},
      {credentials:fakeCreds,now:()=>NOW}).safeTick();
    assert.equal(posts,0);assert.equal(f.store.runtime().error,'ACCOUNT_CHANGED');
    f.store.updateRuntime({account:'account-a'});
    const op=f.store.reserve('account-a','FIVE_HOUR',snapshot(),NOW);
    f.store.settle(op.id,'APPLIED',NOW);
    await new Engine(f.store,{snapshot:async()=>snapshot(),use:async()=>posts++},
      {credentials:fakeCreds,now:()=>NOW}).safeTick();
    assert.equal(posts,0);
    assert.equal(f.store.pending('account-a').state,'APPLIED');
  }finally{f.cleanup();}
});
