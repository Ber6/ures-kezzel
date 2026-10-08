// Közös adatok: ebből épül a Fesztiválok oldal és a foglalási űrlap is.
// Új fesztivál = egy új sor a listában. A "name" kerül be a foglalásokhoz, ezt később ne írd át.
window.UK_DATA = {
  FESTIVALS: [
    { name: "Fishing on Orfű", where: "Orfű, [IDŐPONT]" },
    { name: "Sziget",          where: "Budapest, Hajógyári-sziget, [IDŐPONT]" },
    { name: "VOLT",            where: "Sopron, [IDŐPONT]" },
    { name: "Balaton Sound",   where: "Zamárdi, [IDŐPONT]" },
    { name: "STRAND Fesztivál", where: "Zamárdi, [IDŐPONT]" },
    { name: "EFOTT",           where: "Velence, [IDŐPONT]" },
    { name: "Campus Fesztivál", where: "Debrecen, [IDŐPONT]" }
  ],
  PACKAGES: {
    solo: { name: "Solo Pack", people: 1, price: "14 900 Ft" },
    duo:  { name: "Duo Pack",  people: 2, price: "24 900 Ft" },
    crew: { name: "Crew Pack", people: 4, price: "44 900 Ft" }
  }
};
