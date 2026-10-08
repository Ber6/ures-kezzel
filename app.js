/* Üres Kézzel – belépés, foglalás, Foglalásaim, admin (Supabase).
   Az index.html útválasztója minden oldalváltáskor "uk:route" eseményt küld, erre rajzoljuk ki a nézetet. */
(function(){
  "use strict";
  var CFG = window.UK_CONFIG || {};
  var DATA = window.UK_DATA || { FESTIVALS: [], PACKAGES: {} };
  var PKG = DATA.PACKAGES;   // kulcs → csomag; a Supabase-ből betöltve felülíródik
  DATA.SETTINGS = DATA.SETTINGS || {};
  var STATUS = { elofoglalas: "Előfoglalás", megerositett: "Megerősítve", lemondott: "Lemondva" };
  var BASE = location.origin + location.pathname;
  var BACK_OK = ["foglalas", "foglalasaim", "fiokom", "admin"];

  function $(s, r){ return (r || document).querySelector(s); }
  function $$(s, r){ return Array.from((r || document).querySelectorAll(s)); }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtFt(n){ return Number(n || 0).toLocaleString("hu-HU").replace(/\s/g, "\u00a0") + "\u00a0Ft"; }
  function activePkgKeys(){
    return Object.keys(PKG).filter(function(k){ return PKG[k].active !== false; })
      .sort(function(a, b){ return (PKG[a].sort || 0) - (PKG[b].sort || 0); });
  }
  // akciós ár: a leárazás után 100 Ft-ra kerekítve (ugyanígy számol az adatbázis is: pkg_price)
  function effPrice(p){ return Math.round(p.price * (100 - (p.discount || 0)) / 100 / 100) * 100; }
  function priceHtml(p){
    return p.discount ? "<s>" + fmtFt(p.price) + "</s>" + fmtFt(effPrice(p)) : fmtFt(p.price);
  }
  function activeFestivals(){ return DATA.FESTIVALS.filter(function(f){ return f.active !== false; }); }
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

  // status: a vásárló kauciója és hogy foglalhat-e (az adatbázis számolja: my_status)
  var state = { user: null, isAdmin: false, ready: false, view: null, params: new URLSearchParams(), flash: null, rows: [], status: null };

  /* ---------- magyar hibaüzenetek ---------- */
  function huErr(err){
    var m = String((err && (err.message || err.error_description)) || err || "");
    var all = m + " " + ((err && err.code) || "");
    console.warn("Supabase hiba:", err);
    if (/Invalid login credentials/i.test(all)) return "Hibás e-mail-cím vagy jelszó.";
    if (/Email not confirmed|email_not_confirmed/i.test(all)) return "Még nem erősítetted meg az e-mail-címed. Nézd meg a postafiókod (a spam mappát is), és kattints a levélben lévő linkre.";
    if (/email_exists/i.test(all)) return "Ezzel az e-mail-címmel már van fiók.";
    if (/already registered|already been registered|user_already_exists/i.test(all)) return "Ezzel az e-mail-címmel már regisztráltak. Lépj be, vagy kérj új jelszót.";
    if (/same_password|should be different/i.test(all)) return "Az új jelszó nem lehet ugyanaz, mint a régi.";
    if (/Password should|weak_password/i.test(all)) return "A jelszó túl rövid vagy túl gyenge. Legalább 8 karakter legyen.";
    if (/rate limit|security purposes|too many/i.test(all)) return "Túl sok próbálkozás rövid idő alatt. Várj pár percet, és próbáld újra.";
    if (/invalid format|validate email|email_address_invalid/i.test(all)) return "Ez az e-mail-cím nem tűnik érvényesnek.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(all)) return "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot, és próbáld újra.";
    if (/JWT|session missing|not authenticated/i.test(all)) return "Lejárt a belépésed. Lépj be újra.";
    if (/sold_out/i.test(all)) return "Sajnos ez a csomag jelenleg elfogyott.";
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
  async function loadStatus(){
    state.status = null;
    if (!state.user) return;
    var r = await sb.rpc("my_status");
    if (!r.error) state.status = r.data;
  }
  async function setUser(session){
    state.user = (session && session.user) || null;
    await Promise.all([checkAdmin(), loadStatus()]);
    updateNav();
    renderPublic();
  }
  function blocked(){ return !!(state.status && state.status.blocked); }
  function go(hash){ if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------- nézetek ---------- */
  function viewEl(v){ return $('.view[data-view="' + v + '"]'); }
  function showBody(v){
    var el = viewEl(v);
    $$("[data-loading]", el).forEach(function(x){ x.hidden = true; });
    $$("[data-body]", el).forEach(function(x){ x.hidden = false; });
    return el;
  }
  // Az üzenet addig marad, amíg a felhasználó másik oldalra nem lép (egy oldal többször is kirajzolódhat).
  function takeFlash(v){
    return state.flash && state.flash.view === v ? state.flash : null;
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
      case "fiokom": return guard() && showAccount();
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
        options: { data: newsletterData(name, $("#signup-newsletter").checked), emailRedirectTo: BASE + "?megerositve=1" }
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

  function newsletterData(name, on){
    var d = { newsletter: on, newsletter_at: on ? new Date().toISOString() : null };
    if (name) d.full_name = name;
    return d;
  }
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

  /* ---------- Nyilvános tartalom: csomagkártyák, fesztiválok, beállítások ---------- */
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  function renderPublic(){
    var cards = activePkgKeys().map(function(k){
      var p = PKG[k];
      return '<article class="plan' + (p.featured ? " featured" : "") + '">' +
        (p.featured ? '<span class="tag">A legnépszerűbb</span>' : "") +
        (p.discount ? '<span class="sale" aria-label="' + p.discount + ' százalék kedvezmény">−' + p.discount + "%</span>" : "") +
        "<h3>" + esc(p.name) + '</h3><p class="who">' + p.people + ' főre</p><div class="price">' + priceHtml(p) +
        '</div><p class="per">egy teljes fesztiválra</p><ul>' +
        (p.items || []).map(function(it){ return "<li>" + CHECK + esc(it) + "</li>"; }).join("") +
        '</ul>' + (blocked()
          ? '<span class="btn soldout' + (p.featured ? "" : " btn-ghost") + '" aria-disabled="true">Elfogyott</span>'
          : '<a class="btn' + (p.featured ? "" : " btn-ghost") + '" href="#/foglalas?csomag=' + encodeURIComponent(k) + '">Ezt kérem</a>') + "</article>";
    }).join("");
    $$(".plans").forEach(function(el){ el.innerHTML = cards; });

    var fests = activeFestivals();
    var list = $(".fest-list");
    if (list) list.innerHTML = fests.map(function(f){
      var where = [f.location, f.dates].filter(Boolean).join(", ");
      return "<li><div><b>" + esc(f.name) + '</b><span class="where">' + esc(where) + '</span></div><span class="chip">' + esc(f.status || "Tervezett") + "</span></li>";
    }).join("");
    var chips = $("#fest-chips");
    if (chips) chips.innerHTML = fests.slice(0, 4).map(function(f){ return '<span class="chip">' + esc(f.name) + "</span>"; }).join("") +
      (fests.length > 4 ? '<span class="chip">és még több</span>' : "");

    applySettings();
    buildBookingForm();
  }
  // a beállítások (kaució stb.) beírása a [data-setting] elemekbe; az index.html is hívja, ha új ilyen elemet rajzol
  function settingFt(k){ return parseInt(String(DATA.SETTINGS[k] || "").replace(/\D/g, ""), 10) || 0; }
  function applySettings(){
    $$("[data-setting]").forEach(function(el){
      var k = el.getAttribute("data-setting"), v = DATA.SETTINGS[k];
      if (v == null || v === "") return;
      el.textContent = /^kaucio/.test(k) ? fmtFt(settingFt(k)) : v;
    });
  }
  window.UK_applySettings = applySettings;

  // Az élő adatok betöltése az adatbázisból (bárki olvashatja őket)
  async function loadContent(){
    if (!sb) return;
    var r = await Promise.all([
      sb.from("packages").select("*").order("sort"),
      sb.from("festivals").select("*").order("sort"),
      sb.from("settings").select("*")
    ]);
    if (r[0].error || r[1].error || r[2].error) return console.warn("Tartalom betöltése nem sikerült", r);
    var pk = {};
    r[0].data.forEach(function(p){ pk[p.key] = p; });
    if (r[0].data.length) PKG = DATA.PACKAGES = pk;
    if (r[1].data.length) DATA.FESTIVALS = r[1].data;
    r[2].data.forEach(function(x){ DATA.SETTINGS[x.key] = x.value; });
    renderPublic();
  }
  renderPublic();

  /* ---------- Foglalás ---------- */
  function buildBookingForm(){
    var selF = $("#bk-festival").value, selP = $("#bk-packages input:checked");
    selP = selP && selP.value;
    $("#bk-festival").innerHTML = '<option value="">Válassz fesztivált…</option>' +
      activeFestivals().map(function(f){ return '<option value="' + esc(f.name) + '">' + esc(f.name) + "</option>"; }).join("");
    $("#bk-festival").value = selF;
    $$("#bk-packages > div").forEach(function(d){ d.remove(); });
    $("#bk-packages").insertAdjacentHTML("beforeend", activePkgKeys().map(function(k){
      var p = PKG[k];
      return '<div><input type="radio" name="package" id="pkg-' + esc(k) + '" value="' + esc(k) + '" required>' +
        '<label for="pkg-' + esc(k) + '"><b>' + esc(p.name.replace(/ Pack$/, "")) + "</b><span>" +
        (blocked() ? "Elfogyott" : p.people + " fő · " + (p.discount ? '<span class="was">' + fmtFt(p.price) + "</span>" + fmtFt(effPrice(p)) +
          '<span class="off">−' + p.discount + "%</span>" : fmtFt(p.price))) + "</span></label></div>";
    }).join(""));
    $$("#bk-packages input").forEach(function(i){ i.disabled = blocked(); });
    $("#form-booking button[type=submit]").disabled = blocked();
    if (selP && !blocked()) pickPackage(selP);
  }

  function pickPackage(k){
    var r = $("#pkg-" + k);
    if (!r) return;
    r.checked = true;
  }
  // Lezáratlan (még nem leadott, probléma nélküli, nem lemondott) foglalások: ezek kimenetele még módosíthatja a kauciót.
  function openBookings(list, exceptId, before){
    return list.filter(function(o){
      return o.id !== exceptId && o.status !== "lemondott" && !o.returned_at && !o.return_problem &&
        (!before || o.created_at < before);
    });
  }
  function provisionalNote(deposit, others){
    if (!others.length) return "";
    var names = Array.from(new Set(others.map(function(o){ return o.festival; }))).join(", ");
    var reg = settingFt("kaucio"), high = settingFt("kaucio_elso");
    return "A kaució még nem végleges, mert a(z) " + names + " foglalásod még nincs lezárva (a csomagot még nem adtad le). " +
      (deposit > reg && reg ? "Ha azt mindennel együtt, rendben visszahozod, itt " + fmtFt(reg) + " lesz a kaució."
        : "Ha annál a visszahozással probléma lesz, itt " + fmtFt(high) + "-ra nőhet a kaució.");
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
    buildBookingForm();
    var dep = $("#bk-deposit");
    dep.hidden = blocked() || !state.status;
    var depText = state.status ? "Kaució: " + fmtFt(state.status.deposit) + ". Átvételkor kell kifizetni, és a leadás után visszajár." +
      (state.status.deposit > settingFt("kaucio") && settingFt("kaucio") ? " Ha mindent rendben visszahozol, legközelebb csak " + fmtFt(settingFt("kaucio")) + "." : "") : "";
    dep.textContent = depText;
    if (state.status && !blocked()){
      sb.from("bookings").select("id,festival,status,returned_at,return_problem,created_at").eq("user_id", state.user.id).then(function(r){
        if (r.error) return;
        state.ownBookings = r.data;
        var note = provisionalNote(state.status.deposit, openBookings(r.data));
        if (note) dep.textContent = "Kaució: " + fmtFt(state.status.deposit) + ", átvételkor kell kifizetni, és a leadás után visszajár. " + note;
      });
    }
    if (blocked()) return say($("#bk-msg"), "Sajnos jelenleg minden csomagunk elfogyott.");
    var k = state.params.get("csomag");
    if (k && PKG[k]) pickPackage(k);
    else if (!$('#bk-packages input:checked')){
      var keys = activePkgKeys(), feat = keys.filter(function(x){ return PKG[x].featured; })[0];
      if (keys.length) pickPackage(feat || keys[0]);
    }
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
      var note = provisionalNote(b.deposit, openBookings(state.ownBookings || [], b.id));
      $("#bk-summary").innerHTML = "<b>" + esc(b.festival) + "</b><br>" + esc(PKG[b.package].name) + " · " + b.people + " fő · " +
        fmtFt(b.price != null ? b.price : effPrice(PKG[b.package])) +
        (b.deposit ? "<br>Kaució: " + fmtFt(b.deposit) + " (átvételkor, a leadás után visszajár)" : "") +
        (note ? '<span class="prov">' + esc(note) + "</span>" : "");
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
      var p = PKG[b.package] || { name: b.package };
      var price = b.price != null ? b.price : (p.price != null ? p.price : null);
      var note = !b.picked_up_at && b.status !== "lemondott" ? provisionalNote(b.deposit, openBookings(r.data, b.id, b.created_at)) : "";
      return '<li class="bk">' +
        "<div><b>" + esc(b.festival) + '</b><span class="meta">' + esc(p.name) + " · " + b.people + " fő" + (price != null ? " · " + fmtFt(price) : "") +
        "<br>Foglalva: " + esc(fmtDate(b.created_at)) + (b.deposit ? " · Kaució: " + fmtFt(b.deposit) : "") + "</span>" +
        (note ? '<span class="prov">' + esc(note) + "</span>" : "") + "</div>" +
        '<div class="bk-side">' + (b.returned_at ? '<span class="badge megerositett">Visszahozva</span>' : b.picked_up_at ? '<span class="badge elofoglalas">Átvéve</span>' : "") +
        '<span class="badge ' + esc(b.status) + '">' + esc(STATUS[b.status] || b.status) + "</span>" +
        (b.status !== "lemondott" && !b.picked_up_at ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel="' + esc(b.id) + '">Lemondás</button>' : "") +
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
      if (r.error) return say($("#acct-msg"), huErr(r.error));
      await sb.auth.signOut({ scope: "local" });
      await setUser(null);
      alert("A fiókodat és az összes foglalásodat töröltük.");
      go("#/");
    });
  });

  /* ---------- Fiókom ---------- */
  function userName(){ return (state.user.user_metadata && state.user.user_metadata.full_name) || ""; }
  async function showAccount(){
    showBody("fiokom");
    var u = state.user;
    var f = takeFlash("fiokom");
    say($("#acct-msg"), f ? f.text : "", f ? f.kind : "err");
    ["#name-msg", "#email-msg", "#pw-msg"].forEach(function(s){ say($(s), ""); });
    $("#acct-name").textContent = userName() || "–";
    $("#acct-email").textContent = u.email + (u.new_email ? " (függőben: " + u.new_email + ")" : "");
    $("#acct-created").textContent = u.created_at ? fmtDate(u.created_at) : "–";
    $("#acct-new-name").value = userName();
    $("#acct-newsletter").checked = !!(u.user_metadata && u.user_metadata.newsletter);
    say($("#nl-msg"), "");
    $("#acct-bookings").textContent = "…";
    var r = await sb.from("bookings").select("status").eq("user_id", u.id);
    if (r.error) return $("#acct-bookings").textContent = "–";
    var active = r.data.filter(function(b){ return b.status !== "lemondott"; }).length;
    $("#acct-bookings").innerHTML = r.data.length + " db (" + active + ' aktív) · <a href="#/foglalasaim">megnézem</a>';
  }
  $("#form-name").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#name-msg"), name = $("#acct-new-name").value.trim(); say(msg, "");
    if (name.length < 2) return say(msg, "Add meg a teljes neved.");
    busy($("#form-name button[type=submit]"), async function(){
      var r = await sb.auth.updateUser({ data: { full_name: name } });
      if (r.error) return say(msg, huErr(r.error));
      state.user = r.data.user;
      $("#acct-name").textContent = name;
      say(msg, "A neved el van mentve.", "ok");
    });
  });
  $("#form-newsletter").addEventListener("submit", function(e){
    e.preventDefault();
    var on = $("#acct-newsletter").checked, msg = $("#nl-msg");
    busy($("#form-newsletter button[type=submit]"), async function(){
      var r = await sb.auth.updateUser({ data: newsletterData(null, on) });
      if (r.error) return say(msg, huErr(r.error));
      state.user = r.data.user;
      say(msg, on ? "Feliratkoztál a hírlevélre." : "Leiratkoztál a hírlevélről.", "ok");
    });
  });
  $("#form-email").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#email-msg"), email = $("#acct-new-email").value.trim(); say(msg, "");
    if (email.toLowerCase() === (state.user.email || "").toLowerCase()) return say(msg, "Ez a jelenlegi e-mail-címed.");
    busy($("#form-email button[type=submit]"), async function(){
      var r = await sb.auth.updateUser({ email: email }, { emailRedirectTo: BASE + "?email-csere=1" });
      if (r.error) return say(msg, huErr(r.error));
      if (r.data && r.data.user) state.user = r.data.user;
      $("#form-email").reset();
      say(msg, "Küldtünk egy megerősítő levelet ide: " + email + ". A csere a levélben lévő linkre kattintva lép életbe. Ha a régi címedre is jön levél, azt is meg kell erősítened.", "ok");
    });
  });
  $("#form-pw").addEventListener("submit", function(e){
    e.preventDefault();
    var msg = $("#pw-msg"); say(msg, "");
    var old = $("#acct-pw-old").value, a = $("#acct-pw-new").value, b = $("#acct-pw-new2").value;
    if (a !== b) return say(msg, "A két új jelszó nem egyezik.");
    busy($("#form-pw button[type=submit]"), async function(){
      // a jelenlegi jelszó ellenőrzése: újra belépünk vele
      var chk = await sb.auth.signInWithPassword({ email: state.user.email, password: old });
      if (chk.error) return say(msg, /Invalid login credentials/i.test(chk.error.message) ? "A jelenlegi jelszó nem jó." : huErr(chk.error));
      var r = await sb.auth.updateUser({ password: a });
      if (r.error) return say(msg, huErr(r.error));
      $("#form-pw").reset();
      say(msg, "Az új jelszavad el van mentve.", "ok");
    });
  });
  $("#acct-export").addEventListener("click", function(){
    busy($("#acct-export"), async function(){
      var u = state.user;
      var r = await sb.from("bookings").select("*").eq("user_id", u.id).order("created_at", { ascending: true });
      if (r.error) return say($("#acct-msg"), huErr(r.error));
      var out = {
        letoltve: new Date().toISOString(),
        fiok: { nev: userName(), email: u.email, regisztracio: u.created_at, email_megerositve: u.email_confirmed_at || null, utolso_belepes: u.last_sign_in_at || null },
        foglalasok: r.data.map(function(b){
          return { leadva: b.created_at, fesztival: b.festival, csomag: (PKG[b.package] || {}).name || b.package, fo: b.people, allapot: STATUS[b.status] || b.status, nev_a_foglalason: b.full_name };
        })
      };
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "ures-kezzel-adataim.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    });
  });

  /* ---------- Admin ---------- */
  async function showAdmin(){
    var el = showBody("admin");
    $("#admin-denied").hidden = state.isAdmin;
    $("#admin-panel").hidden = !state.isAdmin;
    if (!state.isAdmin) return;
    say($("#admin-msg"), "");
    loadContent().then(function(){ setAdminTab(adminTab); });
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
  function downloadCsv(name, rows){
    var lines = rows.map(function(r){
      return r.map(function(v){
        v = String(v == null ? "" : v);
        if (/^[=+\-@]/.test(v)) v = "'" + v; // ne fusson képletként Excelben
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(";");
    });
    // BOM + pontosvessző, hogy a magyar Excel jól nyissa meg
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  }
  $("#admin-csv").addEventListener("click", function(){
    var head = ["Leadva", "Név", "Fesztivál", "Csomag", "Fő", "Ár", "Állapot", "Kaució", "Átvette", "Leadta", "Probléma", "Probléma leírása", "Azonosító"];
    downloadCsv("foglalasok-" + new Date().toISOString().slice(0, 10) + ".csv", [head].concat(filteredRows().map(function(b){
      return [fmtDate(b.created_at), b.full_name, b.festival, (PKG[b.package] || {}).name || b.package, b.people, b.price || "", STATUS[b.status] || b.status,
        b.deposit || "", b.picked_up_at ? fmtDate(b.picked_up_at) : "", b.returned_at ? fmtDate(b.returned_at) : "",
        b.return_problem ? "igen" : "", b.problem_note || "", b.id];
    })));
  });

  /* ---------- Admin: csomagok, fesztiválok, beállítások szerkesztése ---------- */
  var adminTab = "bookings";
  function setAdminTab(t){
    adminTab = t;
    if (t === "bookings" && state.rows.length) renderAdmin();
    $$("[data-atab]").forEach(function(b){ b.setAttribute("aria-selected", String(b.getAttribute("data-atab") === t)); });
    $$("[data-apanel]").forEach(function(p){ p.hidden = p.getAttribute("data-apanel") !== t; });
    if (t === "packages") renderPkgEditors();
    if (t === "festivals") renderFestEditors();
    if (t === "settings") fillSettings();
    if (t === "checkin") renderCheckin(true);
    if (t === "log") loadLog();
  }
  $$("[data-atab]").forEach(function(b){
    b.addEventListener("click", function(){ say($("#admin-msg"), ""); setAdminTab(b.getAttribute("data-atab")); });
  });
  function checkbox(name, label, on){
    return '<label class="check"><input type="checkbox" name="' + name + '"' + (on ? " checked" : "") + "><span>" + label + "</span></label>";
  }
  function inp(label, name, value, extra){
    return '<div class="field"><label>' + label + '<input name="' + name + '" value="' + esc(value) + '" ' + (extra || "") + "></label></div>";
  }
  function lines(t){ return t.split("\n").map(function(x){ return x.trim(); }).filter(Boolean); }
  async function afterSave(text){
    await loadContent();
    setAdminTab(adminTab);
    say($("#admin-msg"), text, "ok");
  }
  function saveErr(err){
    if (err && err.code === "23503") return "Erre már van foglalás, ezért nem törölhető. Kapcsold ki inkább (Aktív pipa).";
    if (err && err.code === "23505") return "Ilyen nevű vagy azonosítójú elem már létezik.";
    return huErr(err);
  }

  function renderPkgEditors(){
    $("#pkg-editors").innerHTML = Object.keys(PKG).sort(function(a, b){ return (PKG[a].sort || 0) - (PKG[b].sort || 0); }).map(function(k){
      var p = PKG[k];
      return '<form class="editor' + (p.active === false ? " off" : "") + '" data-pkg="' + esc(k) + '">' +
        '<div class="head"><b>' + esc(p.name) + '</b><span class="key">' + esc(k) + "</span></div>" +
        inp("Név", "name", p.name, 'required maxlength="60"') +
        '<div class="field-row">' + inp("Létszám (fő)", "people", p.people, 'type="number" min="1" max="8" required') +
        inp("Ár (Ft)", "price", p.price, 'type="number" min="0" step="100" required') +
        inp("Leárazás (%)", "discount", p.discount || 0, 'type="number" min="0" max="90"') + "</div>" +
        (p.discount ? '<p class="hint" style="margin:0">Akciós ár: ' + fmtFt(effPrice(p)) + "</p>" : "") +
        '<div class="field"><label>Tartalom (soronként egy)<textarea name="items" rows="5">' + esc((p.items || []).join("\n")) + "</textarea></label></div>" +
        inp("Sorrend", "sort", p.sort || 0, 'type="number"') +
        '<div class="checks">' + checkbox("active", "Aktív", p.active !== false) + checkbox("featured", "Legnépszerűbb", !!p.featured) + "</div>" +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" type="submit">Mentés</button>' +
        '<button class="btn btn-ghost btn-danger btn-sm" type="button" data-del>Törlés</button></div></form>';
    }).join("");
  }
  $("#pkg-editors").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target, k = f.getAttribute("data-pkg");
    var row = { name: f.elements.name.value.trim(), people: +f.elements.people.value, price: +f.elements.price.value, discount: +f.elements.discount.value || 0, items: lines(f.elements.items.value),
      sort: +f.elements.sort.value || 0, active: f.elements.active.checked, featured: f.elements.featured.checked };
    busy(f.querySelector("[type=submit]"), async function(){
      // egyszerre csak egy „legnépszerűbb” csomag legyen
      if (row.featured) await sb.from("packages").update({ featured: false }).neq("key", k);
      var r = await sb.from("packages").update(row).eq("key", k).select();
      if (r.error || !r.data.length) return say($("#admin-msg"), r.error ? saveErr(r.error) : "Nem sikerült menteni.");
      afterSave("A(z) " + row.name + " csomag el van mentve.");
    });
  });
  $("#pkg-editors").addEventListener("click", function(e){
    var b = e.target.closest("[data-del]");
    if (!b) return;
    var k = b.closest("form").getAttribute("data-pkg");
    if (!confirm("Biztosan törlöd ezt a csomagot: " + PKG[k].name + "?")) return;
    busy(b, async function(){
      var r = await sb.from("packages").delete().eq("key", k).select();
      if (r.error || !r.data.length) return say($("#admin-msg"), r.error ? saveErr(r.error) : "Nem sikerült törölni.");
      afterSave("A csomag törölve.");
    });
  });
  $("#pkg-new").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target;
    var row = { key: $("#pkg-new-key").value.trim().toLowerCase(), name: $("#pkg-new-name").value.trim(),
      people: +$("#pkg-new-people").value, price: +$("#pkg-new-price").value, discount: +$("#pkg-new-discount").value || 0, items: lines($("#pkg-new-items").value),
      sort: Object.keys(PKG).length + 1 };
    busy(f.querySelector("[type=submit]"), async function(){
      var r = await sb.from("packages").insert(row).select();
      if (r.error) return say($("#admin-msg"), saveErr(r.error));
      f.reset(); f.closest("details").open = false;
      afterSave("Az új csomag (" + row.name + ") el van mentve, és már látszik az oldalon.");
    });
  });

  function renderFestEditors(){
    $("#fest-editors").innerHTML = DATA.FESTIVALS.map(function(x){
      return '<form class="editor' + (x.active === false ? " off" : "") + '" data-fest="' + esc(x.id) + '">' +
        '<div class="head"><b>' + esc(x.name) + "</b></div>" +
        inp("Név", "name", x.name, 'required maxlength="80"') +
        '<div class="field-row">' + inp("Helyszín", "location", x.location || "", 'maxlength="80"') +
        inp("Időpont", "dates", x.dates || "", 'maxlength="60"') + "</div>" +
        '<div class="field-row">' + inp("Állapot", "status", x.status || "Tervezett", 'maxlength="30" list="fest-status"') +
        inp("Sorrend", "sort", x.sort || 0, 'type="number"') + "</div>" +
        '<div class="checks">' + checkbox("active", "Aktív", x.active !== false) + "</div>" +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" type="submit">Mentés</button>' +
        '<button class="btn btn-ghost btn-danger btn-sm" type="button" data-del>Törlés</button></div></form>';
    }).join("") + '<datalist id="fest-status"><option value="Tervezett"><option value="Megerősítve"><option value="Elmarad"></datalist>';
  }
  $("#fest-editors").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target, id = f.getAttribute("data-fest");
    var row = { name: f.elements.name.value.trim(), location: f.elements.location.value.trim(), dates: f.elements.dates.value.trim(),
      status: f.elements.status.value.trim() || "Tervezett", sort: +f.elements.sort.value || 0, active: f.elements.active.checked };
    busy(f.querySelector("[type=submit]"), async function(){
      var r = await sb.from("festivals").update(row).eq("id", id).select();
      if (r.error || !r.data.length) return say($("#admin-msg"), r.error ? saveErr(r.error) : "Nem sikerült menteni.");
      afterSave("A(z) " + row.name + " fesztivál el van mentve.");
    });
  });
  $("#fest-editors").addEventListener("click", function(e){
    var b = e.target.closest("[data-del]");
    if (!b) return;
    var id = b.closest("form").getAttribute("data-fest");
    if (!confirm("Biztosan törlöd ezt a fesztivált? A már leadott foglalások megmaradnak.")) return;
    busy(b, async function(){
      var r = await sb.from("festivals").delete().eq("id", id).select();
      if (r.error || !r.data.length) return say($("#admin-msg"), r.error ? saveErr(r.error) : "Nem sikerült törölni.");
      afterSave("A fesztivál törölve.");
    });
  });
  $("#fest-new").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target;
    var row = { name: $("#fest-new-name").value.trim(), location: $("#fest-new-location").value.trim(),
      dates: $("#fest-new-dates").value.trim(), sort: DATA.FESTIVALS.length + 1 };
    busy(f.querySelector("[type=submit]"), async function(){
      var r = await sb.from("festivals").insert(row).select();
      if (r.error) return say($("#admin-msg"), saveErr(r.error));
      f.reset(); f.closest("details").open = false;
      afterSave("Az új fesztivál (" + row.name + ") el van mentve, és már látszik az oldalon.");
    });
  });

  var SETTING_KEYS = ["kaucio_elso", "kaucio", "lemondasi_feltetelek"];
  function fillSettings(){
    SETTING_KEYS.forEach(function(k){ $("#set-" + k).value = /^kaucio/.test(k) ? settingFt(k) : (DATA.SETTINGS[k] || ""); });
  }
  $("#settings-form").addEventListener("submit", function(e){
    e.preventDefault();
    var rows = SETTING_KEYS.map(function(k){ return { key: k, value: $("#set-" + k).value.trim() }; });
    busy($("#settings-form [type=submit]"), async function(){
      var r = await sb.from("settings").upsert(rows).select();
      if (r.error || !r.data.length) return say($("#admin-msg"), r.error ? saveErr(r.error) : "Nem sikerült menteni.");
      afterSave("A beállítások el vannak mentve.");
    });
  });

  /* ---------- Admin: hírlevél-lista ---------- */
  $("#admin-newsletter").addEventListener("click", function(){
    busy($("#admin-newsletter"), async function(){
      var r = await sb.rpc("newsletter_subscribers");
      if (r.error) return say($("#admin-msg"), huErr(r.error));
      downloadCsv("hirlevel-" + new Date().toISOString().slice(0, 10) + ".csv", [["E-mail", "Név", "Feliratkozott"]].concat(
        r.data.map(function(x){ return [x.email, x.full_name || "", x.since ? fmtDate(x.since) : ""]; })));
      say($("#admin-msg"), r.data.length + " feliratkozó letöltve.", "ok");
    });
  });

  // A feliratkozás változását az adatbázis magától átküldi a MailerLite-nak (trigger az auth.users táblán).
  // Ez a gomb mindenkit újraküld, és pár másodperc múlva megmutatja a MailerLite válaszát.
  $("#admin-mlsync").addEventListener("click", function(){
    busy($("#admin-mlsync"), async function(){
      var r = await sb.rpc("mailerlite_sync_all");
      if (r.error) return say($("#admin-msg"), huErr(r.error));
      if (r.data && r.data.error === "missing_key") return say($("#admin-msg"), "Hiányzik a MailerLite API-kulcs a Supabase Vaultból (név: mailerlite_api_key).");
      var n = r.data.queued;
      if (!n) return say($("#admin-msg"), "Nincs feliratkozó, akit át kellene küldeni.", "ok");
      say($("#admin-msg"), n + " feliratkozó elküldve a MailerLite-nak, várom a választ…", "ok");
      await new Promise(function(ok){ setTimeout(ok, 4000); });
      var res = await sb.rpc("mailerlite_last_results");
      if (res.error) return;
      var last = res.data.slice(0, n);
      var bad = last.filter(function(x){ return !(x.status >= 200 && x.status < 300); });
      say($("#admin-msg"), bad.length
        ? "MailerLite: " + (last.length - bad.length) + " rendben, " + bad.length + " hiba. Első hiba: " + (bad[0].status || "") + " " + (bad[0].message || "")
        : "MailerLite: mind a(z) " + last.length + " feliratkozó rendben átment.", bad.length ? "err" : "ok");
    });
  });

  /* ---------- Admin: Helyszín (átvétel és leadás a fesztiválon) ---------- */
  var ciFilter = "all", ciNotes = {}, ciOpen = {};
  function problemsOf(uid){ return state.rows.filter(function(b){ return b.user_id === uid && b.return_problem; }).length; }
  async function renderCheckin(reload){
    var sel = $("#ci-festival"), keep = sel.value;
    var names = activeFestivals().map(function(f){ return f.name; });
    state.rows.forEach(function(b){ if (names.indexOf(b.festival) < 0) names.push(b.festival); });
    sel.innerHTML = names.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    if (keep && names.indexOf(keep) >= 0) sel.value = keep;
    if (reload){
      var r = await sb.from("bookings").select("*").order("created_at", { ascending: false });
      if (r.error) return say($("#admin-msg"), huErr(r.error));
      state.rows = r.data;
      var ids = Array.from(new Set(r.data.map(function(b){ return b.user_id; })));
      ciNotes = {};
      if (ids.length){
        var n = await sb.from("user_notes").select("*").in("user_id", ids).order("created_at", { ascending: true });
        if (!n.error) n.data.forEach(function(x){ (ciNotes[x.user_id] = ciNotes[x.user_id] || []).push(x); });
      }
    }
    drawCheckin();
  }
  function drawCheckin(){
    var fest = $("#ci-festival").value, q = $("#ci-search").value.trim().toLowerCase();
    var rows = state.rows.filter(function(b){ return b.festival === fest && b.status !== "lemondott"; })
      .sort(function(a, b){ return a.full_name.localeCompare(b.full_name, "hu"); });
    var out = rows.filter(function(b){ return b.picked_up_at && !b.returned_at; }).length;
    var waiting = rows.filter(function(b){ return !b.picked_up_at && !b.returned_at; }).length;
    var done = rows.filter(function(b){ return b.returned_at; }).length;
    var probs = rows.filter(function(b){ return b.return_problem; }).length;
    $("#ci-stats").innerHTML = [[rows.length, "foglalás"], [waiting, "még jön"], [out, "kint van"], [done, "leadta"], [probs, "probléma"]]
      .map(function(x){ return "<div><b>" + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("");
    var list = rows.filter(function(b){
      if (q && b.full_name.toLowerCase().indexOf(q) < 0) return false;
      if (ciFilter === "waiting") return !b.picked_up_at && !b.returned_at;
      if (ciFilter === "out") return b.picked_up_at && !b.returned_at;
      if (ciFilter === "done") return !!b.returned_at;
      return true;
    });
    $("#ci-list").innerHTML = list.length ? list.map(function(b){
      var p = PKG[b.package] || { name: b.package }, pc = problemsOf(b.user_id), notes = ciNotes[b.user_id] || [];
      return '<li class="ci-row' + (pc >= 2 ? " blocked" : "") + '" data-id="' + esc(b.id) + '">' +
        '<div class="ci-top"><div><b>' + esc(b.full_name) + '</b> <span class="meta">' + esc(p.name) + " · " + b.people + " fő" +
        (b.deposit ? " · kaució " + fmtFt(b.deposit) : "") + "</span></div><div>" +
        (pc ? '<span class="badge prob">' + pc + " probléma" + (pc >= 2 ? " · letiltva" : "") + "</span> " : "") +
        (notes.length ? '<span class="badge">' + notes.length + " megjegyzés</span>" : "") + "</div></div>" +
        '<div class="ci-actions">' +
        '<button type="button" class="ci-toggle" data-act="pick" aria-pressed="' + !!b.picked_up_at + '">' + (b.picked_up_at ? "✓ Átvette " + esc(fmtTime(b.picked_up_at)) : "Átvette") + "</button>" +
        '<button type="button" class="ci-toggle" data-act="ret" aria-pressed="' + !!b.returned_at + '">' + (b.returned_at ? "✓ Leadta " + esc(fmtTime(b.returned_at)) : "Leadta") + "</button>" +
        '<button type="button" class="ci-toggle prob" data-act="prob" aria-pressed="' + b.return_problem + '">' + (b.return_problem ? "⚠ Probléma volt" : "Probléma") + "</button>" +
        '<button type="button" class="ci-toggle" data-act="more" aria-expanded="' + !!ciOpen[b.id] + '">Megjegyzések</button></div>' +
        (b.return_problem || ciOpen[b.id] ? '<div class="ci-extra">' +
          (b.return_problem ? '<label class="muted">Mi volt a probléma?<input data-field="problem_note" value="' + esc(b.problem_note || "") + '" maxlength="1000" placeholder="pl. összetört a szék, nem hozta vissza a sátrat"></label>' +
            '<div><button type="button" class="btn btn-ghost btn-sm" data-act="save-prob">Probléma leírásának mentése</button></div>' : "") +
          (ciOpen[b.id] ? '<ul class="ci-notes">' + (notes.length ? notes.map(function(x){
            return "<li>" + esc(x.note) + "<br><small>" + esc(x.author_name || "") + " · " + esc(fmtDate(x.created_at)) + "</small></li>";
          }).join("") : '<li class="muted">Még nincs megjegyzés ehhez a vásárlóhoz.</li>') + "</ul>" +
            '<textarea data-field="note" rows="2" maxlength="1000" placeholder="Megjegyzés a vásárló fiókjához (csak a csapat látja)"></textarea>' +
            '<div><button type="button" class="btn btn-primary btn-sm" data-act="add-note">Megjegyzés mentése</button></div>' : "") +
        "</div>" : "") + "</li>";
    }).join("") : '<li class="muted">Nincs ilyen foglalás.</li>';
  }
  function fmtTime(s){ try { return new Date(s).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  async function updateBooking(id, patch){
    var r = await sb.from("bookings").update(patch).eq("id", id).select();
    if (r.error || !r.data.length){ say($("#admin-msg"), r.error ? huErr(r.error) : "Nem sikerült menteni."); return false; }
    Object.assign(state.rows.find(function(b){ return b.id === id; }), r.data[0]);
    say($("#admin-msg"), "");
    drawCheckin();
    return true;
  }
  $("#ci-festival").addEventListener("change", drawCheckin);
  $("#ci-search").addEventListener("input", drawCheckin);
  $$("[data-cif]").forEach(function(b){
    b.addEventListener("click", function(){
      ciFilter = b.getAttribute("data-cif");
      $$("[data-cif]").forEach(function(x){ x.setAttribute("aria-pressed", String(x === b)); });
      drawCheckin();
    });
  });
  $("#ci-list").addEventListener("click", function(e){
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var li = btn.closest("[data-id]"), id = li.getAttribute("data-id"), b = state.rows.find(function(x){ return x.id === id; });
    var act = btn.getAttribute("data-act");
    if (act === "more"){ ciOpen[id] = !ciOpen[id]; return drawCheckin(); }
    busy(btn, async function(){
      if (act === "pick") await updateBooking(id, { picked_up_at: b.picked_up_at ? null : new Date().toISOString() });
      if (act === "ret") await updateBooking(id, { returned_at: b.returned_at ? null : new Date().toISOString(),
        picked_up_at: b.picked_up_at || new Date().toISOString() });
      if (act === "prob"){
        if (!b.return_problem && problemsOf(b.user_id) >= 1 &&
            !confirm("Ez a vásárló második problémája lesz. Ezután minden csomag elfogyottnak látszik neki. Folytatod?")) return;
        await updateBooking(id, { return_problem: !b.return_problem });
      }
      if (act === "save-prob"){
        if (await updateBooking(id, { problem_note: li.querySelector('[data-field="problem_note"]').value.trim() || null }))
          say($("#admin-msg"), "A probléma leírása el van mentve.", "ok");
      }
      if (act === "add-note"){
        var t = li.querySelector('[data-field="note"]').value.trim();
        if (!t) return;
        var r = await sb.from("user_notes").insert({ user_id: b.user_id, note: t }).select();
        if (r.error) return say($("#admin-msg"), huErr(r.error));
        (ciNotes[b.user_id] = ciNotes[b.user_id] || []).push(r.data[0]);
        drawCheckin();
        say($("#admin-msg"), "A megjegyzés el van mentve.", "ok");
      }
    });
  });

  /* ---------- Admin: napló ---------- */
  var LOG_TBL = { bookings: "Foglalás", packages: "Csomag", festivals: "Fesztivál", settings: "Beállítás", user_notes: "Megjegyzés", admins: "Admin-jog" };
  var LOG_ACT = { insert: "létrehozta", update: "módosította", delete: "törölte" };
  var LOG_FIELD = { status: "állapot", picked_up_at: "átvette", returned_at: "leadta", return_problem: "probléma", problem_note: "probléma leírása",
    name: "név", price: "ár", people: "létszám", items: "tartalom", featured: "legnépszerűbb", active: "aktív", sort: "sorrend",
    location: "helyszín", dates: "időpont", value: "érték", note: "megjegyzés", full_name: "név", festival: "fesztivál", package: "csomag", deposit: "kaució", discount: "leárazás (%)" };
  function logLabel(x){
    var d = x.new_data || x.old_data || {};
    if (x.tbl === "bookings") return (d.full_name || "") + " · " + (d.festival || "");
    if (x.tbl === "settings") return d.key;
    if (x.tbl === "user_notes") return (d.note || "").slice(0, 60);
    return d.name || x.record_id || "";
  }
  function logVal(v){
    if (v === null || v === undefined || v === "") return "–";
    if (v === true) return "igen"; if (v === false) return "nem";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return fmtDate(v);
    return String(v);
  }
  function logChanges(x){
    if (x.action !== "update") return "";
    var o = x.old_data || {}, n = x.new_data || {};
    return Object.keys(n).filter(function(k){ return JSON.stringify(o[k]) !== JSON.stringify(n[k]); }).map(function(k){
      return "<b>" + esc(LOG_FIELD[k] || k) + "</b>: " + esc(logVal(o[k])) + " → " + esc(logVal(n[k]));
    }).join("<br>");
  }
  async function loadLog(){
    var q = sb.from("admin_log").select("*").order("at", { ascending: false }).limit(300);
    var f = $("#log-filter").value;
    if (f) q = q.eq("tbl", f);
    var r = await q;
    if (r.error) return say($("#admin-msg"), huErr(r.error));
    $("#log-table tbody").innerHTML = r.data.length ? r.data.map(function(x){
      return "<tr><td>" + esc(fmtDate(x.at)) + "</td><td>" + esc(x.actor_name || "") + "</td><td>" +
        esc((LOG_TBL[x.tbl] || x.tbl) + " " + (LOG_ACT[x.action] || x.action)) + '<br><span class="muted">' + esc(logLabel(x)) +
        '</span></td><td class="chg">' + logChanges(x) + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="muted">Még nincs bejegyzés.</td></tr>';
  }
  $("#log-filter").addEventListener("change", loadLog);
  $("#log-reload").addEventListener("click", loadLog);

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
    if (state.flash && state.flash.view !== state.view) state.flash = null;
    render();
  });

  async function init(){
    if (!sb){ state.ready = true; render(); return; }
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
    var linkError = q.get("error_description") || h.get("error_description");
    var fromLink = q.has("code") || q.has("megerositve") || q.has("uj-jelszo") || q.has("email-csere") || !!linkError;

    // Az induláskor érkező eseményekből derül ki, hogy a ?code=… linkből sikerült-e belépni,
    // és hogy jelszó-visszaállító link volt-e.
    var initDone = false, exchanged = false, recovery = false;
    sb.auth.onAuthStateChange(function(event, session){
      if (!initDone){
        if (event === "PASSWORD_RECOVERY"){ recovery = true; exchanged = true; }
        if (event === "SIGNED_IN") exchanged = true;
        return;
      }
      // a callbackben ne hívjunk közvetlenül Supabase-t (holtpont), ezért setTimeout
      setTimeout(async function(){
        if (event === "PASSWORD_RECOVERY"){ await setUser(session); return go("#/uj-jelszo"); }
        if (event === "SIGNED_OUT" || (session && (!state.user || session.user.id !== state.user.id))){
          await setUser(session); render();
        } else if (session) state.user = session.user;
      }, 0);
    });

    loadContent().catch(function(e){ console.warn(e); });
    var s = await sb.auth.getSession(); // ez cseréli be a ?code=… paramétert is belépésre
    await setUser(s.data.session);
    state.ready = true;
    initDone = true;

    if (fromLink){
      var target = "#/belepes";
      if (linkError) state.flash = { view: "belepes", text: "A link lejárt, vagy már felhasználták. Lépj be, vagy kérj új linket.", kind: "err" };
      else if (recovery || (q.has("uj-jelszo") && exchanged)) target = "#/uj-jelszo";
      else if (q.has("code") && !exchanged){
        // a linket nem abban a böngészőben (vagy nem azon a címen) nyitották meg, ahol kérték
        target = state.user ? "#/fiokom" : "#/belepes";
        state.flash = { view: state.user ? "fiokom" : "belepes", kind: "err", text: q.has("megerositve")
          ? "Az e-mail-címed meg van erősítve. Most már be tudsz lépni."
          : "Ezt a linket nem tudtuk feldolgozni. Ha a regisztrációdat erősítetted meg, az rendben van, be tudsz lépni. Ha új jelszót kértél, kérj újat az „Elfelejtett jelszó” gombbal, és a levelet ugyanabban a böngészőben nyisd meg." };
        if (q.has("megerositve")) state.flash.kind = "ok";
      }
      else if (q.has("uj-jelszo")) target = "#/uj-jelszo";
      else if (q.has("email-csere")){
        // a Supabase a régi és az új címre is küldhet linket; a csere a második után lép életbe
        var u = (await sb.auth.getUser()).data.user;
        if (u) state.user = u;
        target = state.user ? "#/fiokom" : "#/belepes";
        state.flash = { view: state.user ? "fiokom" : "belepes", kind: "ok", text: state.user && state.user.new_email
          ? "Megerősítve. Ha a másik címedre is jött levél, kattints abban is a linkre, a csere utána lép életbe."
          : "Az e-mail-címed frissült." };
      }
      else if (state.user){ target = "#/foglalas"; }
      else state.flash = { view: "belepes", text: "Az e-mail-címed meg van erősítve. Most már be tudsz lépni.", kind: "ok" };
      history.replaceState(null, "", location.pathname);
      go(target);
    } else render();
  }
  init().catch(function(e){ console.error(e); state.ready = true; render(); });
})();
