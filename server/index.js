const { createApp } = require("./app");

const port = Number(process.env.PORT) || 3000;

createApp({
  databaseUrl: process.env.DATABASE_URL,
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  secureCookies: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY === "1",
})
  .then(({ server }) => server.listen(port, () => console.log(`Help Seeker running on http://localhost:${port}`)))
  .catch((e) => {
    console.error("Failed to start:", e.message);
    process.exit(1);
  });
