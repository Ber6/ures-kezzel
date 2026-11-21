# Üres Kézzel

Fesztiválfelszerelés-kölcsönző egyetemi projekt (PTE KTK, „Vállalkozásindítás alapjai”, 2-es csapat).
Az oldal célja: **valódi előfoglalásokat gyűjteni fizetés nélkül.**

Sima HTML/CSS/JS, nincs build lépés. Háttér: Supabase (Auth + Postgres + Row Level Security).

## Fájlok

| Fájl | Mi ez |
| --- | --- |
| `index.html` | A weboldal: landing page és minden aloldal (hash alapú: `#/`, `#/csomagok`, `#/foglalas` …) |
| `app.js` | Belépés, regisztráció, foglalás, Foglalásaim, admin (Supabase) |
| `data.js` | Tartalék csomag-, fesztivál- és beállításlista. Az élő adatok a Supabase-ben vannak, és az **admin oldalon** szerkeszthetők. |
| `config.js` | Supabase Project URL + publishable kulcs + a csapat e-mail-címe |
| `supabase/schema.sql` | Az adatbázis (egyszer kell lefuttatni a Supabase SQL Editorban) |
| `docs/adatkezeles.md` | Adatkezelési tájékoztató, ebből lesz a `#/adatkezeles` oldal. A `[...]` részeket ki kell tölteni. |
| `CLAUDE.md` | Részletes fejlesztési leírás |

## Oldalak

- `#/belepes`: belépés, regisztráció, elfelejtett jelszó
- `#/foglalas`: foglalás (csak belépve; a csomagkártyák „Ezt kérem” gombja előre kiválasztja a csomagot)
- `#/foglalasaim`: saját foglalások, lemondás
- `#/fiokom`: fiókadatok, név / e-mail / jelszó módosítása, adatok letöltése (JSON), fiók törlése
- `#/admin` (csak az `admins` táblában szereplőknek):
  - **Foglalások:** összes foglalás, szűrés, állapot, CSV, összesítő, hírlevél-lista (CSV)
  - **Helyszín:** a fesztiválon: ki jön még, átvette / leadta, probléma (+ leírás), megjegyzés a vásárló fiókjához
  - **Csomagok, Fesztiválok, Beállítások:** szerkesztés (leárazás %-ban, kaució első bérlésnél / rendes, lemondási feltételek)
  - **Napló:** minden admin-módosítás (ki, mikor, mit); nem szerkeszthető, nem törölhető

**Hírlevél (MailerLite):** a feliratkozókat az adatbázis küldi át a MailerLite „Üres Kézzel hírlevél” csoportjába (`pg_net`, trigger az `auth.users` táblán): megerősített regisztrációkor és a Fiókom oldali ki-/bekapcsoláskor magától, az admin oldalon a „MailerLite szinkronizálás” gombbal mindenkit újra. A MailerLite API-kulcs a Supabase **Vault**-jában van `mailerlite_api_key` néven, a repóba nem kerül. (Edge Functionből nem megy: a MailerLite tűzfala blokkolja a Supabase Edge IP-címeit.) Körlevelet a MailerLite felületén lehet írni és küldeni.

**Kaució-szabály:** első bérlésnél és probléma után emelt kaució, ha a legutóbbi bérlés rendben zárult, rendes kaució. Két problémás visszahozás után a vásárlónak minden csomag „elfogyott”. Ezt az adatbázis számolja (`my_status`, `booking_before_insert`), nem lehet kijátszani.
- `#/adatkezeles`: adatkezelési tájékoztató

A foglalási oldalakon a 3D háttér nem fut, hogy ne lassítson.

## Beállítás (Supabase)

1. Supabase projekt EU régióban (pl. Frankfurt).
2. A `supabase/schema.sql` tartalmát futtasd le az **SQL Editor**ban (egyszer).
3. **Authentication → Sign In / Providers → Email**: bekapcsolva, „Confirm email” bekapcsolva.
4. **Authentication → URL Configuration**
   - Site URL: `https://ber6.github.io/ures-kezzel/`
   - Redirect URLs: `https://ber6.github.io/ures-kezzel/**`
5. **E-mail-küldés (SMTP):** a Supabase beépített levélküldője csak a projekt csapattagjainak küld levelet, és óránként csak néhányat.
   Valódi felhasználókhoz saját SMTP kell: **Authentication → Emails → SMTP Settings** (pl. Resend vagy Brevo ingyenes csomag).
6. Admin hozzáadása (miután az illető regisztrált az oldalon):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'valaki@pelda.hu';
   ```

## Hol vannak a kulcsok?

Csak a `config.js`-ben. A publishable (anon) kulcs nyilvános lehet, a védelmet a Row Level Security adja.
A **`service_role` / secret kulcs SOHA ne kerüljön a repóba.**

## Élesítés (GitHub Pages)

GitHub → a repó **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
Pár perc múlva elérhető: `https://ber6.github.io/ures-kezzel/`

Helyi kipróbálás: `python3 -m http.server` a repó mappájában, majd `http://localhost:8000`
(a `file://` megnyitás nem jó, mert az adatkezelési tájékoztatót így nem lehet betölteni).

## Hamarosan-mód, kérdőív, kupon, mérés (2026. november)

Minden az **admin oldalon** kapcsolható, kód nélkül:

- **Beállítások → A weboldal állapota**
  - *Foglalás nyitva*: amíg ki van kapcsolva, az oldalon „Hamarosan indulunk” látszik, és **az adatbázis minden foglalást elutasít** (`booking_closed`), akkor is, ha valaki a gomb nélkül, közvetlenül próbálkozik. Adminok tesztelhetnek.
  - *Várható árak mutatása*: „várhatóan X Ft-tól”, vagy ár nélkül „Hamarosan”.
- **Kérdőív fül**: indítás/leállítás, előnézet, cím, bevezető, kedvezmény %, kérdések szerkesztése (rövid/hosszú szöveg, egy vagy több választás „Egyéb” saját válasszal, csúszka 1–5 / 1–7 / 1–10), sorrend, ki/bekapcsolás.
- **Kuponok fül**: ki kapott kódot, elment-e az e-mail, beváltották-e, újraküldés, CSV.

Hogyan működik:
- A kérdőív kitöltéséhez belépés és megerősített e-mail kell. Fiókonként egy kitöltés, egy kupon (`UK-XXXXXXXX`).
- Az ellenőrzés a szerveren történik: `submit_survey()` (kötelező kérdések, érvényes válaszok, rejtett mező, minimum kitöltési idő).
- A kupont a `booking-confirmation` Edge Function küldi e-mailben (`kind: "coupon"`), és a Fiókom oldalon is látszik.
- Beváltás: a foglalási űrlap „Kuponkód” mezője; az árat az adatbázis számolja, lemondáskor a kupon újra felhasználható.
- Látogatómérés süti nélkül (`track()` → `page_events`), 13 hónap után törlődik. DNT/GPC esetén nem mér, adminokat nem mér.
- **Google Sheet** (Drive → Üres kézzel → Kérdőívek → „Üres Kézzel – weboldal kérdőív és látogatók (élő adat)”): `IMPORTDATA` képletek a `sheet-export` Edge Functionből. A token a Supabase Vaultban van (`sheet_token`). A válaszok lap álnevesített (nincs név, e-mail).
- Az SQL: `supabase/kerdoiv.sql`.

Kampánylinkek: `https://ures-kezzel.vercel.app/?utm_source=instagram` (a `?` a `#` elé kerüljön), így a Sheet „Források” lapján külön látszik.

### Botvédelem (Cloudflare Turnstile), opcionális

1. Cloudflare-fiók → Turnstile → új widget, domain: `ures-kezzel.vercel.app` → kapsz egy *Site Key*-t és egy *Secret Key*-t.
2. Supabase → Authentication → Attack Protection → CAPTCHA → Turnstile, ide a **Secret Key**.
3. `config.js` → `TURNSTILE_SITE_KEY`: ide a **Site Key**. A regisztrációnál, belépésnél és jelszókérésnél megjelenik az ellenőrzés.

A 2. és 3. lépést egyszerre csináld, különben a belépés nem működik.
