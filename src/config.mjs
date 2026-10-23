import { ensure } from './errors.mjs';
export const DEFAULTS = Object.freeze({
  dailyLimit: 2, fiveHourThreshold: 90, weekThreshold: 97,
  pollMs: 60000, cooldownMs: 1800000, rolloverGraceMs: 600000,
  timeZone: 'Asia/Shanghai', autostart: false, notifications: true
});
export function validateConfig(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'CONFIG_INVALID', '配置格式错误，自动用卡未启用。');
  ensure(Object.keys(value).length === Object.keys(DEFAULTS).length && Object.keys(value).every(k => k in DEFAULTS),
    'CONFIG_INVALID', '配置字段缺失或不受支持，自动用卡未启用。');
  ensure(value.dailyLimit === 'unlimited' || (Number.isSafeInteger(value.dailyLimit) && value.dailyLimit > 0),
    'CONFIG_INVALID', '每日上限必须是正整数或 unlimited。');
  for (const k of ['fiveHourThreshold', 'weekThreshold'])
    ensure(Number.isFinite(value[k]) && value[k] >= 1 && value[k] <= 100, 'CONFIG_INVALID', '额度阈值必须为 1 到 100 的数字。');
  for (const [k, min, max] of [['pollMs',15000,3600000], ['cooldownMs',60000,86400000], ['rolloverGraceMs',0,3600000]])
    ensure(Number.isSafeInteger(value[k]) && value[k] >= min && value[k] <= max, 'CONFIG_INVALID', '轮询、冷却或刷新宽限时间不合法。');
  ensure(value.timeZone === 'Asia/Shanghai' && typeof value.autostart === 'boolean' && typeof value.notifications === 'boolean',
    'CONFIG_INVALID', '预算时区、自启或通知配置不合法。');
  return { ...value };
}
export function dayKey(now) {
  const p = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = type => p.find(x => x.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
