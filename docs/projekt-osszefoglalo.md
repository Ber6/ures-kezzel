# Üres Kézzel – projekt-összefoglaló

A Claude Code-dal folytatott munka teljes összefoglalója (2026. október 7–8.).
Mi készült el, hogyan működik, mi van beállítva, és mi van még hátra.

---

## 1. A projekt röviden

- **Mi ez:** fesztiválfelszerelés-kölcsönző egyetemi projekt (PTE KTK, „Vállalkozásindítás alapjai”, 2-es csapat).
- **Cél (MVP):** valódi előfoglalásokat gyűjteni fizetés nélkül. Ezzel teszteljük a mentori hipotézist: hajlandók-e előfoglalni?
- **Csapat (adatkezelők):** Molnár Bertalan (kapcsolattartó), Májlinger Bence, Simon Vanda, Varga Ádám.
- **Kapcsolat:** urreskezzel@gmail.com · Instagram: [@ures.kezzel](https://www.instagram.com/ures.kezzel/)

## 2. Címek és fiókok

| Mi | Hol |
| --- | --- |
| Élő oldal | https://ures-kezzel.vercel.app |
| Admin oldal | https://ures-kezzel.vercel.app/#/admin |
| GitHub repó | https://github.com/Ber6/ures-kezzel (élő ág: `main`) |
| Régi cím | `ber6.github.io/ures-kezzel` → magától átirányít a Vercel-címre |
| Tárhely | Vercel, projekt: `ures-kezzel` (minden `main`-be kerülő változást magától élesít) |
| Háttér | Supabase, projekt: `qhcavmetzbmenogbcxfv`, régió: `eu-west-1` (Írország) |
| Levélküldés | Gmail SMTP (urreskezzel@gmail.com, alkalmazásjelszóval) |
| Hírlevél | MailerLite (urreskezzel@gmail.com), csoport: „Üres Kézzel hírlevél” |

**Adminok:** Molnár Bertalan és Májlinger Bence (`admins` tábla).
Új admin felvétele, miután az illető regisztrált (Supabase → SQL Editor):

```sql
insert into public.admins (user_id) select id from auth.users where email = 'valaki@pelda.hu';
```

## 3. Technika

- **Felépítés:** sima HTML/CSS/JS, nincs build lépés. Hash alapú „oldalak” egyetlen `index.html`-ben.
- **Dizájn:** éjkék (#0f1633), lámpássárga (#F2C230), narancs (#E8764A). Betűk: Bricolage Grotesque és Instrument Sans. three.js 3D háttér, ami a foglalási oldalakon nem fut.
- **Supabase:** Auth (e-mail + jelszó, megerősítéssel, PKCE), Postgres és Row Level Security.
- **Kulcsok:** a frontendbe csak a Project URL és a publishable (anon) kulcs kerül (`config.js`). A service_role kulcs soha nem kerül a repóba. A MailerLite kulcs a Supabase **Vault**-jában van.

### Fájlok

| Fájl | Mi ez |
| --- | --- |
| `index.html` | Az oldal: landing és minden nézet, stílusok, 3D háttér, útválasztó |
| `app.js` | Belépés, foglalás, Foglalásaim, Fiókom, admin (Supabase) |
| `config.js` | Supabase URL, publishable kulcs, `TEAM_EMAIL`, `SITE_URL` |
| `data.js` | Tartalék csomag-, fesztivál- és beállításlista (az élő adat a Supabase-ben van) |
| `docs/adatkezeles.md` | Adatkezelési tájékoztató, ez jelenik meg a `#/adatkezeles` oldalon |
| `supabase/schema.sql` | Az adatbázis leírása lépésenként (1–5.) |
| `supabase/email-templates/` | Magyar levélsablonok: megerősítés, új jelszó, e-mail-csere |
| `CLAUDE.md` | Fejlesztési leírás Claude Code-nak |
| `README.md` | Rövid magyar leírás és beállítás |

## 4. Oldalak és funkciók

### Nyilvános
- `#/` főoldal, `#/hogyan`, `#/csomagok`, `#/csomag-arak`, `#/fesztivalok`, `#/gyik`, `#/arak`.
- **Csomagkártyák:** az adatbázisból jönnek. Leárazásnál a jobb felső sarokban narancs **−X%** jelvény, a régi ár áthúzva.
- **Kaució-szöveg:** „első bérlésnél 20 000 Ft, utána 10 000 Ft” (a Beállításokból).
- **Leadás:** „Az utolsó napon, ugyanott, az e-mailben megadott időpontig. Az időpont fesztiválonként változik.”
- `#/adatkezeles`: adatkezelési tájékoztató. A láblécből és a regisztrációs űrlapról is elérhető.

### Vásárló
- **`#/belepes`:** belépés és regisztráció fülekkel, elfelejtett jelszó, magyar hibaüzenetek.
  - Regisztrációnál a név, az e-mail és a jelszó kell, plus a kötelező pipa: „Elolvastam az adatkezelési tájékoztatót, és elmúltam 18 éves”.
  - **Hírlevél-pipa:** alapból üres, mert a GDPR szerint az előre bepipált hozzájárulás érvénytelen.
- **`#/foglalas`:** csak belépve érhető el. Fesztivál és csomag választható, a létszám a csomagból adódik.
  - A kaució összege kiíródik.
  - Ha van le nem zárt korábbi foglalás, megmagyarázza, miért nem végleges még a kaució.
  - Letiltott vásárlónak minden „Elfogyott”.
- **`#/foglalasaim`:** saját foglalások ár, kaució és állapot szerint (Átvéve / Visszahozva). Lemondani csak átvétel előtt lehet.
- **`#/fiokom`:** fiókadatok, név, e-mail és jelszó módosítása, hírlevél be/ki, adatok letöltése (JSON), fiók törlése.
- **Visszaigazolás:** a képernyőn a csapat e-mail-címe látszik. **Telefonszámot nem kérünk**, a csapat telefonszámát csak a fesztivál előtt, e-mailben adjuk ki.

### Admin (`#/admin`)
- **Foglalások:**
  - táblázat, szűrés fesztiválra, állapot módosítása
  - CSV (ár, kaució, átvétel, leadás, probléma)
  - összesítő: fesztivál × csomag
  - Hírlevél-lista (CSV), MailerLite szinkronizálás gomb
- **Helyszín** (a fesztiválon, telefonra optimalizálva):
  - számlálók: foglalás / még jön / kint van / leadta / probléma
  - keresés, szűrés
  - **Átvette**, **Leadta**, **Probléma** (+ leírás)
  - megjegyzések a vásárló fiókjához (csak a csapat látja)
- **Csomagok:** név, létszám, ár, **leárazás (%)**, tartalom, sorrend, aktív, legnépszerűbb, új csomag, törlés. Foglalással rendelkező csomag nem törölhető, csak kikapcsolható.
- **Fesztiválok:** név, helyszín, időpont, állapot, sorrend, aktív, új, törlés.
- **Beállítások:** kaució első bérlésnél, rendes kaució, lemondási feltételek.
- **Napló:** minden admin-módosítás (ki, mikor, mit, régi → új érték). Nem szerkeszthető és nem törölhető.

### Szabályok
- **Kaució:**
  - Első bérlésnél és probléma után emelt kaució jár (`kaucio_elso`, alapból 20 000 Ft).
  - Ha a legutóbbi bérlés rendben zárult, rendes kaució jár (`kaucio`, 10 000 Ft).
  - Az adatbázis számolja foglaláskor, így nem lehet kijátszani.
  - Leadás vagy probléma után a vásárló többi, még át nem vett foglalásán a kaució újraszámolódik.
- **Letiltás:** két problémás visszahozás után a vásárlónak minden csomag „Elfogyott”, és az adatbázis is elutasítja a foglalását (`sold_out`).
- **Leárazás:** az akciós ár 100 Ft-ra kerekedik. A foglalás elmenti a foglaláskori árat (`bookings.price`).

## 5. Adatbázis (Supabase)

### Táblák
| Tábla | Mire | Ki látja / írja |
| --- | --- | --- |
| `bookings` | Foglalások. Mezők: név, fesztivál, csomag, fő, állapot, ár, kaució, átvette, leadta, probléma, probléma leírása, `deleted_at` | Vásárló a sajátját; admin mindet |
| `admins` | Adminok | Csak SQL-ből |
| `packages` | Csomagok, benne a `discount` (%) | Mindenki olvassa, admin írja |
| `festivals` | Fesztiválok | Mindenki olvassa, admin írja |
| `settings` | `kaucio`, `kaucio_elso`, `lemondasi_feltetelek` (a `leadas_idopont` már nincs használatban) | Mindenki olvassa, admin írja |
| `user_notes` | Megjegyzések a vásárló fiókjához | Csak admin |
| `admin_log` | Napló, triggerek töltik | Admin olvassa, senki nem írja |

### Függvények és triggerek
- `is_admin()`, `cancel_booking(b)`, `delete_my_account()`
- `setting_int`, `is_blocked(uid)`, `deposit_for(uid)`, `my_status()` → `{deposit, blocked}`
- `pkg_price(key)`: akciós ár
- `booking_before_insert`: letiltás és inaktív csomag ellenőrzése, kaució és ár beállítása
- `recalc_open_deposits`: leadás vagy probléma után a többi foglalás kauciója újraszámolódik
- `set_note_author`, `log_admin_change` (napló, 6 táblán)
- `newsletter_subscribers()`: admin CSV
- **MailerLite:** `mailerlite_send`, `mailerlite_on_user_change` (trigger az `auth.users`-en), `mailerlite_sync_all()`, `mailerlite_last_results()`
- **Bővítmény:** `pg_net` (az adatbázis innen hívja a MailerLite-ot)

## 6. Beállítások a szolgáltatóknál

**Supabase → Authentication**
- Email provider: bekapcsolva, „Confirm email” bekapcsolva.
- URL Configuration: Site URL `https://ures-kezzel.vercel.app/`, Redirect URLs `https://ures-kezzel.vercel.app/**`.
- SMTP: `smtp.gmail.com`, port 465, felhasználó urreskezzel@gmail.com, jelszó a Gmail **alkalmazásjelszó**. A „personal provider” figyelmeztetés nem hiba.
- Templates (magyar): Confirm signup, Reset password, Change email address. Forrás: `supabase/email-templates/`. A legújabb változatban alul Instagram-link is van.

**MailerLite**
- API-kulcs a Supabase **Vault**-ban, `mailerlite_api_key` néven.
- Az Edge Functionös megoldás nem működött: a MailerLite Cloudflare-tűzfala 403-mal blokkolja a Supabase Edge IP-címeit, ezért a szinkron az adatbázisból megy.
- Ami kitakarítható: a `mailerlite-sync` Edge Function és a `MAILERLITE_API_KEY` Edge-secret már nem kell, a Supabase-ben törölhetők.

## 7. Élesítések (pull requestek, mind beolvasztva)

1. [#1](https://github.com/Ber6/ures-kezzel/pull/1) MVP: landing, belépés, foglalás, Foglalásaim, admin, adatkezelés
2. [#2](https://github.com/Ber6/ures-kezzel/pull/2) Fiókom oldal, létszám mező ki, csapat e-mail, adatkezelési tájékoztató kitöltve
3. [#3](https://github.com/Ber6/ures-kezzel/pull/3) Instagram mindenhol
4. [#4](https://github.com/Ber6/ures-kezzel/pull/4) Jelszó-visszaállító link javítása, GitHub Pages → Vercel átirányítás
5. [#5](https://github.com/Ber6/ures-kezzel/pull/5) Admin: csomagok, fesztiválok, beállítások szerkesztése
6. [#6](https://github.com/Ber6/ures-kezzel/pull/6) Helyszín fül, kaució-szintek, letiltás, napló, hírlevél
7. [#7](https://github.com/Ber6/ures-kezzel/pull/7) Leárazás, nem végleges kaució magyarázata, leadási szöveg, hírlevél alapból üres
8. [#8](https://github.com/Ber6/ures-kezzel/pull/8) MailerLite szinkron (Edge Function, később lecserélve)
9. [#9](https://github.com/Ber6/ures-kezzel/pull/9) MailerLite szinkron az adatbázisból

## 8. Félbemaradt munka: kuka a foglalásokhoz

**A kérés:**
- A foglalás törlése kukába kerüljön, amit üríteni lehet, és 30 naponta magától ürüljön.
- Soronként egy kuka ikon, ami az egér alatt piros, kattintásra rákérdez.
- Több sort vagy mindet ki lehessen jelölni, és együtt törölni vagy visszaigazolni.
- Plusz még további hasznos funkciók.

**Ami az adatbázisban már megvan:**
- `bookings.deleted_at` oszlop
- „read own or admin” szabály: a vásárló nem látja a kukában lévő foglalását
- „admin delete” szabály: végleges törlés csak adminnak
- `cancel_booking`, `is_blocked`, `deposit_for`: a kukában lévő foglalást figyelmen kívül hagyják

**Ami még hiányzik:**
- `purge_trash()` függvény: tartalék ürítés az admin oldal megnyitásakor
- `pg_cron` bekapcsolása és a napi ürítés (`delete ... where deleted_at < now() - interval '30 days'`)
- A weboldal része:
  - kuka ikon soronként
  - jelölőnégyzetek és „mind kijelölése”
  - csoportos műveletek: Megerősítés / Lemondva / Kukába
  - Kuka nézet: visszaállítás, végleges törlés, ürítés
  - keresés névre, szűrés állapotra
  - a kukában lévők kizárása a Helyszín fülről, a számlálókból és az összesítőből

**Megjegyzés:**
- Az élő oldal még nem tud a kukáról. A `deleted_at` oszlop mindenhol üres, így ez most semmin nem változtat.
- A Supabase SQL-eszköze ebben a lépésben többször időtúllépéssel megszakadt (például a több utasításos és a `$$`-os blokkoknál), ezért kellett az utasításokat egyenként futtatni.

## 9. Teendők (csapat)

- [ ] Supabase Vault: `mailerlite_api_key` beírása, utána admin → **MailerLite szinkronizálás** próba.
- [ ] Ellenőrizni, hogy mindhárom levélsablon a legújabb változat-e.
- [ ] Beállítások fül: **lemondási feltételek** kitöltése. A GYIK-ben most `[LEMONDÁSI FELTÉTELEK]` áll.
- [ ] Fesztiválok fül: időpontok és helyszínek véglegesítése.
- [ ] RLS-teszt két felhasználóval: az egyik ne lássa a másik foglalását.
- [ ] Opcionális: a régi `mailerlite-sync` Edge Function és a `MAILERLITE_API_KEY` secret törlése.
- [ ] Opcionális: GitHub Pages kikapcsolása (most átirányít a Vercelre).

## 10. Fontos döntések és tudnivalók

- **Hírlevél:** a pipa alapból üres (GDPR, Planet49-ítélet). Körlevelet a MailerLite-ban lehet írni és küldeni (Campaigns → csoport: „Üres Kézzel hírlevél”).
- **Kaució:** a foglaláskor rögzül, de a többi foglalás lezárásakor magától újraszámolódik.
- **„Elfogyott” a letiltottaknak:** az adatkezelési tájékoztató általánosan leírja, hogy két problémás bérlés után nem adunk ki újra csomagot.
- **Napló:** személyes adatot is tartalmaz (régi és új érték). Érdemes időnként, például szezon végén átnézni.
- **Ingyenes kvóták:** a Gmail kb. 500 levél/nap. A MailerLite 1000 feliratkozóig ingyenes.
- **Tesztelés:** minden változtatás előtt fej nélküli böngészőben, egy Supabase-utánzattal teszteltünk. Az adatbázis-szabályokat élő adatbázison, visszavont tranzakciókban próbáltuk ki.
