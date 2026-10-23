export function choose(snapshot, config, { lastAt=()=>0, now=Date.now(), previous=null, pending=false, usedToday=0 }={}) {
  if(pending)return {action:null,reason:'上次用卡待确认，自动消费已暂停。'};
  if(config.dailyLimit!=='unlimited'&&usedToday>=config.dailyLimit)return {action:null,reason:'已达到每日自动用卡上限。'};
  const q=snapshot.quota, cards=snapshot.cards;
  if(q.WEEK.usedPct>=100 && cards.WEEK===0)return {action:null,reason:'周额度耗尽且无周卡，保留五小时卡。'};
  const type=q.WEEK.usedPct>=config.weekThreshold && cards.WEEK>0 ? 'WEEK'
    : q.FIVE_HOUR.usedPct>=config.fiveHourThreshold && cards.FIVE_HOUR>0 ? 'FIVE_HOUR' : null;
  if(!type)return {action:null,reason:'未达到重置条件，或没有对应重置卡。'};
  if(now-lastAt(type)<config.cooldownMs)return {action:null,reason:'仍在冷却时间内。'};
  const target=q[type], until=target.nextResetTime-now;
  if(target.usedPct<100 && target.remaining>0 && until<=config.rolloverGraceMs && previous) {
    const old=previous.quota[type], dt=now-previous.fetchedAt;
    if(old.nextResetTime===target.nextResetTime && dt>=1000 && dt<=300000) {
      const consumed=old.remaining-target.remaining;
      if(consumed>0 && target.remaining/consumed*dt>=until+30000)
        return {action:null,reason:'按近期消耗估计，额度足够等待自然刷新。'};
    }
  }
  return {action:type,reason:type==='WEEK'?'周额度达到阈值，优先用周卡恢复两个额度池。':'五小时额度达到阈值。'};
}
export function effectVisible(before, after, type) {
  const improved = t => after.quota[t].usedPct < before.quota[t].usedPct
    || after.quota[t].remaining > before.quota[t].remaining;
  return improved(type) && (type!=='WEEK' || before.quota.FIVE_HOUR.usedPct===0 || improved('FIVE_HOUR'));
}
