// Foglalási visszaigazoló e-mail.
// Az adatbázis hívja meg minden új foglaláskor (notify_booking_confirmation trigger, pg_net).
// A kérésben csak a foglalás azonosítója számít: a foglalást és a bérlő e-mail-címét a függvény
// maga olvassa ki, és foglalásonként csak egyszer küld (confirmation_sent_at), így kívülről nem
// lehet vele tetszőleges címre levelet küldeni.
//
// Secretek (Supabase → Edge Functions → Secrets):
//   SMTP_PASS   – a Gmail alkalmazásjelszó (kötelező)
//   SMTP_USER   – alapból urreskezzel@gmail.com
//   TEAM_PHONE  – a csapat telefonszáma
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let id: string | undefined;
  try {
    const body = await req.json();
    id = body?.record?.id ?? body?.id; // Database Webhook formátum vagy sima { id }
  } catch { /* üres vagy hibás törzs */ }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "missing_id" }, 400);
  if (!SMTP_PASS) return json({ error: "missing_smtp_pass" }, 500);

  const { data: b, error } = await sb.from("bookings").select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!b) return json({ error: "not_found" }, 404);
  if (b.confirmation_sent_at) return json({ ok: true, skipped: "already_sent" });
  // csak friss foglalásra küldünk
  if (Date.now() - new Date(b.created_at).getTime() > 60 * 60 * 1000) return json({ ok: true, skipped: "too_old" });

  // lefoglaljuk a küldést, hogy párhuzamos hívásnál se menjen ki kétszer
  const { data: claimed } = await sb.from("bookings").update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", id).is("confirmation_sent_at", null).select("id");
  if (!claimed?.length) return json({ ok: true, skipped: "already_sent" });

  const { data: u } = await sb.auth.admin.getUserById(b.user_id);
  const to = u?.user?.email;
  if (!to) return json({ error: "no_email" }, 404);
  const { data: pkg } = await sb.from("packages").select("name").eq("key", b.package).maybeSingle();
  const pkgName = pkg?.name || b.package;

  const rows: [string, string][] = [
    ["Név", b.full_name],
    ["Fesztivál", b.festival],
    ["Csomag", pkgName],
    ["Létszám", b.people + " fő"],
  ];
  if (b.price) rows.push(["Ár", ft(b.price)]);
  if (b.deposit) rows.push(["Kaució", ft(b.deposit) + " (leadás után visszajár)"]);
  rows.push(["Foglalás azonosítója", b.id]);

  const text = [
    `Szia ${b.full_name}!`,
    "",
    "Megkaptuk az előfoglalásodat. Köszönjük!",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Fizetés: a helyszínen, a csomag átvételekor. Most nem kell fizetned semmit.",
    "Átvétel: a kemping bejárata előtt. Leadás: az utolsó napon, ugyanott.",
    "",
    `Kérdésed van? Telefon: ${TEAM_PHONE} · E-mail: ${TEAM_EMAIL}`,
    `A foglalásaidat itt látod, és itt is tudod lemondani: ${SITE_URL}/#/foglalasaim`,
    "",
    "Üres Kézzel csapat",
  ].join("\n");

  const html = `<!doctype html><html lang="hu"><body style="margin:0;background:#0f1633;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#f4f1ea">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1a2350;border-radius:20px;padding:28px">
<tr><td>
<p style="margin:0 0 6px;color:#F2C230;font-weight:bold;font-size:15px">▲ Üres Kézzel</p>
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#f4f1ea">Megkaptuk az előfoglalásodat!</h1>
<p style="margin:0 0 18px;font-size:16px;line-height:1.5">Szia ${esc(b.full_name)}! Köszönjük, hogy minket választottál. A foglalásod adatai:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin:0 0 18px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #2e3a72;color:#b7bdd6;width:42%">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #2e3a72;font-weight:bold;word-break:break-all">${esc(v)}</td></tr>`).join("")}
</table>
<p style="margin:0 0 10px;font-size:15px;line-height:1.5;border-left:3px solid #F2C230;padding-left:12px"><b>Fizetés a helyszínen</b>, a csomag átvételekor. Most nem kell fizetned semmit.</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#dfe2ef">Átvétel a kemping bejárata előtt, leadás az utolsó napon ugyanott.</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.5">Kérdésed van? Hívj minket: <b>${esc(TEAM_PHONE)}</b><br>vagy írj: <a href="mailto:${esc(TEAM_EMAIL)}" style="color:#F2C230">${esc(TEAM_EMAIL)}</a></p>
<p style="margin:0 0 6px"><a href="${SITE_URL}/#/foglalasaim" style="display:inline-block;background:#F2C230;color:#0f1633;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Foglalásaim</a></p>
<p style="margin:22px 0 0;font-size:13px;color:#b7bdd6">Üres Kézzel csapat · <a href="https://www.instagram.com/ures.kezzel/" style="color:#b7bdd6">Instagram</a></p>
</td></tr></table></td></tr></table></body></html>`;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, // a Supabase Edge a 25-ös és 587-es portot tiltja
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transport.sendMail({
      from: `"Üres Kézzel" <${SMTP_USER}>`,
      replyTo: TEAM_EMAIL,
      to,
      subject: `Előfoglalás visszaigazolása – ${b.festival}, ${pkgName}`,
      text,
      html,
    });
  } catch (e) {
    // sikertelen küldés: visszaengedjük, hogy újra lehessen próbálni
    await sb.from("bookings").update({ confirmation_sent_at: null }).eq("id", id);
    console.error("smtp error", e);
    return json({ error: "smtp", message: String((e as Error)?.message || e) }, 502);
  }
  return json({ ok: true, to_domain: to.split("@")[1] });
});
