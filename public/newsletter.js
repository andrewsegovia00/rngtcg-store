/* ============================================================================
   First-visit newsletter popup → 10% welcome code.
   Shows once per browser (localStorage), posts to /api/newsletter-signup, and
   shows the resulting code / "check your email" state.
   ============================================================================ */
(function () {
  const SEEN_KEY = "rg_news_seen";
  if (location.protocol === "file:") return;            // API only exists under Wrangler/Pages
  if (localStorage.getItem(SEEN_KEY)) return;

  function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {} }

  function build() {
    const wrap = document.createElement("div");
    wrap.className = "news-pop";
    wrap.innerHTML = `
      <div class="news-pop__card" role="dialog" aria-label="Get 10% off">
        <button class="news-pop__x" aria-label="Close">×</button>
        <p class="news-pop__kicker">Join the crew</p>
        <h2 class="news-pop__title">Get 10% off your first rip.</h2>
        <p class="news-pop__sub">Drop your email for a one-time code — plus first dibs when drops go live.</p>
        <form class="news-pop__form">
          <input type="email" name="email" placeholder="you@email.com" autocomplete="email" required />
          <div class="news-pop__turnstile"></div>
          <button type="submit">Get my code</button>
        </form>
        <p class="news-pop__msg" role="status" aria-live="polite"></p>
        <button class="news-pop__skip" type="button">No thanks</button>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => { markSeen(); wrap.remove(); };
    wrap.querySelector(".news-pop__x").onclick = close;
    wrap.querySelector(".news-pop__skip").onclick = close;
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });

    // Bot protection (no-op until a Turnstile site key is configured).
    let turnstileWidget = null;
    if (typeof mountTurnstile === "function") {
      mountTurnstile(wrap.querySelector(".news-pop__turnstile")).then(w => { turnstileWidget = w; });
    }

    const form = wrap.querySelector(".news-pop__form");
    const msg = wrap.querySelector(".news-pop__msg");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const email = form.email.value.trim();
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const res = await fetch("/api/newsletter-signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, source: "popup", turnstile_token: turnstileWidget ? turnstileWidget.getToken() : "" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { turnstileWidget?.reset(); throw new Error(data.error || "Something went wrong."); }
        // Already signed up with this email — keep the form open so they can
        // try a different address (one welcome code per email).
        if (data.already) {
          msg.textContent = "That email's already signed up — try a different one to grab a code.";
          msg.classList.remove("is-ok"); msg.classList.add("is-err");
          btn.disabled = false; btn.textContent = "Get my code";
          form.email.focus(); form.email.select();
          return;
        }
        markSeen();
        form.style.display = "none";
        wrap.querySelector(".news-pop__skip").style.display = "none";
        // Never print the code on screen (it would let anyone farm codes with
        // throwaway emails). It's only ever delivered by email.
        msg.innerHTML = `Check your email for your ${data.percent_off || 10}% off code. 🎉`;
        msg.classList.add("is-ok");
      } catch (err) {
        msg.textContent = err.message;
        msg.classList.add("is-err");
        btn.disabled = false; btn.textContent = "Get my code";
      }
    });
  }

  const start = () => setTimeout(build, 1200);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
