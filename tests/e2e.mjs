/**
 * Tests de bout en bout dans un vrai navigateur (Chrome) :
 * parcours invité (mobile) et parcours organisateur, contre la vraie base
 * (schema.sql dans PostgreSQL local). Captures dans tests/screenshots/.
 *
 *   CHROME_PATH=/chemin/vers/chrome npm run test:e2e
 */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = path.join(root, 'tests/screenshots');
const downloads = path.join(shots, 'downloads');
rmSync(shots, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

const srv = await startServer({ port: 8899 });
const BASE = `http://localhost:${srv.port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const IPHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const results = [];
const problems = [];

async function newPage(viewport = IPHONE) {
  const ctx = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: downloads } });
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console] ${page.url()} : ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[js] ${page.url()} : ${e.message}`));
  return page;
}
async function step(name, fn) {
  try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✖', name + ' — ' + e.message]); }
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (el) => !el.hidden && el.offsetParent !== null).catch(() => false);
const rows = async () => (await srv.db.query('select * from public.guests order by created_at')).rows;
// Fait défiler l'élément au centre avant de le toucher (la barre de navigation mobile est fixe en bas).
async function tap(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.click(sel);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= PARCOURS INVITÉ ================= */
const g = await newPage();

await step('Accueil : titre, compte à rebours, boutons', async () => {
  await g.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await g.evaluate(() => document.fonts.ready);
  assert.match((await text(g, 'h1')).replace(/\s+/g, ''), /FamillesOUATTARA&KANTÉ/);
  assert.match(await text(g, '[data-cd="d"]'), /^\d+$/);
  const btns = await g.$$eval('.hero-actions a', (a) => a.map((x) => x.textContent.trim().toUpperCase()));
  assert.deepEqual(btns, ['CONFIRMER MA PRÉSENCE', 'DÉCOUVRIR LE PROGRAMME']);
  const cards = await g.$$eval('#date-cards .date-card', (c) => c.map((x) => x.textContent));
  assert.equal(cards.length, 3);
  assert.match(cards[1], /Prêche.*À confirmer/s);
  const og = await g.$eval('meta[property="og:image"]', (m) => m.content);
  assert.equal(og, BASE + '/assets/img/og-image.jpg');
  await shot(g, '01-accueil-mobile');
  await g.evaluate(() => document.querySelectorAll('.fade-in').forEach((e) => e.classList.add('visible')));
  await shot(g, '02-accueil-mobile-complet', true);
});

await step('Programme : 3 cartes, rien d’inventé', async () => {
  await g.goto(BASE + '/programme.html', { waitUntil: 'networkidle0' });
  const cards = await g.$$eval('.event-card', (c) => c.map((x) => x.innerText));
  assert.equal(cards.length, 3);
  assert.match(cards[0], /Jeudi 24 décembre 2026/);
  assert.match(cards[0], /Daloa/);
  assert.match(cards[1], /Mosquée du Nouveau Quartier/);
  assert.match(cards[1], /Date\s+À CONFIRMER/i);
  assert.match(cards[2], /Dimanche 3 janvier 2027/);
  for (const c of cards) assert.match(c, /Heure\s+À CONFIRMER/i, 'aucun horaire inventé');
  await g.evaluate(() => document.querySelectorAll('.fade-in').forEach((e) => e.classList.add('visible')));
  await shot(g, '03-programme-mobile', true);
});

let token;
await step('RSVP : validation des champs vides', async () => {
  await g.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  await tap(g, '#submit-btn');
  const invalid = await g.$$eval('.invalid', (els) => els.map((e) => e.dataset.field));
  assert.deepEqual(invalid, ['full_name', 'phone', 'category', 'status']);
  assert.equal((await rows()).length, 0);
});

await step('RSVP « Oui » à 3 personnes, double clic : une seule réponse enregistrée', async () => {
  await g.type('#full_name', 'Aminata Koné');
  await g.type('#phone', '07 08 09 10 11');
  await tap(g, 'input[name="category"][value="famille_epouse"]');
  await tap(g, 'input[name="status"][value="yes"]');
  assert.ok(await visible(g, '#yes-block'));
  const evs = await g.$$eval('input[name="events"]', (i) => i.map((x) => x.value));
  assert.deepEqual(evs, ['ceremonie', 'reception'], 'prêche non proposé tant qu’il n’est pas ouvert');
  assert.match(await text(g, '#events-hint'), /Prêche/);
  await tap(g, '[data-step="1"]'); await tap(g, '[data-step="1"]');
  assert.ok(await visible(g, '#companions-block'));
  await g.type('#companions', 'Ibrahim Koné\nFatou Koné');
  await tap(g, 'input[name="events"][value="ceremonie"]'); // décoche la cérémonie
  await shot(g, '04-rsvp-formulaire-mobile', true);
  await Promise.all([tap(g, '#submit-btn'), tap(g, '#submit-btn').catch(() => {})]);
  await g.waitForSelector('#thanks:not([hidden])', { timeout: 5000 });
  const r = await rows();
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'yes');
  assert.equal(r[0].party_size, 3);
  assert.deepEqual(r[0].events, ['reception']);
  assert.match(r[0].companions, /Ibrahim Koné/);
  assert.match(await text(g, '#thanks-title'), /Merci, Aminata Koné/);
  assert.match(await text(g, '#thanks-msg'), /seront heureuses de partager/);
  assert.match(await text(g, '#saved-at'), /Réponse enregistrée le/);
  token = await g.evaluate(() => localStorage.getItem('ok-rsvp-token'));
  assert.equal(token.length, 64);
  const wa = await g.$eval('#wa-link', (a) => a.href);
  assert.ok(decodeURIComponent(wa).includes('/rsvp.html?m=' + token));
  await sleep(400);
  await shot(g, '05-rsvp-merci-mobile', true);
});

await step('Modification via le lien personnel (Oui → Non)', async () => {
  const p = await newPage();
  await p.goto(BASE + '/rsvp.html?m=' + token, { waitUntil: 'networkidle0' });
  assert.equal(new URL(p.url()).search, '', 'le jeton est retiré de la barre d’adresse');
  assert.ok(await visible(p, '#edit-banner'));
  assert.equal(await p.$eval('#full_name', (i) => i.value), 'Aminata Koné');
  assert.equal(await p.$eval('#party_size', (i) => i.value), '3');
  await tap(p, 'input[name="status"][value="no"]');
  assert.equal(await visible(p, '#yes-block'), false, 'pas d’accompagnants demandés si absent');
  await tap(p, '#submit-btn');
  await p.waitForSelector('#thanks:not([hidden])');
  const r = await rows();
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'no');
  assert.equal(r[0].party_size, 0);
  await p.browserContext().close();
});

await step('Même numéro depuis un autre téléphone : refusé avec message clair', async () => {
  const p = await newPage();
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  await p.type('#full_name', 'Quelqu’un d’autre');
  await p.type('#phone', '+225 0708091011');
  await tap(p, 'input[name="category"][value="ami"]');
  await tap(p, 'input[name="status"][value="no"]');
  await tap(p, '#submit-btn');
  await p.waitForSelector('#form-error:not([hidden])');
  assert.match(await text(p, '#form-error'), /déjà été enregistrée/);
  assert.equal(await visible(p, '#thanks'), false);
  assert.equal((await rows()).length, 1);
  await shot(p, '06-rsvp-doublon-mobile');
  await p.browserContext().close();
});

await step('Panne réseau : aucun faux « enregistré »', async () => {
  const p = await newPage();
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  await p.type('#full_name', 'Moussa Diaby');
  await p.type('#phone', '05 06 07 08 09');
  await tap(p, 'input[name="category"][value="parrain"]');
  await tap(p, 'input[name="status"][value="no"]');
  await p.setOfflineMode(true);
  await tap(p, '#submit-btn');
  await p.waitForSelector('#form-error:not([hidden])');
  assert.match(await text(p, '#form-error'), /n’a pas encore été envoyée/);
  assert.equal(await visible(p, '#thanks'), false);
  await p.setOfflineMode(false);
  await tap(p, '#submit-btn');
  await p.waitForSelector('#thanks:not([hidden])');
  assert.equal((await rows()).length, 2);
  await p.browserContext().close();
});

/* ================= PARCOURS ORGANISATEUR ================= */
const a = await newPage();

await step('Admin : mauvais mot de passe refusé, aucune donnée visible', async () => {
  await a.goto(BASE + '/admin/', { waitUntil: 'networkidle0' });
  assert.ok(await visible(a, '#login-view'));
  await a.type('#email', srv.adminEmail);
  await a.type('#password', 'mauvais');
  await tap(a, '#login-btn');
  await a.waitForSelector('#login-error:not([hidden])');
  assert.equal(await visible(a, '#app-view'), false);
  await shot(a, '07-admin-connexion-mobile');
});

await step('Admin : connexion et indicateurs', async () => {
  await a.$eval('#password', (i) => { i.value = ''; });
  await a.type('#password', srv.adminPassword);
  await tap(a, '#login-btn');
  await a.waitForSelector('#app-view:not([hidden]) .kpi');
  const k = await a.$$eval('.kpi', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  assert.match(k[0], /Réponses reçues 2 sur 300/i);
  assert.match(k[1], /Présents 0/i);
  assert.match(k[2], /Absents 2/i);
  assert.match(k[3], /En attente 298/i);
  assert.match(k[4], /Personnes attendues 0/i);
});

await step('Admin : ajout manuel, modification, filtres, recherche', async () => {
  await tap(a, '[data-tab="guests"]');
  await tap(a, '#add-btn');
  await a.type('#g-name', 'Famille Traoré');
  await a.type('#g-phone', '01 02 03 04 05');
  await a.select('#g-category', 'honneur');
  await a.select('#g-status', 'yes');
  await a.$eval('#g-party', (i) => { i.value = '4'; });
  await shot(a, '08-admin-ajout-mobile');
  await tap(a, '#guest-save');
  await a.waitForFunction(() => !document.querySelector('#guest-dlg').open);
  await a.waitForFunction(() => document.querySelectorAll('#rows tr').length === 3);
  let r = await rows();
  const added = r.find((x) => x.full_name === 'Famille Traoré');
  assert.equal(added.source, 'admin');
  assert.equal(added.party_size, 4);

  await a.select('#f-status', 'yes');
  assert.equal(await a.$$eval('#rows tr', (t) => t.length), 1);
  await a.select('#f-status', '');
  await a.type('#q', 'kone');
  assert.equal(await a.$$eval('#rows tr', (t) => t.length), 1, 'recherche insensible aux accents');
  await a.$eval('#q', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });

  await tap(a, `[data-edit="${added.id}"]`);
  await a.$eval('#g-party', (i) => { i.value = '6'; });
  await tap(a, '#guest-save');
  await a.waitForFunction(() => !document.querySelector('#guest-dlg').open);
  await sleep(300);
  r = await rows();
  assert.equal(r.find((x) => x.id === added.id).party_size, 6);
  await shot(a, '09-admin-invites-mobile', true);
});

await step('Admin : export CSV et Excel', async () => {
  await tap(a, '#csv-btn');
  await tap(a, '#xlsx-btn');
  for (let i = 0; i < 30 && readdirSync(downloads).filter((f) => !f.endsWith('.crdownload')).length < 2; i++) await sleep(200);
  const files = readdirSync(downloads);
  const csv = files.find((f) => f.endsWith('.csv'));
  const xlsx = files.find((f) => f.endsWith('.xlsx'));
  assert.ok(csv && xlsx, 'deux fichiers téléchargés : ' + files.join(', '));
  const content = readFileSync(path.join(downloads, csv), 'utf8');
  assert.ok(content.startsWith('﻿"Nom et prénoms";"Téléphone"'));
  assert.match(content, /"Famille Traoré"/);
  assert.equal(readFileSync(path.join(downloads, xlsx)).subarray(0, 2).toString(), 'PK');
});

await step('Admin : suppression avec confirmation', async () => {
  const r = await rows();
  const target = r.find((x) => x.full_name === 'Moussa Diaby');
  await tap(a, `[data-del="${target.id}"]`);
  assert.match(await text(a, '#confirm-text'), /Moussa Diaby/);
  await tap(a, '#confirm-dlg [data-close]'); // annuler
  assert.equal((await rows()).length, 3);
  await tap(a, `[data-del="${target.id}"]`);
  await tap(a, '#confirm-yes');
  await a.waitForFunction(() => document.querySelectorAll('#rows tr').length === 2);
  assert.equal((await rows()).length, 2);
});

await step('Admin : ouverture du prêche (date + heure) → visible côté invité', async () => {
  await tap(a, '[data-tab="events"]');
  const f = 'form[data-key="preche"]';
  await a.$eval(`${f} [name="event_date"]`, (i) => { i.value = '2027-01-02'; });
  await a.type(`${f} [name="time_label"]`, '16h00');
  await a.$eval(`${f} [name="rsvp_enabled"]`, (i) => { i.checked = true; });
  await tap(a, `${f} button[type=submit]`);
  await a.waitForFunction((s) => /Enregistré/.test(document.querySelector(s + ' .alert-box').textContent), {}, f);
  await shot(a, '10-admin-programme-mobile');

  const p = await newPage();
  await p.goto(BASE + '/programme.html', { waitUntil: 'networkidle0' });
  const card = await p.$eval('#evt-preche', (c) => c.innerText);
  assert.match(card, /Samedi 2 janvier 2027/);
  assert.match(card, /16h00/);
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  const evs = await p.$$eval('input[name="events"]', (i) => i.map((x) => x.value));
  assert.deepEqual(evs, ['ceremonie', 'preche', 'reception']);
  await p.browserContext().close();
});

await step('Admin : fermeture des confirmations', async () => {
  await tap(a, '[data-tab="settings"]');
  await a.$eval('#s-open', (i) => { i.checked = false; });
  await tap(a, '#settings-form button[type=submit]');
  await sleep(500);
  const p = await newPage();
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  assert.ok(await visible(p, '#closed-banner'));
  assert.equal(await visible(p, '#rsvp-form'), false);
  await p.browserContext().close();
  await a.$eval('#s-open', (i) => { i.checked = true; });
  await tap(a, '#settings-form button[type=submit]');
  await sleep(300);
});

await step('Admin : tableau de bord (mobile + ordinateur)', async () => {
  // Quelques réponses supplémentaires pour illustrer les graphiques (base de test uniquement)
  const extra = [['Koffi Yao', '0711111111', 'ami', 'yes', 2], ['Awa Bamba', '0722222222', 'parrain', 'yes', 1], ['Seydou Cissé', '0733333333', 'famille_epoux', 'yes', 5], ['Nadia Touré', '0744444444', 'honneur', 'no', 0]];
  for (const [n, ph, c, s, ps] of extra) {
    await fetch(BASE + '/rest/v1/rpc/submit_rsvp', { method: 'POST', headers: { apikey: 'k', 'Content-Type': 'application/json' }, body: JSON.stringify({ p: { full_name: n, phone: ph, category: c, status: s, party_size: ps, events: s === 'yes' ? ['reception', 'ceremonie'] : [] } }) });
  }
  await tap(a, '[data-tab="dashboard"]');
  await tap(a, '#refresh-btn');
  await sleep(500);
  const k = await a.$$eval('.kpi .v', (els) => els.map((e) => e.textContent));
  assert.deepEqual(k, ['6', '4', '2', '294', '14']);
  await shot(a, '11-admin-tableau-de-bord-mobile', true);
  await a.setViewport({ width: 1366, height: 900 });
  await sleep(300);
  await shot(a, '12-admin-tableau-de-bord-ordinateur', true);
  await tap(a, '[data-tab="guests"]');
  await shot(a, '13-admin-invites-ordinateur', true);
});

await step('Accueil et RSVP sur ordinateur', async () => {
  const p = await newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await sleep(900);
  await shot(p, '14-accueil-ordinateur');
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  await shot(p, '15-rsvp-ordinateur');
  await p.browserContext().close();
});

await step('Page introuvable (404) stylée', async () => {
  const p = await newPage();
  const res = await p.goto(BASE + '/une/page/inexistante', { waitUntil: 'networkidle0' });
  assert.equal(res.status(), 404);
  assert.ok(await p.$eval('link[rel=stylesheet]', (l) => l.sheet !== null));
  await p.browserContext().close();
});

await step('Horodatages à l’heure d’Abidjan sur un appareil réglé sur un autre fuseau', async () => {
  // Côté organisateur : une réponse à 23h30 UTC tomberait le lendemain à Tokyo (UTC+9).
  await a.emulateTimezone('Asia/Tokyo');
  await srv.db.query("update public.guests set responded_at = '2026-12-24T23:30:00Z' where full_name = 'Koffi Yao'");
  await tap(a, '[data-tab="dashboard"]');
  await tap(a, '#refresh-btn');
  await sleep(500);
  assert.match(await text(a, '#stamp'), /\(heure d’Abidjan\)$/);
  await tap(a, '[data-tab="guests"]');
  const row = await a.$$eval('#rows tr', (t) => t.map((x) => x.innerText).find((x) => x.includes('Koffi Yao')));
  assert.match(row, /24\/12\/2026,? 23:30/);

  // Côté invité : message de remerciement après l'envoi.
  const p = await newPage();
  await p.emulateTimezone('Asia/Tokyo');
  await p.goto(BASE + '/rsvp.html', { waitUntil: 'networkidle0' });
  await p.type('#full_name', 'Mariam Diallo');
  await p.type('#phone', '07 55 55 55 55');
  await tap(p, 'input[name="category"][value="ami"]');
  await tap(p, 'input[name="status"][value="no"]');
  await tap(p, '#submit-btn');
  await p.waitForSelector('#thanks:not([hidden])', { timeout: 5000 });
  const saved = (await rows()).find((r) => r.full_name === 'Mariam Diallo').responded_at;
  const inAbidjan = new Date(saved).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan' });
  assert.ok((await text(p, '#saved-at')).endsWith(`à ${inAbidjan} (heure d’Abidjan)`), await text(p, '#saved-at'));
  await p.browserContext().close();
});

await browser.close();
await srv.close();

console.log('\nRésultats :');
results.forEach(([s, n]) => console.log(` ${s} ${n}`));
const filteredProblems = problems.filter((p) => !/Failed to load resource.*(400|404|ERR_INTERNET_DISCONNECTED)/.test(p));
if (filteredProblems.length) { console.log('\nErreurs navigateur :'); filteredProblems.forEach((p) => console.log(' • ' + p)); }
const failed = results.filter((r) => r[0] === '✖').length;
console.log(`\n${results.length - failed}/${results.length} parcours réussis. Captures : tests/screenshots/`);
process.exit(failed || filteredProblems.length ? 1 : 0);
