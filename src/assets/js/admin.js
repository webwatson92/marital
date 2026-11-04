/* =====================================================================
   Espace organisateurs : connexion Supabase Auth, indicateurs,
   gestion des invités, programme, réglages, exports.
   Toutes les opérations passent par les fonctions admin_* de la base,
   qui vérifient côté serveur que le compte est bien organisateur.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATEGORIES = {
    honneur: 'Invité d’honneur', parrain: 'Parrain', ami: 'Collègue ou ami',
    famille_epoux: 'Famille de l’époux', famille_epouse: 'Famille de l’épouse',
  };
  const STATUS = { yes: 'Présent(e)', no: 'Absent(e)', pending: 'En attente' };
  const ERR = {
    FORBIDDEN: 'Ce compte n’est pas autorisé à accéder à l’espace organisateurs.',
    PHONE_TAKEN: 'Ce numéro de téléphone est déjà utilisé par un autre invité.',
    NOT_FOUND: 'Élément introuvable (il a peut-être été supprimé entre-temps).',
    'VALIDATION:full_name': 'Nom invalide (2 à 120 caractères).',
    'VALIDATION:phone': 'Numéro de téléphone invalide.',
    'VALIDATION:category': 'Catégorie invalide.',
    'VALIDATION:status': 'Réponse invalide.',
    'VALIDATION:party_size': 'Nombre de personnes invalide (1 à 20).',
    'VALIDATION:events': 'Événements invalides.',
  };
  const errMsg = (e) => {
    const m = (e && e.message) || '';
    const k = Object.keys(ERR).find((key) => m === key || m.startsWith(key));
    if (k) return ERR[k];
    if (/JWT|session|token/i.test(m)) return 'Votre session a expiré. Merci de vous reconnecter.';
    if (/fetch|network|Failed/i.test(m)) return 'Connexion impossible. Vérifiez votre accès Internet.';
    return m || 'Une erreur est survenue.';
  };

  let sb = null;
  let state = { guests: [], events: [], settings: {}, server_time: null };
  let pollTimer = null;

  /* ---------------- Démarrage ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
      $('login-view').hidden = false;
      showLoginError('Configuration manquante : le site n’est pas relié à Supabase (voir README).');
      return;
    }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ok-admin-session' },
    });
    bindUi();
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(data.session);
    else showLogin();
  });

  function showLogin() { $('app-view').hidden = true; $('login-view').hidden = false; stopPolling(); }
  function showLoginError(msg) { const b = $('login-error'); b.textContent = msg; b.hidden = !msg; }
  function showAppError(msg) { const b = $('app-error'); b.textContent = msg || ''; b.hidden = !msg; }

  async function enter(session) {
    const { data: ok, error } = await sb.rpc('is_admin');
    if (error || !ok) {
      await sb.auth.signOut();
      showLogin();
      showLoginError(error ? errMsg(error) : ERR.FORBIDDEN);
      return;
    }
    $('who').textContent = session.user.email;
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    await load();
    startPolling();
  }

  /* ---------------- Données ---------------- */
  async function load() {
    const { data, error } = await sb.rpc('admin_overview');
    if (error) {
      showAppError(errMsg(error));
      if (/JWT|expired/i.test(error.message)) { await sb.auth.signOut(); showLogin(); }
      return;
    }
    showAppError('');
    state = data;
    renderAll();
  }
  function startPolling() {
    stopPolling();
    // Actualisation automatique toutes les 30 s quand l'onglet est visible
    pollTimer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) load(); }, 30000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function renderAll() {
    renderDashboard();
    renderGuests();
    renderEventForms();
    renderSettings();
    $('stamp').textContent = 'Dernière actualisation : ' + new Date().toLocaleString('fr-FR');
  }

  /* ---------------- Statistiques ---------------- */
  function stats() {
    const g = state.guests;
    const yes = g.filter((x) => x.status === 'yes');
    const no = g.filter((x) => x.status === 'no');
    const pendingRows = g.filter((x) => x.status === 'pending');
    const responses = yes.length + no.length;
    const planned = state.settings.planned_invitations || 0;
    const people = yes.reduce((s, x) => s + (x.party_size || 0), 0);
    return { yes, no, pendingRows, responses, planned, people, waiting: Math.max(planned - responses, 0) };
  }

  function bar(label, right, parts, max) {
    const segs = parts.map(([cls, v]) => v > 0 ? `<span class="${cls}" style="width:${(v / max) * 100}%"></span>` : '').join('');
    return `<div class="bar-row"><div class="lbl"><span>${esc(label)}</span><b>${esc(right)}</b></div><div class="bar-track">${segs}</div></div>`;
  }

  function renderDashboard() {
    const s = stats();
    const kpi = (k, v, sub, cls) => `<div class="kpi ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
    $('kpis').innerHTML = [
      kpi('Réponses reçues', s.responses, `sur ${s.planned} invitations prévues`),
      kpi('Présents', s.yes.length, 'réponses positives'),
      kpi('Absents', s.no.length, 'ont décliné'),
      kpi('En attente', s.waiting, s.pendingRows.length ? `dont ${s.pendingRows.length} invité(s) enregistré(s) sans réponse` : 'invitations sans réponse'),
      kpi('Personnes attendues', s.people, 'accompagnants compris', 'hl wide'),
    ].join('');

    const pct = s.planned ? Math.min(100, Math.round((s.responses / s.planned) * 100)) : 0;
    $('progress-bar').style.width = pct + '%';
    $('progress-left').textContent = `${s.responses} réponse(s) — ${pct} %`;
    $('progress-right').textContent = `${s.planned} prévues`;

    // Par événement
    const evRows = state.events.map((e) => {
      const n = s.yes.filter((x) => (x.events || []).includes(e.key)).reduce((t, x) => t + x.party_size, 0);
      return [e.title + (e.rsvp_enabled ? '' : ' (confirmation non ouverte)'), n];
    });
    const evMax = Math.max(1, ...evRows.map((r) => r[1]));
    $('chart-events').innerHTML = evRows.map(([l, n]) => bar(l, n + ' pers.', [['ppl', n]], evMax)).join('');

    // Par catégorie
    const cats = Object.keys(CATEGORIES).map((k) => {
      const y = s.yes.filter((x) => x.category === k);
      const n = s.no.filter((x) => x.category === k).length;
      return { k, y: y.length, n, p: y.reduce((t, x) => t + x.party_size, 0) };
    });
    const cMax = Math.max(1, ...cats.map((c) => c.y + c.n));
    $('chart-categories').innerHTML = s.responses
      ? cats.map((c) => bar(CATEGORIES[c.k], `${c.y} présent(s) · ${c.n} absent(s)`, [['yes', c.y], ['no', c.n]], cMax)).join('')
      : '<div class="empty">Aucune réponse pour le moment.</div>';
    const pMax = Math.max(1, ...cats.map((c) => c.p));
    $('chart-people').innerHTML = s.people
      ? cats.map((c) => bar(CATEGORIES[c.k], c.p + ' pers.', [['ppl', c.p]], pMax)).join('')
      : '<div class="empty">Aucune personne attendue pour le moment.</div>';

    // Réponses par jour
    const byDay = {};
    state.guests.forEach((x) => { if (x.responded_at) { const d = x.responded_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; } });
    const days = Object.keys(byDay).sort();
    if (!days.length) { $('chart-timeline').innerHTML = '<div class="empty">Les réponses apparaîtront ici jour après jour.</div>'; return; }
    const list = []; const d = new Date(days[0] + 'T00:00:00Z'); const end = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    while (d <= end && list.length < 120) { const k = d.toISOString().slice(0, 10); list.push([k, byDay[k] || 0]); d.setUTCDate(d.getUTCDate() + 1); }
    const tMax = Math.max(1, ...list.map((r) => r[1]));
    const fmt = (k) => new Date(k + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    $('chart-timeline').innerHTML = `<div class="timeline">${list.map(([k, v]) => `<div class="col" style="height:${Math.max(v ? 4 : 0, (v / tMax) * 100)}%" title="${fmt(k)} : ${v} réponse(s)"></div>`).join('')}</div>
      <div class="timeline-axis"><span>${fmt(list[0][0])}</span><span>max ${tMax} / jour</span><span>${fmt(list[list.length - 1][0])}</span></div>`;
  }

  /* ---------------- Liste des invités ---------------- */
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filtered() {
    const q = norm($('q').value.trim());
    const qd = q.replace(/\D/g, '');
    const cat = $('f-category').value; const st = $('f-status').value;
    return state.guests.filter((g) => (!cat || g.category === cat) && (!st || g.status === st)
      && (!q || norm(g.full_name).includes(q) || norm(g.companions).includes(q) || (qd.length >= 3 && g.phone.replace(/\D/g, '').includes(qd))));
  }
  const evTitle = (k) => (state.events.find((e) => e.key === k) || {}).title || k;
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  function renderGuests() {
    const rows = filtered();
    $('count').textContent = `${rows.length} ligne(s) · ${rows.filter((g) => g.status === 'yes').reduce((t, g) => t + g.party_size, 0)} personne(s) présentes`;
    $('rows').innerHTML = rows.length ? rows.map((g) => {
      const wa = 'https://wa.me/' + g.phone.replace(/\D/g, '').replace(/^00/, '').replace(/^0(?=\d{9}$)/, '2250');
      return `<tr>
        <td class="first" data-label="Nom">${esc(g.full_name)}${g.companions ? `<span class="sub">${esc(g.companions)}</span>` : ''}</td>
        <td data-label="Téléphone"><a href="${esc(wa)}" target="_blank" rel="noopener">${esc(g.phone)}</a></td>
        <td data-label="Catégorie">${esc(CATEGORIES[g.category] || g.category)}</td>
        <td data-label="Réponse"><span class="badge ${g.status}">${STATUS[g.status]}</span></td>
        <td data-label="Personnes">${g.status === 'yes' ? g.party_size : '—'}</td>
        <td data-label="Événements">${g.status === 'yes' ? esc((g.events || []).map(evTitle).join(', ') || '—') : '—'}</td>
        <td data-label="Répondu le">${fmtDate(g.responded_at)}${g.source === 'admin' ? '<span class="sub">ajouté par un organisateur</span>' : ''}</td>
        <td data-label="Actions"><div class="row-actions"><button class="mini" data-edit="${g.id}">Modifier</button><button class="mini danger" data-del="${g.id}">Supprimer</button></div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8"><div class="empty">Aucun invité ne correspond.</div></td></tr>';
  }

  /* ---------------- Fenêtre invité ---------------- */
  let editingId = null;
  function openGuest(g) {
    editingId = g ? g.id : null;
    $('guest-dlg-title').textContent = g ? 'Modifier l’invité' : 'Ajouter un invité';
    $('g-name').value = g ? g.full_name : '';
    $('g-phone').value = g ? g.phone : '';
    $('g-category').value = g ? g.category : 'ami';
    $('g-status').value = g ? g.status : 'pending';
    $('g-party').value = g ? Math.max(1, g.party_size) : 1;
    $('g-companions').value = g ? (g.companions || '') : '';
    $('g-events').innerHTML = state.events.map((e) => `<label class="check"><input type="checkbox" value="${esc(e.key)}" ${!g || (g.events || []).includes(e.key) || (g.status !== 'yes' && e.rsvp_enabled) ? 'checked' : ''}> ${esc(e.title)}</label>`).join('');
    $('guest-error').hidden = true;
    toggleGuestFields();
    $('guest-dlg').showModal();
  }
  function toggleGuestFields() {
    const st = $('g-status').value;
    $('g-yes-only').hidden = st !== 'yes';
    $('g-events-wrap').hidden = st !== 'yes';
    $('g-party').disabled = st === 'no';
  }

  async function saveGuest(ev) {
    ev.preventDefault();
    const btn = $('guest-save');
    if (btn.disabled) return;
    const st = $('g-status').value;
    const p = {
      id: editingId || undefined,
      full_name: $('g-name').value, phone: $('g-phone').value, category: $('g-category').value, status: st,
      party_size: Number($('g-party').value) || 1, companions: st === 'yes' ? $('g-companions').value : '',
      events: st === 'yes' ? [...$('g-events').querySelectorAll('input:checked')].map((i) => i.value) : [],
    };
    btn.disabled = true;
    const { error } = await sb.rpc('admin_save_guest', { p });
    btn.disabled = false;
    if (error) { const b = $('guest-error'); b.textContent = errMsg(error); b.hidden = false; return; }
    $('guest-dlg').close();
    await load();
  }

  let deletingId = null;
  function askDelete(g) {
    deletingId = g.id;
    $('confirm-text').textContent = `La réponse de « ${g.full_name} » sera supprimée définitivement. Cette action est irréversible.`;
    $('confirm-dlg').showModal();
  }
  async function doDelete() {
    const btn = $('confirm-yes'); btn.disabled = true;
    const { error } = await sb.rpc('admin_delete_guest', { p_id: deletingId });
    btn.disabled = false;
    $('confirm-dlg').close();
    if (error) showAppError(errMsg(error));
    await load();
  }

  /* ---------------- Exports ---------------- */
  function exportRows() {
    const head = ['Nom et prénoms', 'Téléphone', 'Catégorie', 'Réponse', 'Nombre de personnes', 'Accompagnants', ...state.events.map((e) => e.title), 'Date de réponse', 'Origine'];
    const rows = filtered().map((g) => [
      g.full_name, g.phone, CATEGORIES[g.category] || g.category, STATUS[g.status], g.status === 'yes' ? g.party_size : 0, g.companions || '',
      ...state.events.map((e) => (g.status === 'yes' && (g.events || []).includes(e.key) ? 'Oui' : '')),
      g.responded_at ? fmtDate(g.responded_at) : '', g.source === 'admin' ? 'Organisateur' : 'Site',
    ]);
    return [head, ...rows];
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stampName = () => 'invites-ouattara-kante-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  function exportCsv() {
    // Point-virgule + BOM UTF-8 : s'ouvre correctement dans Excel en français.
    const csv = exportRows().map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), stampName() + '.csv');
  }
  function exportXlsx() { download(window.XlsxLite.build(exportRows(), 'Invités'), stampName() + '.xlsx'); }

  /* ---------------- Programme ---------------- */
  function renderEventForms() {
    const box = $('event-forms');
    if (box.contains(document.activeElement)) return; // ne pas écraser une saisie en cours
    box.innerHTML = state.events.map((e) => `
      <form class="event-form" data-key="${esc(e.key)}">
        <h3>${esc(e.title)}</h3>
        <p class="muted">Dernière modification : ${fmtDate(e.updated_at)}</p>
        <div class="form-grid two">
          <div class="field"><label>Titre</label><input class="input" name="title" value="${esc(e.title)}" maxlength="80" required></div>
          <div class="field"><label>Date</label><input class="input" name="event_date" type="date" value="${esc(e.event_date || '')}"></div>
          <div class="field"><label>Heure</label><input class="input" name="time_label" value="${esc(e.time_label || '')}" maxlength="40" placeholder="Vide = À confirmer"></div>
          <div class="field"><label>Lieu</label><input class="input" name="venue" value="${esc(e.venue || '')}" maxlength="160" placeholder="Vide = À confirmer"></div>
        </div>
        <div class="field"><label>Adresse détaillée</label><input class="input" name="address" value="${esc(e.address || '')}" maxlength="300" placeholder="Vide = À confirmer"></div>
        <div class="field"><label>Lien Google Maps (https://…)</label><input class="input" name="maps_url" type="url" value="${esc(e.maps_url || '')}" maxlength="600" placeholder="Vide = pas de bouton d’itinéraire"></div>
        <div class="field"><label>Note affichée aux invités</label><textarea class="textarea" name="note" maxlength="400">${esc(e.note || '')}</textarea></div>
        <div class="flags">
          <label class="check"><input type="checkbox" name="visible" ${e.visible ? 'checked' : ''}> Visible sur le site</label>
          <label class="check"><input type="checkbox" name="rsvp_enabled" ${e.rsvp_enabled ? 'checked' : ''}> Confirmation ouverte</label>
        </div>
        <div class="alert-box" hidden></div>
        <p style="margin-top:12px"><button class="btn btn-dark btn-sm" type="submit">Enregistrer</button></p>
      </form>`).join('');
  }
  async function saveEvent(form) {
    const f = form.elements; const msg = form.querySelector('.alert-box');
    const url = f.maps_url.value.trim();
    if (url && !/^https:\/\//.test(url)) { msg.textContent = 'Le lien Google Maps doit commencer par https://'; msg.hidden = false; return; }
    const p = {
      key: form.dataset.key, title: f.title.value, event_date: f.event_date.value, time_label: f.time_label.value,
      venue: f.venue.value, address: f.address.value, maps_url: url, note: f.note.value,
      visible: f.visible.checked, rsvp_enabled: f.rsvp_enabled.checked,
    };
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const { error } = await sb.rpc('admin_update_event', { p });
    btn.disabled = false;
    if (error) { msg.textContent = errMsg(error); msg.hidden = false; return; }
    document.activeElement.blur();
    await load();
    // Le formulaire a été redessiné avec les données à jour : on y affiche la confirmation.
    const fresh = document.querySelector(`#event-forms form[data-key="${form.dataset.key}"] .alert-box`);
    if (fresh) { fresh.textContent = 'Enregistré : le site est à jour.'; fresh.hidden = false; }
  }

  /* ---------------- Réglages ---------------- */
  function renderSettings() {
    if ($('settings-form').contains(document.activeElement)) return;
    $('s-planned').value = state.settings.planned_invitations;
    $('s-deadline').value = state.settings.rsvp_deadline || '';
    $('s-open').checked = !!state.settings.rsvp_open;
  }
  async function saveSettings(ev) {
    ev.preventDefault();
    const p = { planned_invitations: Number($('s-planned').value) || 0, rsvp_deadline: $('s-deadline').value, rsvp_open: $('s-open').checked };
    const { error } = await sb.rpc('admin_update_settings', { p });
    showAppError(error ? errMsg(error) : '');
    if (!error) { document.activeElement.blur(); await load(); alertOk('Réglages enregistrés.'); }
  }
  function alertOk(text) { const b = $('app-error'); b.textContent = text; b.hidden = false; setTimeout(() => { if (b.textContent === text) b.hidden = true; }, 3000); }

  /* ---------------- Événements d'interface ---------------- */
  function bindUi() {
    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('login-btn'); if (btn.disabled) return;
      showLoginError('');
      btn.disabled = true; btn.textContent = 'Connexion…';
      const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      btn.disabled = false; btn.textContent = 'Se connecter';
      if (error) { showLoginError('Identifiants incorrects ou compte inexistant.'); return; }
      $('password').value = '';
      await enter(data.session);
    });
    $('logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });
    $('refresh-btn').addEventListener('click', load);

    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + b.dataset.tab; });
      window.scrollTo({ top: 0 });
    }));

    const catOpts = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('f-category').innerHTML = '<option value="">Toutes les catégories</option>' + catOpts;
    $('g-category').innerHTML = catOpts;
    ['q', 'f-category', 'f-status'].forEach((id) => $(id).addEventListener('input', renderGuests));

    $('rows').addEventListener('click', (ev) => {
      const e = ev.target.closest('[data-edit]'); const d = ev.target.closest('[data-del]');
      if (e) openGuest(state.guests.find((g) => g.id === e.dataset.edit));
      if (d) askDelete(state.guests.find((g) => g.id === d.dataset.del));
    });
    $('add-btn').addEventListener('click', () => openGuest(null));
    $('g-status').addEventListener('change', toggleGuestFields);
    $('guest-form').addEventListener('submit', saveGuest);
    $('confirm-yes').addEventListener('click', doDelete);
    document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $('csv-btn').addEventListener('click', exportCsv);
    $('xlsx-btn').addEventListener('click', exportXlsx);
    $('event-forms').addEventListener('submit', (ev) => { ev.preventDefault(); saveEvent(ev.target); });
    $('settings-form').addEventListener('submit', saveSettings);

    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showLogin(); });
  }
})();
