/* Üres Kézzel – belépés, foglalás, Foglalásaim, admin (Supabase).
   Az index.html útválasztója minden oldalváltáskor "uk:route" eseményt küld, erre rajzoljuk ki a nézetet. */
(function(){
  "use strict";
  var CFG = window.UK_CONFIG || {};
  var DATA = window.UK_DATA || { FESTIVALS: [], PACKAGES: {} };
  var PKG = DATA.PACKAGES;
  var STATUS = { elofoglalas: "Előfoglalás", megerositett: "Megerősítve", lemondott: "Lemondva" };
  var BASE = location.origin + location.pathname;
  var BACK_OK = ["foglalas", "foglalasaim", "admin"];

  function $(s, r){ return (r || document).querySelector(s); }
  function $$(s, r){ return Array.from((r || document).querySelectorAll(s)); }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(s){
    try { return new Date(s).toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return s; }
  }
  function showContact(){
    var m = CFG.TEAM_EMAIL || "";
    $$(".team-contact").forEach(function(el){ el.innerHTML = '<a href="mailto:' + esc(m) + '">' + esc(m) + "</a>"; });
  }

  /* ---------- Supabase kliens ---------- */
  var sb = null;
  try {
    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      // PKCE: a megerősítő és jelszó-visszaállító link ?code=… paraméterrel jön vissza, nem #-tel,
      // így nem akad össze a hash alapú oldalakkal.
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } });
    }
  } catch (e) { console.error(e); }

  var state = { user: null, isAdmin: false, ready: false, view: null, params: new URLSearchParams(), flash: null, rows: [] };

  /* ---------- magyar hibaüzenetek ---------- */
  function huErr(err){
    var m = String((err && (err.message || err.error_description)) || err || "");
    var all = m + " " + ((err && err.code) || "");
    console.warn("Supabase hiba:", err);
    if (/Invalid login credentials/i.test(all)) return "Hibás e-mail-cím vagy jelszó.";
    if (/Email not confirmed|email_not_confirmed/i.test(all)) return "Még nem erősítetted meg az e-mail-címed. Nézd meg a postafiókod (a spam mappát is), és kattints a levélben lévő linkre.";
    if (/already registered|already been registered|user_already_exists/i.test(all)) return "Ezzel az e-mail-címmel már regisztráltak. Lépj be, vagy kérj új jelszót.";
    if (/same_password|should be different/i.test(all)) return "Az új jelszó nem lehet ugyanaz, mint a régi.";
    if (/Password should|weak_password/i.test(all)) return "A jelszó túl rövid vagy túl gyenge. Legalább 8 karakter legyen.";
    if (/rate limit|security purposes|too many/i.test(all)) return "Túl sok próbálkozás rövid idő alatt. Várj pár percet, és próbáld újra.";
    if (/invalid format|validate email|email_address_invalid/i.test(all)) return "Ez az e-mail-cím nem tűnik érvényesnek.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(all)) return "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot, és próbáld újra.";
    if (/JWT|session missing|not authenticated/i.test(all)) return "Lejárt a belépésed. Lépj be újra.";
    if (/row-level security|permission denied/i.test(all)) return "Ehhez nincs jogosultságod.";
    return "Valami hiba történt, próbáld újra később. (" + m + ")";
  }

  function say(el, text, kind){
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg " + (kind || "err");
    el.hidden = !text;
  }
  async function busy(btn, fn){
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "Pillanat…";
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  /* ---------- belépési állapot ---------- */
  async function checkAdmin(){
    state.isAdmin = false;
    if (!state.user) return;
    var r = await sb.from("admins").select("user_id").eq("user_id", state.user.id).maybeSingle();
    state.isAdmin = !r.error && !!r.data;
  }
  function updateNav(){
    var inn = !!state.user;
    $$('[data-auth="out"]').forEach(function(el){ el.hidden = inn; });
    $$('[data-auth="in"]').forEach(function(el){ el.hidden = !inn; });
    $$('[data-auth="admin"]').forEach(function(el){ el.hidden = !state.isAdmin; });
  }
  async function setUser(session){
    state.user = (session && session.user) || null;
    await checkAdmin();
    updateNav();
  }
  function go(hash){ if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------- nézetek ---------- */
  function viewEl(v){ return $('.view[data-view="' + v + '"]'); }
  function showBody(v){
    var el = viewEl(v);
    $$("[data-loading]", el).forEach(function(x){ x.hidden = true; });
    $$("[data-body]", el).forEach(function(x){ x.hidden = false; });
    return el;
  }
  function takeFlash(v){
    if (state.flash && state.flash.view === v){ var f = state.flash; state.flash = null; return f; }
    return null;
  }

  // Csak belépve elérhető oldalak. Kijelentkezve a belépésre visz, utána ide vissza.
  function guard(){
    var el = viewEl(state.view);
    if (!sb){
      $$("[data-loading]", el).forEach(function(x){ x.textContent = "A foglalási rendszer most nem érhető el. Próbáld újra később."; });
      return false;
    }
    if (!state.ready) return false;
    if (!state.user){
      var p = new URLSearchParams(state.params);
      p.set("vissza", state.view);
      location.replace("#/belepes?" + p.toString());
      return false;
    }
    return true;
  }

  function render(){
    switch (state.view){
      case "belepes": return showLogin();
      case "foglalas": return guard() && showBooking();
      case "foglalasaim": return guard() && showMine();
      case "admin": return guard() && showAdmin();
      case "uj-jelszo": return showNewPassword();
      case "adatkezeles": return showPrivacy();
    }
  }

  /* ---------- Belépés / Regisztráció ---------- */
  function setTab(tab){
    $$(".tabs [data-tab]").forEach(function(b){ b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab)); });
    $("#form-login").hidden = tab !== "login";
    $("#form-signup").hidden = tab !== "signup";
    $("#form-reset").hidden = tab !== "reset";
    $(".tabs").hidden = tab === "reset";
  }
  function afterLogin(){
    var p = new URLSearchParams(state.params);
    var back = p.get("vissza");
    if (BACK_OK.indexOf(back) < 0) back = "foglalas";
    p.delete("vissza"); p.delete("tab");
    var qs = p.toString();
    location.replace("#/" + back + (qs ? "?" + qs : ""));
  }
  function showLogin(){
    if (state.ready && state.user) return afterLogin();
    var tab = state.params.get("tab");
    setTab(tab === "signup" || tab === "reset" ? tab : "login");
    ["#login-msg", "#signup-msg", "#reset-msg"].forEach(function(s){ say($(s), ""); });
    var f = takeFlash("belepes");
    if (f) say($("#login-msg"), f.text, f.kind);
    else if (state.params.get("vissza") === "foglalas") say($("#login-msg"), "A foglaláshoz lépj be, vagy regisztrálj. Egy perc az egész.", "ok");
    if (!sb) say($("#login-msg"), "A belépés most nem érhető el. Próbáld újra később.");
  }

  $$(".tabs [data-tab]").forEach(function(b){ b.addEventListener("click", function(){ setTab(b.getAttribute("data-tab")); }); });
  $("#to-reset").addEventListener("click", function(){
    $("#reset-email").value = $("#login-email").value;
    setTab("reset"); $("#reset-email").focus();
  });
  $("#back-login").addEventListener("click", function(){ setTab("login"); });

  $("#form-login").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#login-msg"); say(msg, "");
    if (!sb) return say(msg, "A belépés most nem érhető el.");
    busy($("#form-login button[type=submit]"), async function(){
      var r = await sb.auth.signInWithPassword({ email: $("#login-email").value.trim(), password: $("#login-password").value });
      if (r.error) return say(msg, huErr(r.error));
      $("#login-password").value = "";
      await setUser(r.data.session);
      afterLogin();
    });
  });

  $("#form-signup").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#signup-msg"); say(msg, "");
    if (!sb) return say(msg, "A regisztráció most nem érhető el.");
    var name = $("#signup-name").value.trim();
    var email = $("#signup-email").value.trim();
    if (name.length < 2) return say(msg, "Add meg a teljes neved.");
    if (!$("#signup-consent").checked) return say(msg, "A regisztrációhoz el kell fogadnod az adatkezelési tájékoztatót, és be kell töltened a 18. életévedet.");
    busy($("#form-signup button[type=submit]"), async function(){
      var r = await sb.auth.signUp({
        email: email,
        password: $("#signup-password").value,
        options: { data: { full_name: name }, emailRedirectTo: BASE + "?megerositve=1" }
      });
      if (r.error) return say(msg, huErr(r.error));
      // Ha a cím már foglalt, a Supabase nem ad hibát, csak egy üres "identities" listát.
      if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0)
        return say(msg, "Ezzel az e-mail-címmel már regisztráltak. Lépj be, vagy kérj új jelszót.");
      if (r.data.session){ await setUser(r.data.session); return afterLogin(); }
      $("#form-signup").reset();
      say(msg, "Küldtünk egy megerősítő e-mailt ide: " + email + ". Kattints a levélben lévő linkre, utána be tudsz lépni. Ha nem jön meg pár percen belül, nézd meg a spam mappát is.", "ok");
    });
  });

  $("#form-reset").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#reset-msg"); say(msg, "");
    if (!sb) return say(msg, "A jelszó-visszaállítás most nem érhető el.");
    busy($("#form-reset button[type=submit]"), async function(){
      var r = await sb.auth.resetPasswordForEmail($("#reset-email").value.trim(), { redirectTo: BASE + "?uj-jelszo=1" });
      if (r.error) return say(msg, huErr(r.error));
      say(msg, "Ha van ilyen címmel fiók, küldtünk rá egy levelet a jelszó visszaállításához. Nyisd meg ugyanebben a böngészőben.", "ok");
    });
  });

  /* ---------- Új jelszó (a visszaállító linkről) ---------- */
  function showNewPassword(){
    if (!state.ready) return;
    showBody("uj-jelszo");
    say($("#newpw-msg"), state.user ? "" : "A link lejárt, vagy másik böngészőben nyitottad meg. Kérj új linket a belépésnél az „Elfelejtett jelszó” gombbal.");
    $("#form-newpw").hidden = !state.user;
  }
  $("#form-newpw").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#newpw-msg"); say(msg, "");
    var a = $("#newpw").value, b = $("#newpw2").value;
    if (a !== b) return say(msg, "A két jelszó nem egyezik.");
    busy($("#form-newpw button[type=submit]"), async function(){
      var r = await sb.auth.updateUser({ password: a });
      if (r.error) return say(msg, huErr(r.error));
      $("#form-newpw").reset();
      state.flash = { view: "foglalasaim", text: "Az új jelszavad el van mentve.", kind: "ok" };
      go("#/foglalasaim");
    });
  });

  /* ---------- Foglalás ---------- */
  (function buildBookingForm(){
    $("#bk-festival").innerHTML = '<option value="">Válassz fesztivált…</option>' +
      DATA.FESTIVALS.map(function(f){ return '<option value="' + esc(f.name) + '">' + esc(f.name) + "</option>"; }).join("");
    $("#bk-packages").insertAdjacentHTML("beforeend", Object.keys(PKG).map(function(k){
      var p = PKG[k];
      return '<div><input type="radio" name="package" id="pkg-' + k + '" value="' + k + '" required>' +
        '<label for="pkg-' + k + '"><b>' + esc(p.name.replace(" Pack", "")) + "</b><span>" + p.people + " fő · " + esc(p.price) + "</span></label></div>";
    }).join(""));
  })();

  function pickPackage(k){
    var r = $("#pkg-" + k);
    if (!r) return;
    r.checked = true;
  }
  function showBooking(){
    showBody("foglalas");
    $("#bk-done").hidden = true;
    $("#form-booking").hidden = false;
    say($("#bk-msg"), "");
    var name = (state.user.user_metadata && state.user.user_metadata.full_name) || "";
    $("#bk-hello").textContent = name ? "Szia, " + name + "! Válaszd ki, hova és melyik csomagot kéred." : "Válaszd ki, hova és melyik csomagot kéred.";
    $("#bk-name-field").hidden = !!name;
    $("#bk-name").required = !name;
    var k = state.params.get("csomag");
    if (k && PKG[k]) pickPackage(k);
    else if (!$('#bk-packages input:checked')) pickPackage("duo");
  }
  $("#form-booking").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#bk-msg"); say(msg, "");
    var meta = state.user.user_metadata || {};
    var name = (meta.full_name || $("#bk-name").value).trim();
    var festival = $("#bk-festival").value;
    var pkgEl = $('#bk-packages input:checked');
    if (name.length < 2) return say(msg, "Add meg a teljes neved.");
    if (!festival) return say(msg, "Válassz fesztivált.");
    if (!pkgEl) return say(msg, "Válassz csomagot.");
    busy($("#form-booking button[type=submit]"), async function(){
      var r = await sb.from("bookings")
        .insert({ user_id: state.user.id, full_name: name, festival: festival, package: pkgEl.value, people: PKG[pkgEl.value].people })
        .select().single();
      if (r.error) return say(msg, huErr(r.error));
      var b = r.data;
      $("#bk-summary").innerHTML = "<b>" + esc(b.festival) + "</b><br>" + esc(PKG[b.package].name) + " · " + b.people + " fő · " + esc(PKG[b.package].price);
      showContact();
      $("#form-booking").hidden = true;
      $("#bk-done").hidden = false;
      $("#bk-done h2").focus();
    });
  });

  /* ---------- Foglalásaim ---------- */
  async function showMine(){
    var el = showBody("foglalasaim");
    showContact();
    var f = takeFlash("foglalasaim");
    say($("#mine-msg"), f ? f.text : "", f ? f.kind : "err");
    var list = $("#mine-list", el);
    list.innerHTML = '<li class="muted">Betöltés…</li>';
    var r = await sb.from("bookings").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false });
    if (r.error){ list.innerHTML = ""; return say($("#mine-msg"), huErr(r.error)); }
    if (!r.data.length){
      list.innerHTML = '<li class="empty">Még nincs foglalásod. <a href="#/foglalas">Foglalj most</a>, egy perc az egész.</li>';
      return;
    }
    list.innerHTML = r.data.map(function(b){
      var p = PKG[b.package] || { name: b.package, price: "" };
      return '<li class="bk">' +
        "<div><b>" + esc(b.festival) + '</b><span class="meta">' + esc(p.name) + " · " + b.people + " fő · " + esc(p.price) +
        "<br>Leadva: " + esc(fmtDate(b.created_at)) + "</span></div>" +
        '<div class="bk-side"><span class="badge ' + esc(b.status) + '">' + esc(STATUS[b.status] || b.status) + "</span>" +
        (b.status !== "lemondott" ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel="' + esc(b.id) + '">Lemondás</button>' : "") +
        "</div></li>";
    }).join("");
  }
  $("#mine-list").addEventListener("click", function(e){
    var btn = e.target.closest("[data-cancel]");
    if (!btn) return;
    if (!confirm("Biztosan lemondod ezt a foglalást?")) return;
    busy(btn, async function(){
      var r = await sb.rpc("cancel_booking", { b: btn.getAttribute("data-cancel") });
      if (r.error) return say($("#mine-msg"), huErr(r.error));
      state.flash = { view: "foglalasaim", text: "A foglalást lemondtad.", kind: "ok" };
      showMine();
    });
  });
  $("#delete-account").addEventListener("click", function(){
    if (!confirm("Biztosan törlöd a fiókodat? Ezzel az összes foglalásod is törlődik, és ez nem vonható vissza.")) return;
    busy($("#delete-account"), async function(){
      var r = await sb.rpc("delete_my_account");
      if (r.error) return say($("#mine-msg"), huErr(r.error));
      await sb.auth.signOut({ scope: "local" });
      await setUser(null);
      alert("A fiókodat és az összes foglalásodat töröltük.");
      go("#/");
    });
  });

  /* ---------- Admin ---------- */
  async function showAdmin(){
    var el = showBody("admin");
    $("#admin-denied").hidden = state.isAdmin;
    $("#admin-panel").hidden = !state.isAdmin;
    if (!state.isAdmin) return;
    say($("#admin-msg"), "");
    $("#admin-count").textContent = "Betöltés…";
    var r = await sb.from("bookings").select("*").order("created_at", { ascending: false });
    if (r.error){ $("#admin-count").textContent = ""; return say($("#admin-msg"), huErr(r.error)); }
    state.rows = r.data;
    var sel = $("#admin-filter"), keep = sel.value;
    sel.innerHTML = '<option value="">Minden fesztivál</option>' + festivalNames().map(function(n){
      return '<option value="' + esc(n) + '">' + esc(n) + "</option>";
    }).join("");
    sel.value = keep;
    renderAdmin();
  }
  // A közös lista, plusz ami a foglalásokban szerepel, de már nincs a listában.
  function festivalNames(){
    var names = DATA.FESTIVALS.map(function(f){ return f.name; });
    state.rows.forEach(function(b){ if (names.indexOf(b.festival) < 0) names.push(b.festival); });
    return names;
  }
  function filteredRows(){
    var f = $("#admin-filter").value;
    return f ? state.rows.filter(function(b){ return b.festival === f; }) : state.rows;
  }
  function renderAdmin(){
    var rows = filteredRows();
    var active = rows.filter(function(b){ return b.status !== "lemondott"; });
    $("#admin-count").textContent = rows.length + " foglalás, ebből " + active.length + " aktív (" +
      active.reduce(function(s, b){ return s + b.people; }, 0) + " fő)";

    // összesítő: fesztivál × csomag, lemondott nélkül
    var keys = Object.keys(PKG);
    var fests = $("#admin-filter").value ? [$("#admin-filter").value] : festivalNames();
    var tot = {}; keys.forEach(function(k){ tot[k] = 0; });
    var body = fests.map(function(fn){
      var sum = 0;
      var cells = keys.map(function(k){
        var n = active.filter(function(b){ return b.festival === fn && b.package === k; }).length;
        tot[k] += n; sum += n;
        return "<td>" + (n || '<span class="muted">0</span>') + "</td>";
      }).join("");
      return "<tr><td>" + esc(fn) + "</td>" + cells + "<td><b>" + sum + "</b></td></tr>";
    }).join("");
    var grand = keys.reduce(function(s, k){ return s + tot[k]; }, 0);
    $("#admin-summary").innerHTML =
      "<thead><tr><th>Fesztivál</th>" + keys.map(function(k){ return "<th>" + esc(PKG[k].name) + "</th>"; }).join("") + "<th>Összesen</th></tr></thead>" +
      "<tbody>" + body + '<tr class="total"><td>Összesen</td>' + keys.map(function(k){ return "<td>" + tot[k] + "</td>"; }).join("") + "<td>" + grand + "</td></tr></tbody>";

    $("#admin-table tbody").innerHTML = rows.length ? rows.map(function(b){
      var opts = Object.keys(STATUS).map(function(s){
        return '<option value="' + s + '"' + (s === b.status ? " selected" : "") + ">" + STATUS[s] + "</option>";
      }).join("");
      return "<tr><td>" + esc(fmtDate(b.created_at)) + "</td><td>" + esc(b.full_name) + "</td><td>" + esc(b.festival) + "</td><td>" +
        esc((PKG[b.package] || {}).name || b.package) + '</td><td><select data-status="' + esc(b.id) + '" aria-label="Állapot">' + opts + "</select></td></tr>";
    }).join("") : '<tr><td colspan="5" class="muted">Nincs foglalás.</td></tr>';
  }
  $("#admin-filter").addEventListener("change", renderAdmin);
  $("#admin-reload").addEventListener("click", showAdmin);
  $("#admin-table").addEventListener("change", async function(e){
    var sel = e.target.closest("[data-status]");
    if (!sel) return;
    var id = sel.getAttribute("data-status"), row = state.rows.find(function(b){ return b.id === id; });
    sel.disabled = true;
    var r = await sb.from("bookings").update({ status: sel.value }).eq("id", id).select();
    sel.disabled = false;
    if (r.error || !r.data.length){
      sel.value = row.status;
      return say($("#admin-msg"), r.error ? huErr(r.error) : "Nem sikerült menteni (nincs jogosultság?).");
    }
    row.status = sel.value;
    say($("#admin-msg"), "");
    renderAdmin();
  });
  $("#admin-csv").addEventListener("click", function(){
    var head = ["Leadva", "Név", "Fesztivál", "Csomag", "Fő", "Állapot", "Azonosító"];
    var lines = [head].concat(filteredRows().map(function(b){
      return [fmtDate(b.created_at), b.full_name, b.festival, (PKG[b.package] || {}).name || b.package, b.people, STATUS[b.status] || b.status, b.id];
    })).map(function(r){
      return r.map(function(v){
        v = String(v);
        if (/^[=+\-@]/.test(v)) v = "'" + v; // ne fusson képletként Excelben
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(";");
    });
    // BOM + pontosvessző, hogy a magyar Excel jól nyissa meg
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "foglalasok-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---------- Adatkezelési tájékoztató (docs/adatkezeles.md) ---------- */
  var privacyLoaded = false;
  function loadScript(src){
    return new Promise(function(ok, fail){
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  async function showPrivacy(){
    if (privacyLoaded) return;
    var box = $("#privacy");
    try {
      var res = await fetch("docs/adatkezeles.md", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      var md = await res.text();
      if (!window.marked) await loadScript("https://cdn.jsdelivr.net/npm/marked@12/marked.min.js");
      box.innerHTML = window.marked.parse(md);
      privacyLoaded = true;
    } catch (e) {
      box.innerHTML = '<p>A tájékoztató most nem tölthető be. <a href="docs/adatkezeles.md">Megnyitás szövegként</a></p>';
    }
  }

  /* ---------- kijelentkezés ---------- */
  $("#logout").addEventListener("click", async function(){
    if (sb) await sb.auth.signOut();
    await setUser(null);
    go("#/");
  });

  /* ---------- indulás ---------- */
  window.addEventListener("uk:route", function(e){
    state.view = e.detail.view;
    state.params = e.detail.params;
    render();
  });

  async function init(){
    if (!sb){ state.ready = true; render(); return; }
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
    var linkError = q.get("error_description") || h.get("error_description");
    var fromLink = q.has("code") || q.has("megerositve") || q.has("uj-jelszo") || !!linkError;

    var s = await sb.auth.getSession(); // ez cseréli be a ?code=… paramétert is belépésre
    await setUser(s.data.session);
    state.ready = true;

    sb.auth.onAuthStateChange(function(event, session){
      // a callbackben ne hívjunk közvetlenül Supabase-t (holtpont), ezért setTimeout
      setTimeout(async function(){
        if (event === "PASSWORD_RECOVERY"){ await setUser(session); return go("#/uj-jelszo"); }
        if (event === "SIGNED_OUT" || (session && (!state.user || session.user.id !== state.user.id))){
          await setUser(session); render();
        } else if (session) state.user = session.user;
      }, 0);
    });

    if (fromLink){
      var target = "#/belepes";
      if (linkError) state.flash = { view: "belepes", text: "A link lejárt, vagy már felhasználták. Lépj be, vagy kérj új linket.", kind: "err" };
      else if (q.has("uj-jelszo")) target = "#/uj-jelszo";
      else if (state.user){ target = "#/foglalas"; }
      else state.flash = { view: "belepes", text: "Az e-mail-címed meg van erősítve. Most már be tudsz lépni.", kind: "ok" };
      history.replaceState(null, "", location.pathname);
      go(target);
    } else render();
  }
  init().catch(function(e){ console.error(e); state.ready = true; render(); });
})();
