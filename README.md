# Üres Kézzel

Fesztiválfelszerelés-kölcsönző egyetemi projekt (PTE KTK, „Vállalkozásindítás alapjai”, 2-es csapat).
Az oldal célja: **valódi előfoglalásokat gyűjteni fizetés nélkül.**

Sima HTML/CSS/JS, nincs build lépés. Háttér: Supabase (Auth + Postgres + RLS).

## Fájlok

| Fájl | Mi ez |
| --- | --- |
| `index.html` | A weboldal (landing page, hash alapú oldalakkal: `#/`, `#/csomagok`, `#/foglalas` …) |
| `config.js` | Supabase Project URL + anon kulcs + a csapat telefonszáma |
| `docs/adatkezeles.md` | Adatkezelési tájékoztató (a `[...]` részeket ki kell tölteni) |
| `CLAUDE.md` | Részletes fejlesztési leírás (adatbázis, oldalak, teendők) |

## Beállítás

1. **Supabase projekt** létrehozása EU régióban (pl. Frankfurt).
2. A `CLAUDE.md` „Adatbázis” részében lévő SQL-t futtasd le a Supabase **SQL Editor**ában.
3. **Authentication → Providers → Email**: bekapcsolva, „Confirm email” bekapcsolva.
4. **Authentication → URL Configuration**: Site URL és Redirect URL = az élő oldal címe.
5. **Project Settings → API**: a *Project URL* és az *anon/publishable key* menjen a `config.js`-be.

## Hol vannak a kulcsok?

Csak a `config.js`-ben. Az anon kulcs nyilvános lehet, a védelmet a Row Level Security adja.
A **`service_role` kulcs SOHA ne kerüljön a repóba.**

## Élesítés (GitHub Pages)

GitHub → a repó **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
Pár perc múlva elérhető: `https://ber6.github.io/ures-kezzel/`
