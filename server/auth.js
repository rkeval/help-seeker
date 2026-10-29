const crypto = require("node:crypto");

const SESSION_MS = 14 * 24 * 3600 * 1000;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query("DELETE FROM sessions WHERE expires_at < now()"); // housekeeping so the table doesn't grow forever
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
    [sha256(token), userId, new Date(Date.now() + SESSION_MS)]);
  return token;
}

async function userFromToken(db, token) {
  if (!token) return null;
  return db.one(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
}

async function destroySession(db, token) {
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

async function destroyAllSessions(db, userId) {
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, secure) {
  const attrs = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${token ? SESSION_MS / 1000 : 0}`];
  if (secure) attrs.push("Secure");
  return `sid=${token || ""}; ${attrs.join("; ")}`;
}

module.exports = { sha256, hashPassword, verifyPassword, createSession, userFromToken, destroySession, destroyAllSessions, parseCookies, sessionCookie };
