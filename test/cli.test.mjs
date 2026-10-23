import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { locations } from '../src/paths.mjs';
import { removeFixture } from '../scripts/temp.mjs';
const entry=fileURLToPath(new URL('../bin/zwd.mjs',import.meta.url));
function envFixture() {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zwd-cli-'));
  const home=path.join(parent,'中文 data'),env={...process.env,ZWD_HOME:home};
  return {home,parent,run:(args=[])=>spawnSync(process.execPath,[entry,...args],{env,encoding:'utf8',windowsHide:true,timeout:10000}),
    clean:()=>removeFixture(parent)};
}
test('help, status and offline doctor are non-mutating and do not require credentials',()=>{
  const f=envFixture();
  try {
    assert.equal(f.run(['--help']).status,0);
    assert.equal(f.run(['--version']).stdout.trim(),'2.0.0-beta.1');
    const status=f.run(['--json']);assert.equal(status.status,0,status.stderr);
    assert.equal(JSON.parse(status.stdout).runtime.phase,'NOT_CONFIGURED');
    assert.equal(f.run(['doctor']).status,0);
    assert.equal(f.run(['config','--init','--daily-limit','0']).status,2);
    assert.equal(fs.existsSync(f.home),false);
  }finally{f.clean();}
});
test('config init does not activate; unlimited persists; invalid input does not modify data',()=>{
  const f=envFixture();
  try {
    assert.equal(f.run(['config','--init']).status,0);
    assert.equal(f.run(['config','--daily-limit','unlimited']).status,0);
    const paths=locations(f.home);let store=new Store(paths,{readOnly:true});
    assert.equal(store.config().value.dailyLimit,'unlimited');
    assert.equal(store.runtime().desired,'stopped');
    const revision=store.config().revision;store.close();
    for(const args of [['config','--daily-limit','oops'],['config','--daily-limit','0'],
      ['config','--week-threshold','101'],['config','--autostart','invalid'],['start','--init'],['no-such-command']])
      assert.notEqual(f.run(args).status,0);
    store=new Store(paths,{readOnly:true});
    assert.equal(store.config().revision,revision);assert.equal(store.runtime().desired,'stopped');store.close();
  }finally{f.clean();}
});
test('public output never reflects unexpected exceptions or raw credential/provider content',()=>{
  const f=envFixture();
  try {
    assert.equal(f.run(['config','--init']).status,0);
    const store=new Store(locations(f.home));
    store.db.prepare('UPDATE settings SET value=?').run('SECRET-do-not-print');
    store.close();
    const result=f.run(['--json']);
    assert.equal(result.status,1);
    assert(!result.stdout.includes('SECRET'));
    assert(!result.stderr.includes('SECRET'));
    assert.equal(JSON.parse(result.stdout).storageError.code,'CONFIG_INVALID');
  }finally{f.clean();}
});
