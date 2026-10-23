import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Fault, ensure } from './errors.mjs';
export function decrypt(value, secret) {
  ensure(typeof value==='string','AUTH_REQUIRED','ZCode 登录凭证缺失。');
  if(!value.startsWith('enc:v1:'))return value;
  const parts=value.slice(7).split('.');
  ensure(parts.length===3,'AUTH_REQUIRED','ZCode 凭证格式无法识别，请重新登录。');
  const d=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(parts[0],'base64url'));
  d.setAuthTag(Buffer.from(parts[1],'base64url'));
  return Buffer.concat([d.update(Buffer.from(parts[2],'base64url')),d.final()]).toString('utf8');
}
function claims(token) {
  try { return JSON.parse(Buffer.from(token.replace(/^Bearer /,'').split('.')[1],'base64url')); }
  catch { throw new Fault('AUTH_REQUIRED','ZCode 登录凭证无法识别。'); }
}
export function parseCredentials(raw, secret, now=Date.now()) {
  try {
    const jwt=decrypt(raw.zcodejwttoken,secret),oauth=decrypt(raw['oauth:zai:access_token'],secret);
    const a=claims(jwt),b=claims(oauth);
    const identity=a.user_id ?? a.sub;
    ensure((typeof identity==='string'||typeof identity==='number') && String(identity).length>0,
      'ACCOUNT_AMBIGUOUS','无法确定稳定账号身份，自动用卡未启用。');
    if(a.user_id!=null && a.sub!=null)ensure(String(a.user_id)===String(a.sub),'ACCOUNT_AMBIGUOUS','ZCode 账号身份不一致。');
    for(const c of [a,b])if(c.exp!=null)ensure(typeof c.exp==='number' && c.exp*1000>now,'AUTH_REQUIRED','ZCode 登录已过期，请在 ZCode 中重新登录。');
    // User-info is paired with OAuth by ZCode. Do not combine an arbitrary stored provider API key.
    ensure(typeof raw['oauth:zai:user_info']==='string','ACCOUNT_AMBIGUOUS','缺少账号身份信息，请在 ZCode 中重新登录。');
    const info=JSON.parse(decrypt(raw['oauth:zai:user_info'],secret));
    ensure(String(info.user_id)===String(identity),'ACCOUNT_AMBIGUOUS','ZCode 登录账号与 OAuth 账号不一致。');
    // Provider and ZCode use different ID namespaces. Bind both, rather than compare them
    // or use a token hash that would change on every refresh.
    ensure((typeof b.user_id==='string'||typeof b.user_id==='number') && String(b.user_id).length>0,
      'ACCOUNT_AMBIGUOUS','无法确定 OAuth 提供商的稳定账号身份。');
    const account=crypto.createHash('sha256').update(JSON.stringify(['zai-personal',String(identity),String(b.user_id)])).digest('hex');
    return {jwt,oauth,account};
  } catch(e) {
    if(e instanceof Fault)throw e;
    throw new Fault('AUTH_REQUIRED','无法读取或解密 ZCode 登录凭证，请重新登录。');
  }
}
export function loadCredentials() {
  try {
    let username;
    try {username=os.userInfo().username;}catch{username=process.env.USERNAME;}
    ensure(username,'AUTH_REQUIRED','无法确定当前用户的凭证环境。');
    const secret=process.env.ZCODE_CREDENTIAL_SECRET
      ?? 'zcode-credential-fallback:'+os.platform()+':'+os.homedir()+':'+username;
    const raw=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.zcode','v2','credentials.json'),'utf8'));
    return parseCredentials(raw,secret);
  } catch(e) {
    if(e instanceof Fault)throw e;
    throw new Fault('AUTH_REQUIRED','尚未找到有效的 ZCode 登录，请先在 ZCode 中登录。');
  }
}
