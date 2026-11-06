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
