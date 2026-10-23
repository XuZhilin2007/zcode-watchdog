import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempStore } from './helpers.mjs';
import { notifyWindows } from '../src/notify.mjs';
const script=fileURLToPath(new URL('../scripts/scheduler.ps1',import.meta.url));
test('notification receives fixed local text, never the supplied error code or exception body',{skip:process.platform!=='win32'},()=>{
  let input='',args,options;
  notifyWindows('SECRET-upstream-body',(_exe,a,o)=>{
    args=a;options=o;
    const child=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=s=>{input=s;};child.unref=()=>{};
    return child;
  });
  assert(!input.includes('SECRET'));assert(input.includes('zwd doctor'));
  assert.equal(options.windowsHide,true);
  assert(args.includes('-File'));assert(!args.includes('-Command'));
});
test('scheduled task installation/removal on disposable GitHub Windows runner only',
  {skip:process.platform!=='win32'||process.env.ZWD_CI_TASK_TEST!=='1'},()=>{
  const f=tempStore(),task='ZCodeWatchdogV2-'+crypto.randomBytes(6).toString('hex');
  const launcher=path.join(f.parent,'fixture.vbs');
  fs.writeFileSync(launcher,Buffer.concat([Buffer.from([255,254]),Buffer.from('WScript.Quit 0','utf16le')]));
  const payload=JSON.stringify({task,home:f.paths.home,launcher});
  const invoke=action=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action],
    {input:payload,encoding:'utf8',windowsHide:true,timeout:20000});
  try {
    const created=invoke('install');assert.equal(created.status,0,created.stdout+created.stderr);
    const inspected=invoke('inspect');assert.equal(inspected.status,0,inspected.stdout+inspected.stderr);
    assert(!inspected.stdout.includes('not installed'));
    const removed=invoke('remove');assert.equal(removed.status,0,removed.stdout+removed.stderr);
    assert(invoke('inspect').stdout.includes('not installed'));
  }finally{invoke('remove');f.cleanup();}
});
