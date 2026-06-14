/* ============================================================================
   R&G TCG — Email template editor. Token-gated (shares the admin token).
   Loads the editable email_settings fields, shows the built-in defaults as
   placeholders, renders a live server-side preview, and saves changes.
   ============================================================================ */
const TOKEN_KEY = "rg_admin_token";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const token = () => sessionStorage.getItem(TOKEN_KEY) || "";
const setToken = v => sessionStorage.setItem(TOKEN_KEY, v.trim());
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

let defaults = {};
let previewKind = "order";
let lastPreview = null;

function showStatus(message, type = "ok") {
  const el = $("#status");
  el.hidden = false;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === "ok") setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "authorization": `Bearer ${token()}`, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// Collect only the fields the user actually filled in (blank = use default).
function collectSettings() {
  const out = {};
  $$("[data-field]").forEach(el => { out[el.dataset.field] = el.value; });
  return out;
}

function paintPreview() {
  const html = lastPreview ? lastPreview[previewKind] : "";
  $("#previewFrame").srcdoc = html || "<p style='font-family:sans-serif;padding:24px;color:#777'>No preview.</p>";
}

async function load() {
  if (!token()) { showStatus("Paste your admin token to edit the email template.", "err"); return; }
  try {
    const data = await api("/api/admin-email-settings");
    defaults = data.defaults || {};
    $$("[data-field]").forEach(el => {
      const key = el.dataset.field;
      el.value = data.settings?.[key] ?? "";
      if (defaults[key]) el.placeholder = defaults[key];
    });
    lastPreview = data.preview || null;
    paintPreview();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

let previewTimer = null;
function schedulePreview() {
  if (!token()) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const data = await api("/api/admin-email-settings", {
        method: "POST",
        body: JSON.stringify({ settings: collectSettings(), preview_only: true })
      });
      lastPreview = data.preview || lastPreview;
      paintPreview();
    } catch (_) { /* preview is best-effort */ }
  }, 450);
}

async function save() {
  if (!token()) { showStatus("Unlock with your admin token first.", "err"); return; }
  try {
    showStatus("Saving…", "ok");
    const data = await api("/api/admin-email-settings", {
      method: "POST",
      body: JSON.stringify({ settings: collectSettings() })
    });
    $$("[data-field]").forEach(el => { el.value = data.settings?.[el.dataset.field] ?? ""; });
    lastPreview = data.preview || lastPreview;
    paintPreview();
    showStatus("Saved. Live emails now use this template.", "ok");
  } catch (error) {
    showStatus(error.message, "err");
  }
}

$("#tokenForm").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#adminToken").value;
  if (!v.trim()) return showStatus("Enter an admin token first.", "err");
  setToken(v);
  load();
});
$("#refreshBtn").onclick = load;
$("#lockBtn").onclick = () => { clearToken(); $("#adminToken").value = ""; showStatus("Locked.", "err"); };
$("#saveBtn").onclick = save;
$$("[data-field]").forEach(el => el.addEventListener("input", schedulePreview));
$$(".seg__btn").forEach(b => b.onclick = () => {
  previewKind = b.dataset.preview;
  $$(".seg__btn").forEach(x => x.classList.toggle("is-active", x === b));
  paintPreview();
});

if (token()) { $("#adminToken").value = token(); load(); }
