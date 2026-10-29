const { Pool } = require("pg");

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('seeker','housekeeper')),
    pass_hash TEXT NOT NULL,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    phone TEXT NOT NULL,
    rate INTEGER NOT NULL,
    exp INTEGER NOT NULL DEFAULT 0,
    avail TEXT NOT NULL,
    services JSONB NOT NULL,
    bio TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    seeker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hk_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seeker_phone TEXT NOT NULL,
    when_text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS requests_hk_idx ON requests(hk_id);
  CREATE INDEX IF NOT EXISTS requests_seeker_idx ON requests(seeker_id);
  CREATE UNIQUE INDEX IF NOT EXISTS requests_one_pending ON requests(seeker_id, hk_id) WHERE status = 'pending';
  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
    hk_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS reviews_hk_idx ON reviews(hk_id);
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS messages_request_idx ON messages(request_id, id);
  CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages(request_id) WHERE read_at IS NULL;
  CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages(sender_id, created_at);
`;

// Postgres error codes we turn into friendly HTTP errors
const UNIQUE_VIOLATION = "23505";

/**
 * Opens a connection pool and creates the tables if needed.
 * `schema` (used by tests) isolates everything in its own Postgres schema, dropped again on close().
 */
async function openDb(connectionString, { schema } = {}) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (schema) {
    const boot = new Pool({ connectionString, max: 1 });
    await boot.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await boot.end();
  }
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX) || 10,
    options: schema ? `-c search_path="${schema}"` : undefined,
  });
  pool.on("error", (e) => console.error("idle database client error:", e.message)); // don't crash on dropped idle connections

  const db = {
    /** Runs a query with $1, $2… parameters and returns the rows. */
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    one: async (sql, params = []) => (await pool.query(sql, params)).rows[0] ?? null,
    isUniqueViolation: (e) => e?.code === UNIQUE_VIOLATION,
    async close() {
      if (schema) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    },
  };
  await pool.query(SCHEMA_SQL);
  return db;
}

module.exports = { openDb };
