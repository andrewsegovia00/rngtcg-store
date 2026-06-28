/* ============================================================================
   Shared admin auth for every admin page.
   - Signs in via Supabase (email + password) using the browser-safe anon key
     fetched from /api/public-config.
   - Injects a full-screen login gate; the dashboard stays hidden (body.admin-locked)
     until a valid session exists. A failed sign-in stays on the gate.
   - Exposes window.AdminAuth: requireLogin(loadFn), accessToken(), signOut(), email().
   The server still re-verifies the Supabase token AND the email allowlist on
   every admin API call (functions/_lib/admin.js), so this is the UI half of a
   real check — not a security boundary on its own.
   ============================================================================ */
(function () {
  let client = null;
  let session = null;
  let onUnlock = null;
  let booted = false;

  function gateEl() {
    let g = document.getElementById("adminGate");
    if (g) return g;
    const t = document.createElement("template");
    t.innerHTML = `
      <div class="admin-gate" id="adminGate">
        <form class="admin-gate__card" id="adminGateForm" autocomplete="on">
          <div class="admin-gate__brand"><span class="admin-gate__mark">R&G</span><strong>Admin sign in</strong></div>
          <label class="admin-gate__field"><span>Email</span>
            <input id="adminEmail" type="email" autocomplete="username" placeholder="you@example.com" required /></label>
          <label class="admin-gate__field"><span>Password</span>
            <input id="adminPass" type="password" autocomplete="current-password" placeholder="Your password" required /></label>
          <button type="submit" id="adminGateBtn">Sign in</button>
          <p class="admin-gate__err" id="adminGateErr" hidden></p>
          <p class="admin-gate__note">Authorized accounts only.</p>
        </form>
      </div>`.trim();
    g = t.content.firstChild;
    document.body.appendChild(g);
    document.body.classList.add("admin-locked");
    g.querySelector("#adminGateForm").addEventListener("submit", onSubmit);
    return g;
  }

  function err(msg) {
    const e = document.getElementById("adminGateErr");
    if (e) { e.hidden = !msg; e.textContent = msg || ""; }
  }
  function lock(msg) {
    document.body.classList.add("admin-locked");
    err(msg || "");
    const i = document.getElementById("adminEmail"); if (i) i.focus();
  }
  function unlock() {
    document.body.classList.remove("admin-locked");
    err("");
    if (typeof onUnlock === "function") onUnlock();
  }

  async function boot() {
    if (booted) return;
    booted = true;
    gateEl();
    let cfg = {};
    try { cfg = await (await fetch("/api/public-config")).json(); } catch (_) {}
    if (!cfg.supabase_url || !cfg.supabase_anon_key) {
      lock("Admin login isn't configured yet (missing Supabase keys).");
      return;
    }
    try {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2");
      client = mod.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    } catch (_) {
      lock("Couldn't load the sign-in library. Check your connection and retry.");
      return;
    }
    const { data } = await client.auth.getSession();
    session = data.session || null;
    client.auth.onAuthStateChange((_e, s) => { session = s; });
    if (session) unlock(); else lock();
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (!client) return;
    const email = (document.getElementById("adminEmail").value || "").trim();
    const password = document.getElementById("adminPass").value || "";
    const btn = document.getElementById("adminGateBtn");
    if (!email || !password) return err("Enter your email and password.");
    btn.disabled = true; err("");
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      const pass = document.getElementById("adminPass"); if (pass) pass.value = "";
      unlock();
    } catch (e) {
      const msg = e && e.message ? e.message : "Sign in failed.";
      lock(/invalid|credential/i.test(msg) ? "Incorrect email or password." : msg);
    } finally {
      btn.disabled = false;
    }
  }

  window.AdminAuth = {
    // Show the gate; run loadFn whenever a session unlocks (sign-in or restored session).
    requireLogin(loadFn) {
      onUnlock = loadFn;
      if (!booted) boot();
      else if (session) unlock();
    },
    accessToken() { return (session && session.access_token) || ""; },
    email() { return (session && session.user && session.user.email) || ""; },
    async signOut() {
      try { if (client) await client.auth.signOut(); } catch (_) {}
      session = null;
      lock();
    }
  };
})();
