-- =====================================================================
--  MISE À JOUR DU PROGRAMME — Mariage religieux à Daloa
--  (carton d'invitation : 21, 23 et 24 décembre 2026)
--
--  À exécuter UNE FOIS dans Supabase > SQL Editor > New query > Run,
--  sur la base déjà en service. Aucune réponse d'invité n'est modifiée :
--  la clé « ceremonie » est conservée, les confirmations déjà reçues
--  pour la cérémonie valent pour le mariage religieux du 24 décembre.
--
--  Le prêche et la réception d'Abidjan ne sont pas modifiés (seul leur
--  ordre d'affichage change : ils passent après les journées de Daloa).
-- =====================================================================

begin;

-- 1. Autoriser les deux nouvelles journées
alter table public.events drop constraint if exists events_key_check;
alter table public.events add constraint events_key_check
  check (key in ('chambre', 'danse', 'ceremonie', 'preche', 'reception'));

-- 2. Lundi 21 et mercredi 23 décembre, au domicile de la mariée
insert into public.events (key, sort_order, title, event_date, time_label, venue, address, maps_url, note, rsvp_enabled, visible) values
  ('chambre', 1, 'Mise en chambre de la mariée', '2026-12-21', 'À partir de 14 h', 'Domicile de la mariée, Daloa',
     'Quartier Médico-Scolaire, près de l''Institut d''hygiène et du dispensaire urbain', null, null, true, true),
  ('danse',   2, 'Danse de réjouissance', '2026-12-23', 'À partir de 14 h', 'Domicile de la mariée, Daloa',
     'Quartier Médico-Scolaire, près de l''Institut d''hygiène et du dispensaire urbain', null, null, true, true)
on conflict (key) do update set
  sort_order = excluded.sort_order, title = excluded.title, event_date = excluded.event_date,
  time_label = excluded.time_label, venue = excluded.venue, address = excluded.address,
  note = excluded.note, rsvp_enabled = excluded.rsvp_enabled, visible = excluded.visible, updated_at = now();

-- 3. Jeudi 24 décembre : mariage religieux à 8 h 00, suivi d'une réception
update public.events set
  sort_order   = 3,
  title        = 'Mariage religieux',
  event_date   = '2026-12-24',
  time_label   = '8 h 00',
  venue        = 'Grande cour familiale, Daloa',
  address      = 'Quartier Djoulabougou, non loin de l''établissement Djoulabougou',
  note         = 'Fouroussiri et attachement des colas, suivis d''une réception au domicile de la mariée (quartier Médico-Scolaire).',
  rsvp_enabled = true,
  visible      = true,
  updated_at   = now()
where key = 'ceremonie';

-- 4. Abidjan : après Daloa dans l'ordre d'affichage
update public.events set sort_order = 4 where key = 'preche';
update public.events set sort_order = 5 where key = 'reception';

commit;

-- Vérification : le programme tel que les invités le verront
select sort_order, key, title, event_date, time_label, venue, rsvp_enabled, visible
from public.events order by sort_order;
