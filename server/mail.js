// Sends mail through Resend's HTTP API (free tier: 3,000 emails/month) when RESEND_API_KEY is set.
// Without it, messages are printed to the server log so the flow still works in development.
// Text is UTF-8 throughout: the request body is JSON declared as UTF-8, Resend encodes non-ASCII subjects for the mail
// system (RFC 2047) itself, and `Content-Language` tells the receiving mail client which language the message is in.
function createMailer({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || "Help Seeker <onboarding@resend.dev>" } = {}) {
  return async function sendMail({ to, subject, text, lang }) {
    if (!apiKey) {
      console.log(`[mail] to=${to} lang=${lang || "en"} subject=${subject}\n${text}\n`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ from, to, subject, text, ...(lang ? { headers: { "Content-Language": lang } } : {}) }),
    });
    if (!res.ok) throw new Error(`mail provider returned ${res.status}`);
  };
}

module.exports = { createMailer };
