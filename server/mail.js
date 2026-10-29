// Sends mail through Resend's HTTP API (free tier: 3,000 emails/month) when RESEND_API_KEY is set.
// Without it, messages are printed to the server log so the flow still works in development.
function createMailer({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || "Help Seeker <onboarding@resend.dev>" } = {}) {
  return async function sendMail({ to, subject, text }) {
    if (!apiKey) {
      console.log(`[mail] to=${to} subject=${subject}\n${text}\n`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) throw new Error(`mail provider returned ${res.status}`);
  };
}

module.exports = { createMailer };
