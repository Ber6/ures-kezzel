create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 100),
  festival text not null,
  package text not null check (package in ('solo','duo','crew')),
  people int not null check (people between 1 and 8),
  status text not null default 'elofoglalas'
    check (status in ('elofoglalas','megerositett','lemondott')),
  created_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.bookings enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create policy "read own or admin" on public.bookings
  for select using (auth.uid() = user_id or public.is_admin());
create policy "insert own" on public.bookings
  for insert with check (auth.uid() = user_id and status = 'elofoglalas');
create policy "admin update" on public.bookings
  for update using (public.is_admin());
create policy "admins see self" on public.admins
  for select using (user_id = auth.uid());

-- lemondás a felhasználónak: csak az állapotot állítja 'lemondott'-ra
create or replace function public.cancel_booking(b uuid) returns void
language sql security definer set search_path = public as $$
  update public.bookings set status = 'lemondott'
  where id = b and user_id = auth.uid();
$$;

-- saját fiók törlése (a foglalások cascade-del törlődnek)
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ===== 2. lépés: az admin oldalon szerkeszthető tartalom (2026-10-08) =====
-- Csomagok, fesztiválok és beállítások: mindenki olvashatja, csak admin módosíthatja.
create table public.packages (
  key text primary key check (key ~ '^[a-z0-9-]{2,20}$'),
  name text not null check (char_length(name) between 1 and 60),
  people int not null check (people between 1 and 8),
  price int not null check (price between 0 and 10000000),
  items text[] not null default '{}',
  featured boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);

create table public.festivals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  location text not null default '',
  dates text not null default '',
  status text not null default 'Tervezett',
  active boolean not null default true,
  sort int not null default 0
);

create table public.settings (
  key text primary key,
  value text not null default ''
);

alter table public.packages enable row level security;
alter table public.festivals enable row level security;
alter table public.settings enable row level security;

create policy "public read" on public.packages for select using (true);
create policy "admin write" on public.packages for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.festivals for select using (true);
create policy "admin write" on public.festivals for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.settings for select using (true);
create policy "admin write" on public.settings for all using (public.is_admin()) with check (public.is_admin());

insert into public.packages (key, name, people, price, items, featured, sort) values
  ('solo', 'Solo Pack', 1, 14900, array['2 fős sátor','Önfelfújó matrac','Kempingszék','LED sátorlámpa','Powerbank'], false, 1),
  ('duo',  'Duo Pack',  2, 24900, array['3 fős sátor','2 önfelfújó matrac','2 kempingszék','LED sátorlámpa','2 powerbank'], true, 2),
  ('crew', 'Crew Pack', 4, 44900, array['4 fős kupolasátor','4 önfelfújó matrac','4 kempingszék','3×3 m-es pavilon','2 LED sátorlámpa','4 powerbank'], false, 3);

insert into public.festivals (name, location, sort) values
  ('Fishing on Orfű', 'Orfű', 1), ('Sziget', 'Budapest, Hajógyári-sziget', 2), ('VOLT', 'Sopron', 3),
  ('Balaton Sound', 'Zamárdi', 4), ('STRAND Fesztivál', 'Zamárdi', 5), ('EFOTT', 'Velence', 6), ('Campus Fesztivál', 'Debrecen', 7);

insert into public.settings (key, value) values
  ('kaucio', '10 000 Ft'), ('leadas_idopont', '[IDŐPONT]'), ('lemondasi_feltetelek', '[LEMONDÁSI FELTÉTELEK]');

-- a foglalás csomagja a packages táblából jön (a régi fix lista helyett)
alter table public.bookings drop constraint if exists bookings_package_check;
alter table public.bookings add constraint bookings_package_fkey
  foreign key (package) references public.packages(key) on update cascade;

-- ===== 3. lépés: helyszíni átvétel, kaució-szintek, megjegyzések, admin napló, hírlevél (2026-10-08) =====
-- A teljes migráció a Supabase-ben "checkin_deposit_log_newsletter" néven fut le.
-- Röviden:
--   bookings: + deposit, picked_up_at, returned_at, return_problem, problem_note
--   settings: kaucio = '10000', kaucio_elso = '20000' (számként)
--   setting_int(), is_blocked(uid) (>= 2 probléma), deposit_for(uid), my_status() → {deposit, blocked}
--   booking_before_insert trigger: letiltott vásárló / inaktív csomag → 'sold_out'; kaució beállítása
--   user_notes tábla (csak admin), set_note_author trigger
--   admin_log tábla (admin olvassa, senki nem írja közvetlenül), log_admin_change trigger
--     a packages, festivals, settings, bookings, admins, user_notes táblákon
--   newsletter_subscribers() (csak admin)
