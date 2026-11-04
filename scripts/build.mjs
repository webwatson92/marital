#!/usr/bin/env node
/**
 * Construit le site dans dist/ à partir de src/ (aucune dépendance).
 *  - assemble les fragments communs  <!--#include partials/xxx.html -->
 *  - remplace %%SITE_URL%% (balises Open Graph, liens canoniques)
 *  - génère assets/js/config.js à partir des variables d'environnement
 *  - génère _headers (en-têtes de sécurité Netlify, dont la CSP)
 *
 * Variables d'environnement (Netlify > Site configuration > Environment variables) :
 *   SUPABASE_URL       URL du projet Supabase (https://xxxx.supabase.co)       — obligatoire
 *   SUPABASE_ANON_KEY  clé publique « anon » ou « publishable » du projet      — obligatoire
 *   SITE_URL           adresse publique du site (sinon : URL fournie par Netlify)
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src');
const out = path.join(root, process.env.OUT_DIR || 'dist');

// Chargement facultatif d'un fichier .env local (jamais publié)
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const SITE_URL = (process.env.SITE_URL || process.env.URL || 'http://localhost:8888').trim().replace(/\/$/, '');

const problems = [];
if (!/^https?:\/\/[^\s]+$/.test(SUPABASE_URL)) problems.push('SUPABASE_URL manquante ou invalide');
if (!SUPABASE_KEY) problems.push('SUPABASE_ANON_KEY manquante');
if (/service_role|sb_secret_/.test(SUPABASE_KEY) || keyRole(SUPABASE_KEY) === 'service_role') {
  problems.push('SUPABASE_ANON_KEY contient une clé SECRÈTE (service_role). Utilisez la clé publique « anon » / « publishable ».');
}
if (problems.length) {
  console.error('\n✖ Construction interrompue :\n  - ' + problems.join('\n  - ') + '\n  Voir README.md, section « Variables d’environnement ».\n');
  process.exit(1);
}

function keyRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { return null; }
}

// 1. Copie
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true, filter: (p) => !p.includes(`${path.sep}partials`) });

// 2. Pages HTML : fragments + URL du site
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  let html = readFileSync(file, 'utf8');
  html = html.replace(/<!--#include ([\w/.-]+) -->/g, (_, rel) => readFileSync(path.join(src, rel), 'utf8').trim());
  html = html.replaceAll('%%SITE_URL%%', SITE_URL);
  // La page 404 peut être servie à n'importe quelle profondeur : liens absolus.
  if (path.basename(file) === '404.html') html = html.replace(/(href|src)="(?!https?:|\/|#|mailto:|data:)/g, '$1="/');
  writeFileSync(file, html);
}

// 3. Configuration publique (la clé anon est publique par conception ;
//    la sécurité repose sur les règles de la base de données).
writeFileSync(path.join(out, 'assets/js/config.js'),
  `/* Généré automatiquement par scripts/build.mjs — ne pas modifier. */\n` +
  `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, siteUrl: SITE_URL }, null, 2)};\n`);

// 4. En-têtes de sécurité
const supabaseOrigin = new URL(SUPABASE_URL).origin;
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
writeFileSync(path.join(out, '_headers'), `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000

/admin/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

/assets/js/config.js
  Cache-Control: public, max-age=0, must-revalidate

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);

// 5. robots.txt et sitemap.xml
writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nDisallow: /admin/\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/programme.html', '/rsvp.html'].map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}
</urlset>
`);

console.log(`✔ Site construit dans ${path.relative(root, out)}/  (site : ${SITE_URL}, base : ${supabaseOrigin})`);
