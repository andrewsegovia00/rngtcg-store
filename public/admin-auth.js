/* ============================================================================
   Shared admin auth for every admin page.
   - Signs in with Google via Supabase OAuth (browser-safe anon key from
     /api/public-config).
   - Injects a full-screen gate. While the session is being restored it shows a
     neutral "loading" state; the "Continue with Google" button only appears
     when there is genuinely no session — so normal page-to-page navigation just
     shows a brief spinner, never a flash of the sign-in form.
   - Exposes window.AdminAuth: requireLogin(loadFn), accessToken(), signOut(), email().
   The server re-verifies the Supabase token + email allowlist on every admin
   API call (functions/_lib/admin.js).
   ============================================================================ */
(function () {
  let client = null;
  let session = null;
  let onUnlock = null;
  let booted = false;
  let checking = false;

  const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;

  function gateEl() {
    let g = document.getElementById("adminGate");
    if (g) return g;
    const t = document.createElement("template");
    t.innerHTML = `
      <div class="admin-gate" id="adminGate">
        <div class="admin-gate__card">
          <div class="admin-gate__brand"><span class="admin-gate__mark">R&G</span><strong>Admin</strong></div>
          <div class="admin-gate__loading" id="adminGateLoading"><span class="admin-gate__spinner"></span> Restoring your session…</div>
          <div class="admin-gate__signin" id="adminGateSignin" hidden>
            <button type="button" id="adminGoogleBtn" class="admin-gate__google">${GOOGLE_SVG}<span>Continue with Google</span></button>
            <p class="admin-gate__err" id="adminGateErr" hidden></p>
            <p class="admin-gate__note">Authorized Google accounts only.</p>
          </div>
        </div>
      </div>`.trim();
    g = t.content.firstChild;
    document.body.appendChild(g);
    document.body.classList.add("admin-locked");
    g.querySelector("#adminGoogleBtn").addEventListener("click", signInGoogle);
    return g;
  }

  function showLoading() {
    document.body.classList.add("admin-locked");
    const l = document.getElementById("adminGateLoading");
    const s = document.getElementById("adminGateSignin");
    if (l) l.hidden = false;
    if (s) s.hidden = true;
  }
  function showSignin(msg) {
    document.body.classList.add("admin-locked");
    const l = document.getElementById("adminGateLoading");
    const s = document.getElementById("adminGateSignin");
    const e = document.getElementById("adminGateErr");
    if (l) l.hidden = true;
    if (s) s.hidden = false;
    if (e) { e.hidden = !msg; e.textContent = msg || ""; }
  }
  function unlock() {
    document.body.classList.remove("admin-locked");
    const e = document.getElementById("adminGateErr"); if (e) e.hidden = true;
    if (typeof onUnlock === "function") onUnlock();
  }

  // A session only unlocks the UI if the server agrees the account is an admin.
  async function gateCheck() {
    if (checking) return;
    if (!session) { showSignin(); return; }
    checking = true;
    try {
      const res = await fetch("/api/admin-overview", { headers: { authorization: `Bearer ${session.access_token}` } });
      if (res.ok) { unlock(); return; }
      if (res.status === 403) { await doSignOut(); showSignin("That Google account isn't on the admin allowlist."); return; }
      await doSignOut(); showSignin("Sign-in could not be verified.");
    } catch (_) {
      unlock(); // transient network issue — let the page load and surface errors itself
    } finally {
      checking = false;
    }
  }

  async function boot() {
    if (booted) return;
    booted = true;
    gateEl();
    showLoading();
    let cfg = {};
    try { cfg = await (await fetch("/api/public-config")).json(); } catch (_) {}
    if (!cfg.supabase_url || !cfg.supabase_anon_key) {
      showSignin("Admin login isn't configured yet (missing Supabase keys).");
      return;
    }
    try {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2");
      client = mod.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (_) {
      showSignin("Couldn't load the sign-in library. Check your connection and retry.");
      return;
    }
    client.auth.onAuthStateChange((_e, s) => {
      session = s;
      if (s && document.body.classList.contains("admin-locked")) gateCheck();
    });
    const { data } = await client.auth.getSession();
    session = data.session || null;
    if (session) gateCheck(); else showSignin();
  }

  async function signInGoogle() {
    if (!client) return;
    const btn = document.getElementById("adminGoogleBtn");
    if (btn) btn.disabled = true;
    showLoading();
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
      // Browser navigates to Google; control returns via the redirect.
    } catch (e) {
      if (btn) btn.disabled = false;
      showSignin((e && e.message) || "Couldn't start Google sign-in.");
    }
  }

  async function doSignOut() {
    try { if (client) await client.auth.signOut(); } catch (_) {}
    session = null;
  }

  window.AdminAuth = {
    requireLogin(loadFn) {
      onUnlock = loadFn;
      if (!booted) boot();
      else if (session) gateCheck();
      else showSignin();
    },
    accessToken() { return (session && session.access_token) || ""; },
    email() { return (session && session.user && session.user.email) || ""; },
    async signOut() { await doSignOut(); showSignin(); }
  };
})();
