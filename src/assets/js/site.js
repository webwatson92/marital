/* =====================================================================
   Fonctions communes au site public : API Supabase, navigation,
   mise en forme des dates, affichage des événements, partage.
   ===================================================================== */
(function () {
  'use strict';
  document.documentElement.classList.remove('no-js');

  const CFG = window.APP_CONFIG || {};

  /* ---------------- API (appels RPC Supabase) ---------------- */
  const ERRORS = {
    RSVP_CLOSED: 'Les confirmations sont actuellement fermées. Merci de contacter directement les familles.',
    ALREADY_RESPONDED: 'Une réponse a déjà été enregistrée avec ce numéro. Pour la modifier, utilisez votre lien personnel ou contactez les organisateurs.',
    TOKEN_INVALID: 'Ce lien de modification n’est pas valide. Vérifiez qu’il est complet, ou envoyez une nouvelle réponse.',
    PHONE_TAKEN: 'Ce numéro est déjà associé à une autre réponse.',
    RATE_LIMIT: 'Trop d’envois depuis votre connexion. Merci de patienter quelques minutes puis de réessayer.',
    SPAM: 'Votre envoi n’a pas pu être validé. Merci de réessayer.',
    'VALIDATION:full_name': 'Merci d’indiquer votre nom et vos prénoms.',
    'VALIDATION:phone': 'Merci d’indiquer un numéro WhatsApp valide.',
    'VALIDATION:category': 'Merci de choisir votre catégorie d’invité.',
    'VALIDATION:status': 'Merci d’indiquer si vous serez présent(e).',
    'VALIDATION:party_size': 'Le nombre de personnes doit être compris entre 1 et 20.',
    'VALIDATION:companions': 'La liste des accompagnants est trop longue.',
    'VALIDATION:events': 'Merci de choisir au moins un événement auquel vous participerez.',
    NETWORK: 'Connexion impossible. Vérifiez votre connexion Internet puis réessayez : votre réponse n’a pas encore été envoyée.',
    CONFIG: 'Le site n’est pas encore relié à sa base de données (configuration manquante).',
  };

  class ApiError extends Error {
    constructor(code) { super(ERRORS[code] || 'Une erreur est survenue. Merci de réessayer.'); this.code = code; }
  }

  async function rpc(fn, args) {
    if (!CFG.supabaseUrl || !CFG.supabaseKey) throw new ApiError('CONFIG');
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
    // Ancienne clé « anon » (JWT) : à transmettre aussi en Authorization.
    if (CFG.supabaseKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.supabaseKey;
    let res;
    try {
      res = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers, body: JSON.stringify(args || {}),
      });
    } catch (e) {
      throw new ApiError('NETWORK');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* réponse non JSON */ }
    if (!res.ok) {
      const msg = (data && data.message) || '';
      const code = Object.keys(ERRORS).find((k) => msg === k || msg.startsWith(k + ' ')) || 'UNKNOWN';
      throw new ApiError(code);
    }
    return data;
  }

  /* ---------------- Utilitaires ---------------- */
  // Les horodatages s'affichent à l'heure de la Côte d'Ivoire, quel que soit le réglage de l'appareil.
  const TIME_ZONE = 'Africa/Abidjan';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function formatDate(iso, opts) {
    const d = parseDate(iso);
    if (!d) return null;
    const s = d.toLocaleDateString('fr-FR', opts || { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function shortDate(iso) {
    const d = parseDate(iso);
    if (!d) return null;
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  }
  const TBC = '<span class="tbc">À confirmer</span>';

  // Programme de secours : affiché si la base est momentanément injoignable.
  // Il ne contient que les informations confirmées.
  const FALLBACK_EVENTS = [
    { key: 'ceremonie', title: 'Cérémonie religieuse', event_date: '2026-12-24', time_label: null, venue: 'Daloa', address: null, maps_url: null, note: 'Le lieu précis sera communiqué prochainement.', rsvp_enabled: true },
    { key: 'preche', title: 'Prêche', event_date: null, time_label: null, venue: 'Mosquée du Nouveau Quartier, Yopougon', address: null, maps_url: null, note: 'La date et l’horaire seront communiqués prochainement.', rsvp_enabled: false },
    { key: 'reception', title: 'Réception', event_date: '2027-01-03', time_label: null, venue: 'Yopougon Nouveau Quartier, Abidjan', address: 'Terrain situé à environ 15 mètres de la mosquée', maps_url: null, note: null, rsvp_enabled: true },
  ];

  let infoPromise = null;
  function getPublicInfo() {
    if (!infoPromise) {
      infoPromise = rpc('get_public_info').catch((e) => {
        console.warn('Programme indisponible, affichage de secours :', e.message);
        return { rsvp_open: null, events: FALLBACK_EVENTS, offline: true };
      });
    }
    return infoPromise;
  }

  /* ---------------- Icônes ---------------- */
  const ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>',
  };

  /* Carte détaillée d'un événement (page Programme) */
  function eventCard(e, i) {
    const date = formatDate(e.event_date);
    const maps = e.maps_url && /^https:\/\//.test(e.maps_url)
      ? `<a class="btn btn-ghost" href="${esc(e.maps_url)}" target="_blank" rel="noopener">${ICONS.map}<span>Itinéraire Google Maps</span></a>`
      : '<span class="maps-pending">Itinéraire disponible dès que l’emplacement exact sera confirmé.</span>';
    return `
      <article class="event-card fade-in" id="evt-${esc(e.key)}">
        <div class="event-num">${['I', 'II', 'III', 'IV'][i] || ''}</div>
        <h2>${esc(e.title)}</h2>
        <dl class="event-meta">
          <div>${ICONS.calendar}<span><dt>Date</dt><dd>${date ? esc(date) : TBC}</dd></span></div>
          <div>${ICONS.clock}<span><dt>Heure</dt><dd>${e.time_label ? esc(e.time_label) : TBC}</dd></span></div>
          <div>${ICONS.pin}<span><dt>Lieu</dt><dd>${e.venue ? esc(e.venue) : TBC}</dd></span></div>
          <div>${ICONS.map}<span><dt>Adresse</dt><dd>${e.address ? esc(e.address) : TBC}</dd></span></div>
        </dl>
        ${e.note ? `<p class="event-note">${esc(e.note)}</p>` : ''}
        <div class="event-actions">${maps}</div>
      </article>`;
  }

  /* Carte courte (page d'accueil) */
  function dateCard(e) {
    const date = formatDate(e.event_date);
    return `
      <a class="date-card fade-in" href="programme.html#evt-${esc(e.key)}">
        <h3>${esc(e.title)}</h3>
        <div class="when">${date ? esc(date) : TBC}</div>
        <div class="where">${esc(e.venue || 'Lieu à confirmer')}</div>
      </a>`;
  }

  /* ---------------- Interface ---------------- */
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
      ta.remove(); return ok;
    }
  }

  function siteUrl() {
    return (CFG.siteUrl || location.origin).replace(/\/$/, '');
  }
  function whatsappShareUrl(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  function observeFadeIns(root) {
    const els = (root || document).querySelectorAll('.fade-in:not(.visible)');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('visible')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    // Sécurité : tout le contenu devient visible au plus tard après 2 s.
    setTimeout(() => els.forEach((el) => el.classList.add('visible')), 2000);
  }

  function initChrome() {
    const page = document.body.dataset.page;
    document.querySelectorAll('[data-nav="' + page + '"]').forEach((a) => a.setAttribute('aria-current', 'page'));
    const header = document.querySelector('.site-header');
    if (header && !header.classList.contains('solid')) {
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 30);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    document.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const text = 'Les FAMILLES OUATTARA & KANTÉ ont la joie de vous convier à la célébration de leur union. '
          + 'Programme et confirmation de présence : ' + siteUrl() + '/';
        window.open(whatsappShareUrl(text), '_blank', 'noopener');
      });
    });
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = new Date().getFullYear();
    observeFadeIns();
  }

  document.addEventListener('DOMContentLoaded', initChrome);

  window.Site = {
    CFG, rpc, ApiError, ERRORS, TIME_ZONE, esc, formatDate, shortDate, parseDate, getPublicInfo, FALLBACK_EVENTS,
    eventCard, dateCard, ICONS, toast, copyText, siteUrl, whatsappShareUrl, observeFadeIns, TBC,
  };
})();
