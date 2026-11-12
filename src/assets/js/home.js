/* Page d'accueil : dates depuis la base + compte à rebours.
   Le compte à rebours vise le mariage religieux, puis, une fois celui-ci passé, la réception. */
document.addEventListener('DOMContentLoaded', async () => {
  const S = window.Site;

  // Étapes successives du compte à rebours (valeurs de secours si la base est injoignable).
  const MILESTONES = [
    { key: 'ceremonie', label: 'le mariage religieux', event_date: '2026-12-24', time_label: '8 h 00' },
    { key: 'reception', label: 'la réception', event_date: '2027-01-03', time_label: 'De 8 h 30 à 14 h' },
  ];

  // Heure cible à l'heure d'Abidjan (UTC+0). Sans horaire confirmé, on vise minuit le jour J.
  function targetTime(ev) {
    const [y, m, d] = ev.event_date.split('-').map(Number);
    let h = 0, min = 0;
    const match = ev.time_label && ev.time_label.match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
    if (match) { h = Number(match[1]); min = Number(match[2] || 0); }
    return Date.UTC(y, m - 1, d, h, min);
  }

  const cd = document.getElementById('countdown');
  const label = document.getElementById('countdown-label');
  const cells = {};
  cd.querySelectorAll('[data-cd]').forEach((b) => { cells[b.dataset.cd] = b; });

  let timer = null;
  let steps = MILESTONES.map((ms) => ({ label: ms.label, at: targetTime(ms) }));

  function current() { return steps.find((st) => st.at > Date.now()); }

  function tick() {
    const step = current();
    if (!step) {
      cd.outerHTML = '<p class="countdown-done">Le grand jour est arrivé !</p>';
      label?.remove();
      if (timer) clearInterval(timer);
      return;
    }
    const text = 'Avant ' + step.label;
    if (label && label.textContent !== text) {
      label.textContent = text;
      cd.setAttribute('aria-label', 'Compte à rebours avant ' + step.label);
    }
    const s = Math.floor((step.at - Date.now()) / 1000);
    cells.d.textContent = Math.floor(s / 86400);
    cells.h.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    cells.m.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    cells.s.textContent = String(s % 60).padStart(2, '0');
  }
  tick();
  if (current()) timer = setInterval(tick, 1000);

  // Données à jour depuis l'espace administrateur
  const info = await S.getPublicInfo();
  const events = info.events || [];
  steps = MILESTONES.map((ms) => {
    const ev = events.find((e) => e.key === ms.key && e.event_date);
    return { label: ms.label, at: targetTime(ev || ms) };
  });
  if (document.getElementById('countdown')) tick();

  if (events.length) {
    const box = document.getElementById('date-cards');
    box.style.setProperty('--n', events.length);
    box.innerHTML = S.dateGroupsHtml(events);
    S.observeFadeIns();
  }
});
