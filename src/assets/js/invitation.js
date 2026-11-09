/* =====================================================================
   Invitation personnelle (image PNG) dessinée dans le navigateur de l'invité.
   Rien n'est envoyé à un service externe. Ne contient que le nom, le nombre
   de personnes et le programme : ni téléphone, ni lien personnel.
   Une information absente du programme s'affiche « À confirmer ».
   ===================================================================== */
(function () {
  'use strict';
  const WIDTH = 1080;
  const MARGIN = 90;
  const CONTENT = WIDTH - MARGIN * 2;
  const CENTER = WIDTH / 2;

  const DEEP = '#0A1230';
  const YELLOW = '#F9E000';
  const WHITE = '#FFFFFF';
  const TEXT_SOFT = 'rgba(255, 255, 255, .78)';
  const TEXT_FAINT = 'rgba(255, 255, 255, .6)';
  const LINE = 'rgba(249, 224, 0, .45)';

  const SERIF = "Cormorant, 'Cormorant Garamond', Georgia, 'Times New Roman', serif";
  const SANS = "Montserrat, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const serif = (size, weight = 500, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${SERIF}`;
  const sans = (size, weight = 500) => `${weight} ${size}px ${SANS}`;

  // Attend les polices du site, sans jamais bloquer l'invitation si le réseau est lent.
  function loadFonts() {
    const wanted = [serif(60), serif(60, 600), serif(60, 500, true), sans(30, 400), sans(30, 500), sans(30, 600)];
    const all = Promise.all(wanted.map((f) => document.fonts.load(f, 'ÉAa&'))).catch(() => {});
    return Promise.race([all, new Promise((resolve) => setTimeout(resolve, 4000))]);
  }

  function wrap(ctx, text, max) {
    const lines = [];
    let line = '';
    for (let word of String(text || '').replace(/\s+/g, ' ').trim().split(' ')) {
      while (word.length > 1 && ctx.measureText(word).width > max) { // mot plus long que la ligne
        if (line) { lines.push(line); line = ''; }
        let n = word.length - 1;
        while (n > 1 && ctx.measureText(word.slice(0, n)).width > max) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= max) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Texte espacé, dessiné lettre par lettre : letterSpacing n'existe pas partout sur canvas.
  function spacedWidth(ctx, text, spacing) {
    return [...text].reduce((w, c) => w + ctx.measureText(c).width + spacing, -spacing);
  }
  function drawSpaced(ctx, text, x, y, spacing) {
    let cursor = x;
    ctx.textAlign = 'left';
    for (const c of text) {
      ctx.fillText(c, cursor, y);
      cursor += ctx.measureText(c).width + spacing;
    }
  }

  function drawBackground(ctx, height) {
    ctx.fillStyle = DEEP;
    ctx.fillRect(0, 0, WIDTH, height);

    const halo = ctx.createRadialGradient(CENTER, 520, 40, CENTER, 520, 760);
    halo.addColorStop(0, 'rgba(34, 52, 110, .85)');
    halo.addColorStop(1, 'rgba(34, 52, 110, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, WIDTH, Math.min(height, 1300));

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(34, 34, WIDTH - 68, height - 68);
    ctx.strokeStyle = 'rgba(255, 255, 255, .14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(47.5, 47.5, WIDTH - 95, height - 95);
  }

  // Monogramme O&K, identique à celui de la page d'accueil.
  function drawCrest(ctx, y) {
    const radius = 58;
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER, y + radius, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CENTER, y + radius, radius - 7, 0, Math.PI * 2);
    ctx.stroke();

    const parts = [['O', serif(40, 600), WHITE], ['&', serif(40, 500, true), YELLOW], ['K', serif(40, 600), WHITE]];
    const gap = 3;
    const width = parts.reduce((w, [text, font]) => { ctx.font = font; return w + ctx.measureText(text).width + gap; }, -gap);
    let cursor = CENTER - width / 2;
    ctx.textAlign = 'left';
    for (const [text, font, color] of parts) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(text, cursor, y + radius + 13);
      cursor += ctx.measureText(text).width + gap;
    }
  }

  function drawRule(ctx, y, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y + 0.5);
    ctx.lineTo(WIDTH - MARGIN, y + 0.5);
    ctx.stroke();
  }

  function drawOrnament(ctx, y) {
    ctx.fillStyle = YELLOW;
    ctx.beginPath();
    ctx.moveTo(CENTER, y - 11);
    ctx.lineTo(CENTER + 11, y);
    ctx.lineTo(CENTER, y + 11);
    ctx.lineTo(CENTER - 11, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CENTER - 130, y);
    ctx.lineTo(CENTER - 28, y);
    ctx.moveTo(CENTER + 28, y);
    ctx.lineTo(CENTER + 130, y);
    ctx.stroke();
  }

  // Bloc d'un événement. Renvoie sa hauteur ; ne dessine que si paint est vrai.
  function eventBlock(ctx, event, numeral, top, paint) {
    const PADDING = 34;
    const LABEL_WIDTH = 170;
    const left = MARGIN;
    const valueLeft = left + LABEL_WIDTH;
    const valueWidth = CONTENT - LABEL_WIDTH;
    let y = top + PADDING;

    ctx.textAlign = 'left';
    ctx.font = serif(32, 500, true);
    ctx.fillStyle = YELLOW;
    if (paint) ctx.fillText(numeral, left, y + 26);
    y += 40;

    ctx.fillStyle = WHITE;
    ctx.font = serif(58, 500);
    for (const line of wrap(ctx, event.title, CONTENT)) {
      if (paint) ctx.fillText(line, left, y + 46);
      y += 62;
    }
    y += 14;

    for (const [label, value] of [['DATE', event.date], ['HEURE', event.time], ['LIEU', event.venue], ['ADRESSE', event.address]]) {
      if (paint) {
        ctx.font = sans(23, 500);
        ctx.fillStyle = TEXT_FAINT;
        drawSpaced(ctx, label, left, y + 31, 3);
      }
      if (value) {
        ctx.font = sans(31, 500);
        ctx.fillStyle = WHITE;
        for (const line of wrap(ctx, value, valueWidth)) {
          if (paint) ctx.fillText(line, valueLeft, y + 32);
          y += 44;
        }
      } else {
        ctx.font = sans(25, 600);
        ctx.fillStyle = YELLOW;
        if (paint) drawSpaced(ctx, 'À CONFIRMER', valueLeft, y + 31, 3);
        y += 44;
      }
      y += 8;
    }

    if (event.note) {
      y += 6;
      ctx.font = serif(33, 500, true);
      ctx.fillStyle = TEXT_SOFT;
      for (const line of wrap(ctx, event.note, CONTENT)) {
        if (paint) ctx.fillText(line, left, y + 30);
        y += 40;
      }
    }
    return y + PADDING - 8 - top;
  }

  // Compose la page entière. Renvoie la hauteur nécessaire ; ne dessine que si paint est vrai.
  function compose(ctx, data, paint) {
    let y = 96;

    const centered = (text, font, color, lineHeight, after = 0, max = CONTENT) => {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      for (const line of wrap(ctx, text, max)) {
        if (paint) ctx.fillText(line, CENTER, y + lineHeight * 0.78);
        y += lineHeight;
      }
      y += after;
    };
    const spacedLine = (text, font, color, spacing, lineHeight, after = 0) => {
      ctx.font = font;
      ctx.fillStyle = color;
      if (paint) drawSpaced(ctx, text, CENTER - spacedWidth(ctx, text, spacing) / 2, y + lineHeight * 0.78, spacing);
      y += lineHeight + after;
    };

    if (paint) drawCrest(ctx, y);
    y += 116 + 30;
    spacedLine('INVITATION', sans(28), YELLOW, 10, 40, 18);
    spacedLine('FAMILLES', sans(26), TEXT_SOFT, 13, 36, 8);
    spacedLine('OUATTARA', serif(122), WHITE, 6, 122);
    // Esperluette encadrée de deux filets, comme sur la page d'accueil.
    if (paint) {
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(CENTER - 210, y + 50.5);
      ctx.lineTo(CENTER - 66, y + 50.5);
      ctx.moveTo(CENTER + 66, y + 50.5);
      ctx.lineTo(CENTER + 210, y + 50.5);
      ctx.stroke();
    }
    spacedLine('&', serif(88, 500, true), YELLOW, 0, 96);
    spacedLine('KANTÉ', serif(122), WHITE, 6, 122, 20);
    centered('« Deux familles, une union, une célébration. »', serif(42, 500, true), WHITE, 52, 20);
    centered('Avec une immense joie, les familles OUATTARA et KANTÉ vous convient à célébrer l’union de leurs enfants.', sans(28, 400), TEXT_SOFT, 42, 36, 830);

    if (paint) drawOrnament(ctx, y + 8);
    y += 52;

    spacedLine('INVITATION AU NOM DE', sans(25), YELLOW, 7, 36, 12);
    // Le nom est réduit au besoin : au-delà de deux lignes, il passe à la taille minimale.
    let nameSize = 84;
    ctx.font = serif(nameSize, 600);
    while (nameSize > 56 && wrap(ctx, data.name, CONTENT).length > 2) {
      nameSize -= 4;
      ctx.font = serif(nameSize, 600);
    }
    centered(data.name, serif(nameSize, 600), WHITE, nameSize * 1.12, 12);
    const people = data.partySize > 1 ? `POUR ${data.partySize} PERSONNES` : 'POUR 1 PERSONNE';
    spacedLine(people, sans(27, 600), YELLOW, 5, 38, 44);

    // Événements rangés par ville : « À DALOA », puis « À ABIDJAN ».
    let n = 0;
    data.groups.forEach((group, gi) => {
      if (group.label) {
        if (gi > 0) y += 34;
        spacedLine(group.label.toUpperCase(), serif(54, 600), YELLOW, 6, 62, 4);
        if (group.sub) centered(group.sub, sans(26, 500), TEXT_SOFT, 36, 0);
        y += 22;
      }
      for (const event of group.events) {
        const numeral = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n++] || '';
        if (paint) {
          drawRule(ctx, y, LINE);
          eventBlock(ctx, event, numeral, y, true);
        }
        y += eventBlock(ctx, event, numeral, y, false);
      }
    });
    if (n) {
      if (paint) drawRule(ctx, y, LINE);
      y += 42;
    }

    centered('Programme à jour sur', sans(25, 400), TEXT_FAINT, 36, 4);
    centered(data.site, sans(27, 600), YELLOW, 40, 0);
    return y + 104;
  }

  function slug(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /**
   * guest : { full_name, party_size, events: [clés] } — programme : événements de la base.
   * Renvoie { blob, filename }.
   */
  async function create(guest, programme) {
    const S = window.Site;
    const chosen = (programme || []).filter((e) => (guest.events || []).includes(e.key));
    const data = {
      name: guest.full_name,
      partySize: Number(guest.party_size) || 1,
      groups: S.groupByCity(chosen).map((g) => ({
        label: g.label,
        sub: g.sub,
        events: g.items.map(({ e }) => ({
          title: e.title,
          date: S.formatDate(e.event_date),
          time: e.time_label,
          venue: e.venue,
          address: e.address,
          note: e.note,
        })),
      })),
      site: new URL(S.siteUrl()).host,
    };

    await loadFonts();
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = 10;
    const height = compose(canvas.getContext('2d'), data, false);
    canvas.height = height; // réinitialise le canvas : on peut maintenant dessiner à la bonne taille
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, height);
    compose(ctx, data, true);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Image non générée');
    const name = slug(guest.full_name);
    return { blob, filename: `invitation-ouattara-kante${name ? '-' + name : ''}.png` };
  }

  window.Invitation = { create };
})();
