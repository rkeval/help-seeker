const { createApp } = require("./app");

const port = Number(process.env.PORT) || 3000;
const { server } = createApp({
  dbFile: process.env.DB_FILE || undefined,
  secureCookies: process.env.NODE_ENV === "production",
});
server.listen(port, () => console.log(`Help Seeker running on http://localhost:${port}`));
