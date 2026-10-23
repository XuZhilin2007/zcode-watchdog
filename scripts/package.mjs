import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeFixture } from './temp.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'zwd-pack-'));
try {
const dist=path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});
fs.writeFileSync(path.join(temp,'npmrc'),'');
const args=['--userconfig',path.join(temp,'npmrc'),'--cache',path.join(temp,'cache'),
  'pack','--ignore-scripts','--json','--pack-destination',dist];
// Invoke npm's JS entrypoint, avoiding shell interpolation and PowerShell shim policy.
let npmCli=process.env.npm_execpath;
if(!npmCli||!npmCli.endsWith('.js')) {
  const candidate=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  if(fs.existsSync(candidate))npmCli=candidate;
}
if(!npmCli||!fs.existsSync(npmCli))throw new Error('Run through npm run pack:release or provide npm_execpath.');
const result=spawnSync(process.execPath,[npmCli,...args],{cwd:root,encoding:'utf8',windowsHide:true});
if(result.status!==0)throw new Error('npm pack failed: '+result.stderr);
const info=JSON.parse(result.stdout)[0];
for(const item of info.files) {
  if(!/^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|(?:bin|src|scripts|docs)\/)/.test(item.path)
    || /(?:\.sqlite|\.log|credentials|\.env)(?:$|[./])/.test(item.path.replace('src/credentials.mjs','src/auth.mjs')))
    throw new Error('Unexpected package file: '+item.path);
}
const archive=path.join(dist,info.filename);
const hash=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(path.join(dist,'SHA256SUMS'),hash+'  '+info.filename+'\n');
console.log(JSON.stringify({filename:info.filename,sha256:hash,files:info.files.map(x=>x.path)},null,2));
} finally { removeFixture(temp); }
