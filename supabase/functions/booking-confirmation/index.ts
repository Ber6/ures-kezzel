// Foglalási levelek: visszaigazolás és a csapat telefonszáma a fesztivál előtt.
//   { id }                 – visszaigazolás új foglaláskor (booking_confirmation_email trigger, pg_net)
//   { id, kind: "phone" }  – telefonszám legkésőbb 3 nappal a fesztivál első napja előtt
//                            (pg_cron: send-festival-phone, óránként)
// A kérésben csak a foglalás azonosítója számít: a foglalást és a bérlő e-mail-címét a függvény
// maga olvassa ki, és foglalásonként mindkét levelet csak egyszer küldi (confirmation_sent_at,
// phone_sent_at), így kívülről nem lehet vele tetszőleges címre levelet küldeni.
//
// Secretek (Supabase → Edge Functions → Secrets):
//   SMTP_PASS   – a Gmail alkalmazásjelszó (kötelező)
//   SMTP_USER   – alapból urreskezzel@gmail.com
//   TEAM_PHONE  – a csapat telefonszáma (csak a fesztivál előtti levélben)
//   TEAM_EMAIL  – alapból urreskezzel@gmail.com
import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SMTP_USER = Deno.env.get("SMTP_USER") || "urreskezzel@gmail.com";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const TEAM_PHONE = Deno.env.get("TEAM_PHONE") || "[CSAPAT TELEFONSZÁM]";
const TEAM_EMAIL = Deno.env.get("TEAM_EMAIL") || "urreskezzel@gmail.com";
const SITE_URL = "https://ures-kezzel.vercel.app";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function ft(n: number | null) {
  return n == null ? "" : n.toLocaleString("hu-HU").replace(/\s/g, " ") + " Ft";
}

const P = "margin:0 0 16px;font-size:16px;line-height:1.6;color:#dfe2ef;";
const A = "color:#F2C230;";
// ugyanaz a kinézet, mint a supabase/email-templates/ leveleknél
function layout(title: string, intro: string[], rows: [string, string][], after: string[]) {
  return `<!doctype html>
<html lang="hu">
<body style="margin:0;padding:0;background:#0f1633;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1633;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#18214a;border-radius:20px;">
        <tr><td style="padding:32px 32px 8px;">
          <div style="font-size:22px;font-weight:bold;color:#F4F1EA;">&#9650; Üres Kézzel</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#F4F1EA;">${title}</h1>
${intro.map((x) => `          <p style="${P}">${x}</p>`).join("\n")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:15px;">
${rows.map(([k, v]) => `            <tr><td style="padding:9px 12px 9px 0;border-bottom:1px solid #2b3670;color:#b7bdd6;width:42%;">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid #2b3670;color:#F4F1EA;font-weight:bold;word-break:break-all;">${esc(v)}</td></tr>`).join("\n")}
          </table>
${after.map((x) => `          <p style="${P}">${x}</p>`).join("\n")}
        </td></tr>
        <tr><td style="padding:8px 32px 32px;">
          <a href="${SITE_URL}/#/foglalasaim" style="display:inline-block;background:#F2C230;color:#141A2E;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px;">Foglalásaim</a>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#b7bdd6;">Üres Kézzel, egyetemi projekt a PTE KTK-n · Instagram: <a href="https://www.instagram.com/ures.kezzel/" style="${A}">@ures.kezzel</a></p>
    </td></tr>
  </table>
</body>
</html>`;
}
const strip = (h: string) => h.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function plain(greet: string, intro: string[], rows: [string, string][], after: string[]) {
  return [greet, "", ...intro.map(strip), "", ...rows.map(([k, v]) => `${k}: ${v}`), "", ...after.map(strip), "",
    `A foglalásaidat itt látod: ${SITE_URL}/#/foglalasaim`, "", "Üres Kézzel csapat"].join("\n");
}
// mai nap Budapesten, YYYY-MM-DD
function today() { return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Budapest" }); }
function addDays(d: string, n: number) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function huDate(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let id: string | undefined, kind = "confirmation";
  try {
    const body = await req.json();
    id = body?.record?.id ?? body?.id; // Database Webhook formátum vagy sima { id }
    if (body?.kind === "phone") kind = "phone";
  } catch { /* üres vagy hibás törzs */ }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "missing_id" }, 400);
  if (!SMTP_PASS) return json({ error: "missing_smtp_pass" }, 500);
  const col = kind === "phone" ? "phone_sent_at" : "confirmation_sent_at";

  const { data: b, error } = await sb.from("bookings").select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!b) return json({ error: "not_found" }, 404);
  if (b[col]) return json({ ok: true, skipped: "already_sent" });

  let fest: { start_date: string | null; location: string | null } | null = null;
  if (kind === "confirmation") {
    // csak friss foglalásra küldünk
    if (Date.now() - new Date(b.created_at).getTime() > 60 * 60 * 1000) return json({ ok: true, skipped: "too_old" });
  } else {
    if (b.status === "lemondott" || b.deleted_at) return json({ ok: true, skipped: "inactive" });
    const { data: f } = await sb.from("festivals").select("start_date, location").eq("name", b.festival).maybeSingle();
    fest = f;
    // csak az első nap előtti 3 napban (és a fesztivál alatt), máskor nem
    const t = today();
    if (!f?.start_date || t < addDays(f.start_date, -3) || t > addDays(f.start_date, 3)) return json({ ok: true, skipped: "not_due" });
  }

  // lefoglaljuk a küldést, hogy párhuzamos hívásnál se menjen ki kétszer
  const { data: claimed } = await sb.from("bookings").update({ [col]: new Date().toISOString() })
    .eq("id", id).is(col, null).select("id");
  if (!claimed?.length) return json({ ok: true, skipped: "already_sent" });

  const { data: u } = await sb.auth.admin.getUserById(b.user_id);
  const to = u?.user?.email;
  if (!to) return json({ error: "no_email" }, 404);
  const { data: pkg } = await sb.from("packages").select("name").eq("key", b.package).maybeSingle();
  const pkgName = pkg?.name || b.package;
  const mail = `<a href="mailto:${esc(TEAM_EMAIL)}" style="${A}">${esc(TEAM_EMAIL)}</a>`;
  const greet = `Szia, ${b.full_name}!`;

  let subject: string, title: string, intro: string[], rows: [string, string][], after: string[];
  if (kind === "confirmation") {
    subject = `Előfoglalás visszaigazolása – ${b.festival}, ${pkgName}`;
    title = "Megkaptuk az előfoglalásodat!";
    intro = [esc(greet), "Köszönjük, hogy minket választottál. A foglalásod adatai:"];
    rows = [["Név", b.full_name], ["Fesztivál", b.festival], ["Csomag", pkgName], ["Létszám", b.people + " fő"]];
    if (b.price) rows.push(["Ár", ft(b.price)]);
    if (b.deposit) rows.push(["Kaució", ft(b.deposit) + " (leadás után visszajár)"]);
    rows.push(["Foglalás azonosítója", b.id]);
    after = [
      `<span style="display:block;border-left:3px solid #F2C230;padding-left:12px;"><b style="color:#F4F1EA;">Fizetés a helyszínen</b>, a csomag átvételekor. Most nem kell fizetned semmit.</span>`,
      "Átvétel a kemping bejárata előtt, leadás az utolsó napon ugyanott.",
      `Kérdésed van? Írj nekünk: ${mail}<br>A telefonszámunkat legkésőbb 3 nappal a fesztivál első napja előtt e-mailben elküldjük.`,
    ];
  } else {
    const tel = `<a href="tel:${esc(TEAM_PHONE.replace(/[^\d+]/g, ""))}" style="${A}font-weight:bold;">${esc(TEAM_PHONE)}</a>`;
    subject = `Hamarosan kezdődik: ${b.festival} – a telefonszámunk`;
    title = `Hamarosan kezdődik: ${esc(b.festival)}!`;
    intro = [esc(greet), `Ezen a számon érsz el minket a fesztiválon, például ha keresed az átvételi pontot: <br><span style="font-size:22px;">${tel}</span>`];
    rows = [["Fesztivál", b.festival]];
    if (fest?.start_date) rows.push(["Első nap", huDate(fest.start_date)]);
    if (fest?.location) rows.push(["Helyszín", fest.location]);
    rows.push(["Csomag", pkgName + " (" + b.people + " fő)"]);
    if (b.price) rows.push(["Fizetendő a helyszínen", ft(b.price)]);
    if (b.deposit) rows.push(["Kaució", ft(b.deposit) + " (leadás után visszajár)"]);
    rows.push(["Foglalás azonosítója", b.id]);
    after = [
      "Átvétel a kemping bejárata előtt, leadás az utolsó napon ugyanott.",
      `Ha mégsem tudsz jönni, kérjük, mondd le a foglalást a Foglalásaim oldalon, vagy írj nekünk: ${mail}`,
    ];
  }

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, // a Supabase Edge a 25-ös és 587-es portot tiltja
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transport.sendMail({
      from: `"Üres Kézzel" <${SMTP_USER}>`,
      replyTo: TEAM_EMAIL,
      to,
      subject,
      text: plain(greet, intro.slice(1), rows, after),
      html: layout(title, intro, rows, after),
    });
  } catch (e) {
    // sikertelen küldés: visszaengedjük, hogy újra lehessen próbálni
    await sb.from("bookings").update({ [col]: null }).eq("id", id);
    console.error("smtp error", e);
    return json({ error: "smtp", message: String((e as Error)?.message || e) }, 502);
  }
  return json({ ok: true, kind, to_domain: to.split("@")[1] });
});
