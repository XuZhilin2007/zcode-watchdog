import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function removeFixture(directory) {
  const target=fs.realpathSync(directory),root=fs.realpathSync(os.tmpdir());
  if(path.dirname(target)!==root || !/^zwd-(test|cli|pack|package)-/.test(path.basename(target)))
    throw new Error('Refusing to remove a directory outside the owned temporary fixtures.');
  fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
