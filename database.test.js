import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SupabaseStore } from './supabase-db.js';
import { todayStr, streakInfo } from './public/logic.js';
import { defaultProfile } from './state.js';

test('migration enforces ownership, shape and atomic revision checks in Postgres', async () => {
  const db = new PGlite();
  const alice = '00000000-0000-4000-8000-000000000001';
  const bob = '00000000-0000-4000-8000-000000000002';
  try {
    // Minimal Supabase Auth schema and roles for the real migration.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${alice}'), ('${bob}');
    `);
    await db.exec(await readFile(new URL('./supabase/migrations/202611080001_user_states.sql', import.meta.url), 'utf8'));
    const state = { v: 1, profile: { name: 'Alice' }, entries: [], categories: [], groups: [] };
    const save = (value, revision) => db.query('select public.save_user_state($1::jsonb, $2) as revision', [JSON.stringify(value), revision]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}';`);
    assert.equal((await save(state, 0)).rows[0].revision, 1);
    assert.equal((await save({ ...state, entries: [{ id: 'one' }] }, 1)).rows[0].revision, 2);
    await assert.rejects(save(state, 1), /STATE_CONFLICT/);
    await assert.rejects(save(state, 0), /STATE_CONFLICT/);
    await assert.rejects(save({ v: 1 }, 2), /valid_state/);
    await assert.rejects(db.query('update public.user_states set revision = 100'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub = '${bob}';`);
    assert.equal((await db.query('select * from public.user_states')).rows.length, 0);
    // Bob cannot overwrite Alice, even if he knows her current revision.
    await assert.rejects(save(state, 2), /STATE_CONFLICT/);
    assert.equal((await save({ ...state, profile: { name: 'Bob' } }, 0)).rows[0].revision, 1);
    assert.equal((await db.query('select user_id from public.user_states')).rows[0].user_id, bob);
    await db.exec("set request.jwt.claim.sub = '';");
    await assert.rejects(save(state, 0), /AUTH_REQUIRED/);
    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from public.user_states'), /permission denied/);
    await assert.rejects(save(state, 0), /permission denied/);
  } finally { await db.close(); }
});

test('Supabase preserves main group sharing, ownership, notifications and AI history', async () => {
  const db = new PGlite();
  const ids = [1, 2, 3].map((i) => `00000000-0000-4000-8000-00000000000${i}`);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ${ids.map((id) => `('${id}')`).join(',')};`);
    await db.exec(await readFile(new URL('./supabase/migrations/202611080001_user_states.sql', import.meta.url), 'utf8'));
    // Simulate an already deployed Supabase account before applying the upgrade.
    const existing = { v: 1, profile: defaultProfile('Existing account'), categories: ['프로젝트'], groups: [],
      entries: [{ id: 'existing1', date: todayStr(), category: '프로젝트', title: 'Already saved', raw: 'Existing raw', summary: 'Existing summary', tags: [], qa: [] }], lastNotified: '' };
    await db.query('insert into public.user_states(user_id, state, revision) values ($1, $2::jsonb, 7)', [ids[0], JSON.stringify(existing)]);
    await db.exec(await readFile(new URL('./supabase/migrations/202611080002_main_features.sql', import.meta.url), 'utf8'));
    const stores = ids.map((id, index) => new SupabaseStore({ rpc: async (name, args) => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}';`);
      const values = [];
      const params = Object.entries(args).map(([key, value]) => {
        values.push(value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
        const type = ['p_default', 'p_state', 'p_payload', 'p_run'].includes(key) ? 'jsonb' : key === 'p_today' ? 'date' : key === 'p_revision' ? 'integer' : 'text';
        return `${key} => $${values.length}::${type}`;
      });
      try { return { data: (await db.query(`select public.${name}(${params.join(', ')}) as value`, values)).rows[0].value, error: null }; }
      catch (error) { return { data: null, error }; }
    } }, { id, name: `User ${index}`, email: `private-${index}@example.com` }));
    const [a, b, c] = stores;
    const state = (i) => stores[i].state(ids[i]);
    const save = (i, data) => stores[i].saveState(ids[i], data.state, data.revision);
    const initial = await state(0);
    assert.equal(initial.revision, 7);
    assert.equal(initial.state.entries[0].raw, 'Existing raw');
    initial.state.entries = [{ id: 'diary1', date: todayStr(), category: '프로젝트', title: 'Private diary',
      raw: 'Private original', summary: 'Private summary', qa: [], tags: [] }];
    await save(0, initial);
    await assert.rejects(save(0, initial), { status: 409 });
    await assert.rejects(db.query('select public.save_user_state($1::jsonb, $2)', [
      JSON.stringify({ ...initial.state, profile: { ...initial.state.profile, periodDays: 0 } }), initial.revision + 1,
    ]), /valid_personal/);
    assert.throws(() => a.state(ids[1]), { status: 403 });
    await state(1); await state(2);
    const g = await a.createGroup(ids[0], 'Main group');
    const code = (await state(0)).state.groups[0].code;
    assert.equal((await b.joinGroup(ids[1], code.toLowerCase())).id, g.id);
    assert.equal((await b.joinGroup(ids[1], code)).id, g.id);
    assert.equal((await state(2)).state.groups.length, 0);
    let peer = (await state(1)).state.groups[0].members[0];
    assert.equal(peer.id, ids[0]);
    assert.deepEqual(peer.entries, []);
    assert.equal(peer.doneNow, true);
    assert.equal(peer.streak, streakInfo([todayStr()], initial.state.profile.startDate, 7, todayStr()).streak);
    assert.equal(JSON.stringify(peer).includes('Private original'), false);
    assert.equal(JSON.stringify(peer).includes('private-0@example.com'), false);
    const published = await state(0);
    published.state.profile.public = true;
    published.state.groups[0].members.push({ id: ids[2], name: 'Forged member' });
    await save(0, published);
    peer = (await state(1)).state.groups[0].members[0];
    assert.equal(peer.entries[0].raw, 'Private original');
    assert.equal((await state(2)).state.groups.length, 0);
    await assert.rejects(c.poke(ids[2], g.id, ids[1]), { status: 403 });
    await a.poke(ids[0], g.id, ids[1]); await a.poke(ids[0], g.id, ids[1]);
    assert.equal((await state(1)).state.notifications.length, 1);
    await c.readNotifications(ids[2]);
    assert.equal((await state(1)).state.notifications.length, 1);
    await b.readNotifications(ids[1]);
    assert.equal((await state(1)).state.notifications.length, 0);
    await assert.rejects(b.poke(ids[1], g.id, ids[0]), { status: 400 });
    await a.saveAiRun(ids[0], 'questions', { entries: [] }, { data: { questions: ['Saved'] } });
    assert.equal((await a.aiHistory(ids[0]))[0].task, 'questions');
    assert.deepEqual(await b.aiHistory(ids[1]), []);
    await a.leaveGroup(ids[0], g.id);
    assert.equal((await state(1)).state.groups[0].ownerId, ids[1]);
    assert.deepEqual((await state(0)).state.groups, []);
    await assert.rejects(a.poke(ids[0], g.id, ids[1]), { status: 403 });
    await b.leaveGroup(ids[1], g.id);
    assert.deepEqual((await state(1)).state.groups, []);
    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from public.app_memberships'), /permission denied/);
    await assert.rejects(db.query("select public.app_ai_history(null)"), /permission denied/);
  } finally { await db.close(); }
});
