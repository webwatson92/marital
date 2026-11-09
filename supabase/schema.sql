-- =====================================================================
--  MARIAGE — FAMILLES OUATTARA & KANTÉ
--  Schéma Supabase (PostgreSQL) : tables, sécurité (RLS) et fonctions.
--
--  À exécuter UNE FOIS dans Supabase > SQL Editor > New query > Run.
--  Le script est ré-exécutable : il ne supprime aucune donnée existante.
--
--  Principe de sécurité :
--   • Aucune table n'est lisible ni modifiable directement depuis le site
--     (RLS activée, aucun privilège pour les rôles anon/authenticated).
--   • Les invités passent uniquement par des fonctions contrôlées
--     (submit_rsvp, get_my_rsvp, get_public_info) qui valident tout
--     côté serveur et ne renvoient jamais les réponses des autres.
--   • Les fonctions admin_* vérifient que l'utilisateur connecté figure
--     dans la table public.admins.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Réglages généraux (une seule ligne, id = 1)
create table if not exists public.settings (
  id                  int primary key default 1 check (id = 1),
  planned_invitations int not null default 300 check (planned_invitations between 0 and 100000),
  rsvp_open           boolean not null default true,
  rsvp_deadline       date,              -- null = pas de date limite
  updated_at          timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Événements du programme (modifiables depuis l'espace administrateur)
create table if not exists public.events (
  key          text primary key,             -- clés autorisées : voir events_key_check ci-dessous
  sort_order   int  not null default 0,
  title        text not null check (char_length(title) between 2 and 80),
  event_date   date,                       -- null  => « À confirmer »
  time_label   text check (char_length(time_label) <= 40),   -- ex. « 15h00 » ; null => « À confirmer »
  venue        text check (char_length(venue) <= 160),       -- lieu
  address      text check (char_length(address) <= 300),     -- adresse détaillée
  maps_url     text check (maps_url is null or (maps_url ~ '^https://' and char_length(maps_url) <= 600)),
  note         text check (char_length(note) <= 400),
  rsvp_enabled boolean not null default false,  -- les invités peuvent-ils confirmer pour cet événement ?
  visible      boolean not null default true,   -- l'événement apparaît-il sur le site ?
  updated_at   timestamptz not null default now()
);

-- Clés d'événements autorisées. La contrainte est recréée à chaque exécution :
-- le script reste ré-exécutable sur une base existante, sans toucher aux données.
alter table public.events drop constraint if exists events_key_check;
alter table public.events add constraint events_key_check
  check (key in ('chambre', 'danse', 'ceremonie', 'preche', 'reception'));

-- Données de départ : UNIQUEMENT les informations confirmées par les familles.
-- Daloa : programme du carton d'invitation « Mariage religieux » (21, 23 et 24 décembre 2026).
-- Une base déjà en service se met à jour avec supabase/maj-programme-daloa.sql.
insert into public.events (key, sort_order, title, event_date, time_label, venue, address, maps_url, note, rsvp_enabled, visible) values
  ('chambre',   1, 'Mise en chambre de la mariée', '2026-12-21', 'À partir de 14 h', 'Domicile de la mariée, Daloa',
     'Quartier Médico-Scolaire, près de l''Institut d''hygiène et du dispensaire urbain', null, null, true, true),
  ('danse',     2, 'Danse de réjouissance', '2026-12-23', 'À partir de 14 h', 'Domicile de la mariée, Daloa',
     'Quartier Médico-Scolaire, près de l''Institut d''hygiène et du dispensaire urbain', null, null, true, true),
  ('ceremonie', 3, 'Mariage religieux', '2026-12-24', '8 h 00', 'Grande cour familiale, Daloa',
     'Quartier Djoulabougou, non loin de l''établissement Djoulabougou', null,
     'Fouroussiri et attachement des colas, suivis d''une réception au domicile de la mariée (quartier Médico-Scolaire).', true, true),
  ('preche',    4, 'Prêche', null, null, 'Mosquée du Nouveau Quartier, Yopougon', null, null,
     'La date et l''horaire seront communiqués prochainement.', false, true),
  ('reception', 5, 'Réception', '2027-01-03', null, 'Yopougon Nouveau Quartier, Abidjan',
     'Terrain situé à environ 15 mètres de la mosquée', null, null, true, true)
on conflict (key) do nothing;

-- Invités et réponses
create table if not exists public.guests (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (char_length(full_name) between 2 and 120),
  phone           text not null check (char_length(phone) between 6 and 30),
  phone_key       text not null unique,       -- numéro normalisé (chiffres uniquement), anti-doublon
  category        text not null check (category in ('honneur','parrain','ami','famille_epoux','famille_epouse')),
  status          text not null default 'pending' check (status in ('pending','yes','no')),
  party_size      int  not null default 1 check (party_size between 0 and 30),
  companions      text check (char_length(companions) <= 1000),
  events          text[] not null default '{}',
  source          text not null default 'rsvp' check (source in ('rsvp','admin')),
  edit_token_hash text,                       -- empreinte SHA-256 du lien personnel de modification
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists guests_status_idx   on public.guests (status);
create index if not exists guests_category_idx on public.guests (category);
create unique index if not exists guests_token_idx on public.guests (edit_token_hash) where edit_token_hash is not null;

-- Journal des tentatives (protection contre les soumissions abusives)
create table if not exists public.rsvp_attempts (
  id         bigserial primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists rsvp_attempts_idx on public.rsvp_attempts (ip_hash, created_at);

-- Organisateurs autorisés (liés aux comptes Supabase Auth)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. SÉCURITÉ : RLS activée partout, aucun accès direct aux tables
-- ---------------------------------------------------------------------
alter table public.settings      enable row level security;
alter table public.events        enable row level security;
alter table public.guests        enable row level security;
alter table public.rsvp_attempts enable row level security;
alter table public.admins        enable row level security;

revoke all on public.settings, public.events, public.guests, public.rsvp_attempts, public.admins
  from anon, authenticated;
revoke all on sequence public.rsvp_attempts_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. FONCTIONS UTILITAIRES (internes)
-- ---------------------------------------------------------------------

-- Normalise un numéro : chiffres uniquement, préfixe 00 retiré,
-- numéros ivoiriens à 10 chiffres préfixés par 225.
create or replace function public._phone_key(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^00' then substr(d, 3)
    when char_length(d) = 10 and d ~ '^0' then '225' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

create or replace function public._sha256(p text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

-- Valide et nettoie les données d'un invité. Renvoie un jsonb propre ou lève
-- une erreur « VALIDATION:<champ> ». p_admin = true autorise le statut « pending ».
create or replace function public._clean_guest(p jsonb, p_admin boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_name      text := btrim(regexp_replace(coalesce(p->>'full_name', ''), '\s+', ' ', 'g'));
  v_phone     text := btrim(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+ ().-]', '', 'g'));
  v_key       text := public._phone_key(p->>'phone');
  v_category  text := coalesce(p->>'category', '');
  v_status    text := coalesce(p->>'status', '');
  v_party     int;
  v_comp      text := nullif(btrim(coalesce(p->>'companions', '')), '');
  v_events    text[];
  v_allowed   text[];
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'VALIDATION:full_name';
  end if;
  if char_length(v_key) < 8 or char_length(v_key) > 15 then
    raise exception 'VALIDATION:phone';
  end if;
  if v_category not in ('honneur','parrain','ami','famille_epoux','famille_epouse') then
    raise exception 'VALIDATION:category';
  end if;
  if v_status not in ('yes','no') and not (p_admin and v_status = 'pending') then
    raise exception 'VALIDATION:status';
  end if;

  if v_status = 'yes' then
    begin
      v_party := (p->>'party_size')::int;
    exception when others then
      raise exception 'VALIDATION:party_size';
    end;
    if v_party is null or v_party < 1 or v_party > 20 then
      raise exception 'VALIDATION:party_size';
    end if;
    if v_comp is not null and char_length(v_comp) > 1000 then
      raise exception 'VALIDATION:companions';
    end if;

    -- Événements choisis : uniquement parmi ceux autorisés
    select coalesce(array_agg(distinct e), '{}') into v_events
      from jsonb_array_elements_text(coalesce(p->'events', '[]'::jsonb)) e;
    if p_admin then
      select array_agg(key) into v_allowed from public.events;
    else
      select array_agg(key) into v_allowed from public.events where rsvp_enabled and visible;
    end if;
    v_allowed := coalesce(v_allowed, '{}');
    if not (v_events <@ v_allowed) then
      raise exception 'VALIDATION:events';
    end if;
    if not p_admin and cardinality(v_allowed) > 0 and cardinality(v_events) = 0 then
      raise exception 'VALIDATION:events';
    end if;
  else
    v_party  := case when v_status = 'pending' then greatest(1, coalesce((p->>'party_size')::int, 1)) else 0 end;
    v_comp   := null;
    v_events := '{}';
  end if;

  return jsonb_build_object(
    'full_name', v_name, 'phone', v_phone, 'phone_key', v_key,
    'category', v_category, 'status', v_status, 'party_size', v_party,
    'companions', v_comp, 'events', to_jsonb(v_events)
  );
end $$;

create or replace function public._guest_json(g public.guests)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', g.id, 'full_name', g.full_name, 'phone', g.phone, 'category', g.category,
    'status', g.status, 'party_size', g.party_size, 'companions', g.companions,
    'events', to_jsonb(g.events), 'source', g.source, 'responded_at', g.responded_at,
    'created_at', g.created_at, 'updated_at', g.updated_at
  );
$$;

-- ---------------------------------------------------------------------
-- 4. FONCTIONS PUBLIQUES (invités)
-- ---------------------------------------------------------------------

-- Informations publiques : programme visible + état des inscriptions.
create or replace function public.get_public_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or current_date <= s.rsvp_deadline),
    'rsvp_deadline', s.rsvp_deadline,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', e.key, 'title', e.title, 'event_date', e.event_date, 'time_label', e.time_label,
        'venue', e.venue, 'address', e.address, 'maps_url', e.maps_url, 'note', e.note,
        'rsvp_enabled', e.rsvp_enabled
      ) order by e.sort_order)
      from public.events e where e.visible
    ), '[]'::jsonb)
  )
  from public.settings s where s.id = 1;
$$;

-- Enregistre ou modifie une réponse.
--  p = { full_name, phone, category, status: 'yes'|'no', party_size, companions,
--        events: [...], token?: lien personnel (modification), website?: piège à robots }
create or replace function public.submit_rsvp(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_set     public.settings;
  v_clean   jsonb;
  v_ip      text;
  v_ip_hash text;
  v_count   int;
  v_token   text;
  v_row     public.guests;
  v_existing public.guests;
begin
  -- Piège à robots : champ invisible pour les humains
  if coalesce(p->>'website', '') <> '' then
    raise exception 'SPAM';
  end if;

  -- Limite de fréquence par adresse IP : au plus 40 réponses enregistrées par
  -- tranche de 10 minutes (généreux, car beaucoup d'invités partagent la même IP
  -- via les opérateurs mobiles). Un envoi rejeté est annulé et ne laisse aucune trace.
  v_ip := split_part(coalesce(
            nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
            nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for',
            'unknown'), ',', 1);
  v_ip_hash := public._sha256('ip:' || btrim(v_ip));
  delete from public.rsvp_attempts where created_at < now() - interval '1 day';
  select count(*) into v_count from public.rsvp_attempts
   where ip_hash = v_ip_hash and created_at > now() - interval '10 minutes';
  if v_count >= 40 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.rsvp_attempts (ip_hash) values (v_ip_hash);

  -- Inscriptions ouvertes ?
  select * into v_set from public.settings where id = 1;
  if not v_set.rsvp_open or (v_set.rsvp_deadline is not null and current_date > v_set.rsvp_deadline) then
    raise exception 'RSVP_CLOSED';
  end if;

  v_clean := public._clean_guest(p, false);

  -- Cas 1 : modification via le lien personnel
  if nullif(p->>'token', '') is not null then
    select * into v_existing from public.guests where edit_token_hash = public._sha256(p->>'token');
    if not found then
      raise exception 'TOKEN_INVALID';
    end if;
    if exists (select 1 from public.guests where phone_key = v_clean->>'phone_key' and id <> v_existing.id) then
      raise exception 'PHONE_TAKEN';
    end if;
    update public.guests set
      full_name = v_clean->>'full_name', phone = v_clean->>'phone', phone_key = v_clean->>'phone_key',
      category = v_clean->>'category', status = v_clean->>'status',
      party_size = (v_clean->>'party_size')::int, companions = v_clean->>'companions',
      events = array(select jsonb_array_elements_text(v_clean->'events')),
      responded_at = now(), updated_at = now()
    where id = v_existing.id
    returning * into v_row;
    v_token := p->>'token';

  else
    -- Cas 2 : nouvelle réponse
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    select * into v_existing from public.guests where phone_key = v_clean->>'phone_key';

    if found and v_existing.status <> 'pending' then
      -- Une réponse existe déjà pour ce numéro (double envoi ou personne différente)
      raise exception 'ALREADY_RESPONDED';
    elsif found then
      -- Invité pré-enregistré par les organisateurs : il répond maintenant
      update public.guests set
        full_name = v_clean->>'full_name', phone = v_clean->>'phone',
        category = v_clean->>'category', status = v_clean->>'status',
        party_size = (v_clean->>'party_size')::int, companions = v_clean->>'companions',
        events = array(select jsonb_array_elements_text(v_clean->'events')),
        edit_token_hash = public._sha256(v_token), responded_at = now(), updated_at = now()
      where id = v_existing.id
      returning * into v_row;
    else
      insert into public.guests (full_name, phone, phone_key, category, status, party_size,
                                 companions, events, source, edit_token_hash, responded_at)
      values (v_clean->>'full_name', v_clean->>'phone', v_clean->>'phone_key', v_clean->>'category',
              v_clean->>'status', (v_clean->>'party_size')::int, v_clean->>'companions',
              array(select jsonb_array_elements_text(v_clean->'events')),
              'rsvp', public._sha256(v_token), now())
      returning * into v_row;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'token', v_token, 'full_name', v_row.full_name, 'status', v_row.status,
    'party_size', v_row.party_size, 'events', to_jsonb(v_row.events), 'responded_at', v_row.responded_at
  );
end $$;

-- Lecture de SA propre réponse grâce au lien personnel (jeton secret).
create or replace function public.get_my_rsvp(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_row public.guests;
begin
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'TOKEN_INVALID';
  end if;
  select * into v_row from public.guests where edit_token_hash = public._sha256(p_token);
  if not found then
    raise exception 'TOKEN_INVALID';
  end if;
  return jsonb_build_object(
    'full_name', v_row.full_name, 'phone', v_row.phone, 'category', v_row.category,
    'status', v_row.status, 'party_size', v_row.party_size, 'companions', v_row.companions,
    'events', to_jsonb(v_row.events), 'responded_at', v_row.responded_at
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. FONCTIONS ADMINISTRATEUR (organisateurs connectés uniquement)
-- ---------------------------------------------------------------------

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.settings s where id = 1),
    'events',   coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order) from public.events e), '[]'::jsonb),
    'guests',   coalesce((select jsonb_agg(public._guest_json(g) order by g.created_at desc) from public.guests g), '[]'::jsonb),
    'server_time', now()
  );
end $$;

-- Ajout (sans id) ou modification (avec id) d'un invité par un organisateur.
create or replace function public.admin_save_guest(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_clean jsonb;
  v_row   public.guests;
  v_id    uuid := nullif(p->>'id', '')::uuid;
begin
  perform public._require_admin();
  v_clean := public._clean_guest(p, true);

  if exists (select 1 from public.guests where phone_key = v_clean->>'phone_key'
             and (v_id is null or id <> v_id)) then
    raise exception 'PHONE_TAKEN';
  end if;

  if v_id is null then
    insert into public.guests (full_name, phone, phone_key, category, status, party_size,
                               companions, events, source, responded_at)
    values (v_clean->>'full_name', v_clean->>'phone', v_clean->>'phone_key', v_clean->>'category',
            v_clean->>'status', (v_clean->>'party_size')::int, v_clean->>'companions',
            array(select jsonb_array_elements_text(v_clean->'events')), 'admin',
            case when v_clean->>'status' = 'pending' then null else now() end)
    returning * into v_row;
  else
    update public.guests g set
      full_name = v_clean->>'full_name', phone = v_clean->>'phone', phone_key = v_clean->>'phone_key',
      category = v_clean->>'category', status = v_clean->>'status',
      party_size = (v_clean->>'party_size')::int, companions = v_clean->>'companions',
      events = array(select jsonb_array_elements_text(v_clean->'events')),
      responded_at = case
        when v_clean->>'status' = 'pending' then null
        when g.status <> v_clean->>'status' or g.responded_at is null then now()
        else g.responded_at end,
      updated_at = now()
    where g.id = v_id
    returning * into v_row;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
  end if;
  return public._guest_json(v_row);
end $$;

create or replace function public.admin_delete_guest(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  perform public._require_admin();
  delete from public.guests where id = p_id;
  return found;
end $$;

create or replace function public.admin_update_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_row public.settings;
begin
  perform public._require_admin();
  update public.settings set
    planned_invitations = coalesce((p->>'planned_invitations')::int, planned_invitations),
    rsvp_open           = coalesce((p->>'rsvp_open')::boolean, rsvp_open),
    rsvp_deadline       = case when p ? 'rsvp_deadline' then nullif(p->>'rsvp_deadline', '')::date else rsvp_deadline end,
    updated_at          = now()
  where id = 1
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.admin_update_event(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_row public.events;
begin
  perform public._require_admin();
  update public.events set
    title        = coalesce(nullif(btrim(p->>'title'), ''), title),
    event_date   = nullif(p->>'event_date', '')::date,
    time_label   = nullif(btrim(coalesce(p->>'time_label', '')), ''),
    venue        = nullif(btrim(coalesce(p->>'venue', '')), ''),
    address      = nullif(btrim(coalesce(p->>'address', '')), ''),
    maps_url     = nullif(btrim(coalesce(p->>'maps_url', '')), ''),
    note         = nullif(btrim(coalesce(p->>'note', '')), ''),
    rsvp_enabled = coalesce((p->>'rsvp_enabled')::boolean, rsvp_enabled),
    visible      = coalesce((p->>'visible')::boolean, visible),
    updated_at   = now()
  where key = p->>'key'
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 6. DROITS D'EXÉCUTION
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_public_info()   to anon, authenticated;
grant execute on function public.submit_rsvp(jsonb)  to anon, authenticated;
grant execute on function public.get_my_rsvp(text)   to anon, authenticated;

grant execute on function public.is_admin()                  to authenticated;
grant execute on function public.admin_overview()            to authenticated;
grant execute on function public.admin_save_guest(jsonb)     to authenticated;
grant execute on function public.admin_delete_guest(uuid)    to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.admin_update_event(jsonb)   to authenticated;

-- Fin du script.
