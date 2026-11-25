-- =====================================================================
-- Üres Kézzel – kérdőív regisztráció nélkül, kupon e-mail-címre (2026-11-25)
-- A kerdoiv.sql után. Le van futtatva az éles adatbázisban; itt dokumentációnak van.
--
-- - A kérdőív belépés nélkül is kitölthető: a végén csak egy e-mail-címet kérünk,
--   arra megy a kupon. Belépett felhasználónál a fiók e-mail-címe számít.
-- - E-mail-címenként (és fiókonként) egy kitöltés, egy kupon.
-- - A kupon egyszer használható. Beváltani az a fiók tudja, amelyiknek az e-mail-címe
--   megegyezik a kupon e-mail-címével (a foglaláshoz megerősített e-mail kell, így
--   a beváltásnál derül ki, hogy a cím tényleg a kitöltőé).
-- =====================================================================

-- ---------- Oszlopok ----------
alter table public.coupons alter column user_id drop not null;
alter table public.coupons add column if not exists email text
  check (email is null or (char_length(email) <= 254 and email = lower(email)));
alter table public.coupons drop constraint if exists coupons_owner_check;
alter table public.coupons add constraint coupons_owner_check check (user_id is not null or email is not null);
create unique index if not exists coupons_email_source on public.coupons (email, source) where email is not null;

alter table public.survey_responses alter column user_id drop not null;
alter table public.survey_responses add column if not exists coupon_id uuid references public.coupons(id) on delete set null;

-- a saját (e-mail-címhez kötött) kupon és válasz is látszik a fiókban
drop policy if exists "read own by email" on public.coupons;
create policy "read own by email" on public.coupons for select
  using (user_id is null and email is not null and email = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "read own by email" on public.survey_responses;
create policy "read own by email" on public.survey_responses for select
  using (user_id is null and coupon_id in (select id from public.coupons
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))));

-- ---------- Válaszok ellenőrzése (ugyanaz, mint a submit_survey-ben) ----------
create or replace function public.survey_check(p_answers jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q record; a jsonb; v jsonb; other text; val text; n int; item text; arr text[]; out_ jsonb := '[]'::jsonb;
begin
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
  return out_;
end $$;

-- ---------- Kitöltés belépéssel vagy anélkül ----------
create or replace function public.submit_survey_public(p_email text, p_answers jsonb, p_consent boolean default false,
  p_duration int default null, p_source text default null, p_hp text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); e text; out_ jsonb; pct int; v_code text; v_cid uuid;
begin
  if coalesce(public.setting('survey_open'), 'false') <> 'true' then raise exception 'survey_closed'; end if;
  if coalesce(p_hp, '') <> '' then raise exception 'bot_suspected'; end if;          -- rejtett mező (honeypot)
  if p_duration is not null and p_duration < 15 then raise exception 'too_fast'; end if;
  if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
  -- egyszerű védelem a tömeges beküldés ellen
  if (select count(*) from public.coupons where source = 'kerdoiv' and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;

  if uid is not null then
    select lower(email) into e from auth.users where id = uid;
  else
    e := lower(btrim(coalesce(p_email, '')));
  end if;
  if e is null or char_length(e) > 254 or e !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'invalid_email'; end if;

  -- e-mail-címenként és fiókonként egy kitöltés
  if exists (select 1 from public.coupons c
             where c.source = 'kerdoiv' and (c.email = e or (uid is not null and c.user_id = uid)
               or c.user_id in (select id from auth.users where lower(email) = e))) then
    raise exception 'already_done';
  end if;
  if uid is not null and exists (select 1 from public.survey_responses where user_id = uid) then raise exception 'already_done'; end if;

  out_ := public.survey_check(p_answers);

  pct := coalesce(nullif(regexp_replace(coalesce(public.setting('survey_discount'), ''), '\D', '', 'g'), '')::int, 10);
  pct := greatest(1, least(50, pct));
  insert into public.coupons (code, user_id, email, percent) values (public.gen_coupon_code(), uid, e, pct)
    returning id, code into v_cid, v_code;
  insert into public.survey_responses (user_id, answers, duration_s, source, coupon_id)
    values (uid, out_, p_duration, left(p_source, 80), v_cid);
  -- belépés nélkül a kód csak e-mailben megy ki (különben kitalált címekkel végtelen kódot lehetne kérni)
  return json_build_object('ok', true, 'percent', pct, 'email', e, 'code', case when uid is not null then v_code end);
exception when unique_violation then
  raise exception 'already_done';
end $$;

revoke execute on function public.survey_check(jsonb) from public, anon, authenticated;
revoke execute on function public.submit_survey_public(text, jsonb, boolean, int, text, text) from public;
grant execute on function public.submit_survey_public(text, jsonb, boolean, int, text, text) to anon, authenticated;

-- ---------- Beváltás: saját fiókos kupon, vagy a fiók e-mail-címére kapott kupon ----------
create or replace function public.booking_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; ue text;
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
    select lower(email) into ue from auth.users where id = new.user_id;
    select * into c from public.coupons
      where code = upper(btrim(new.coupon_code)) and used_at is null
        and (user_id = new.user_id or (user_id is null and email = ue));
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
      -- a jogosultságot a booking_before_insert már ellenőrizte; itt az egyszeri felhasználást zárjuk le
      update public.coupons set used_at = now(), booking_id = new.id
        where code = new.coupon_code and used_at is null;
      if not found then raise exception 'invalid_coupon'; end if;
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.coupon_code is not null and (
       (new.status = 'lemondott' and old.status <> 'lemondott') or (new.deleted_at is not null and old.deleted_at is null)) then
    update public.coupons set used_at = null, booking_id = null where booking_id = new.id;
  end if;
  if tg_op = 'DELETE' and old.coupon_code is not null then
    update public.coupons set used_at = null, booking_id = null where booking_id = old.id;
  end if;
  return null;
end $$;

-- ---------- Fióktörlés: az e-mail-címhez kötött kupon és válasz is törlődik ----------
drop function if exists public.delete_my_account();
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare e text;
begin
  select lower(email) into e from auth.users where id = auth.uid();
  if e is not null then
    delete from public.survey_responses where coupon_id in (select id from public.coupons where user_id is null and email = e);
    delete from public.coupons where user_id is null and email = e;
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Admin és Sheet: e-mail a kuponból, ha nincs fiók ----------
create or replace function public.admin_coupons()
returns table(id uuid, code text, full_name text, email text, percent int, created_at timestamptz, email_sent_at timestamptz, used_at timestamptz, booking_id uuid)
language sql stable security definer set search_path = public, auth as $$
  select c.id, c.code, coalesce(u.raw_user_meta_data->>'full_name', ''), coalesce(u.email::text, c.email), c.percent, c.created_at, c.email_sent_at, c.used_at, c.booking_id
  from public.coupons c left join auth.users u on u.id = c.user_id
  where public.is_admin()
  order by c.created_at desc;
$$;

create or replace function public.sheet_kuponok()
returns table(kod text, nev text, email text, kedvezmeny int, letrehozva text, email_elkuldve text, bevaltva text)
language sql stable security definer set search_path = public, auth as $$
  select c.code, coalesce(u.raw_user_meta_data->>'full_name', ''), coalesce(u.email::text, c.email), c.percent,
    to_char(c.created_at at time zone 'Europe/Budapest', 'YYYY-MM-DD HH24:MI'),
    coalesce(to_char(c.email_sent_at at time zone 'Europe/Budapest', 'YYYY-MM-DD HH24:MI'), 'még nem'),
    coalesce(to_char(c.used_at at time zone 'Europe/Budapest', 'YYYY-MM-DD HH24:MI'), '')
  from public.coupons c left join auth.users u on u.id = c.user_id order by c.created_at desc;
$$;

-- a sátorfelállítás kérdése kikapcsolva (nem tudjuk garantálni, ne keltsünk ilyen elvárást)
update public.survey_questions set active = false
  where kind = 'number' and label like 'És ha a sátradat is felállítaná%';

-- 2026-11-26: nyilvános számláló (#/szamlalo) – csak a kitöltések száma és a cél
insert into public.settings (key, value) values ('survey_goal', '150') on conflict (key) do nothing;
create or replace function public.survey_progress() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'count', (select count(*) from public.survey_responses),
    'goal', coalesce(nullif(regexp_replace(coalesce(public.setting('survey_goal'), ''), '\D', '', 'g'), '')::int, 150),
    'at', now());
$$;
revoke execute on function public.survey_progress() from public;
grant execute on function public.survey_progress() to anon, authenticated;
