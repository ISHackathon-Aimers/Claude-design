import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

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
