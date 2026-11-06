-- Schema del database Supabase per le iscrizioni GOLD.
-- Già applicato al progetto Supabase "gold-iscrizioni" (regione Zurigo).
-- Serve come riferimento o per ricreare il database da zero.

-- Soci autorizzati (un account = una email)
create table public.members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  full_name text not null,
  is_admin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Persone iscrivibili: il socio stesso e i suoi familiari
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  full_name text not null,
  birth_year int check (birth_year between 1900 and 2100),
  created_at timestamptz not null default now()
);
create index on public.participants(member_id);

-- Eventi (allenamenti, gare, trasferte)
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  capacity int check (capacity > 0),
  cutoff_hours int not null default 24 check (cutoff_hours >= 0),
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.events(starts_at);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, participant_id)
);
create index on public.registrations(participant_id);

-- ─── Funzioni di supporto ───
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members
  where email = lower(auth.jwt() ->> 'email') and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.members
    where email = lower(auth.jwt() ->> 'email') and active), false)
$$;

-- Iscrizioni aperte: evento visibile e prima di (inizio - cutoff_hours)
create or replace function public.registration_open(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select published and now() < starts_at - make_interval(hours => cutoff_hours)
    from public.events where id = p_event), false)
$$;

-- Prima di inviare il codice: l'email è nell'elenco soci?
create or replace function public.is_member_email(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.members where email = lower(trim(p_email)) and active)
$$;

-- Numero iscritti per evento (visibile ai soci senza mostrare i nomi)
create or replace function public.event_counts()
returns table(event_id uuid, n bigint)
language sql stable security definer set search_path = '' as $$
  select r.event_id, count(*) from public.registrations r
  where public.current_member_id() is not null
  group by r.event_id
$$;

-- Ogni nuovo socio diventa anche partecipante
create or replace function public.member_self_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.participants(member_id, full_name) values (new.id, new.full_name);
  return new;
end $$;
create trigger trg_member_self after insert on public.members
  for each row execute function public.member_self_participant();

-- Controllo posti disponibili (blocca la riga evento per evitare iscrizioni oltre il limite)
create or replace function public.check_capacity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap int; taken int;
begin
  select capacity into cap from public.events where id = new.event_id for update;
  if cap is not null then
    select count(*) into taken from public.registrations where event_id = new.event_id;
    if taken >= cap then
      raise exception 'Evento al completo' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_capacity before insert on public.registrations
  for each row execute function public.check_capacity();

-- ─── RLS ───
alter table public.members enable row level security;
alter table public.participants enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;

create policy members_select on public.members for select to authenticated
  using (id = public.current_member_id() or public.is_admin());
create policy members_admin on public.members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy part_select on public.participants for select to authenticated
  using (member_id = public.current_member_id() or public.is_admin());
create policy part_insert on public.participants for insert to authenticated
  with check (member_id = public.current_member_id() or public.is_admin());
create policy part_update on public.participants for update to authenticated
  using (member_id = public.current_member_id() or public.is_admin())
  with check (member_id = public.current_member_id() or public.is_admin());
create policy part_delete on public.participants for delete to authenticated
  using (member_id = public.current_member_id() or public.is_admin());

create policy events_select on public.events for select to authenticated
  using ((published and public.current_member_id() is not null) or public.is_admin());
create policy events_admin on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy reg_select on public.registrations for select to authenticated
  using (public.is_admin() or participant_id in
    (select id from public.participants where member_id = public.current_member_id()));
create policy reg_insert on public.registrations for insert to authenticated
  with check (public.is_admin() or (public.registration_open(event_id) and participant_id in
    (select id from public.participants where member_id = public.current_member_id())));
create policy reg_delete on public.registrations for delete to authenticated
  using (public.is_admin() or (public.registration_open(event_id) and participant_id in
    (select id from public.participants where member_id = public.current_member_id())));

-- ─── Permessi sulle funzioni ───
revoke all on function public.is_member_email(text) from public;
grant execute on function public.is_member_email(text) to anon, authenticated;
revoke execute on function public.event_counts() from public, anon;
grant execute on function public.event_counts() to authenticated;
revoke execute on function public.current_member_id() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.registration_open(uuid) from public, anon;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.registration_open(uuid) to authenticated;
revoke execute on function public.member_self_participant() from public, anon, authenticated;
revoke execute on function public.check_capacity() from public, anon, authenticated;

-- Primo amministratore (sostituire con l'email reale):
-- insert into public.members(email, full_name, is_admin) values ('admin@esempio.ch', 'Nome Cognome', true);

-- ═══ Gestione soci e quote sociali ═══
alter table public.members
  add column phone text, add column address text, add column zip text, add column city text,
  add column birth_date date, add column member_since date default current_date,
  add column category text not null default 'Adulto';
alter table public.participants add column si_card text;

-- Note riservate agli amministratori
create table public.member_notes (
  member_id uuid primary key references public.members(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- Impostazioni (es. istruzioni di pagamento mostrate ai soci)
create table public.settings (key text primary key, value text not null default '');
insert into public.settings(key, value) values ('istruzioni_pagamento', '');

-- Tariffe per anno e categoria; quote dei singoli soci
create table public.fee_types (
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2000 and 2100),
  category text not null,
  amount numeric(8,2) not null check (amount >= 0),
  due_date date,
  unique (year, category)
);
create table public.fees (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  description text not null,
  amount numeric(8,2) not null check (amount >= 0),
  due_date date, paid_at date, paid_amount numeric(8,2), method text, note text,
  fee_type_id uuid references public.fee_types(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, fee_type_id)
);
create index on public.fees(year);
create index on public.fees(member_id);

-- Il socio modifica solo i propri recapiti (security invoker: current_user è il ruolo reale)
create or replace function public.protect_member_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if public.is_admin() or current_user in ('postgres','supabase_admin','service_role') then
    return new;
  end if;
  if new.email is distinct from old.email or new.full_name is distinct from old.full_name
     or new.is_admin is distinct from old.is_admin or new.active is distinct from old.active
     or new.category is distinct from old.category or new.member_since is distinct from old.member_since then
    raise exception 'Questi dati li può modificare solo il comitato' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_protect_member before update on public.members
  for each row execute function public.protect_member_fields();
revoke execute on function public.protect_member_fields() from public, anon, authenticated;

create policy members_update_self on public.members for update to authenticated
  using (id = public.current_member_id()) with check (id = public.current_member_id());

-- Genera le quote dell'anno per tutti i soci attivi secondo la loro categoria
create or replace function public.generate_fees(p_year int) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Solo amministratori'; end if;
  insert into public.fees(member_id, year, description, amount, due_date, fee_type_id)
  select m.id, p_year, 'Tassa sociale ' || p_year || ' · ' || t.category, t.amount, t.due_date, t.id
  from public.members m join public.fee_types t on t.year = p_year and t.category = m.category
  where m.active
  on conflict (member_id, fee_type_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.generate_fees(int) from public, anon;
grant execute on function public.generate_fees(int) to authenticated;

alter table public.member_notes enable row level security;
alter table public.settings enable row level security;
alter table public.fee_types enable row level security;
alter table public.fees enable row level security;
create policy notes_admin on public.member_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_read on public.settings for select to authenticated
  using (public.current_member_id() is not null);
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy fee_types_read on public.fee_types for select to authenticated
  using (public.current_member_id() is not null);
create policy fee_types_admin on public.fee_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy fees_read on public.fees for select to authenticated
  using (member_id = public.current_member_id() or public.is_admin());
create policy fees_admin on public.fees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
