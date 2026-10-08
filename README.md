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
  - **Csomagok, Fesztiválok, Beállítások:** szerkesztés (kaució első bérlésnél / rendes, leadási időpont, lemondási feltételek)
  - **Napló:** minden admin-módosítás (ki, mikor, mit); nem szerkeszthető, nem törölhető

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
