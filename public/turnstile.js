/* ============================================================================
   Shared Cloudflare Turnstile client helper.
   Renders a managed (interaction-only) widget when a site key is configured
   (served by /api/public-config). When no key is set it's a no-op — pages work
   unchanged and getToken() returns "" (the server then skips verification).

   Usage:
     const ts = await mountTurnstile(containerEl);
     ... at submit time:  body.turnstile_token = ts.getToken();
   ============================================================================ */
(function () {
  let configP = null;
  let scriptP = null;

  function getConfig() {
    if (!configP) {
      configP = fetch("/api/public-config").then(r => r.json()).catch(() => ({})).then(c => c || {});
    }
    return configP;
  }

  function loadScript() {
    if (scriptP) return scriptP;
    scriptP = new Promise((resolve, reject) => {
      if (window.turnstile) return resolve(window.turnstile);
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.defer = true;
      s.onload = () => resolve(window.turnstile);
      s.onerror = () => reject(new Error("turnstile script failed to load"));
      document.head.appendChild(s);
    });
    return scriptP;
  }

  // Mount a widget into `container`. Resolves to { getToken, reset }.
  // Safe no-op (getToken -> "") when unconfigured or on any failure.
  window.mountTurnstile = async function mountTurnstile(container) {
    const noop = { getToken: () => "", reset: () => {} };
    const cfg = await getConfig();
    if (!cfg.turnstile_key || !container) return noop;
    let turnstile;
    try { turnstile = await loadScript(); } catch (_) { return noop; }
    let widgetId = null;
    try {
      widgetId = turnstile.render(container, {
        sitekey: cfg.turnstile_key,
        action: "turnstile-spin-v1",
        appearance: "interaction-only"
      });
    } catch (_) { return noop; }
    return {
      getToken: () => { try { return turnstile.getResponse(widgetId) || ""; } catch (_) { return ""; } },
      reset: () => { try { turnstile.reset(widgetId); } catch (_) {} }
    };
  };
})();
