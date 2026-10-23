import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locations } from '../src/paths.mjs';
import { Store } from '../src/store.mjs';
import { removeFixture } from '../scripts/temp.mjs';
export const NOW=Date.parse('2026-10-23T04:00:00Z');
export function tempStore(config={}) {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zwd-test-'));
  const paths=locations(path.join(parent,'data'));
  const store=new Store(paths,{initialize:true});
  store.configure(config);
  store.updateRuntime({desired:'running'});
  return {store,paths,parent,cleanup(){store.close();removeFixture(parent);}};
}
export function snapshot({five=95,week=10,fiveCards=5,weekCards=5,now=NOW,reset5=now+4*3600000}={}) {
  const pool=(pct,total,time)=>({usedPct:pct,remaining:total*(1-pct/100),total,nextResetTime:time});
  return {quota:{FIVE_HOUR:pool(five,2000,reset5),WEEK:pool(week,10000,now+3*86400000)},
    cards:{FIVE_HOUR:fiveCards,WEEK:weekCards},fetchedAt:now};
}
export const fakeCreds=()=>({jwt:'fake-jwt',oauth:'fake-oauth',account:'account-a'});
