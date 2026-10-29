// Obviously fake sample data (12 housekeepers in Pusad, 3 households, requests, reviews, messages).
// Used by `npm run seed:dummy` and by the owner-only button on the Account tab. Every account's email ends in
// @dummy.test, which is how it is found again, hidden from everyone but the owner, and removed.
const auth = require("./auth");

const DOMAIN = "@dummy.test";
const isDummyEmail = (email) => String(email).toLowerCase().endsWith(DOMAIN);

const hk = [
  ["Lakshmi Nair", 110, 7, "Full-time", ["Cooking", "Cleaning"], "Kerala home cooking and tidy kitchens."],
  ["Fatima Khan", 160, 4, "Part-time", ["Cleaning", "Laundry", "Ironing"], "Careful with delicate fabrics."],
  ["Ramesh Yadav", 180, 9, "Full-time", ["Cooking", "Grocery shopping"], "Plans weekly menus and does the shopping."],
  ["Priya Singh", 210, 6, "Weekends", ["Child care", "Cleaning"], "First-aid trained, great with toddlers."],
  ["Joseph D'Souza", 140, 12, "Full-time", ["Cooking", "Elder care"], "Patient caregiver and Goan cook."],
  ["Meena Kumari", 100, 2, "Part-time", ["Dishwashing", "Cleaning"], "Quick and thorough."],
  ["Kavita Joshi", 230, 8, "Part-time", ["Cleaning", "Laundry"], "Deep cleaning for flats."],
  ["Suresh Babu", 130, 5, "Weekends", ["Cooking", "Dishwashing"], "South Indian meals for parties."],
  ["Nisha Verma", 125, 3, "Part-time", ["Child care", "Dishwashing"], "Reliable after-school care."],
  ["Imran Sheikh", 150, 6, "Full-time", ["Cleaning", "Grocery shopping", "Ironing"], "Organised and punctual."],
  ["Geeta Rao", 170, 10, "Full-time", ["Elder care", "Cooking"], "Ten years caring for seniors."],
  ["Tara Menon", 115, 1, "Weekends", ["Cleaning"], "New to the platform, eager to please."],
].map(([name, rate, exp, avail, services, bio], i) => ({ name, email: `${name.split(/\W+/)[0].toLowerCase()}${i}${DOMAIN}`, city: "Pusad", rate, exp, avail, services, bio, phone: `+91 97000 ${String(10000 + i * 111).slice(0, 5)}` }));
const households = [["Aarav Mehta", "aarav", "+91 96000 00001"], ["Sara Thomas", "sara", "+91 96000 00002"], ["Rohan Das", "rohan", "+91 96000 00003"]]
  .map(([name, local, phone]) => ({ name, email: local + DOMAIN, phone }));

// [household index, housekeeper index, status, note, rating|null, [messages: from "s"(household)|"h", text]]
const requests = [
  [0, 0, "accepted", "Need cooking for a family of four, weekday evenings.", 5, [["s", "Hi! Could you start Monday?"], ["h", "Yes, Monday at 5 works."]]],
  [0, 3, "accepted", "Weekend care for a 3-year-old.", 4, []],
  [1, 2, "accepted", "Weekly menu planning and shopping.", 5, [["s", "Thanks for the great first week!"]]],
  [1, 6, "declined", "Deep clean before a move.", null, []],
  [2, 4, "pending", "Evening care for my mother.", null, []],
  [2, 10, "pending", "Cooking and care, six days a week.", null, []],
  [0, 5, "accepted", "Daily dishes and floor cleaning.", 3, []],
];
const COUNTS = { housekeepers: hk.length, households: households.length, requests: requests.length };

/** Adds the sample data; does nothing for accounts that already exist, so it is safe to repeat.
 *  `password` is what the sample accounts get: the CLI uses a documented one for local play, the website button a random
 *  one nobody knows, so nobody can sign in as a sample person. */
async function addDummy(db, { password }) {
  const hash = auth.hashPassword(password);
  const mk = async (name, email, role) => {
    const have = await db.one("SELECT id FROM users WHERE email = $1", [email]);
    if (have) return { id: have.id, fresh: false };
    const u = await db.one("INSERT INTO users (email,name,role,pass_hash,email_verified_at) VALUES ($1,$2,$3,$4,now()) RETURNING id", [email, name, role, hash]);
    return { id: u.id, fresh: true };
  };
  const hkIds = [], skIds = [], fresh = [];
  for (const h of hk) {
    const u = await mk(h.name, h.email, "housekeeper"); hkIds.push(u.id);
    if (u.fresh) await db.query("INSERT INTO profiles (user_id,city,phone,rate,exp,avail,services,bio) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [u.id, h.city, h.phone, h.rate, h.exp, h.avail, JSON.stringify(h.services), h.bio]);
  }
  for (const s of households) { const u = await mk(s.name, s.email, "seeker"); skIds.push(u.id); fresh.push(u.fresh); }
  if (fresh.some(Boolean)) {
    for (const [si, hi, status, note, rating, msgs] of requests) {
      const r = await db.one("INSERT INTO requests (seeker_id,hk_id,seeker_phone,when_text,note,status) VALUES ($1,$2,$3,'Flexible',$4,$5) RETURNING id", [skIds[si], hkIds[hi], households[si].phone, note, status]);
      if (rating) await db.query("INSERT INTO reviews (request_id,hk_id,rating) VALUES ($1,$2,$3)", [r.id, hkIds[hi], rating]);
      for (const [from, text] of msgs) await db.query("INSERT INTO messages (request_id,sender_id,body,read_at) VALUES ($1,$2,$3,now())", [r.id, from === "s" ? skIds[si] : hkIds[hi], text]);
    }
  }
  return COUNTS;
}

/** Deletes every @dummy.test account; their profiles, requests, reviews and messages go with them. Real accounts are untouched. */
async function removeDummy(db) {
  const r = await db.query("DELETE FROM users WHERE lower(email) LIKE '%@dummy.test'");
  return { removed: r.rowCount };
}

const countDummy = async (db) =>
  (await db.one("SELECT COUNT(*)::int AS n FROM profiles p JOIN users u ON u.id = p.user_id WHERE lower(u.email) LIKE '%@dummy.test'")).n;

module.exports = { addDummy, removeDummy, countDummy, isDummyEmail, COUNTS };
