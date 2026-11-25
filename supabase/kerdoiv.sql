-- =====================================================================
-- Üres Kézzel – kérdőív, kuponok, látogatómérés (2026. november)
-- Ez már le van futtatva az éles adatbázisban; itt csak dokumentációnak van.
-- A schema.sql után kell futtatni (plusz a coming_soon_lock rész a fájl végén).
-- =====================================================================

-- ---------- Kérdések (az admin Kérdőív fülön szerkeszthetők) ----------
create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  sort int not null default 0,
  kind text not null check (kind in ('text','textarea','single','multi','scale','number','page')),
  label text not null check (char_length(label) between 1 and 300),
  help text not null default '' check (char_length(help) <= 500),
  options text[] not null default '{}' check (cardinality(options) <= 30),
  allow_other boolean not null default false,
  shuffle boolean not null default false,   -- véletlen válaszsorrend (a záró „Semmi/Nem…” a végén marad)
  required boolean not null default true,
  scale_min int not null default 1 check (scale_min between 0 and 1),
  scale_max int not null default 10 check (scale_max between 3 and 10),
  min_label text not null default '' check (char_length(min_label) <= 60),
  max_label text not null default '' check (char_length(max_label) <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.survey_questions enable row level security;
create policy "read active" on public.survey_questions for select using (active or public.is_admin());
create policy "admin write" on public.survey_questions for all using (public.is_admin()) with check (public.is_admin());
create trigger log_change after insert or delete or update on public.survey_questions
  for each row execute function public.log_admin_change();

-- ---------- Válaszok (csak a submit_survey függvényen keresztül írható) ----------
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  answers jsonb not null,            -- [{qid, label, kind, value}] – a kérdés szövege is el van mentve
  consent_at timestamptz not null default now(),
  duration_s int,
  source text,
  created_at timestamptz not null default now()
);
alter table public.survey_responses enable row level security;
create policy "read own or admin" on public.survey_responses for select using (user_id = auth.uid() or public.is_admin());
create policy "admin delete" on public.survey_responses for delete using (public.is_admin());

-- ---------- Kuponok ----------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^UK-[A-Z0-9]{8}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  percent int not null check (percent between 1 and 50),
  source text not null default 'kerdoiv',
  created_at timestamptz not null default now(),
  email_sent_at timestamptz,
  used_at timestamptz,
  booking_id uuid references public.bookings(id) on delete set null,
  unique (user_id, source)
);
alter table public.coupons enable row level security;
create policy "read own or admin" on public.coupons for select using (user_id = auth.uid() or public.is_admin());
create policy "admin update" on public.coupons for update using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.coupons for delete using (public.is_admin());
create trigger log_change after insert or delete or update on public.coupons
  for each row execute function public.log_admin_change();

alter table public.bookings add column if not exists coupon_code text check (coupon_code is null or char_length(coupon_code) <= 20);

create or replace function public.gen_coupon_code() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; b bytea; i int;
begin
  loop
    b := gen_random_bytes(8); c := 'UK-';
    for i in 0..7 loop c := c || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.coupons where code = c);
  end loop;
  return c;
end $$;

-- ---------- Kitöltés: ellenőrzés + válasz mentése + kupon ----------
create or replace function public.submit_survey(p_answers jsonb, p_duration int default null, p_source text default null, p_hp text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q record; a jsonb; v jsonb; other text; val text; n int; item text; arr text[];
  out_ jsonb := '[]'::jsonb; pct int; v_code text;
begin
  if uid is null then raise exception 'not_logged_in'; end if;
  if coalesce(public.setting('survey_open'), 'false') <> 'true' then raise exception 'survey_closed'; end if;
  if not exists (select 1 from auth.users where id = uid and email_confirmed_at is not null) then raise exception 'email_not_confirmed'; end if;
  if coalesce(p_hp, '') <> '' then raise exception 'bot_suspected'; end if;          -- rejtett mező (honeypot)
  if p_duration is not null and p_duration < 15 then raise exception 'too_fast'; end if;
  if exists (select 1 from public.survey_responses where user_id = uid) then raise exception 'already_done'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 40000 then raise exception 'invalid_answers'; end if;

  for q in select * from public.survey_questions where active and kind <> 'page' order by sort, created_at loop
    a := p_answers -> q.id::text;
    v := a -> 'value';
    other := left(btrim(coalesce(a ->> 'other', '')), 300);
    val := null;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if q.kind in ('text', 'textarea') then
        val := nullif(left(btrim(v #>> '{}'), case when q.kind = 'text' then 300 else 3000 end), '');
      elsif q.kind = 'single' then
        val := v #>> '{}';
        if val = '__other__' then
          val := case when q.allow_other and other <> '' then 'Egyéb: ' || other end;
        elsif not (val = any(q.options)) then raise exception 'invalid_option';
        end if;
      elsif q.kind = 'multi' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then raise exception 'invalid_option'; end if;
        arr := '{}';
        for item in select jsonb_array_elements_text(v) loop
          if item = '__other__' then
            if q.allow_other and other <> '' then arr := arr || ('Egyéb: ' || other); end if;
          elsif item = any(q.options) then arr := arr || item;
          else raise exception 'invalid_option';
          end if;
        end loop;
        val := nullif(array_to_string(arr, '; '), '');
      elsif q.kind = 'number' then
        val := regexp_replace(v #>> '{}', '[\s.]', '', 'g');
        if val !~ '^\d{1,8}$' then raise exception 'invalid_number'; end if;
        val := (val::bigint)::text;
      elsif q.kind = 'scale' then
        if jsonb_typeof(v) <> 'number' then raise exception 'invalid_scale'; end if;
        n := round((v #>> '{}')::numeric)::int;
        if n < q.scale_min or n > q.scale_max then raise exception 'invalid_scale'; end if;
        val := n::text;
      end if;
    end if;
    if val is null and q.required then raise exception 'missing_required'; end if;
    out_ := out_ || jsonb_build_array(jsonb_build_object('qid', q.id, 'label', q.label, 'kind', q.kind, 'value', val));
  end loop;
  if jsonb_array_length(out_) = 0 then raise exception 'no_questions'; end if;

  insert into public.survey_responses (user_id, answers, duration_s, source)
  values (uid, out_, p_duration, left(p_source, 80));

  pct := coalesce(nullif(regexp_replace(coalesce(public.setting('survey_discount'), ''), '\D', '', 'g'), '')::int, 10);
  pct := greatest(1, least(50, pct));
  insert into public.coupons (code, user_id, percent) values (public.gen_coupon_code(), uid, pct) returning code into v_code;
  return json_build_object('ok', true, 'percent', pct, 'code', v_code);
end $$;

-- ---------- Kupon e-mail (ugyanaz az Edge Function küldi, mint a foglalási leveleket) ----------
create or replace function public.notify_coupon_email() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://qhcavmetzbmenogbcxfv.supabase.co/functions/v1/booking-confirmation',
    body := jsonb_build_object('kind', 'coupon', 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  return null;
end $$;
create trigger coupon_email after insert on public.coupons for each row execute function public.notify_coupon_email();

-- admin: kuponlevél újraküldése
create or replace function public.resend_coupon_email(c uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.coupons set email_sent_at = null where id = c;
  perform net.http_post(
    url := 'https://qhcavmetzbmenogbcxfv.supabase.co/functions/v1/booking-confirmation',
    body := jsonb_build_object('kind', 'coupon', 'id', c),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
end $$;

-- ---------- Kupon beváltása foglaláskor (az árat a szerver számolja) ----------
create or replace function public.booking_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if coalesce(public.setting('booking_open'), 'false') <> 'true' and not public.is_admin() then
    raise exception 'booking_closed';
  end if;
  if public.is_blocked(new.user_id)
     or not exists (select 1 from public.packages where key = new.package and active) then
    raise exception 'sold_out';
  end if;
  new.deposit := public.deposit_for(new.user_id);
  new.price := public.pkg_price(new.package);
  new.picked_up_at := null; new.returned_at := null; new.return_problem := false; new.problem_note := null;
  if nullif(btrim(coalesce(new.coupon_code, '')), '') is null then
    new.coupon_code := null;
  else
    select * into c from public.coupons
      where code = upper(btrim(new.coupon_code)) and user_id = new.user_id and used_at is null;
    if not found then raise exception 'invalid_coupon'; end if;
    new.coupon_code := c.code;
    new.price := (round(new.price * (100 - c.percent) / 100.0 / 100) * 100)::int;
  end if;
  return new;
end $$;

create or replace function public.booking_coupon_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.coupon_code is not null then
      update public.coupons set used_at = now(), booking_id = new.id
        where code = new.coupon_code and user_id = new.user_id and used_at is null;
      if not found then raise exception 'invalid_coupon'; end if;
    end if;
    return null;
  end if;
  -- lemondás vagy kukába tétel: a kupon újra felhasználható
  if tg_op = 'UPDATE' and new.coupon_code is not null and (
       (new.status = 'lemondott' and old.status <> 'lemondott') or (new.deleted_at is not null and old.deleted_at is null)) then
    update public.coupons set used_at = null, booking_id = null where booking_id = new.id;
  end if;
  if tg_op = 'DELETE' and old.coupon_code is not null then
    update public.coupons set used_at = null, booking_id = null where booking_id = old.id;
  end if;
  return null;
end $$;
create trigger booking_coupon after insert or update or delete on public.bookings
  for each row execute function public.booking_coupon_after();

-- ---------- Látogatómérés: süti és személyes adat nélkül ----------
create table if not exists public.page_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null check (event ~ '^[a-z0-9_]{1,40}$'),
  path text check (char_length(path) <= 80),
  referrer text check (char_length(referrer) <= 100),
  utm_source text check (char_length(utm_source) <= 60),
  utm_medium text check (char_length(utm_medium) <= 60),
  utm_campaign text check (char_length(utm_campaign) <= 60),
  device text check (char_length(device) <= 10),
  browser text check (char_length(browser) <= 20),
  os text check (char_length(os) <= 20),
  lang text check (char_length(lang) <= 10),
  screen_w int check (screen_w between 0 and 10000),
  logged_in boolean,
  entry boolean
);
create index if not exists page_events_at on public.page_events (at);
alter table public.page_events enable row level security;
create policy "admin read" on public.page_events for select using (public.is_admin());

create or replace function public.track(e jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ev text := e ->> 'event';
begin
  if ev is null or ev !~ '^[a-z0-9_]{1,40}$' then return; end if;
  -- egyszerű védelem a teleszemetelés ellen
  if (select count(*) from public.page_events where at > now() - interval '1 minute') > 600 then return; end if;
  insert into public.page_events (event, path, referrer, utm_source, utm_medium, utm_campaign, device, browser, os, lang, screen_w, logged_in, entry)
  values (ev, left(e ->> 'path', 80), left(e ->> 'referrer', 100), left(e ->> 'utm_source', 60), left(e ->> 'utm_medium', 60),
          left(e ->> 'utm_campaign', 60), left(e ->> 'device', 10), left(e ->> 'browser', 20), left(e ->> 'os', 20),
          left(e ->> 'lang', 10), least(10000, greatest(0, coalesce((e ->> 'screen_w')::int, 0))),
          (e ->> 'logged_in')::boolean, (e ->> 'entry')::boolean);
exception when others then return;
end $$;

-- 13 hónapnál régebbi mérési adat törlése (naponta)
select cron.schedule('purge-page-events', '17 3 * * *', $$delete from public.page_events where at < now() - interval '13 months'$$);

-- ---------- Jogosultságok ----------
revoke execute on function public.submit_survey(jsonb, int, text, text) from public, anon;
grant execute on function public.submit_survey(jsonb, int, text, text) to authenticated;
revoke execute on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;
revoke execute on function public.resend_coupon_email(uuid) from public, anon;
grant execute on function public.resend_coupon_email(uuid) to authenticated;
revoke execute on function public.gen_coupon_code() from public, anon, authenticated;
revoke execute on function public.notify_coupon_email() from public, anon, authenticated;
revoke execute on function public.booking_coupon_after() from public, anon, authenticated;
revoke execute on function public.booking_before_insert() from public, anon, authenticated;

-- 2026-11-24: meglévő adatbázisba
alter table public.survey_questions add column if not exists shuffle boolean not null default false;

-- 2026-11-25: oldaltörés ('page': címsor + szöveg, nem kérdés) és számmező ('number', egész Ft)
alter table public.survey_questions drop constraint if exists survey_questions_kind_check;
alter table public.survey_questions add constraint survey_questions_kind_check check (kind in ('text','textarea','single','multi','scale','number','page'));
