// Alapértékek. Az élő adatok a Supabase-ből jönnek (packages, festivals, settings táblák),
// és az admin oldalon szerkeszthetők. Ez csak akkor látszik, ha az adatbázis nem érhető el.
window.UK_DATA = {
  FESTIVALS: [
    { name: "Fishing on Orfű",  location: "Orfű" },
    { name: "Sziget",           location: "Budapest, Hajógyári-sziget" },
    { name: "VOLT",             location: "Sopron" },
    { name: "Balaton Sound",    location: "Zamárdi" },
    { name: "STRAND Fesztivál", location: "Zamárdi" },
    { name: "EFOTT",            location: "Velence" },
    { name: "Campus Fesztivál", location: "Debrecen" }
  ],
  PACKAGES: {
    solo: { name: "Solo Pack", people: 1, price: 14900, items: ["2 fős sátor", "Önfelfújó matrac", "Kempingszék", "LED sátorlámpa", "Powerbank"] },
    duo:  { name: "Duo Pack",  people: 2, price: 24900, featured: true, items: ["3 fős sátor", "2 önfelfújó matrac", "2 kempingszék", "LED sátorlámpa", "2 powerbank"] },
    crew: { name: "Crew Pack", people: 4, price: 44900, items: ["4 fős kupolasátor", "4 önfelfújó matrac", "4 kempingszék", "3×3 m-es pavilon", "2 LED sátorlámpa", "4 powerbank"] }
  },
  SETTINGS: {
    kaucio: "10000",        // rendes kaució (Ft)
    kaucio_elso: "20000",   // első bérlésnél és probléma után (Ft)
    leadas_idopont: "[IDŐPONT]",
    lemondasi_feltetelek: "[LEMONDÁSI FELTÉTELEK]"
  }
};
