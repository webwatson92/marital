// Tests de la base de données : sécurité, validation, RSVP, administration.
// Lancer : npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, rpc, callAs } from './db.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let db;
const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const guest = { role: 'anon' };
const admin = { role: 'authenticated', sub: ADMIN };
const intruder = { role: 'authenticated', sub: OTHER };

const base = (o = {}) => ({
  full_name: 'Awa Traoré', phone: '07 08 09 10 11', category: 'ami',
  status: 'yes', party_size: 2, companions: 'Moussa Traoré', events: ['reception'], ...o,
});

async function rejects(promise, code) {
  await assert.rejects(promise, (e) => { assert.match(e.message, new RegExp(code)); return true; });
}

before(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@test.local'), ($2, 'autre@test.local')`, [ADMIN, OTHER]);
  await db.query(`insert into public.admins (user_id, email) values ($1, 'admin@test.local')`, [ADMIN]);
});

test('le programme public ne contient que les infos confirmées', async () => {
  const info = await rpc(db, guest, 'get_public_info');
  assert.equal(info.rsvp_open, true);
  assert.deepEqual(info.events.map((e) => e.key), ['chambre', 'danse', 'ceremonie', 'preche', 'reception']);
  const byKey = Object.fromEntries(info.events.map((e) => [e.key, e]));
  // Daloa : carton d'invitation « Mariage religieux »
  assert.equal(byKey.chambre.event_date, '2026-12-21');
  assert.equal(byKey.chambre.time_label, 'À partir de 14 h');
  assert.equal(byKey.danse.event_date, '2026-12-23');
  assert.equal(byKey.danse.time_label, 'À partir de 14 h');
  assert.equal(byKey.ceremonie.title, 'Mariage religieux');
  assert.equal(byKey.ceremonie.event_date, '2026-12-24');
  assert.equal(byKey.ceremonie.time_label, '8 h 00');
  assert.match(byKey.ceremonie.address, /Djoulabougou/);
  for (const k of ['chambre', 'danse', 'ceremonie']) assert.equal(byKey[k].rsvp_enabled, true, k);
  // Abidjan : inchangé
  assert.equal(byKey.reception.event_date, '2027-01-03');
  assert.equal(byKey.preche.event_date, null, 'la date du prêche ne doit pas être supposée');
  assert.equal(byKey.preche.rsvp_enabled, false);
  for (const k of ['preche', 'reception']) assert.equal(byKey[k].time_label, null, 'aucun horaire inventé');
});

test('le script de mise à jour donne le même programme qu’une installation neuve', async () => {
  const cols = 'key, sort_order, title, event_date, time_label, venue, address, maps_url, note, rsvp_enabled, visible';
  const fresh = (await db.query(`select ${cols} from public.events order by sort_order`)).rows;
  const other = await createDb();
  await other.exec(readFileSync(path.join(root, 'supabase/maj-programme-daloa.sql'), 'utf8'));
  await other.exec(readFileSync(path.join(root, 'supabase/maj-programme-daloa.sql'), 'utf8')); // ré-exécutable
  assert.deepEqual((await other.query(`select ${cols} from public.events order by sort_order`)).rows, fresh);
  await other.close();
});

test('un visiteur ne peut lire aucune table directement', async () => {
  for (const t of ['guests', 'settings', 'events', 'admins', 'rsvp_attempts']) {
    await rejects(callAs(db, guest, `select * from public.${t}`), 'permission denied');
  }
  await rejects(callAs(db, guest, `insert into public.guests (full_name) values ('x')`), 'permission denied');
});

test('un visiteur ne peut pas appeler les fonctions admin', async () => {
  await rejects(rpc(db, guest, 'admin_overview'), 'permission denied');
  await rejects(rpc(db, intruder, 'admin_overview'), 'FORBIDDEN');
});

let token;
test('une réponse « oui » est réellement enregistrée et renvoie un lien personnel', async () => {
  const r = await rpc(db, guest, 'submit_rsvp', { p: base() });
  assert.equal(r.ok, true);
  assert.equal(r.token.length, 64);
  token = r.token;
  const rows = (await db.query(`select * from public.guests where phone_key = '2250708091011'`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'yes');
  assert.equal(rows[0].party_size, 2);
  assert.deepEqual(rows[0].events, ['reception']);
  assert.notEqual(rows[0].edit_token_hash, token, 'le jeton est stocké sous forme d’empreinte');
});

test('un double envoi avec le même numéro est refusé (pas de doublon)', async () => {
  await rejects(rpc(db, guest, 'submit_rsvp', { p: base({ phone: '+225 0708091011' }) }), 'ALREADY_RESPONDED');
  const n = (await db.query(`select count(*)::int n from public.guests`)).rows[0].n;
  assert.equal(n, 1);
});

test("l'invité retrouve et modifie sa réponse avec son lien", async () => {
  const mine = await rpc(db, guest, 'get_my_rsvp', { p_token: token });
  assert.equal(mine.full_name, 'Awa Traoré');
  const r = await rpc(db, guest, 'submit_rsvp', { p: base({ token, status: 'no' }) });
  assert.equal(r.status, 'no');
  const row = (await db.query(`select * from public.guests`)).rows[0];
  assert.equal(row.status, 'no');
  assert.equal(row.party_size, 0, 'pas d’accompagnants si absent');
  assert.equal(row.companions, null);
  assert.deepEqual(row.events, []);
  await rejects(rpc(db, guest, 'get_my_rsvp', { p_token: 'a'.repeat(64) }), 'TOKEN_INVALID');
  await rejects(rpc(db, guest, 'submit_rsvp', { p: base({ token: 'b'.repeat(64) }) }), 'TOKEN_INVALID');
});

test('validation côté serveur', async () => {
  const cases = [
    [{ full_name: 'A' }, 'VALIDATION:full_name'],
    [{ phone: '123' }, 'VALIDATION:phone'],
    [{ phone: '07 11 22 33 44', category: 'vip' }, 'VALIDATION:category'],
    [{ phone: '07 11 22 33 44', status: 'pending' }, 'VALIDATION:status'],
    [{ phone: '07 11 22 33 44', party_size: 0 }, 'VALIDATION:party_size'],
    [{ phone: '07 11 22 33 44', party_size: 99 }, 'VALIDATION:party_size'],
    [{ phone: '07 11 22 33 44', events: ['preche'] }, 'VALIDATION:events'], // prêche pas encore ouvert
    [{ phone: '07 11 22 33 44', events: [] }, 'VALIDATION:events'],
    [{ phone: '07 11 22 33 44', website: 'http://spam' }, 'SPAM'],
  ];
  for (const [o, code] of cases) await rejects(rpc(db, guest, 'submit_rsvp', { p: base(o) }), code);
});

test('limitation des envois abusifs par IP', async () => {
  const ctx = { role: 'anon', ip: '9.9.9.9' };
  // Les envois invalides sont annulés (rien n'est stocké) ; on compte les envois enregistrés.
  for (let i = 0; i < 40; i++) {
    await rpc(db, ctx, 'submit_rsvp', { p: base({ full_name: 'Robot ' + i, phone: '0600000' + String(i).padStart(3, '0') }) });
  }
  await rejects(rpc(db, ctx, 'submit_rsvp', { p: base({ phone: '05 55 55 55 55' }) }), 'RATE_LIMIT');
  await db.query(`delete from public.guests where full_name like 'Robot %'`);
  // une autre IP n'est pas bloquée
  const ok = await rpc(db, { role: 'anon', ip: '8.8.8.8' }, 'submit_rsvp', { p: base({ full_name: 'Koffi Yao', phone: '05 55 55 55 55', category: 'parrain', party_size: 1, events: ['ceremonie', 'reception'] }) });
  assert.equal(ok.ok, true);
});

test("l'admin voit, ajoute, modifie et supprime les invités", async () => {
  const ov = await rpc(db, admin, 'admin_overview');
  assert.equal(ov.settings.planned_invitations, 300);
  assert.equal(ov.guests.length, 2);
  assert.ok(!('edit_token_hash' in ov.guests[0]), 'les jetons ne sortent jamais');

  const added = await rpc(db, admin, 'admin_save_guest', { p: { full_name: 'Famille Diaby', phone: '01 02 03 04 05', category: 'famille_epouse', status: 'pending', party_size: 4 } });
  assert.equal(added.status, 'pending');
  assert.equal(added.responded_at, null);
  await rejects(rpc(db, admin, 'admin_save_guest', { p: { full_name: 'Doublon', phone: '+2250102030405', category: 'ami', status: 'pending' } }), 'PHONE_TAKEN');

  // L'invité pré-enregistré répond lui-même : sa fiche est complétée, pas dupliquée
  const r = await rpc(db, guest, 'submit_rsvp', { p: base({ full_name: 'Mariam Diaby', phone: '0102030405', category: 'famille_epouse', party_size: 3, events: ['ceremonie'] }) });
  assert.equal(r.ok, true);
  const ov2 = await rpc(db, admin, 'admin_overview');
  assert.equal(ov2.guests.length, 3);
  const diaby = ov2.guests.find((g) => g.id === added.id);
  assert.equal(diaby.status, 'yes');
  assert.equal(diaby.party_size, 3);

  const edited = await rpc(db, admin, 'admin_save_guest', { p: { ...diaby, party_size: 5 } });
  assert.equal(edited.party_size, 5);
  assert.equal(await rpc(db, admin, 'admin_delete_guest', { p_id: added.id }), true);
  assert.equal((await rpc(db, admin, 'admin_overview')).guests.length, 2);
});

test("l'admin active le prêche et ferme les inscriptions", async () => {
  await rpc(db, admin, 'admin_update_event', { p: { key: 'preche', title: 'Prêche', venue: 'Mosquée du Nouveau Quartier, Yopougon', event_date: '', rsvp_enabled: true, visible: true } });
  const ok = await rpc(db, { role: 'anon', ip: '7.7.7.7' }, 'submit_rsvp', { p: base({ full_name: 'Ibrahim Kone', phone: '0707070707', events: ['preche'] }) });
  assert.deepEqual(ok.events, ['preche']);
  await rejects(rpc(db, admin, 'admin_update_event', { p: { key: 'reception', maps_url: 'javascript:alert(1)' } }), 'check constraint');

  await rpc(db, admin, 'admin_update_settings', { p: { rsvp_open: false, planned_invitations: 320 } });
  const info = await rpc(db, guest, 'get_public_info');
  assert.equal(info.rsvp_open, false);
  await rejects(rpc(db, { role: 'anon', ip: '6.6.6.6' }, 'submit_rsvp', { p: base({ phone: '0101010101' }) }), 'RSVP_CLOSED');
  await rpc(db, admin, 'admin_update_settings', { p: { rsvp_open: true } });
  assert.equal((await rpc(db, admin, 'admin_overview')).settings.planned_invitations, 320);
});

test('un intrus connecté ne peut rien modifier', async () => {
  await rejects(rpc(db, intruder, 'admin_save_guest', { p: base() }), 'FORBIDDEN');
  await rejects(rpc(db, intruder, 'admin_update_settings', { p: { rsvp_open: false } }), 'FORBIDDEN');
  await rejects(callAs(db, intruder, `delete from public.guests`), 'permission denied');
});
