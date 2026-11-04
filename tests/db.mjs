// Base PostgreSQL locale (PGlite) chargée avec le vrai schema.sql, pour les tests.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function createDb() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(root, 'tests/supabase-stub.sql'), 'utf8'));
  await db.exec(readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  return db;
}

/**
 * Exécute une requête comme le ferait l'API Supabase (PostgREST) :
 * rôle anon/authenticated, identité JWT et en-têtes HTTP de la requête.
 */
export async function callAs(db, { role = 'anon', sub = null, ip = '1.2.3.4' }, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
      [JSON.stringify(sub ? { sub, role } : { role }), JSON.stringify({ 'x-forwarded-for': ip })]);
    await tx.exec(`set local role ${role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const res = await tx.query(sql, params);
    return res.rows;
  });
}

/** Appelle une fonction RPC avec un argument nommé, comme supabase.rpc(). */
export async function rpc(db, ctx, fn, args = {}) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const vals = names.map((n) => (typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
  const rows = await callAs(db, ctx, sql, vals);
  return rows[0].r;
}
