/**
 * Serveur de test LOCAL : sert le site construit et reproduit l'API Supabase
 * (RPC + connexion) au-dessus d'un vrai PostgreSQL (PGlite) chargé avec
 * supabase/schema.sql. Sert uniquement aux tests : en production, c'est
 * Supabase qui répond.
 *
 *   npm run dev   →  http://localhost:8888  (compte organisateur de test affiché au démarrage)
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb, rpc } from './db.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub, email) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
const subOf = (auth) => {
  try { const p = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url')); return p.role === 'authenticated' ? p.sub : null; } catch { return null; }
};

export async function startServer({ port = 8888, adminEmail = 'organisateur@test.local', adminPassword = 'Test-Mariage-2026!' } = {}) {
  const outDir = path.join(root, 'dist-test');
  execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], {
    env: { ...process.env, OUT_DIR: 'dist-test', SUPABASE_URL: `http://localhost:${port}`, SUPABASE_ANON_KEY: 'sb_publishable_local_test', SITE_URL: `http://localhost:${port}` },
    stdio: 'inherit',
  });
  const headersFile = readFileSync(path.join(outDir, '_headers'), 'utf8');
  const csp = headersFile.match(/Content-Security-Policy: (.+)/)[1];

  const db = await createDb();
  const adminId = randomUUID();
  const users = { [adminEmail]: { id: adminId, password: adminPassword } };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [adminId, adminEmail]);
  await db.query('insert into public.admins (user_id, email) values ($1, $2)', [adminId, adminEmail]);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const session = (email) => {
    const u = users[email];
    return {
      access_token: fakeJwt(u.id, email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh-' + u.id,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};

    // ---- API façon Supabase ----
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (!req.headers.apikey) return send(res, 401, { message: 'No API key found in request' });
      const fn = url.pathname.split('/').pop();
      const sub = subOf(req.headers.authorization || '');
      try {
        const r = await rpc(db, { role: sub ? 'authenticated' : 'anon', sub, ip: req.socket.remoteAddress }, fn, body);
        return send(res, 200, r);
      } catch (e) {
        return send(res, /permission denied/.test(e.message) ? 401 : 400, { code: e.code || 'P0001', message: e.message, details: null, hint: null });
      }
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = users[body.email];
        if (!u || u.password !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, session(body.email));
      }
      const email = Object.keys(users).find((e) => 'refresh-' + users[e].id === body.refresh_token);
      return email ? send(res, 200, session(email)) : send(res, 400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/auth/v1/user') {
      const sub = subOf(req.headers.authorization || '');
      const email = Object.keys(users).find((e) => users[e].id === sub);
      return email ? send(res, 200, session(email).user) : send(res, 401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);

    // ---- Fichiers statiques ----
    let file = path.join(outDir, decodeURIComponent(url.pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    let status = 200;
    if (!file.startsWith(outDir) || !existsSync(file)) { file = path.join(outDir, '404.html'); status = 404; }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });

  await new Promise((r) => server.listen(port, r));
  return { server, db, port, adminEmail, adminPassword, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer();
  console.log(`\nSite de test : http://localhost:${s.port}\nEspace organisateurs : http://localhost:${s.port}/admin/\n  e-mail : ${s.adminEmail}\n  mot de passe : ${s.adminPassword}\n(base temporaire en mémoire — rien n'est envoyé à Supabase)\n`);
}
