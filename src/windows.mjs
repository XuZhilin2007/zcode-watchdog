import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Fault, ensure } from './errors.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const taskName=()=> 'ZCodeWatchdogV2-'+createHash('sha256').update(os.homedir().toLowerCase()).digest('hex').slice(0,12);
const vbsString=s=>'"'+s.replaceAll('"','""')+'"';
export function launcher(node,entry,home,{scheduled=false}={}) {
  for(const v of [node,entry,home])ensure(!/[\r\n\0"]/.test(v),'PATH_INVALID','启动路径不合法。');
  const cmd='"'+node+'" "'+entry+'" '+(scheduled?'_scheduled':'_worker')+' --home "'+home+'"';
  return 'Option Explicit\r\nDim shell, result\r\nSet shell = CreateObject("WScript.Shell")\r\n'
    +'result = shell.Run('+vbsString(cmd)+', 0, True)\r\nWScript.Quit result\r\n';
}
export function writeLauncher(paths,scheduled=false) {
  const p=path.join(paths.home,scheduled?'scheduled.vbs':'worker.vbs');
  const text=launcher(process.execPath,path.join(ROOT,'bin','zwd.mjs'),paths.home,{scheduled});
  fs.writeFileSync(p,Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')]));
  return p;
}
export function launch(paths) {
  ensure(process.platform==='win32','WINDOWS_REQUIRED','后台模式当前仅支持 Windows。');
  const vbs=writeLauncher(paths);
  const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','wscript.exe'),['//B',vbs],
    {detached:true,stdio:'ignore',windowsHide:true});
  child.on('error',()=>{});
  child.unref();
}
export function scheduler(paths,action,run=spawnSync) {
  ensure(process.platform==='win32','WINDOWS_REQUIRED','登录自启当前仅支持 Windows。');
  const payload={task:taskName(),home:paths.home,launcher:action==='install'?writeLauncher(paths,true):path.join(paths.home,'scheduled.vbs')};
  const result=run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(ROOT,'scripts','scheduler.ps1'),'-Action',action],
    {input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:262144});
  if(result.status!==0)throw new Fault('SCHEDULER_ERROR','计划任务操作失败；配置已保存，请运行 zwd doctor 检查权限与 Windows Script Host。');
  return result.stdout?.trim()||'';
}
