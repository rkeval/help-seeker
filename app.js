const SERVICES = ["Cleaning", "Dishwashing", "Cooking", "Laundry", "Ironing", "Grocery shopping", "Child care", "Elder care"];
const KEY = { hk: "hs.housekeepers", req: "hs.requests" };

const SEED = [
  { id: 1, name: "Sunita Devi", city: "Pune", phone: "+91 98000 11111", rate: 150, exp: 8, avail: "Full-time", rating: 4.8, services: ["Cleaning", "Dishwashing", "Cooking"], bio: "Experienced in North and South Indian home cooking." },
  { id: 2, name: "Maria Lopez", city: "Mumbai", phone: "+91 98000 22222", rate: 200, exp: 5, avail: "Part-time", rating: 4.6, services: ["Cleaning", "Laundry", "Ironing"], bio: "Detail-oriented deep cleaning." },
  { id: 3, name: "Anita Sharma", city: "Pune", phone: "+91 98000 33333", rate: 120, exp: 3, avail: "Weekends", rating: 4.3, services: ["Dishwashing", "Cleaning"], bio: "Reliable and punctual." },
  { id: 4, name: "Ravi Kumar", city: "Delhi", phone: "+91 98000 44444", rate: 220, exp: 10, avail: "Full-time", rating: 4.9, services: ["Cooking", "Grocery shopping", "Elder care"], bio: "Former restaurant cook." },
];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let housekeepers = load(KEY.hk, null) || SEED;
let requests = load(KEY.req, []);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- setup ---
$("#f-service").insertAdjacentHTML("beforeend", SERVICES.map((s) => `<option>${s}</option>`).join(""));
$("#svc-checks").innerHTML = SERVICES.map((s) => `<label><input type="checkbox" name="svc" value="${s}"> ${s}</label>`).join("");

// --- tabs ---
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== b.dataset.tab));
  if (b.dataset.tab === "requests") renderRequests();
}));

// --- search ---
function renderResults() {
  const service = $("#f-service").value;
  const city = $("#f-city").value.trim().toLowerCase();
  const maxRate = Number($("#f-rate").value) || Infinity;
  const avail = $("#f-avail").value;
  const sort = $("#f-sort").value;

  const list = housekeepers
    .filter((h) => (!service || h.services.includes(service)) && (!city || h.city.toLowerCase().includes(city)) && h.rate <= maxRate && (!avail || h.avail === avail))
    .sort((a, b) => sort === "rate" ? a.rate - b.rate : sort === "exp" ? b.exp - a.exp : b.rating - a.rating);

  $("#count").textContent = `${list.length} housekeeper${list.length === 1 ? "" : "s"} found`;
  $("#results").innerHTML = list.map((h) => `
    <article class="card hk">
      <h3>${esc(h.name)}</h3>
      <div class="meta">${esc(h.city)} · ${esc(h.avail)} · ${h.exp} yrs · ★ ${h.rating ? h.rating.toFixed(1) : "New"}</div>
      <div>${h.services.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>
      <p>${esc(h.bio || "")}</p>
      <p class="rate">₹${h.rate}/hour</p>
      <button data-id="${h.id}">Request contact</button>
    </article>`).join("") || `<p class="muted">No matches. Try loosening the filters.</p>`;
}
$("#filters").addEventListener("input", renderResults);
$("#filters").addEventListener("submit", (e) => e.preventDefault());

// --- request dialog ---
let target = null;
$("#results").addEventListener("click", (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  target = housekeepers.find((h) => h.id === Number(id));
  $("#dlg-title").textContent = `Request ${target.name}`;
  $("#dlg").showModal();
});
$("#dlg-cancel").addEventListener("click", () => $("#dlg").close());
$("#req-form").addEventListener("submit", (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  requests.unshift({ ...f, hkId: target.id, hkName: target.name, hkPhone: target.phone, at: new Date().toISOString() });
  save(KEY.req, requests);
  e.target.reset();
});

function renderRequests() {
  $("#req-list").innerHTML = requests.map((r) => `
    <div class="card"><strong>${esc(r.hkName)}</strong> · <a href="tel:${esc(r.hkPhone)}">${esc(r.hkPhone)}</a>
    <div class="muted">${new Date(r.at).toLocaleString()} · ${esc(r.when || "flexible")}</div>
    <div>${esc(r.note || "")}</div></div>`).join("") || `<p class="muted">No requests yet.</p>`;
}

// --- housekeeper signup ---
$("#join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const services = fd.getAll("svc");
  if (!services.length) return alert("Pick at least one service.");
  housekeepers.push({
    id: Date.now(), name: fd.get("name").trim(), city: fd.get("city").trim(), phone: fd.get("phone").trim(),
    rate: Number(fd.get("rate")), exp: Number(fd.get("exp")) || 0, avail: fd.get("avail"), rating: 0,
    services, bio: fd.get("bio").trim(),
  });
  save(KEY.hk, housekeepers);
  e.target.reset();
  document.querySelector('[data-tab="find"]').click();
  renderResults();
});

renderResults();
