/* Page Programme : cartes d'événements à jour depuis la base
   (version de secours affichée si la base est injoignable). */
document.addEventListener('DOMContentLoaded', async () => {
  const S = window.Site;
  const box = document.getElementById('events');
  const info = await S.getPublicInfo();
  box.innerHTML = info.events.map(S.eventCard).join('');
  S.observeFadeIns();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'start' });
});
