import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DEFAULTS, validateConfig, dayKey } from './config.mjs';
import { Fault, ensure } from './errors.mjs';

const ACTIVE = ['PREPARED','UNKNOWN','APPLIED'];
export class Store {
  constructor(paths, { initialize = false, readOnly = false } = {}) {
    this.paths = paths; this.readOnly = readOnly;
    try {
    if (!fs.existsSync(paths.db)) {
      ensure(initialize && !fs.existsSync(paths.home), 'STATE_MISSING',
        '本地账本不存在。首次使用请运行 zwd config --init；已有目录缺失账本时请先检查备份。');
      fs.mkdirSync(paths.home, { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(paths.db);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      this.db.exec([
        'CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, clock INTEGER NOT NULL);',
        'INSERT INTO meta VALUES (1, 1, 0);',
        'CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, value TEXT NOT NULL);',
        'CREATE TABLE runtime (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);',
        'CREATE TABLE operations (id TEXT PRIMARY KEY, account TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, before TEXT NOT NULL, reason TEXT);',
        "CREATE UNIQUE INDEX one_active ON operations(account) WHERE state IN ('PREPARED','UNKNOWN','APPLIED');",
        'CREATE TABLE charges (operation TEXT NOT NULL REFERENCES operations(id), day TEXT NOT NULL, PRIMARY KEY(operation,day));',
        'CREATE TABLE events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL);'
      ].join('\n'));
      this.db.prepare('INSERT INTO settings VALUES (1,1,?)').run(JSON.stringify(DEFAULTS));
      this.db.prepare('INSERT INTO runtime VALUES (1,?)').run(JSON.stringify({ desired:'stopped', phase:'STOPPED', heartbeat:0 }));
    } else {
      this.db = new DatabaseSync(paths.db, { readOnly });
      if (!readOnly) this.db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    }
      ensure(this.db.prepare('SELECT version FROM meta WHERE id=1').get()?.version === 1,
        'STATE_INVALID','账本版本不受支持，请勿删除账本后重试。');
      this.config();
      this.runtime();
    } catch (e) {
      try { this.db?.close(); } catch {}
      if(e instanceof Fault)throw e;
      throw new Fault('STATE_INVALID','账本无法读取或写入；自动用卡未启用，请检查权限与备份。');
    }
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  config() {
    try {
      const row = this.db.prepare('SELECT * FROM settings WHERE id=1').get();
      return { value:validateConfig(JSON.parse(row.value)), revision:row.revision };
    } catch (e) { if(e instanceof Fault) throw e; throw new Fault('CONFIG_INVALID','配置无法解析，自动用卡已停止。'); }
  }
  configure(patch) {
    return this.transaction(() => {
      const current = this.config();
      const value = validateConfig({...current.value,...patch});
      this.db.prepare('UPDATE settings SET revision=revision+1,value=? WHERE id=1').run(JSON.stringify(value));
      return this.config();
    });
  }
  runtime() {
    try {
      const value = JSON.parse(this.db.prepare('SELECT value FROM runtime WHERE id=1').get().value);
      ensure(['running','stopped'].includes(value.desired), 'STATE_INVALID','运行状态无法确认。');
      return value;
    } catch(e) { if(e instanceof Fault)throw e;throw new Fault('STATE_INVALID','运行状态无法解析。'); }
  }
  updateRuntime(patch) {
    return this.transaction(() => {
      const value={...this.runtime(),...patch};
      this.db.prepare('UPDATE runtime SET value=? WHERE id=1').run(JSON.stringify(value));
      return value;
    });
  }
  clock(now) {
    this.transaction(() => {
      const old = this.db.prepare('SELECT clock FROM meta WHERE id=1').get().clock;
      ensure(now + 5000 >= old, 'CLOCK_ROLLBACK','系统时间回拨，自动用卡已暂停。');
      this.db.prepare('UPDATE meta SET clock=MAX(clock,?) WHERE id=1').run(now);
    });
  }
  count(account, now) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM charges JOIN operations o ON o.id=charges.operation WHERE o.account=? AND charges.day=? AND o.state!='REJECTED'")
      .get(account,dayKey(now)).n;
  }
  pending(account) {
    return this.db.prepare("SELECT * FROM operations WHERE account=? AND state IN ('PREPARED','UNKNOWN','APPLIED') ORDER BY created").get(account);
  }
  allPending() { return this.db.prepare("SELECT id,type,state,created,updated FROM operations WHERE state IN ('PREPARED','UNKNOWN','APPLIED') ORDER BY created").all(); }
  lastAt(account, type) {
    const row = this.db.prepare("SELECT MAX(updated) AS at FROM operations WHERE account=? AND state!='REJECTED' AND (type=? OR type='WEEK')")
      .get(account,type);
    return row.at || 0;
  }
  reserve(account, type, before, now) {
    return this.transaction(() => {
      const config = this.config().value;
      ensure(this.runtime().desired === 'running','STOPPED','已经停止，未发起新的用卡请求。');
      ensure(!this.pending(account),'RESET_PENDING','上次用卡仍待确认，请运行 zwd reconcile。');
      ensure(config.dailyLimit === 'unlimited' || this.count(account,now) < config.dailyLimit,
        'BUDGET_EXHAUSTED','已达到每日自动用卡上限。');
      ensure(now - this.lastAt(account,type) >= config.cooldownMs, 'COOLDOWN','仍在冷却时间内。');
      const clock=this.db.prepare('SELECT clock FROM meta WHERE id=1').get().clock;
      ensure(now+5000>=clock,'CLOCK_ROLLBACK','系统时间回拨，未发起用卡请求。');
      const id=randomUUID();
      this.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,NULL)').run(id,account,type,'PREPARED',now,now,JSON.stringify(before));
      this.db.prepare('INSERT INTO charges VALUES (?,?)').run(id,dayKey(now));
      this.db.prepare('UPDATE meta SET clock=MAX(clock,?) WHERE id=1').run(now);
      return {id,account,type,before};
    });
  }
  settle(id, state, now, reason = null) {
    ensure(['UNKNOWN','APPLIED','CONFIRMED','REJECTED'].includes(state),'STATE_INVALID','无效的操作状态。');
    return this.transaction(() => {
      const op=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
      ensure(op && ACTIVE.includes(op.state),'STATE_INVALID','该操作不在待处理状态。');
      const allowed={PREPARED:['UNKNOWN','APPLIED','REJECTED'],UNKNOWN:['CONFIRMED'],APPLIED:['CONFIRMED']};
      ensure(allowed[op.state].includes(state),'STATE_INVALID','不允许该状态转换。');
      this.db.prepare('UPDATE operations SET state=?,updated=?,reason=? WHERE id=?').run(state,Math.max(now,op.created),reason,id);
      if(state!=='REJECTED')this.db.prepare('INSERT OR IGNORE INTO charges VALUES (?,?)').run(id,dayKey(now));
    });
  }
  event(code,message,now=Date.now()) {
    // Persist only fixed local messages; never upstream bodies or credential values.
    this.db.prepare('INSERT INTO events(at,code,message) VALUES (?,?,?)').run(now,code,message);
    this.db.prepare('DELETE FROM events WHERE id <= (SELECT COALESCE(MAX(id),0)-1000 FROM events)').run();
  }
  events(limit=20) {return this.db.prepare('SELECT at,code,message FROM events ORDER BY id DESC LIMIT ?').all(limit).reverse();}
}
