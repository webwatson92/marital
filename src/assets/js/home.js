/* Page d'accueil : dates depuis la base + compte à rebours vers la réception. */
document.addEventListener('DOMContentLoaded', async () => {
  const S = window.Site;
  const RECEPTION_FALLBACK = '2027-01-03';

  // Heure cible : date de la réception (heure d'Abidjan = UTC+0).
  // Si l'horaire n'est pas encore confirmé, on vise minuit le jour J.
  function targetTime(ev) {
    const iso = (ev && ev.event_date) || RECEPTION_FALLBACK;
    const [y, m, d] = iso.split('-').map(Number);
    let h = 0, min = 0;
    const match = ev && ev.time_label && ev.time_label.match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
    if (match) { h = Number(match[1]); min = Number(match[2] || 0); }
    return Date.UTC(y, m - 1, d, h, min);
  }

  let target = targetTime(null);
  const cd = document.getElementById('countdown');
  const cells = {};
  cd.querySelectorAll('[data-cd]').forEach((b) => { cells[b.dataset.cd] = b; });

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      cd.outerHTML = '<p class="countdown-done">Le grand jour est arrivé !</p>';
      document.querySelector('.countdown-label')?.remove();
      return false;
    }
    const s = Math.floor(diff / 1000);
    cells.d.textContent = Math.floor(s / 86400);
    cells.h.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    cells.m.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    cells.s.textContent = String(s % 60).padStart(2, '0');
    return true;
  }
  if (tick()) { const t = setInterval(() => { if (!tick()) clearInterval(t); }, 1000); }

  // Données à jour depuis l'espace administrateur
  const info = await S.getPublicInfo();
  const events = info.events || [];
  const reception = events.find((e) => e.key === 'reception');
  if (reception && reception.event_date) target = targetTime(reception);

  if (events.length) {
    document.getElementById('date-cards').innerHTML = events.map(S.dateCard).join('');
    S.observeFadeIns();
  }
});
