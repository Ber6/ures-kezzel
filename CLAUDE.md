# Üres Kézzel – MVP foglalási rendszer (átadó leírás Claude Code-nak)

Ezt a fájlt a claude.ai-os beszélgetésből hoztuk át. Olvasd végig, mielőtt bármit építesz.

## A projekt

- Fesztiválfelszerelés-kölcsönző egyetemi projekt (PTE KTK, „Vállalkozásindítás alapjai”, 2-es csapat).
- Csomagok (próbaárak): Solo (1 fő) 14 900 Ft, Duo (2 fő) 24 900 Ft, Crew (4 fő) 44 900 Ft. Kaució 10 000 Ft, a leadás után visszajár.
- Az ügyfél a kemping bejárata előtt veszi át a csomagot, és az utolsó napon ugyanott adja le.
- Az MVP célja: **valódi előfoglalásokat gyűjteni fizetés nélkül.** Ez a mentori hipotézis tesztje: hajlandók-e előfoglalni?
- A tulajdonos (Beró) tud valamennyit programozni, és vibe codingol. Magyarul kommunikálj vele, röviden és lépésenként.

## Kiindulópont

- `index.html` (eredetileg `landing-page.html`, átnevezve, hogy a GitHub Pages ezt nyissa meg): a kész landing page. Egyetlen fájl, three.js 3D háttérrel és hash alapú „oldalakkal”: `#/`, `#/hogyan`, `#/csomagok`, `#/fesztivalok`, `#/gyik`, `#/arak`, `#/foglalas`, `#/csomag-arak`. **A dizájnt tartsd meg**: éjkék (#0f1633), lámpássárga (#F2C230), narancs (#E8764A), Bricolage Grotesque + Instrument Sans betűk. Az új oldalak ugyanebben a stílusban készüljenek.
- `docs/adatkezeles.md`: az adatkezelési tájékoztató. A `[...]` helyőrzőket a csapat tölti ki. Ebből legyen egy `#/adatkezeles` oldal (vagy külön `adatkezeles.html`), és a láblécből meg a regisztrációs űrlapról is legyen rá link.

## Technikai döntések (már eldöntve)

- **Tárhely:** GitHub repó + GitHub Pages vagy Vercel. Build lépés nélkül: sima HTML/CSS/JS.
- **Háttér:** Supabase (Auth + Postgres + Row Level Security). A projekt régiója EU legyen (pl. Frankfurt).
- **Belépés:** e-mail + jelszó. E-mail-megerősítés bekapcsolva.
- **Supabase kliens:** `@supabase/supabase-js` v2 CDN-ről (jsdelivr).
- A frontendbe csak a **Project URL** és az **anon/publishable key** kerülhet. A `service_role` kulcs SOHA ne kerüljön a repóba.
- A kulcsokat egy `config.js` fájlban tárold. A repó publikus, de az anon kulcs nyilvános, a védelmet az RLS adja.

## Bekért adatok (csak ezek!)

- Regisztráció: név, e-mail, jelszó, plusz egy kötelező jelölőnégyzet: „Elolvastam az adatkezelési tájékoztatót, és elmúltam 18 éves.”
- Foglalás: fesztivál (legördülő lista), csomag (Solo/Duo/Crew). A létszámot nem kérdezzük, a csomagból adódik (Solo 1, Duo 2, Crew 4).
- **Telefonszámot NEM kérünk.** A visszaigazoló képernyőn és a „Foglalásaim” oldalon a csapat e-mail-címe jelenik meg (`config.js` → `TEAM_EMAIL`). A csapat telefonszámát csak a fesztivál előtt, e-mailben adjuk ki a foglalóknak.
- Nincs fizetés, nincs analitika, nincs követő süti.

## Oldalak és funkciók

1. **Regisztráció / Belépés** (`#/belepes`): váltható fülek, „Elfelejtett jelszó” (Supabase reset e-mail), érthető magyar hibaüzenetek.
2. **Foglalás** (`#/foglalas`): csak belépve. A csomagkártyák „Ezt kérem” gombja előre kiválasztja a csomagot. Kijelentkezett felhasználót a belépésre visz, majd vissza a foglaláshoz.
3. **Foglalásaim** (`#/foglalasaim`): a saját foglalások listája állapottal, lemondás gomb.
3/b. **Fiókom** (`#/fiokom`): fiókadatok, név, e-mail-cím és jelszó módosítása, adatok letöltése (JSON), valamint **„Fiókom törlése”** (megerősítő kérdéssel). A törlés a fiókot és minden foglalást töröl.
4. **Admin** (`#/admin`): csak az `admins` táblában szereplő felhasználóknak. Az összes foglalás táblázatban, szűrés fesztiválra, állapot módosítása, CSV export, és egy összesítő: fesztivál × csomag darabszám. Külön füleken a csomagok (név, ár, létszám, tartalom, kiemelés, be/ki), a fesztiválok és a beállítások (kaució, leadási időpont, lemondási feltételek) szerkeszthetők. Ezek a `packages`, `festivals`, `settings` táblákban vannak (`supabase/schema.sql`, 2. lépés), a `data.js` csak tartalék.
   - **Helyszín** fül: fesztiválonként a foglalások, „Átvette” / „Leadta” / „Probléma” gombok, a probléma leírása, megjegyzések a vásárló fiókjához (`user_notes`).
   - **Napló** fül: az `admin_log` táblát triggerek töltik minden admin-módosításkor; nincs rá írási szabály, így nem szerkeszthető.
   - **Kaució:** `kaucio_elso` (első bérlés, probléma után) és `kaucio` (rendes, ha a legutóbbi bérlés rendben zárult). Két `return_problem` után a vásárló le van tiltva: minden csomag „Elfogyott”, és az adatbázis is elutasítja a foglalást (`sold_out`).
   - **Leárazás:** `packages.discount` (%), az akciós ár 100 Ft-ra kerekítve (`pkg_price`); a kártyán `−X%` jelvény. A foglalás elmenti az árat (`bookings.price`).
   - **Kaució több foglalásnál:** ha egy bérlés lezárul, a vásárló többi, még át nem vett foglalásán a kaució újraszámolódik (`recalc_open_deposits` trigger); amíg van lezáratlan korábbi foglalás, a vásárló a „még nem végleges” magyarázatot látja.
   - **MailerLite:** az adatbázis küldi (`pg_net`): `mailerlite_on_user_change` trigger az `auth.users`-en, `mailerlite_sync_all()` (admin gomb), `mailerlite_last_results()`; kulcs a Vaultban (`mailerlite_api_key`), csoport: „Üres Kézzel hírlevél”. Edge Functionből nem megy (a MailerLite Cloudflare-e blokkolja a Supabase Edge IP-ket). A MailerLite-ban leiratkozottat nem iratkoztatja vissza.
   - **Kuka:** a foglalás törlése a kukába teszi (`bookings.deleted_at`), onnan visszaállítható vagy véglegesen törölhető; 30 nap után magától törlődik (`pg_cron`: `purge-booking-trash`, plusz `purge_trash()` az admin oldal megnyitásakor). Soronként kuka ikon, jelölőnégyzetek, „mind kijelölése”, csoportos Megerősítés / Lemondva / Kukába. A kukás foglalás nem számít bele az összesítőbe, a Helyszín fülbe, a kaucióba és a letiltásba.
   - **Hírlevél:** a regisztrációnál (alapból üres) jelölőnégyzet (`user_metadata.newsletter`), a Fiókom oldalon ki/be kapcsolható, az admin CSV-ben letöltheti (`newsletter_subscribers()`).
5. A navigációban legyen „Belépés”, belépve pedig „Foglalásaim”, „Fiókom” és „Kijelentkezés”.

## Adatbázis (Supabase SQL Editorba)

```sql
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

revoke execute on function public.cancel_booking(uuid) from anon;
revoke execute on function public.delete_my_account() from anon;
```

Admin hozzáadása (miután az illető regisztrált): `insert into public.admins (user_id) select id from auth.users where email = 'valaki@pelda.hu';`

Ezt az SQL-t a tulajdonos futtatja a Supabase felületén. Ellenőrizd vele, hogy lefutott-e, és **teszteld az RLS-t két külön felhasználóval**: az egyik ne lássa a másik foglalását.

## Supabase beállítások, amiket a tulajdonosnak kell elvégeznie (vezesd végig)

- Authentication → Providers → Email: bekapcsolva, „Confirm email” bekapcsolva.
- Authentication → URL Configuration: a Site URL és a Redirect URL-ek legyenek az élő oldal címei (GitHub Pages / Vercel).
- Ha lehet, az e-mail-sablonok magyarul.
- Project Settings → API: innen jön a Project URL és az anon key, ezek kerülnek a `config.js`-be.

## Fesztiválok (a landing page-ről, még nem végleges)

Fishing on Orfű, Sziget, VOLT, Balaton Sound, STRAND Fesztivál, EFOTT, Campus Fesztivál. A `festivals` táblából jönnek (admin oldalon szerkeszthető), ezt használja a Fesztiválok oldal és a foglalási legördülő lista is.

## Kész, ha

- [ ] A repó GitHubon van, az oldal élő URL-en elérhető.
- [ ] Regisztráció → megerősítő e-mail → belépés működik.
- [ ] Foglalás leadható, és megjelenik a Foglalásaim oldalon.
- [ ] Másik felhasználó nem látja (RLS-teszt).
- [ ] Lemondás és fióktörlés működik.
- [ ] Az admin látja az összes foglalást, és tud CSV-t exportálni.
- [ ] Az adatkezelési tájékoztató elérhető a láblécből és a regisztrációnál.
- [ ] Telefonon és gépen is működik, a 3D háttér nem lassítja a foglalási oldalakat.
- [ ] Egy rövid README.md magyarul: mi ez, hogyan kell beállítani, hol vannak a kulcsok.
