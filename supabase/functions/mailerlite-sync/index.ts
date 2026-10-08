// Hírlevél-feliratkozók szinkronizálása a MailerLite-tal.
// - Belépett vásárló hívja: csak a saját feliratkozását szinkronizálja (Fiókom / belépés után).
// - Admin hívja { all: true }-val: mindenkit szinkronizál (admin oldal gomb).
// A MailerLite API-kulcs a Supabase titkos tárolójában van (MAILERLITE_API_KEY), sosem kerül a böngészőbe.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ML = "https://connect.mailerlite.com/api";
const GROUP_ID = Deno.env.get("MAILERLITE_GROUP_ID") ?? "200797913882822459";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("MAILERLITE_API_KEY");
  if (!key) return json({ error: "missing_key" }, 500);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth?.user) return json({ error: "unauthorized" }, 401);
  const me = auth.user;
  const body = await req.json().catch(() => ({}));

  // kiket szinkronizálunk
  let users = [me];
  if (body?.all) {
    const { data: adm } = await db.from("admins").select("user_id").eq("user_id", me.id).maybeSingle();
    if (!adm) return json({ error: "forbidden" }, 403);
    users = [];
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: error.message }, 500);
      users.push(...data.users);
      if (data.users.length < 1000) break;
    }
  }

  const ml = (path: string, init: RequestInit = {}) =>
    fetch(ML + path, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    });

  let subscribed = 0, unsubscribed = 0, skipped = 0;
  const failed: string[] = [];
  for (const u of users) {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    if (!u.email || !u.email_confirmed_at || typeof meta.newsletter !== "boolean") { skipped++; continue; }
    try {
      if (meta.newsletter) {
        // létrehozza vagy frissíti; aki a MailerLite-ban leiratkozott, azt NEM iratkoztatja vissza
        const r = await ml("/subscribers", {
          method: "POST",
          body: JSON.stringify({ email: u.email, fields: { name: meta.full_name ?? "" }, groups: [GROUP_ID] }),
        });
        if (!r.ok) throw new Error(String(r.status));
        subscribed++;
      } else {
        // a weboldalon leiratkozott: a MailerLite-ban is leiratkoztatjuk, ha ott aktív
        const r = await ml("/subscribers/" + encodeURIComponent(u.email));
        if (r.status === 404) { skipped++; continue; }
        if (!r.ok) throw new Error(String(r.status));
        const s = (await r.json()).data;
        if (s.status === "active") {
          const p = await ml("/subscribers/" + s.id, { method: "PUT", body: JSON.stringify({ status: "unsubscribed" }) });
          if (!p.ok) throw new Error(String(p.status));
          unsubscribed++;
        } else skipped++;
      }
    } catch (e) {
      failed.push(u.email + " (" + (e as Error).message + ")");
    }
  }
  return json({ subscribed, unsubscribed, skipped, failed });
});
