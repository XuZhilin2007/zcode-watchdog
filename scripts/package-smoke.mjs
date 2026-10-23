import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { removeFixture } from './temp.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'zwd-package-'));
try {
const prefix=path.join(temp,'prefix'),home=path.join(temp,'中文 data');
fs.writeFileSync(path.join(temp,'npmrc'),'');
const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const result=spawnSync(process.execPath,[npm,'--userconfig',path.join(temp,'npmrc'),'--cache',path.join(temp,'cache'),
  'install','--global','--prefix',prefix,'--ignore-scripts','--offline',
  path.join(root,'dist','zcode-watchdog-'+pkg.version+'.tgz')],{encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(result.status,0,result.stderr);
assert.equal(fs.existsSync(home),false);
const shim=path.join(prefix,process.platform==='win32'?'zwd.cmd':'bin/zwd');
assert(fs.existsSync(shim));
function run(args) {
  if(process.platform==='win32')return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(root,'test','fixtures','installed-cli.ps1')],{
    input:JSON.stringify({home,shim,arguments:args}),encoding:'utf8',windowsHide:true,timeout:15000});
  return spawnSync(shim,args,{env:{...process.env,ZWD_HOME:home},encoding:'utf8',timeout:15000});
}
const version=run(['--version']);assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),pkg.version);
assert.equal(run(['--help']).status,0);assert.equal(fs.existsSync(home),false);
const configured=run(['config','--init']);assert.equal(configured.status,0,configured.stderr);
const status=run(['--json']);assert.equal(status.status,0,status.stderr);
assert.equal(JSON.parse(status.stdout).runtime.desired,'stopped');
assert.equal(JSON.parse(status.stdout).process,'not responding');
assert(!fs.existsSync(path.join(home,'worker.vbs')));
console.log('Packed CLI installed to isolated prefix; PowerShell shim, Unicode data path and inactive initialization passed.');
} finally { removeFixture(temp); }
