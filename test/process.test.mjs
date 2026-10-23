import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tempStore,NOW } from './helpers.mjs';
import { Store } from '../src/store.mjs';
import { pipeName } from '../src/paths.mjs';
import { request } from '../src/control.mjs';
import { launcher } from '../src/windows.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const childFile=name=>path.join(dir,'fixtures',name);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function child(file,args) {
  const p=spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';
  p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>resolve({code,stdout,stderr}));});
  return {p,done};
}
test('independent OS processes cannot both reserve; killed process leaves durable reservation',async()=>{
  const f=tempStore({dailyLimit:'unlimited'});
  try {
    const children=[child(childFile('reserve-child.mjs'),[f.paths.home]),child(childFile('reserve-child.mjs'),[f.paths.home])];
    const result=await Promise.all(children.map(c=>c.done));
    assert.deepEqual(result.map(r=>r.stdout).sort(),['RESET_PENDING','reserved']);
    assert.equal(f.store.count('account-a',NOW),1);
  }finally{f.cleanup();}
  const g=tempStore();
  try {
    const result=await child(childFile('crash-child.mjs'),[g.paths.home]).done;
    assert.equal(result.code,73);
    const recovered=new Store(g.paths);
    assert.equal(recovered.pending('account-a').state,'PREPARED');
    assert.equal(recovered.count('account-a',NOW),1);
    recovered.close();
  }finally{g.cleanup();}
});

test('worker IPC is exclusive, reload acknowledges, stop persists and scheduled relaunch is a no-op',async()=>{
  const f=tempStore(),endpoint=pipeName(f.parent);
  let first,second,firstDone=false,secondDone=false;
  try {
    first=child(childFile('worker-child.mjs'),[f.paths.home,endpoint]);
    for(let i=0;i<100;i++){try{await request(endpoint,f.paths.home);break;}catch{await sleep(25);}}
    assert.equal((await request(endpoint,f.paths.home)).desired,'running');
    second=child(childFile('worker-child.mjs'),[f.paths.home,endpoint]);
    assert.equal((await second.done).code,0);secondDone=true;
    const updated=f.store.configure({dailyLimit:'unlimited'});
    await request(endpoint,f.paths.home,'reload');
    for(let i=0;i<40&&f.store.runtime().activeRevision<updated.revision;i++)await sleep(25);
    assert.equal(f.store.runtime().activeRevision,updated.revision);
    await assert.rejects(()=>request(endpoint,f.paths.home+'-wrong','stop'));
    assert.equal(f.store.runtime().desired,'running');
    await request(endpoint,f.paths.home,'stop');
    assert.equal((await first.done).code,0);firstDone=true;
    assert.equal(f.store.runtime().desired,'stopped');
    assert.equal(f.store.runtime().phase,'STOPPED');
    const relaunched=await child(childFile('worker-child.mjs'),[f.paths.home,endpoint]).done;
    assert.equal(relaunched.code,0);
    await assert.rejects(()=>request(endpoint,f.paths.home));
    assert.equal(f.store.allPending().length,0);
  }finally{
    if(first&&!firstDone){first.p.kill();await first.done;}
    if(second&&!secondDone){second.p.kill();await second.done;}
    f.cleanup();
  }
});

test('worker crash releases the OS lock so another instance can recover',async()=>{
  const f=tempStore(),endpoint=pipeName(f.parent);let running;
  try {
    running=child(childFile('worker-child.mjs'),[f.paths.home,endpoint]);
    for(let i=0;i<80;i++){try{await request(endpoint,f.paths.home);break;}catch{await sleep(25);}}
    await request(endpoint,f.paths.home);
    running.p.kill('SIGKILL');await running.done;
    running=child(childFile('worker-child.mjs'),[f.paths.home,endpoint]);
    for(let i=0;i<80;i++){try{await request(endpoint,f.paths.home);break;}catch{await sleep(25);}}
    assert.equal((await request(endpoint,f.paths.home)).desired,'running');
    await request(endpoint,f.paths.home,'stop');await running.done;running=null;
  }finally{if(running){running.p.kill();await running.done;}f.cleanup();}
});

test('Unicode VBS launcher forwards child exit code (no real watchdog or scheduled task)',{skip:process.platform!=='win32'},async()=>{
  const f=tempStore();
  try {
    const home=path.join(f.parent,'中文 空格 & path');
    fs.mkdirSync(home);
    const entry=path.join(home,'exit.mjs');fs.writeFileSync(entry,'process.exit(7);');
    const vbs=path.join(home,'launch.vbs');
    fs.writeFileSync(vbs,Buffer.concat([Buffer.from([255,254]),Buffer.from(launcher(process.execPath,entry,home),'utf16le')]));
    const r=spawnSync('cscript.exe',['//NoLogo','//T:10',vbs],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(r.status,7,r.stdout+r.stderr);
  }finally{f.cleanup();}
});
