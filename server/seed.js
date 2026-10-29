// Adds demo housekeepers (password for all: "demo-pass-123"). Safe to re-run.
const { openDb } = require("./db");
const auth = require("./auth");

const demo = [
  ["Sunita Devi", "sunita@example.com", "Pune", "+91 98000 11111", 150, 8, "Full-time", ["Cleaning", "Dishwashing", "Cooking"], "Experienced in North and South Indian home cooking."],
  ["Maria Lopez", "maria@example.com", "Mumbai", "+91 98000 22222", 200, 5, "Part-time", ["Cleaning", "Laundry", "Ironing"], "Detail-oriented deep cleaning."],
  ["Anita Sharma", "anita@example.com", "Pune", "+91 98000 33333", 120, 3, "Weekends", ["Dishwashing", "Cleaning"], "Reliable and punctual."],
  ["Ravi Kumar", "ravi@example.com", "Delhi", "+91 98000 44444", 220, 10, "Full-time", ["Cooking", "Grocery shopping", "Elder care"], "Former restaurant cook."],
];

(async () => {
  const db = await openDb(process.env.DATABASE_URL);
  for (const [name, email, city, phone, rate, exp, avail, services, bio] of demo) {
    if (await db.one("SELECT 1 FROM users WHERE email = $1", [email])) continue;
    const u = await db.one("INSERT INTO users (email,name,role,pass_hash) VALUES ($1,$2,'housekeeper',$3) RETURNING id",
      [email, name, auth.hashPassword("demo-pass-123")]);
    await db.query("INSERT INTO profiles (user_id,city,phone,rate,exp,avail,services,bio) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
      [u.id, city, phone, rate, exp, avail, JSON.stringify(services), bio]);
  }
  console.log("Seeded demo housekeepers.");
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
