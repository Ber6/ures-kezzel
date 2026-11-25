// Adatok a Google Sheetbe, CSV-ként. A Sheet cellái így húzzák be:
//   =IMPORTDATA("https://qhcavmetzbmenogbcxfv.supabase.co/functions/v1/sheet-export?t=TOKEN&lap=valaszok")
// lap: valaszok | kuponok | napi | forrasok | oldalak | esemenyek
// Csak a helyes tokennel működik; a token a Supabase Vaultban van "sheet_token" néven (ellenőrzés: sheet_token_ok()).
// Ha kiszivárog: SQL Editorban  select vault.update_secret((select id from vault.secrets where name='sheet_token'), 'ÚJ_TOKEN');
// és a Sheet képleteiben is cseréld le. A válaszok lapon nincs név és e-mail (álnevesített), csak a kuponok lapon.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// képlet-befecskendezés ellen: a =, +, -, @ kezdetű szöveg elé szóközt teszünk
function cell(v: unknown) {
  let s = v == null ? "" : typeof v === "boolean" ? (v ? "igen" : "nem") : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = " " + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(rows: unknown[][]) {
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
}
function fmt(d: string) {
  return new Date(d).toLocaleString("sv-SE", { timeZone: "Europe/Budapest" }).slice(0, 16);
}

const VIEWS: Record<string, [string, string[]]> = {
  kuponok: ["sheet_kuponok", ["Kuponkód", "Név", "E-mail", "Kedvezmény (%)", "Létrehozva", "E-mail elküldve", "Beváltva"]],
  napi: ["sheet_napi", ["Nap", "Látogatás", "Oldalmegtekintés", "Regisztráció", "Kérdőív megnyitva", "Kérdőív kitöltve", "Mobilról (%)"]],
  forrasok: ["sheet_forrasok", ["Forrás", "Látogatás", "Regisztráció", "Kérdőív kitöltve", "Kitöltés / látogatás (%)"]],
  oldalak: ["sheet_oldalak", ["Oldal", "Megtekintés", "Ezzel kezdték a látogatást"]],
  esemenyek: ["sheet_esemenyek", ["Időpont", "Esemény", "Oldal", "Forrás", "UTM medium", "UTM kampány", "Eszköz", "Böngésző", "Rendszer", "Nyelv", "Képernyő (px)", "Belépve", "Belépő oldal"]],
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const t = (url.searchParams.get("t") || "").slice(0, 100);
  const ok = await sb.rpc("sheet_token_ok", { t });
  if (ok.error || ok.data !== true) return text("hibas token", 403);
  const lap = url.searchParams.get("lap") || "valaszok";

  if (VIEWS[lap]) {
    const [fn, head] = VIEWS[lap];
    const { data, error } = await sb.rpc(fn);
    if (error) return text("hiba: " + error.message, 500);
    const rows = (data as Record<string, unknown>[]).map((r) => Object.values(r));
    return text(csv([head, ...rows]));
  }

  if (lap === "valaszok") {
    const [qs, rs] = await Promise.all([
      sb.from("survey_questions").select("id,label,sort,active,created_at,kind").neq("kind", "page").order("sort").order("created_at"),
      sb.from("survey_responses").select("id,created_at,duration_s,source,answers").order("created_at", { ascending: true }).limit(10000),
    ]);
    if (qs.error || rs.error) return text("hiba: " + (qs.error || rs.error)!.message, 500);
    // oszlopok: a jelenlegi kérdések sorrendben, utána a már törölt kérdések (a régi válaszokból)
    const cols: { qid: string; label: string }[] = qs.data.map((q) => ({ qid: q.id, label: q.label + (q.active ? "" : " (kikapcsolva)") }));
    const known = new Set(cols.map((c) => c.qid));
    for (const r of rs.data) for (const a of r.answers as { qid: string; label: string }[]) {
      if (!known.has(a.qid)) { known.add(a.qid); cols.push({ qid: a.qid, label: a.label + " (törölt kérdés)" }); }
    }
    const head = ["Beküldve", "Válasz azonosító", "Kitöltési idő (mp)", "Forrás", ...cols.map((c) => c.label)];
    const rows = rs.data.map((r) => {
      const m = new Map((r.answers as { qid: string; value: string | null }[]).map((a) => [a.qid, a.value]));
      return [fmt(r.created_at), String(r.id).slice(0, 8), r.duration_s ?? "", r.source ?? "", ...cols.map((c) => m.get(c.qid) ?? "")];
    });
    return text(csv([head, ...rows]));
  }
  return text("ismeretlen lap", 404);
});
