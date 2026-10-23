import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const script=fileURLToPath(new URL('../scripts/notify.ps1',import.meta.url));
const MESSAGES={
  AUTH_REQUIRED:'ZCode 登录不可用，请重新登录后检查 zwd。',
  AUTH_OR_PLAN_UNAVAILABLE:'登录、权限或套餐不可用，请检查 ZCode。',
  ACCOUNT_CHANGED:'ZCode 账号已切换，自动重置已暂停。',
  RESET_PENDING:'用卡结果待确认，后续消费已暂停。请运行 zwd reconcile。',
  NETWORK_ERROR:'无法检查额度，请查看网络与 zwd 状态。',
  BUDGET_EXHAUSTED:'已达到每日自动用卡上限。',
  PROTOCOL_CHANGED:'额度接口响应变化，自动用卡已暂停。',
  HEARTBEAT_STALE:'后台检查长时间未更新，请运行 zwd doctor。',
  HEALTH_RECOVERED:'额度检查已恢复正常。',
  NO_CARDS:'额度已达到阈值，但没有对应重置卡。',
  INTERNAL_ERROR:'后台检查异常，请运行 zwd doctor。'
};
export function notifyWindows(code,spawnImpl=spawn) {
  if(process.platform!=='win32')return;
  const message=MESSAGES[code]||MESSAGES.INTERNAL_ERROR;
  try {
    const child=spawnImpl('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',script],
      {stdio:['pipe','ignore','ignore'],windowsHide:true,detached:true});
    child.on('error',()=>{});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({message}));
    child.unref();
  }catch{}
}
