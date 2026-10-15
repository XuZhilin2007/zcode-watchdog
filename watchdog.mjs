#!/usr/bin/env node
// ZCode Coding Plan 额度看门狗：轮询 z.ai 额度接口，5 小时窗口 / 周额度接近耗尽时自动使用对应重置卡。
// 不依赖 ZCode 运行（凭证从本地 credentials.json 读取并解密，每轮刷新）。
// 用法: node watchdog.mjs [--once] [--dry-run]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "config.json");
const STATE_PATH = path.join(DIR, "watchdog-state.json");
const LOG_PATH = path.join(DIR, "watchdog.log");
const CREDENTIALS_PATH = path.join(os.homedir(), ".zcode", "v2", "credentials.json");

const DEFAULT_CONFIG = {
  pollMs: 60_000,               // 轮询间隔
  thresholdPct: 90,             // 5小时窗口已用达到该值（剩余10%）→ 用五小时卡
  weekThresholdPct: 97,         // 周额度已用达到该值（剩余3%）→ 用周卡
  maxCardsPerDay: 0,            // 每日自动用卡总量上限，0 = 不限量
  cooldownMs: 30 * 60_000,      // 同一类型两次用卡的最小间隔
  rolloverGraceMs: 10 * 60_000, // 自然刷新前多久不再用卡（等免费刷新）
  dryRun: false,                // true = 只记录将要做的动作，不真正用卡
};

const RESET_BASE = "https://zcode.z.ai/api/v1/coding-plan/reset";
const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

const once = process.argv.includes("--once");
const cliDryRun = process.argv.includes("--dry-run");

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
const config = { ...DEFAULT_CONFIG, ...loadJson(CONFIG_PATH, {}) };
const dryRun = config.dryRun || cliDryRun;
const state = loadJson(STATE_PATH, { cardsUsedToday: 0, dayKey: "", lastCardAt: {} });
// 兼容旧版 state（lastCardAt 曾是数字时间戳）
if (typeof state.lastCardAt !== "object" || state.lastCardAt === null) state.lastCardAt = {};

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

function log(msg) {
  const line = `[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    // 超过 5MB 轮转一次，防止无人值守时长跑把日志写爆
    try {
      const st = fs.statSync(LOG_PATH);
      if (st.size > LOG_ROTATE_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + ".1");
    } catch { /* 日志尚不存在 */ }
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch { /* 写日志失败不能拖垮监控本身 */ }
}

// ---- credentials.json enc:v1 解密（与 ZCode 客户端逻辑一致）----
function decrypt(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) return value;
  const secret = process.env.ZCODE_CREDENTIAL_SECRET
    ?? `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`;
  const key = crypto.createHash("sha256").update(secret).digest();
  const [iv, tag, ct] = value.slice("enc:v1:".length).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

function loadCredentials() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const dec = {};
  for (const [k, v] of Object.entries(raw)) {
    try { dec[k] = decrypt(v); } catch { /* 单项解密失败不整体崩溃 */ }
  }
  // coding-plan 账号 key 可能变，按前缀动态匹配
  const apiKeyEntry = Object.keys(dec).find(k =>
    k.startsWith("account-provider:coding-plan:account:zai-individual-coding-plan:"));
  return {
    jwt: dec["zcodejwttoken"] ?? "",
    oauth: dec["oauth:zai:access_token"] ?? "",
    apiKey: apiKeyEntry ? dec[apiKeyEntry] : "",
  };
}

async function api(name, url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body; // 均为 {code, msg, data} 包装
}

function parseLimit(l) {
  if (!l) return null;
  return {
    usedPct: l.percentage ?? 0,
    remaining: l.remaining,
    usage: l.usage,
    nextResetTime: l.nextResetTime ?? null,
  };
}

async function fetchQuota(creds) {
  const body = await api("quota", QUOTA_URL, { headers: { authorization: creds.apiKey || creds.oauth } });
  const limits = body?.data?.limits;
  if (!Array.isArray(limits) || limits.length === 0) throw new Error("quota 响应缺少 limits");
  // unit 3 = 5小时窗口；unit 6 = 周额度。编号对不上时按自然刷新时间兜底：
  // 刷新最早的视为 5h 窗口，另一条视为周额度，避免接口微调后保护静默失效。
  let l5 = limits.find(l => l.unit === 3);
  let lw = limits.find(l => l.unit === 6);
  if (!l5 || !lw) {
    const sorted = limits.slice().sort((a, b) => (a.nextResetTime ?? Infinity) - (b.nextResetTime ?? Infinity));
    l5 = l5 ?? sorted[0];
    lw = lw ?? sorted.find(l => l !== l5);
  }
  return {
    FIVE_HOUR: parseLimit(l5),
    WEEK: parseLimit(lw),
    level: body?.data?.level,
  };
}

async function fetchResetStatus(creds) {
  const body = await api("reset/status", `${RESET_BASE}/status`, {
    headers: {
      Authorization: creds.jwt.startsWith("Bearer ") ? creds.jwt : `Bearer ${creds.jwt}`,
      "X-Bigmodel-Authorization": creds.oauth,
      "Bigmodel-Target-Type": "PERSONAL",
    },
  });
  if (body.code !== 0) throw new Error(`reset/status code=${body.code} ${body.msg}`);
  const now = Date.now();
  return {
    FIVE_HOUR: (body.data?.available_five_hour_resets ?? []).filter(r => (r.expire_at ?? 0) > now).length,
    WEEK: (body.data?.available_week_resets ?? []).filter(r => (r.expire_at ?? 0) > now).length,
  };
}

async function useCard(creds, resetType) {
  const body = await api("reset/use", `${RESET_BASE}/use`, {
    method: "POST",
    headers: {
      Authorization: creds.jwt.startsWith("Bearer ") ? creds.jwt : `Bearer ${creds.jwt}`,
      "X-Bigmodel-Authorization": creds.oauth,
      "Bigmodel-Target-Type": "PERSONAL",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomBytes(16).toString("hex"),
      reset_type: resetType,
    }),
  });
  if (body.code !== 0 || body.data?.used !== true) throw new Error(`reset/use 失败: ${JSON.stringify(body).slice(0, 200)}`);
}

function saveState() { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }

function dailyFuse() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dayKey !== today) { state.dayKey = today; state.cardsUsedToday = 0; saveState(); }
}

// 单个额度类型的完整判断与用卡流程
async function maybeReset(creds, resetType, quota, availCards, threshold, label) {
  if (!quota) return;
  dailyFuse();
  const now = Date.now();
  const msToRoll = quota.nextResetTime ? quota.nextResetTime - now : Infinity;
  if (quota.usedPct < threshold) return;
  if (availCards <= 0) { log(`${label}已用 ${quota.usedPct}% 但没有可用的重置卡，跳过`); return; }
  if (msToRoll < config.rolloverGraceMs) { log(`${label}已用 ${quota.usedPct}% 但 ${Math.round(msToRoll / 60000)} 分钟后自然刷新，等刷新不用卡`); return; }

  if (config.maxCardsPerDay > 0 && state.cardsUsedToday >= config.maxCardsPerDay) { log(`今日已用 ${state.cardsUsedToday} 张，达到每日上限，不再用卡`); return; }
  const lastAt = state.lastCardAt?.[resetType] ?? 0;
  if (now - lastAt < config.cooldownMs) { log(`${label}距上次用卡不足冷却时间，跳过`); return; }

  if (dryRun) { log(`[dry-run] 将使用一张 ${resetType} 重置卡（${label}已用 ${quota.usedPct}%）`); return; }

  log(`触发 ${label}重置：已用 ${quota.usedPct}% ≥ ${threshold}%`);
  await useCard(creds, resetType);
  state.cardsUsedToday += 1;
  state.lastCardAt[resetType] = now;
  saveState();
  log(`${resetType} 重置卡已使用（今日累计 ${state.cardsUsedToday} 张）`);
}

async function tick() {
  const creds = loadCredentials();
  if (!creds.jwt || !creds.oauth) { log("凭证缺失或不完整（ZCode 是否登录过？），本轮跳过"); return; }

  const quota = await fetchQuota(creds);
  const reset = await fetchResetStatus(creds);
  const q5 = quota.FIVE_HOUR, qw = quota.WEEK;
  log(`5h已用 ${q5 ? q5.usedPct + "% (剩" + q5.remaining + "/" + q5.usage + ")" : "无数据"} | ` +
      `周已用 ${qw ? qw.usedPct + "% (剩" + qw.remaining + "/" + qw.usage + ")" : "无数据"} | ${quota.level} | ` +
      `可重置卡 5h:${reset.FIVE_HOUR} 周:${reset.WEEK}`);

  await maybeReset(creds, "FIVE_HOUR", q5, reset.FIVE_HOUR, config.thresholdPct, "五小时窗口");
  await maybeReset(creds, "WEEK", qw, reset.WEEK, config.weekThresholdPct, "周额度");

  // 任一类型刚用过卡则复查一次额度
  if (Object.values(state.lastCardAt ?? {}).some(t => Date.now() - t < 10_000)) {
    await new Promise(r => setTimeout(r, 5000));
    const after = await fetchQuota(creds);
    log(`复查：5h已用 ${after.FIVE_HOUR?.usedPct}%，周已用 ${after.WEEK?.usedPct}%`);
  }
}

async function main() {
  log(`看门狗启动: 轮询 ${config.pollMs / 1000}s, 5h阈值 ${config.thresholdPct}%, ` +
      `周阈值 ${config.weekThresholdPct}%, 每日上限 ${config.maxCardsPerDay > 0 ? config.maxCardsPerDay + " 张" : "不限"}, ` +
      `dryRun=${dryRun}${once ? ", 单次模式" : ""}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log(`本轮异常（下轮重试）: ${e.message}`);
    }
    if (once) break;
    await new Promise(r => setTimeout(r, config.pollMs));
  }
}

main();
