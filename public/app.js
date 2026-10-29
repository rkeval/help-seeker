const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let me = null;       // { user, profile }
let meta = null;     // { services, availability }
let tab = "find";
let target = null;   // housekeeper being contacted
let lastList = null; // last search result and request lists, kept so a language switch re-renders without asking the server again
let lastReq = null;
const t = (k, p) => I18n.t(k, p);
// Services and availability are English keys in the API and the database; only the words on screen change.
const label = (prefix, v) => { const k = prefix + v; const x = t(k); return x === k ? v : x; };
const la = (text) => I18n.langAttr(text); // ` lang="ta"` for user text in another script than the screen language

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Accept-Language": I18n.lang, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.code ? I18n.errorMessage(data) : t("net.failed", { status: res.status }));
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
    ? `<span class="muted"${la(u.name)}>${esc(u.name)}</span><button class="ghost" id="logout">${esc(t("auth.signout"))}</button>`
    : `<button id="signin">${esc(t("auth.signin_or_create"))}</button>`;
  const tabs = [["find", t("nav.find")]];
  if (u) tabs.push(["profile", me.profile ? t("nav.profile") : t("nav.offer")]);
  if (u) tabs.push(["requests", me.unreadMessages ? t("nav.requests_new", { n: me.unreadMessages }) : t("nav.requests")]);
  if (u) tabs.push(["account", t("nav.account")]);
  $("#nav").innerHTML = tabs.map(([id, text]) => `<button data-tab="${id}" class="${id === tab ? "active" : ""}">${esc(text)}</button>`).join("");
  const needsVerify = !!u && !u.emailVerified;
  $("#verify-banner").hidden = !needsVerify;
  if (needsVerify) {
    $("#verify-text").textContent = t("verify.banner", { email: u.email });
  }
  for (const s of ["find", "auth", "forgot-section", "account", "profile", "requests"]) $("#" + s).hidden = s !== tab;
}

async function show(next) {
  tab = next;
  renderShell();
  if (tab === "find") await loadResults();
  if (tab === "requests") await loadRequests();
  if (tab === "profile") fillProfile();
  if (tab === "account") renderAdmin();
}

// ---------- owner-only sample data ----------
// The card is built here and only for the owner, so it isn't even in the page for anybody else (the server also refuses them).
function renderAdmin() {
  $("#admin-card")?.remove();
  if (!me.isAdmin) return;
  const card = document.createElement("div");
  card.id = "admin-card"; card.className = "card stack";
  card.innerHTML = `<h2>${esc(t("admin.title"))} <span class="tag">${esc(t("admin.badge"))}</span></h2>
    <p>${esc(t("admin.text"))}</p>
    <p class="muted" id="sample-status"></p>
    <div class="actions"><button type="button" data-sample="add">${esc(t("admin.add"))}</button><button type="button" class="ghost" data-sample="remove">${esc(t("admin.remove"))}</button></div>`;
  card.querySelector("#sample-status").textContent = me.sampleHousekeepers ? t("admin.count", { n: me.sampleHousekeepers }) : t("admin.none");
  $("#account").prepend(card);
}
$("#account").addEventListener("click", (e) => {
  const action = e.target.closest("button[data-sample]")?.dataset.sample;
  if (!action) return; // other clicks (like the delete form) must be left alone
  guard(async () => {
    await api("POST", "/api/admin/sample-data", { action });
    await refreshMe(); renderAdmin();
    flash(action === "add" ? t("admin.added") : t("admin.removed"));
  })(e);
});

async function refreshMe() {
  me = await api("GET", "/api/me");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || !(b.dataset.tab || ["signin", "logout", "forgot", "resend-verify", "recheck-verify"].includes(b.id))) return;
  try {
    if (b.dataset.tab) return await show(b.dataset.tab);
    if (b.id === "signin") return await show("auth");
    if (b.id === "forgot") return await show("forgot-section");
    if (b.id === "resend-verify") {
      await api("POST", "/api/email-verification/resend", {});
      return flash(t("verify.sent_flash", { email: me.user.email }));
    }
    if (b.id === "recheck-verify") {
      await refreshMe();
      renderShell();
      if (me.user?.emailVerified) { flash(t("verify.confirmed_flash")); return await show(tab); }
      return flash(t("verify.not_yet_flash"), true);
    }
    await api("POST", "/api/logout", {});
    me = { user: null }; flash(t("flash.signed_out"));
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
  if (me.user.role === "housekeeper") { flash(t("register.welcome_hk")); await show("profile"); }
  else { flash(t("register.welcome")); await show("find"); }
}));

// ---------- password reset & account deletion ----------
$("#forgot-form").addEventListener("submit", guard(async (e) => {
  const r = await api("POST", "/api/password-reset/request", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); flash(t("forgot.sent"));
}));
$("#delete-form").addEventListener("submit", guard(async (e) => {
  if (!confirm(t("account.delete_confirm"))) return;
  await api("POST", "/api/account/delete", Object.fromEntries(new FormData(e.target)));
  e.target.reset(); me = { user: null };
  await show("find"); flash(t("account.deleted_flash"));
}));

// ---------- search ----------
async function loadResults() {
  const q = new URLSearchParams({
    service: $("#f-service").value, city: $("#f-city").value.trim(), maxRate: $("#f-rate").value,
    avail: $("#f-avail").value, sort: $("#f-sort").value,
  });
  lastList = await api("GET", "/api/housekeepers?" + q);
  renderResults();
}
function renderResults() {
  const list = lastList;
  if (!list) return;
  $("#count").textContent = t("results.found", { n: list.length });
  $("#results").innerHTML = list.map((h) => `
    <article class="card hk">
      <h3${la(h.name)}>${esc(h.name)}${h.sample ? ` <span class="tag">${esc(t("hk.sample"))}</span>` : ""}</h3>
      <div class="meta">${esc(h.city)} · ${esc(label("avail.", h.avail))} · ${esc(t("hk.years", { n: h.exp }))} · ${h.rating ? `★ ${h.rating} (${h.reviews})` : esc(t("hk.no_reviews"))}</div>
      <div>${h.services.map((s) => `<span class="tag">${esc(label("service.", s))}</span>`).join("")}</div>
      <p${la(h.bio)}>${esc(h.bio)}</p>
      <p class="rate">${esc(t("hk.rate", { rate: I18n.rupees(h.rate) }))}</p>
      ${!me.user ? "" : h.mine ? `<p class="muted">${esc(t("hk.is_you"))}</p>` : `<button data-hk="${h.id}" data-name="${esc(h.name)}">${esc(t("hk.request_contact"))}</button>`}
    </article>`).join("") || `<p class="muted">${esc(t("results.none"))}</p>`;
}
let debounce;
$("#filters").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(guard(loadResults), 200); });
$("#filters").addEventListener("submit", (e) => e.preventDefault());

$("#results").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-hk]");
  if (!b) return;
  target = { id: Number(b.dataset.hk), name: b.dataset.name };
  $("#dlg-title").textContent = t("dlg.title", { name: target.name });
  $("#dlg").showModal();
});
$("#dlg-cancel").addEventListener("click", () => $("#dlg").close());
$("#req-form").addEventListener("submit", guard(async (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  await api("POST", "/api/requests", { ...f, housekeeperId: target.id });
  e.target.reset(); $("#dlg").close();
  flash(t("dlg.sent_flash", { name: target.name }));
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
  await refreshMe();
  flash(me.user.emailVerified ? t("profile.saved_live") : t("profile.saved_hidden"));
}));

// ---------- requests ----------
function requestCard(r, isHk) {
  const other = isHk ? r.seeker_name : r.hk_name;
  const phone = (p) => `<div>${esc(t("req.phone", { phone: "\u0001" })).replace("\u0001", `<a href="tel:${esc(p)}">${esc(p)}</a>`)}</div>`;
  return `
    <div class="card">
      <strong${la(other)}>${esc(other)}</strong>
      <span class="badge ${r.status}">${esc(t("status." + r.status))}</span>
      <div class="muted">${esc(I18n.dateTime(r.created_at))} · <span${la(r.when)}>${esc(r.when || t("req.flexible"))}</span></div>
      <div${la(r.note)}>${esc(r.note)}</div>
      ${isHk ? phone(r.seeker_phone) : ""}
      ${!isHk && r.hk_phone ? phone(r.hk_phone) : ""}
      ${isHk && r.status === "pending" ? `<div class="actions"><button data-act="accepted" data-id="${r.id}">${esc(t("req.accept"))}</button><button class="ghost" data-act="declined" data-id="${r.id}">${esc(t("req.decline"))}</button></div>` : ""}
      ${!isHk && r.status === "accepted" && !r.my_rating ? `<div class="actions"><select aria-label="${esc(t("req.rating_label"))}">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${"★".repeat(n)}</option>`).join("")}</select><button data-review="${r.id}">${esc(t("req.review"))}</button></div>` : ""}
      ${r.my_rating ? `<div class="muted">${esc(t("req.you_rated", { stars: "★".repeat(r.my_rating) }))}</div>` : ""}
      ${r.status === "accepted" ? `<div class="actions"><button data-chat="${r.id}" data-name="${esc(other)}">${esc(r.unread ? t("req.messages_new", { n: r.unread }) : t("req.messages"))}</button></div>` : ""}
    </div>`;
}
async function loadRequests() {
  const offers = !!me.profile;
  const sent = await api("GET", "/api/requests?as=sent");
  const received = offers ? await api("GET", "/api/requests?as=received") : [];
  lastReq = { offers, sent, received };
  renderRequests();
}
function renderRequests() {
  if (!lastReq) return;
  const { offers, sent, received } = lastReq;
  const section = (title, list, isHk) =>
    `<h3>${esc(title)}</h3>` + (list.map((r) => requestCard(r, isHk)).join("") || `<p class="muted">${esc(t("req.none"))}</p>`);
  $("#req-list").innerHTML = (offers ? section(t("req.received"), received, true) : "") + section(t("req.sent"), sent, false);
}
$("#req-list").addEventListener("click", guard(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.chat) return openChat(Number(b.dataset.chat), b.dataset.name);
  if (b.dataset.act) await api("PATCH", `/api/requests/${b.dataset.id}`, { status: b.dataset.act });
  else if (b.dataset.review) {
    await api("POST", `/api/requests/${b.dataset.review}/review`, { rating: Number(b.parentElement.querySelector("select").value) });
    flash(t("req.review_thanks"));
  } else return;
  await loadRequests();
}));

// ---------- messages ----------
// A conversation belongs to one accepted request. While it's open we poll for new messages every few seconds.
let chat = null; // { id, last, seen:Set, timer }

function renderMessage(m) {
  const div = document.createElement("div");
  div.className = "bubble" + (m.mine ? " mine" : "");
  div.append(document.createTextNode(m.body)); // text node: message content is never parsed as HTML
  const hint = I18n.core.langHint(m.body, I18n.lang);
  if (hint) div.lang = hint; // WCAG 3.1.2: a message in another script than the screen language is read in its own voice
  const tm = document.createElement("time");
  tm.dateTime = m.created_at;
  tm.textContent = I18n.dateTime(m.created_at);
  div.append(tm);
  return div;
}

function addMessages(list) {
  const log = $("#chat-log");
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  let added = false;
  for (const m of list) {
    if (chat.seen.has(m.id)) continue;
    chat.seen.add(m.id);
    log.querySelector(".empty")?.remove();
    log.append(renderMessage(m)); added = true;
  }
  if (added && nearBottom) log.scrollTop = log.scrollHeight;
}

async function pollChat() {
  if (!chat) return;
  const c = chat;
  const r = await api("GET", `/api/requests/${c.id}/messages?after=${c.last}`);
  if (chat !== c) return; // closed or switched while waiting
  if (r.messages.length) c.last = Math.max(c.last, ...r.messages.map((m) => m.id));
  addMessages(r.messages);
  if (!c.seen.size && !$("#chat-log .empty")) {
    $("#chat-log").innerHTML = '<p class="empty muted"></p>';
    $("#chat-log .empty").textContent = t("chat.empty");
  }
  const firstLoad = !c.first;
  if (firstLoad) $("#chat-log").scrollTop = $("#chat-log").scrollHeight; // jump to the latest message when opening
  c.first = true;
  if (firstLoad || r.messages.length) refreshBadge(); // the unread count can only have changed if something happened
}

async function openChat(id, name) {
  closeChat();
  chat = { id, name, last: 0, seen: new Set(), timer: null, first: false };
  $("#chat-title").textContent = t("chat.title", { name });
  $("#chat-log").innerHTML = "";
  $("#chat-dlg").showModal();
  await pollChat();
  if (!chat || chat.id !== id) return;
  chat.timer = setInterval(() => { if (!document.hidden) pollChat().catch(() => {}); }, 4000);
  $("#chat-form [name=body]").focus();
}

function closeChat() {
  if (!chat) return;
  clearInterval(chat.timer); chat = null;
  if ($("#chat-dlg").open) $("#chat-dlg").close();
  if (tab === "requests") loadRequests().catch(() => {});
  refreshBadge();
}
$("#chat-close").addEventListener("click", closeChat);
$("#chat-dlg").addEventListener("cancel", () => closeChat()); // Esc key
$("#chat-form").addEventListener("submit", guard(async (e) => {
  const input = e.target.elements.body;
  const text = input.value.trim();
  if (!text || !chat) return;
  const m = await api("POST", `/api/requests/${chat.id}/messages`, { body: text });
  input.value = "";
  addMessages([m]); // shown immediately; `last` only advances on polls so nothing from the other side is skipped
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}));

// keeps the "(n new)" label on the Requests tab fresh
async function refreshBadge() {
  if (!me?.user) return;
  try { await refreshMe(); renderShell(); } catch { /* offline: keep the old number */ }
}
setInterval(() => {
  if (!me?.user || document.hidden) return;
  refreshBadge().then(() => { if (tab === "requests" && !chat) loadRequests().catch(() => {}); });
}, 20000);

// ---------- language ----------
// Rebuilds the <option>s / checkboxes that come from /api/meta. Their values stay the English keys; only the words change, and
// whatever is selected or ticked stays that way.
function buildMetaControls() {
  if (!meta) return;
  const opts = (list, prefix) => list.map((v) => `<option value="${esc(v)}">${esc(label(prefix, v))}</option>`).join("");
  for (const [sel, list, prefix, any] of [["#f-service", meta.services, "service.", true], ["#f-avail", meta.availability, "avail.", true], ["#p-avail", meta.availability, "avail.", false]]) {
    const el = $(sel), keep = el.value;
    el.innerHTML = (any ? `<option value="">${esc(t("filter.any"))}</option>` : "") + opts(list, prefix);
    if (keep) el.value = keep;
  }
  const checked = new Set([...document.querySelectorAll("[name=svc]:checked")].map((c) => c.value));
  $("#svc-checks").innerHTML = meta.services.map((s) => `<label><input type="checkbox" name="svc" value="${esc(s)}"${checked.has(s) ? " checked" : ""}> <span>${esc(label("service.", s))}</span></label>`).join("");
}
I18n.onChange(() => {
  if (!me) return; // still booting: the first render happens when the data arrives
  buildMetaControls();
  renderShell();
  renderAdmin();
  renderResults();
  renderRequests();
  if (target && $("#dlg").open) $("#dlg-title").textContent = t("dlg.title", { name: target.name });
  if (chat) $("#chat-title").textContent = t("chat.title", { name: chat.name });
  const empty = $("#chat-log .empty");
  if (empty) empty.textContent = t("chat.empty");
  document.querySelectorAll("#chat-log time").forEach((el) => { el.textContent = I18n.dateTime(el.dateTime); });
});

// ---------- boot ----------
(async () => {
  try {
    await I18n.init();
    I18n.mountPicker($("#lang-slot"));
    [meta] = await Promise.all([api("GET", "/api/meta"), refreshMe()]);
    buildMetaControls();
    await show("find");
  } catch (err) { flash(err.message, true); }
})();
