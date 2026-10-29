const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let me = null;       // { user, profile }
let meta = null;     // { services, availability }
let tab = "find";
let target = null;   // housekeeper being contacted

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function flash(text, isErr = false) {
  const el = $("#msg");
  el.textContent = text;
  el.className = "msg" + (isErr ? " err" : "");
  el.hidden = !text;
  if (text) setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 6000);
}
const guard = (fn) => async (e) => {
  e?.preventDefault?.();
  try { await fn(e); } catch (err) { flash(err.message, true); }
};

// ---------- shell ----------
function renderShell() {
  const u = me.user;
  $("#who").innerHTML = u
    ? `<span class="muted">${esc(u.name)} (${u.role})</span><button class="ghost" id="logout">Sign out</button>`
    : `<button id="signin">Sign in / Create account</button>`;
  const tabs = [["find", "Find a housekeeper"]];
  if (u?.role === "housekeeper") tabs.push(["profile", "My profile"]);
  if (u) tabs.push(["requests", u.role === "housekeeper" ? "Incoming requests" : "My requests"]);
  if (u) tabs.push(["account", "Account"]);
  $("#nav").innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? "active" : ""}">${label}</button>`).join("");
  for (const s of ["find", "auth", "forgot-section", "account", "profile", "requests"]) $("#" + s).hidden = s !== tab;
}

async function show(next) {
  tab = next;
  renderShell();
  if (tab === "find") await loadResults();
  if (tab === "requests") await loadRequests();
  if (tab === "profile") fillProfile();
}

async function refreshMe() {
  me = await api("GET", "/api/me");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || !(b.dataset.tab || ["signin", "logout", "forgot"].includes(b.id))) return;
  try {
    if (b.dataset.tab) return await show(b.dataset.tab);
    if (b.id === "signin") return await show("auth");
    if (b.id === "forgot") return await show("forgot-section");
    await api("POST", "/api/logout", {});
    me = { user: null }; flash("Signed out.");
    await show("find");
  } catch (err) { flash(err.message, true); }
});

// ---------- auth ----------
$("#login-form").addEventListener("submit", guard(async (e) => {
  await api("POST", "/api/login", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); await refreshMe();
  await show(me.user.role === "housekeeper" && !me.profile ? "profile" : "find");
}));
$("#register-form").addEventListener("submit", guard(async (e) => {
  await api("POST", "/api/register", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); await refreshMe();
  if (me.user.role === "housekeeper") { flash("Welcome! Fill in your profile so households can find you."); await show("profile"); }
  else { flash("Welcome!"); await show("find"); }
}));

// ---------- password reset & account deletion ----------
$("#forgot-form").addEventListener("submit", guard(async (e) => {
  const r = await api("POST", "/api/password-reset/request", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); flash(r.message);
}));
$("#delete-form").addEventListener("submit", guard(async (e) => {
  if (!confirm("Permanently delete your account? This can't be undone.")) return;
  await api("POST", "/api/account/delete", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); me = { user: null };
  await show("find"); flash("Your account has been deleted.");
}));

// ---------- search ----------
async function loadResults() {
  const q = new URLSearchParams({
    service: $("#f-service").value, city: $("#f-city").value.trim(), maxRate: $("#f-rate").value,
    avail: $("#f-avail").value, sort: $("#f-sort").value,
  });
  const list = await api("GET", "/api/housekeepers?" + q);
  $("#count").textContent = `${list.length} housekeeper${list.length === 1 ? "" : "s"} found`;
  $("#results").innerHTML = list.map((h) => `
    <article class="card hk">
      <h3>${esc(h.name)}</h3>
      <div class="meta">${esc(h.city)} · ${esc(h.avail)} · ${h.exp} yrs · ${h.rating ? `★ ${h.rating} (${h.reviews})` : "No reviews yet"}</div>
      <div>${h.services.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>
      <p>${esc(h.bio)}</p>
      <p class="rate">₹${h.rate}/hour</p>
      ${me.user?.role === "seeker" ? `<button data-hk="${h.id}" data-name="${esc(h.name)}">Request contact</button>` : ""}
    </article>`).join("") || `<p class="muted">No matches. Try loosening the filters.</p>`;
}
let debounce;
$("#filters").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(guard(loadResults), 200); });
$("#filters").addEventListener("submit", (e) => e.preventDefault());

$("#results").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-hk]");
  if (!b) return;
  target = { id: Number(b.dataset.hk), name: b.dataset.name };
  $("#dlg-title").textContent = `Request ${target.name}`;
  $("#dlg").showModal();
});
$("#dlg-cancel").addEventListener("click", () => $("#dlg").close());
$("#req-form").addEventListener("submit", guard(async (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  await api("POST", "/api/requests", { ...f, housekeeperId: target.id });
  e.target.reset(); $("#dlg").close();
  flash(`Request sent to ${target.name}. You'll see their phone number once they accept.`);
}));

// ---------- profile ----------
function fillProfile() {
  const f = $("#profile-form");
  const p = me.profile;
  if (!p) return;
  for (const k of ["city", "phone", "rate", "exp", "avail", "bio"]) f.elements[k].value = p[k];
  f.querySelectorAll("[name=svc]").forEach((c) => (c.checked = p.services.includes(c.value)));
}
$("#profile-form").addEventListener("submit", guard(async (e) => {
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.services = fd.getAll("svc"); delete body.svc;
  body.rate = Number(body.rate); body.exp = Number(body.exp) || 0;
  await api("PUT", "/api/profile", body);
  await refreshMe(); flash("Profile saved. Households can now find you.");
}));

// ---------- requests ----------
async function loadRequests() {
  const isHk = me.user.role === "housekeeper";
  $("#req-title").textContent = isHk ? "Incoming requests" : "My requests";
  const list = await api("GET", "/api/requests");
  $("#req-list").innerHTML = list.map((r) => `
    <div class="card">
      <strong>${esc(isHk ? r.seeker_name : r.hk_name)}</strong>
      <span class="badge ${r.status}">${r.status}</span>
      <div class="muted">${new Date(r.created_at).toLocaleString()} · ${esc(r.when || "flexible")}</div>
      <div>${esc(r.note)}</div>
      ${isHk ? `<div>Phone: <a href="tel:${esc(r.seeker_phone)}">${esc(r.seeker_phone)}</a></div>` : ""}
      ${!isHk && r.hk_phone ? `<div>Phone: <a href="tel:${esc(r.hk_phone)}">${esc(r.hk_phone)}</a></div>` : ""}
      ${isHk && r.status === "pending" ? `<div class="actions"><button data-act="accepted" data-id="${r.id}">Accept</button><button class="ghost" data-act="declined" data-id="${r.id}">Decline</button></div>` : ""}
      ${!isHk && r.status === "accepted" && !r.my_rating ? `<div class="actions"><select aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${"★".repeat(n)}</option>`).join("")}</select><button data-review="${r.id}">Leave a review</button></div>` : ""}
      ${r.my_rating ? `<div class="muted">You rated this ${"★".repeat(r.my_rating)}</div>` : ""}
    </div>`).join("") || `<p class="muted">Nothing here yet.</p>`;
}
$("#req-list").addEventListener("click", guard(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.act) await api("PATCH", `/api/requests/${b.dataset.id}`, { status: b.dataset.act });
  else if (b.dataset.review) {
    await api("POST", `/api/requests/${b.dataset.review}/review`, { rating: Number(b.parentElement.querySelector("select").value) });
    flash("Thanks for your review!");
  } else return;
  await loadRequests();
}));

// ---------- boot ----------
(async () => {
  try {
    [meta] = await Promise.all([api("GET", "/api/meta"), refreshMe()]);
    $("#f-service").insertAdjacentHTML("beforeend", meta.services.map((s) => `<option>${esc(s)}</option>`).join(""));
    $("#f-avail").insertAdjacentHTML("beforeend", meta.availability.map((s) => `<option>${esc(s)}</option>`).join(""));
    $("#p-avail").innerHTML = meta.availability.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#svc-checks").innerHTML = meta.services.map((s) => `<label><input type="checkbox" name="svc" value="${esc(s)}"> ${esc(s)}</label>`).join("");
    await show("find");
  } catch (err) { flash(err.message, true); }
})();
