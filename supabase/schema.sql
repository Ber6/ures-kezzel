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
