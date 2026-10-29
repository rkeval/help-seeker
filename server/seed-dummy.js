// Bigger set of obviously fake data for trying the app: housekeepers in several cities, a few households,
// and requests, reviews and messages in every state. Safe to re-run. Every email ends in @dummy.test and every
// password is "demo-pass-123". Not part of `npm run seed` (the e2e tests rely on that one staying small).
// Refuses to run against a production-looking setup unless ALLOW_DUMMY_DATA=1, so it can't litter the live site.
const { loadEnvFiles } = require("./env");
loadEnvFiles(require("node:path").join(__dirname, ".."));
const { openDb } = require("./db");
const auth = require("./auth");

const hk = [
  ["Lakshmi Nair", "Kochi", 110, 7, "Full-time", ["Cooking", "Cleaning"], "Kerala home cooking and tidy kitchens."],
  ["Fatima Khan", "Hyderabad", 160, 4, "Part-time", ["Cleaning", "Laundry", "Ironing"], "Careful with delicate fabrics."],
  ["Ramesh Yadav", "Delhi", 180, 9, "Full-time", ["Cooking", "Grocery shopping"], "Plans weekly menus and does the shopping."],
  ["Priya Singh", "Bengaluru", 210, 6, "Weekends", ["Child care", "Cleaning"], "First-aid trained, great with toddlers."],
  ["Joseph D'Souza", "Goa", 140, 12, "Full-time", ["Cooking", "Elder care"], "Patient caregiver and Goan cook."],
  ["Meena Kumari", "Jaipur", 100, 2, "Part-time", ["Dishwashing", "Cleaning"], "Quick and thorough."],
  ["Kavita Joshi", "Mumbai", 230, 8, "Part-time", ["Cleaning", "Laundry"], "Deep cleaning for flats."],
  ["Suresh Babu", "Chennai", 130, 5, "Weekends", ["Cooking", "Dishwashing"], "South Indian meals for parties."],
  ["Nisha Verma", "Pune", 125, 3, "Part-time", ["Child care", "Dishwashing"], "Reliable after-school care."],
  ["Imran Sheikh", "Kolkata", 150, 6, "Full-time", ["Cleaning", "Grocery shopping", "Ironing"], "Organised and punctual."],
  ["Geeta Rao", "Bengaluru", 170, 10, "Full-time", ["Elder care", "Cooking"], "Ten years caring for seniors."],
  ["Tara Menon", "Kochi", 115, 1, "Weekends", ["Cleaning"], "New to the platform, eager to please."],
].map(([name, city, rate, exp, avail, services, bio], i) => ({ name, email: `${name.split(/\W+/)[0].toLowerCase()}${i}@dummy.test`, city, rate, exp, avail, services, bio, phone: `+91 97000 ${String(10000 + i * 111).slice(0, 5)}` }));
const households = [["Aarav Mehta", "aarav@dummy.test", "+91 96000 00001"], ["Sara Thomas", "sara@dummy.test", "+91 96000 00002"], ["Rohan Das", "rohan@dummy.test", "+91 96000 00003"]];

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

(async () => {
  if (/onrender|neon\.tech/.test(process.env.DATABASE_URL || "") && process.env.ALLOW_DUMMY_DATA !== "1")
    throw new Error("DATABASE_URL looks like production. Set ALLOW_DUMMY_DATA=1 only if you really want fake people on the live site.");
  const db = await openDb(process.env.DATABASE_URL, { migrationUrl: process.env.DATABASE_URL_UNPOOLED });
  const mk = async (name, email, role) => {
    const have = await db.one("SELECT id FROM users WHERE email = $1", [email]);
    if (have) return { id: have.id, fresh: false };
    const u = await db.one("INSERT INTO users (email,name,role,pass_hash,email_verified_at) VALUES ($1,$2,$3,$4,now()) RETURNING id", [email, name, role, auth.hashPassword("demo-pass-123")]);
    return { id: u.id, fresh: true };
  };
  const hkIds = [], skIds = [];
  for (const h of hk) {
    const u = await mk(h.name, h.email, "housekeeper"); hkIds.push(u.id);
    if (u.fresh) await db.query("INSERT INTO profiles (user_id,city,phone,rate,exp,avail,services,bio) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [u.id, h.city, h.phone, h.rate, h.exp, h.avail, JSON.stringify(h.services), h.bio]);
  }
  const fresh = [];
  for (const [name, email] of households) { const u = await mk(name, email, "seeker"); skIds.push(u.id); fresh.push(u.fresh); }
  if (fresh.some(Boolean)) {
    for (const [si, hi, status, note, rating, msgs] of requests) {
      const r = await db.one("INSERT INTO requests (seeker_id,hk_id,seeker_phone,when_text,note,status) VALUES ($1,$2,$3,'Flexible',$4,$5) RETURNING id", [skIds[si], hkIds[hi], households[si][2], note, status]);
      if (rating) await db.query("INSERT INTO reviews (request_id,hk_id,rating) VALUES ($1,$2,$3)", [r.id, hkIds[hi], rating]);
      for (const [from, text] of msgs) await db.query("INSERT INTO messages (request_id,sender_id,body,read_at) VALUES ($1,$2,$3,now())", [r.id, from === "s" ? skIds[si] : hkIds[hi], text]);
    }
  }
  console.log(`Dummy data ready: ${hk.length} housekeepers, ${households.length} households, ${requests.length} requests (all @dummy.test, password demo-pass-123).`);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
