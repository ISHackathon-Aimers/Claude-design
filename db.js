import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayStr, periodIndex, streakInfo } from './public/logic.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('입력 내용을 확인해 주세요.');
  return value;
};
const day = (value, optional = false) => {
  if (optional && value === '') return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('날짜를 확인해 주세요.');
  return value;
};
export function defaultProfile(name = '나') {
  return { name: name.slice(0, 20), bio: '', photo: '', public: false, periodDays: 7,
    startDate: todayStr(), notify: false, theme: 'system', fontScale: 100 };
}

export function validateState(s) {
  if (!s || s.v !== 1 || !s.profile || !Array.isArray(s.categories) || !Array.isArray(s.entries)) fail('저장 형식이 올바르지 않습니다.');
  const p = s.profile;
  const profile = { name: text(p.name, 20, true), bio: text(p.bio, 40), photo: text(p.photo, 500000),
    public: p.public, periodDays: p.periodDays, startDate: day(p.startDate), notify: p.notify, theme: p.theme, fontScale: p.fontScale };
  if (typeof p.public !== 'boolean' || typeof p.notify !== 'boolean' || ![7, 14, 30].includes(p.periodDays) ||
      !['system', 'light', 'dark'].includes(p.theme) || ![90, 100, 110, 120, 130].includes(p.fontScale)) fail('프로필 설정이 올바르지 않습니다.');
  if (p.photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo)) fail('프로필 사진 형식이 올바르지 않습니다.');
  if (!s.categories.length || s.categories.length > 100 || s.entries.length > 10000) fail('저장 가능한 개수를 초과했습니다.');
  const categories = s.categories.map((c) => text(c, 15, true));
  if (new Set(categories).size !== categories.length) fail('카테고리가 중복되었습니다.');
  const ids = new Set();
  const entries = s.entries.map((e) => {
    if (!e || typeof e !== 'object') fail('기록 형식이 올바르지 않습니다.');
    const id = text(e.id, 80, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) fail('기록 ID가 올바르지 않습니다.');
    ids.add(id);
    if (!categories.includes(e.category)) fail('기록의 카테고리를 확인해 주세요.');
    if (!Array.isArray(e.tags) || e.tags.length > 30 || !Array.isArray(e.qa) || e.qa.length > 30) fail('기록 형식이 올바르지 않습니다.');
    return { id, date: day(e.date), category: e.category, title: text(e.title, 200, true), summary: text(e.summary, 20000, true),
      raw: text(e.raw, 50000), tags: e.tags.map((v) => text(v, 100)),
      qa: e.qa.map((v) => {
        if (!v || typeof v !== 'object') fail('질문과 답변 형식이 올바르지 않습니다.');
        return { q: text(v.q, 2000), a: text(v.a, 10000) };
      }) };
  });
  return { profile, categories, entries, lastNotified: day(s.lastNotified || '', true) };
}

export class Store {
  constructor(filename = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'aimers.sqlite')) {
    if (filename !== ':memory:') {
      filename = path.resolve(ROOT, filename);
      mkdirSync(path.dirname(filename), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, last_notified TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS categories (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL,
        PRIMARY KEY(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS entries (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, date TEXT NOT NULL,
        category TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id, id),
        FOREIGN KEY(user_id, category) REFERENCES categories(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS memberships (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS pokes (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id),
        period INTEGER NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER,
        UNIQUE(group_id, sender_id, recipient_id, period)
      );
      CREATE INDEX IF NOT EXISTS pokes_recipient ON pokes(recipient_id, created_at);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_flows (
        token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(row) { return row && { id: row.id, googleSub: row.google_sub, email: row.email, name: row.name }; }
  upsertUser(identity, now = Date.now()) {
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, last_login_at=excluded.last_login_at`)
        .run(randomUUID(), identity.id, identity.email, identity.name, now, now);
      const user = this.user(this.db.prepare('SELECT * FROM users WHERE google_sub=?').get(identity.id));
      if (!this.db.prepare('SELECT 1 FROM profiles WHERE user_id=?').get(user.id)) {
        this.db.prepare('INSERT INTO profiles(user_id, data) VALUES (?, ?)').run(user.id, JSON.stringify(defaultProfile(user.name)));
        ['프로젝트', '대외활동', '동아리', '전공공부'].forEach((c, i) => this.db.prepare('INSERT INTO categories VALUES (?, ?, ?)').run(user.id, c, i));
      }
      return user;
    });
  }
  prune(now) {
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    this.db.prepare('DELETE FROM oauth_flows WHERE expires<=?').run(now);
  }
  getSession(token, now = Date.now()) {
    if (!token) return null;
    return this.user(this.db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.expires>?`).get(hash(token), now));
  }
  setSession(token, userId, expires) { this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), userId, expires); }
  deleteSession(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }
  countSessions() { return this.db.prepare('SELECT count(*) AS n FROM sessions').get().n; }
  setFlow(token, data) { this.db.prepare('INSERT INTO oauth_flows VALUES (?, ?, ?)').run(hash(token), JSON.stringify(data), data.expires); }
  getFlow(token) {
    const row = token && this.db.prepare('SELECT data FROM oauth_flows WHERE token_hash=?').get(hash(token));
    return row ? JSON.parse(row.data) : null;
  }
  deleteFlow(token) { if (token) this.db.prepare('DELETE FROM oauth_flows WHERE token_hash=?').run(hash(token)); }
  countFlows() { return this.db.prepare('SELECT count(*) AS n FROM oauth_flows').get().n; }
  personal(userId) {
    const row = this.db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId);
    if (!row) fail('사용자를 찾을 수 없습니다.', 404);
    return { profile: JSON.parse(row.data), revision: row.revision, lastNotified: row.last_notified,
      categories: this.db.prepare('SELECT name FROM categories WHERE user_id=? ORDER BY position').all(userId).map((r) => r.name),
      entries: this.db.prepare('SELECT data FROM entries WHERE user_id=? ORDER BY date DESC, rowid DESC').all(userId).map((r) => JSON.parse(r.data)) };
  }
  state(userId) {
    return this.transaction(() => {
      const { revision, ...personal } = this.personal(userId);
      const groups = this.db.prepare(`SELECT g.* FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.rowid`).all(userId).map((g) => ({
        id: g.id, name: g.name, code: g.code, ownerId: g.owner_id,
        members: this.db.prepare('SELECT user_id FROM memberships WHERE group_id=? AND user_id<>?').all(g.id, userId).map((m) => {
          const p = this.personal(m.user_id);
          const stats = streakInfo(p.entries.map((e) => e.date), p.profile.startDate, p.profile.periodDays, todayStr());
          return { id: m.user_id, name: p.profile.name, color: '#7c3aed', photo: p.profile.photo, public: p.profile.public,
            periodDays: p.profile.periodDays, startDate: p.profile.startDate, doneNow: stats.doneNow, streak: stats.streak,
            entries: p.profile.public ? p.entries : [] };
        }),
      }));
      const pokes = {};
      for (const p of this.db.prepare('SELECT group_id, recipient_id, MAX(created_at) AS sent_at FROM pokes WHERE sender_id=? GROUP BY group_id, recipient_id').all(userId)) pokes[`${p.group_id}:${p.recipient_id}`] = p.sent_at;
      const notifications = this.db.prepare(`SELECT p.id, p.group_id AS groupId, p.created_at AS createdAt, g.name AS groupName,
          pr.data AS senderProfile FROM pokes p JOIN groups g ON g.id=p.group_id JOIN profiles pr ON pr.user_id=p.sender_id
          JOIN memberships m ON m.group_id=p.group_id AND m.user_id=p.recipient_id
          WHERE p.recipient_id=? AND p.read_at IS NULL ORDER BY p.created_at DESC LIMIT 50`).all(userId)
        .map(({ senderProfile, ...n }) => ({ ...n, senderName: JSON.parse(senderProfile).name }));
      return { revision, state: { v: 1, ...personal, groups, pokes, notifications } };
    });
  }
  saveState(userId, state, revision) {
    const s = validateState(state);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('저장 버전이 올바르지 않습니다.');
    return this.transaction(() => {
      const result = this.db.prepare(`UPDATE profiles SET data=?, revision=revision+1, last_notified=? WHERE user_id=? AND revision=?`)
        .run(JSON.stringify(s.profile), s.lastNotified, userId, revision);
      if (!result.changes) fail('다른 기기에서 수정한 내용이 있어요. 변경 내용을 내보낸 뒤 새로고침해 주세요.', 409);
      this.db.prepare('DELETE FROM entries WHERE user_id=?').run(userId);
      this.db.prepare('DELETE FROM categories WHERE user_id=?').run(userId);
      s.categories.forEach((c, i) => this.db.prepare('INSERT INTO categories VALUES (?, ?, ?)').run(userId, c, i));
      for (const e of s.entries) this.db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)').run(userId, e.id, e.date, e.category, JSON.stringify(e));
      return { revision: revision + 1 };
    });
  }
  member(userId, groupId) {
    if (!this.db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND group_id=?').get(userId, groupId)) fail('그룹에 접근할 수 없습니다.', 403);
  }
  createGroup(userId, name) {
    text(name, 20, true);
    return this.transaction(() => {
      if (this.db.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get(userId).n >= 100) fail('그룹은 최대 100개까지 참여할 수 있습니다.');
      const id = randomUUID();
      const code = randomBytes(6).toString('hex').toUpperCase();
      this.db.prepare('INSERT INTO groups VALUES (?, ?, ?, ?)').run(id, name.trim(), code, userId);
      this.db.prepare('INSERT INTO memberships VALUES (?, ?)').run(id, userId);
      return { id };
    });
  }
  joinGroup(userId, code) {
    text(code, 20, true);
    return this.transaction(() => {
      const g = this.db.prepare('SELECT * FROM groups WHERE code=?').get(code.trim().toUpperCase());
      if (!g) fail('초대 코드를 확인해 주세요.', 404);
      if (this.db.prepare('SELECT 1 FROM memberships WHERE group_id=? AND user_id=?').get(g.id, userId)) return { id: g.id };
      if (this.db.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get(userId).n >= 100 ||
          this.db.prepare('SELECT count(*) AS n FROM memberships WHERE group_id=?').get(g.id).n >= 100) fail('참여 가능한 그룹 또는 멤버 수를 초과했습니다.');
      this.db.prepare('INSERT INTO memberships VALUES (?, ?)').run(g.id, userId);
      return { id: g.id };
    });
  }
  leaveGroup(userId, groupId) {
    return this.transaction(() => {
      this.member(userId, groupId);
      this.db.prepare('DELETE FROM memberships WHERE user_id=? AND group_id=?').run(userId, groupId);
      this.db.prepare('DELETE FROM pokes WHERE group_id=? AND (sender_id=? OR recipient_id=?)').run(groupId, userId, userId);
      const next = this.db.prepare('SELECT user_id FROM memberships WHERE group_id=? ORDER BY rowid LIMIT 1').get(groupId);
      if (!next) this.db.prepare('DELETE FROM groups WHERE id=?').run(groupId);
      else this.db.prepare('UPDATE groups SET owner_id=? WHERE id=? AND owner_id=?').run(next.user_id, groupId, userId);
      return { ok: true };
    });
  }
  poke(userId, groupId, recipientId) {
    text(recipientId, 80, true);
    return this.transaction(() => {
      this.member(userId, groupId); this.member(recipientId, groupId);
      if (userId === recipientId) fail('다른 멤버를 선택해 주세요.');
      const p = this.personal(recipientId);
      const stats = streakInfo(p.entries.map((e) => e.date), p.profile.startDate, p.profile.periodDays, todayStr());
      if (stats.doneNow || stats.current < 0) fail('현재 기록을 독촉할 수 없는 멤버입니다.');
      const period = periodIndex(todayStr(), p.profile.startDate, p.profile.periodDays);
      const last = this.db.prepare('SELECT MAX(created_at) AS sent_at FROM pokes WHERE group_id=? AND sender_id=? AND recipient_id=?').get(groupId, userId, recipientId);
      if (last.sent_at != null && Date.now() - last.sent_at < 300000) return { ok: true };
      this.db.prepare(`INSERT INTO pokes VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(group_id, sender_id, recipient_id, period) DO UPDATE SET
          id=excluded.id, date=excluded.date, created_at=excluded.created_at, read_at=NULL`)
        .run(randomUUID(), groupId, userId, recipientId, period, todayStr(), Date.now());
      return { ok: true };
    });
  }
  readNotifications(userId) { this.db.prepare('UPDATE pokes SET read_at=? WHERE recipient_id=? AND read_at IS NULL').run(Date.now(), userId); return { ok: true }; }
  saveAiRun(userId, task, input, result) {
    this.db.prepare('INSERT INTO ai_runs VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), userId, task, JSON.stringify(input), JSON.stringify(result), Date.now());
  }
  aiHistory(userId) {
    return this.db.prepare('SELECT id, task, input, result, created_at AS createdAt FROM ai_runs WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 30')
      .all(userId).map((r) => ({ ...r, input: JSON.parse(r.input), result: JSON.parse(r.result) }));
  }
}

let defaultStore;
export const getStore = () => defaultStore ||= new Store();
