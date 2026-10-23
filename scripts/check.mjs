import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/cli.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!==VERSION)throw new Error('CLI/package version mismatch');
for(const dir of ['src','bin','scripts','test']) {
  for(const file of fs.readdirSync(path.join(root,dir),{recursive:true}).filter(x=>x.endsWith('.mjs'))) {
    const result=spawnSync(process.execPath,['--check',path.join(root,dir,file)],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw new Error(result.stderr);
  }
}
console.log('Syntax and version checks passed.');
