// Adds demo housekeepers (password for all: "demo-pass-123"). Safe to re-run.
const { openDb } = require("./db");
const auth = require("./auth");
const path = require("node:path");

const db = openDb(process.env.DB_FILE || path.join(__dirname, "..", "data", "app.db"));
const demo = [
  ["Sunita Devi", "sunita@example.com", "Pune", "+91 98000 11111", 150, 8, "Full-time", ["Cleaning", "Dishwashing", "Cooking"], "Experienced in North and South Indian home cooking."],
  ["Maria Lopez", "maria@example.com", "Mumbai", "+91 98000 22222", 200, 5, "Part-time", ["Cleaning", "Laundry", "Ironing"], "Detail-oriented deep cleaning."],
  ["Anita Sharma", "anita@example.com", "Pune", "+91 98000 33333", 120, 3, "Weekends", ["Dishwashing", "Cleaning"], "Reliable and punctual."],
  ["Ravi Kumar", "ravi@example.com", "Delhi", "+91 98000 44444", 220, 10, "Full-time", ["Cooking", "Grocery shopping", "Elder care"], "Former restaurant cook."],
];
for (const [name, email, city, phone, rate, exp, avail, services, bio] of demo) {
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) continue;
  const { lastInsertRowid } = db.prepare("INSERT INTO users (email,name,role,pass_hash) VALUES (?,?,?,?)")
    .run(email, name, "housekeeper", auth.hashPassword("demo-pass-123"));
  db.prepare("INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?)")
    .run(Number(lastInsertRowid), city, phone, rate, exp, avail, JSON.stringify(services), bio);
}
console.log("Seeded demo housekeepers.");
