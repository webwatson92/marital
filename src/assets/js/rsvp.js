/* =====================================================================
   Formulaire de confirmation de présence (RSVP).
   La réponse n'est déclarée « enregistrée » qu'après confirmation
   explicite de la base de données (fonction submit_rsvp).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  const S = window.Site;
  const TOKEN_KEY = 'ok-rsvp-token';
  const CATEGORIES = [
    ['honneur', 'Invité d’honneur'],
    ['parrain', 'Parrain'],
    ['ami', 'Collègue ou ami des mariés'],
    ['famille_epoux', 'Famille de l’époux'],
    ['famille_epouse', 'Famille de l’épouse'],
  ];
  const TICK = '<span class="tick"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5 6.5 12 13 4.5"/></svg></span>';

  const $ = (id) => document.getElementById(id);
  const form = $('rsvp-form');
  const btn = $('submit-btn');
  const yesBlock = $('yes-block');
  const party = $('party_size');
  const errorBox = $('form-error');
  let events = [];
  let editToken = null;
  let submitting = false;

  const storage = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* stockage indisponible */ } },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } },
  };

  /* ---------- Construction du formulaire ---------- */
  $('category-choices').innerHTML = CATEGORIES.map(([v, l]) =>
    `<label class="choice"><input type="radio" name="category" value="${v}"><span class="box">${TICK}${l}</span></label>`).join('');

  const info = await S.getPublicInfo();
  events = (info.events || []).filter((e) => e.rsvp_enabled);
  const later = (info.events || []).filter((e) => !e.rsvp_enabled);

  // Choix rangés par ville : « À Daloa » puis « À Abidjan ».
  $('event-choices').innerHTML = S.groupByCity(events).map((g) =>
    (g.label ? `<p class="choice-city"><b>${S.esc(g.label)}</b>${g.sub ? ' · ' + S.esc(g.sub) : ''}</p>` : '')
    + g.items.map(({ e }) => {
      const d = S.formatDate(e.event_date, { day: 'numeric', month: 'long', year: 'numeric' });
      return `<label class="choice"><input type="checkbox" name="events" value="${S.esc(e.key)}" checked><span class="box">${TICK}<span>${S.esc(e.title)}<small>${d ? S.esc(d) : 'Date à confirmer'}${e.venue ? ' · ' + S.esc(e.venue) : ''}</small></span></span></label>`;
    }).join('')).join('');
  $('events-hint').textContent = later.length
    ? later.map((e) => e.title).join(', ') + ' : la confirmation sera ouverte dès que les informations seront validées.'
    : '';
  if (!events.length) $('events-step').hidden = true;

  if (info.offline) {
    showError('Le service de confirmation est momentanément injoignable. Vérifiez votre connexion, puis réessayez dans un instant.');
  }

  /* ---------- Interactions ---------- */
  function setPresence() {
    const yes = form.status.value === 'yes';
    if (yes && yesBlock.hidden) { yesBlock.hidden = false; yesBlock.classList.add('show'); }
    if (!yes) yesBlock.hidden = true;
  }
  form.querySelectorAll('input[name="status"]').forEach((r) => r.addEventListener('change', () => { setPresence(); clearInvalid('status'); }));

  function setParty(n) {
    n = Math.max(1, Math.min(20, Number(n) || 1));
    party.value = n;
    const cb = $('companions-block');
    if (n > 1 && cb.hidden) { cb.hidden = false; cb.classList.add('show'); }
    if (n <= 1) cb.hidden = true;
  }
  form.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => setParty(Number(party.value) + Number(b.dataset.step))));
  party.addEventListener('change', () => setParty(party.value));
  form.addEventListener('input', (e) => { const f = e.target.closest('[data-field]'); if (f) f.classList.remove('invalid'); });
  form.addEventListener('change', (e) => { const f = e.target.closest('[data-field]'); if (f) f.classList.remove('invalid'); });

  function clearInvalid(name) { form.querySelector(`[data-field="${name}"]`)?.classList.remove('invalid'); }
  function markInvalid(name) { form.querySelector(`[data-field="${name}"]`)?.classList.add('invalid'); }
  function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
  function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

  function collect() {
    const status = form.status.value;
    return {
      full_name: form.full_name.value.trim(),
      phone: form.phone.value.trim(),
      category: form.category.value,
      status,
      party_size: status === 'yes' ? Number(party.value) : 0,
      companions: status === 'yes' && Number(party.value) > 1 ? form.companions.value.trim() : '',
      events: status === 'yes' ? [...form.querySelectorAll('input[name="events"]:checked')].map((i) => i.value) : [],
      website: form.website.value,
      token: editToken || undefined,
    };
  }

  function validate(p) {
    const bad = [];
    if (p.full_name.replace(/\s+/g, ' ').length < 2) bad.push('full_name');
    const digits = p.phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) bad.push('phone');
    if (!p.category) bad.push('category');
    if (!p.status) bad.push('status');
    if (p.status === 'yes') {
      if (!(p.party_size >= 1 && p.party_size <= 20)) bad.push('party_size');
      if (events.length && !p.events.length) bad.push('events');
    }
    return bad;
  }

  function setBusy(busy) {
    submitting = busy;
    btn.disabled = busy;
    btn.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span> Envoi en cours…' : (editToken ? 'Enregistrer ma modification' : 'Envoyer ma réponse');
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submitting) return; // empêche les doubles envois
    hideError();
    const p = collect();
    const bad = validate(p);
    if (bad.length) {
      bad.forEach(markInvalid);
      const first = form.querySelector('.invalid');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.querySelector('input, textarea')?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      const res = await S.rpc('submit_rsvp', { p });
      if (!res || res.ok !== true || !res.token) throw new S.ApiError('UNKNOWN');
      editToken = res.token;
      storage.set(res.token);
      showThanks(res, p);
    } catch (e) {
      if (e.code && e.code.startsWith('VALIDATION:')) markInvalid(e.code.split(':')[1]);
      if (e.code === 'ALREADY_RESPONDED' || e.code === 'PHONE_TAKEN') markInvalid('phone');
      if (e.code === 'TOKEN_INVALID') { storage.clear(); editToken = null; $('edit-banner').hidden = true; }
      showError(e.message);
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setBusy(false);
    }
  });

  /* ---------- Remerciement ---------- */
  function editUrl(token) { return S.siteUrl() + '/rsvp.html?m=' + encodeURIComponent(token); }

  function showThanks(res, p) {
    const yes = res.status === 'yes';
    $('thanks-title').textContent = 'Merci, ' + res.full_name + ' !';
    $('thanks-msg').textContent = yes
      ? 'Les familles OUATTARA & KANTÉ vous remercient pour votre retour et seront heureuses de partager ces moments de célébration avec vous.'
      : 'Les familles OUATTARA & KANTÉ vous remercient pour votre retour. Vous serez dans leurs pensées en ces moments de célébration.';
    const when = new Date(res.responded_at || Date.now());
    $('saved-at').textContent = 'Réponse enregistrée le ' + when.toLocaleDateString('fr-FR', { timeZone: S.TIME_ZONE }) + ' à ' + when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: S.TIME_ZONE }) + ' (heure d’Abidjan)';
    const titles = Object.fromEntries((events || []).map((e) => [e.key, e.title]));
    const rows = [
      ['Réponse', yes ? 'Présent(e)' : 'Absent(e)'],
      ...(yes ? [['Personnes', String(res.party_size)], ['Événements', (res.events || []).map((k) => titles[k] || k).join(', ') || '—']] : []),
    ];
    $('recap').innerHTML = rows.map(([k, v]) => `<div><dt>${S.esc(k)}</dt><dd>${S.esc(v)}</dd></div>`).join('');
    const url = editUrl(res.token);
    $('wa-link').href = S.whatsappShareUrl('Mon lien pour modifier ma réponse au mariage des FAMILLES OUATTARA & KANTÉ : ' + url);
    $('copy-link').onclick = async () => S.toast((await S.copyText(url)) ? 'Lien copié' : 'Copie impossible : notez le lien ' + url);

    prepareInvite(res);

    form.hidden = true;
    $('edit-banner').hidden = true;
    $('thanks').hidden = false;
    $('rsvp-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('thanks').focus({ preventScroll: true });
  }

  /* ---------- Invitation personnelle (présence confirmée uniquement) ---------- */
  let inviteUrl = null;
  let inviteRun = 0;

  async function prepareInvite(guest) {
    const run = ++inviteRun; // seule la dernière demande compte
    const status = $('invite-status');
    const preview = $('invite-preview');
    const share = $('invite-share');
    const links = [$('invite-download'), $('banner-invite')].filter(Boolean);

    links.forEach((a) => { a.hidden = true; a.removeAttribute('href'); });
    share.hidden = true;
    preview.hidden = true;
    preview.removeAttribute('src');
    $('invite-hint').hidden = true;
    if (inviteUrl) { URL.revokeObjectURL(inviteUrl); inviteUrl = null; }

    const yes = guest.status === 'yes';
    $('invite-box').hidden = !yes;
    if (!yes) return;

    status.hidden = false;
    status.textContent = 'Préparation de votre invitation…';
    try {
      const { blob, filename } = await window.Invitation.create(guest, info.events);
      if (run !== inviteRun) return;
      inviteUrl = URL.createObjectURL(blob);
      links.forEach((a) => { a.href = inviteUrl; a.download = filename; a.hidden = false; });
      preview.src = inviteUrl;
      preview.hidden = false;
      status.hidden = true;
      $('invite-hint').hidden = false;

      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        share.hidden = false;
        share.onclick = () => navigator.share({ files: [file], title: 'Invitation — Familles OUATTARA & KANTÉ' }).catch(() => { /* partage annulé */ });
      }
    } catch (e) {
      if (run !== inviteRun) return;
      console.warn('Invitation non générée :', e.message);
      status.textContent = 'Votre réponse est bien enregistrée, mais l’invitation n’a pas pu être créée sur cet appareil. Essayez avec un autre navigateur grâce à votre lien personnel.';
    }
  }

  $('edit-again').addEventListener('click', () => {
    $('thanks').hidden = true;
    form.hidden = false;
    $('edit-banner').hidden = false;
    setBusy(false);
    $('rsvp-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- Mode modification (lien personnel) ---------- */
  function fill(r) {
    form.full_name.value = r.full_name || '';
    form.phone.value = r.phone || '';
    form.querySelector(`input[name="category"][value="${r.category}"]`)?.click();
    if (r.status === 'yes' || r.status === 'no') form.querySelector(`input[name="status"][value="${r.status}"]`).checked = true;
    setPresence();
    setParty(r.status === 'yes' ? r.party_size : 1);
    form.companions.value = r.companions || '';
    if (r.status === 'yes') {
      form.querySelectorAll('input[name="events"]').forEach((i) => { i.checked = (r.events || []).includes(i.value); });
    }
  }

  const params = new URLSearchParams(location.search);
  const urlToken = params.get('m');
  if (urlToken) {
    storage.set(urlToken);
    history.replaceState(null, '', location.pathname); // retire le jeton de la barre d'adresse
  }
  const token = urlToken || storage.get();
  if (token) {
    try {
      const mine = await S.rpc('get_my_rsvp', { p_token: token });
      editToken = token;
      fill(mine);
      const banner = $('edit-banner');
      banner.hidden = false;
      banner.innerHTML = 'Vous avez déjà répondu' + (mine.responded_at ? ' le ' + S.esc(new Date(mine.responded_at).toLocaleDateString('fr-FR', { timeZone: S.TIME_ZONE })) : '')
        + '. Vous pouvez modifier votre réponse ci-dessous. <a class="btn btn-dark btn-sm" id="banner-invite" style="margin-top:10px" hidden>Télécharger mon invitation</a> <button type="button" class="btn btn-outline-dark btn-sm" id="new-person" style="margin-top:10px">Répondre pour une autre personne</button>';
      prepareInvite(mine);
      $('new-person').addEventListener('click', () => {
        editToken = null; form.reset(); setPresence(); setParty(1); banner.hidden = true; setBusy(false); hideError();
        prepareInvite({ status: null });
        form.querySelectorAll('input[name="events"]').forEach((i) => { i.checked = true; });
        form.full_name.focus();
      });
    } catch (e) {
      if (e.code === 'TOKEN_INVALID') { storage.clear(); if (urlToken) showError(e.message); }
    }
  }

  if (info.rsvp_open === false) {
    $('closed-banner').hidden = false;
    form.hidden = true;
  }
  setBusy(false);
});
