const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
// Drives the real React Native screens through react-native-web (see e2e/run.sh) against the real backend.
// Native-only behaviour (secure storage, real alerts, gestures) is NOT covered.
const APP = process.env.E2E_URL || 'http://localhost:3130', API = APP, LOG = process.env.E2E_LOG || process.argv[2];
const results = [], errors = [];
const step = async (name, fn) => { try { await fn(); results.push(true); console.log('  ✓', name); } catch (e) { results.push(false); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tokenFor = (email) => {
  const b = fs.readFileSync(LOG, 'utf8').split('[mail] ').filter(x => x.startsWith('to=' + email) && x.includes('verify.html'));
  return /token=([\w-]+)/.exec(b[b.length - 1])[1];
};

(async () => {
  const browser = await chromium.launch();
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } }); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push('console: ' + m.text()));
    await p.goto(APP); await p.waitForSelector('text=Help Seeker'); return p;
  };
  const tap = (p, text, opts = {}) => p.locator(`xpath=//*[@role="button" or @role="tab" or self::div[@tabindex="0"]][.//text()[normalize-space()="${text}"] or normalize-space()="${text}"]`).nth(opts.nth ?? 0).click();
  const tapText = (p, text) => p.getByText(text, { exact: true }).first().click();
  const field = (p, label) => p.locator(`xpath=//div[normalize-space(text())="${label}"]/following-sibling::*[self::input or self::textarea][1]`);
  const fill = async (p, label, v) => { await field(p, label).fill(v); };
  const alerts = (p) => p.evaluate(() => window.__alerts);
  const lastAlert = async (p) => (await alerts(p)).slice(-1)[0] || '';
  const waitAlert = async (p, re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await alerts(p)).some(a => re.test(a))) return; await sleep(100); } throw new Error('no alert matching ' + re + ' — got: ' + JSON.stringify(await alerts(p))); };
  const confirmEmail = async (email) => { const r = await fetch(API + '/api/email-verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenFor(email) }) }); assert.equal(r.status, 200); };
  const signUp = async (p, role, name, email) => {
    await tapText(p, 'Sign in'); await tapText(p, 'New here? Create an account');
    await tapText(p, role === 'housekeeper' ? 'Housekeeper' : 'Household');
    await fill(p, 'Name', name); await fill(p, 'Email', email); await fill(p, 'Password (8+ characters)', 'password123');
    await tapText(p, 'Create account');
  };

  console.log('\nMobile app (React Native UI via react-native-web) against the real backend');
  const mia = await open();
  await step('home screen lists housekeepers with ratings, rates and service chips', async () => {
    await mia.waitForSelector('text=Request contact'); assert.ok(await mia.getByText('Sunita Devi').isVisible()); assert.ok(await mia.getByText('₹150/hour').isVisible());
  });
  await step('tapping "Request contact" while signed out sends you to sign in', async () => { await tapText(mia, 'Request contact'); await mia.waitForSelector('text=Forgot password?'); });
  await step('forgot password: asks for the email and says a link is on its way', async () => {
    await tapText(mia, 'Forgot password?'); await fill(mia, 'Email', 'nobody@example.com'); await tapText(mia, 'Send reset link');
    await waitAlert(mia, /Check your email: If that email has an account/);
  });

  console.log('\nHousekeeper (Mia)');
  await mia.reload(); await mia.waitForSelector('text=Help Seeker');
  await step('sign up as housekeeper → "check your email" → lands on profile with confirm banner', async () => {
    await signUp(mia, 'housekeeper', 'Mia Fernandes', 'mia@x.com');
    await waitAlert(mia, /Check your email: We sent a confirmation link to mia@x.com/);
    await mia.waitForSelector('text=My housekeeper profile'); assert.ok(await mia.getByText(/Confirm your email \(mia@x.com\) so households can find you/).isVisible());
  });
  await step('profile validates on the server (no services) and then saves', async () => {
    await fill(mia, 'City / area', 'Chennai'); await fill(mia, 'Phone', '+91 90000 55555'); await fill(mia, 'Rate per hour (₹)', '110'); await fill(mia, 'Years of experience', '4');
    await tapText(mia, 'Save profile'); await waitAlert(mia, /Couldn't save: choose at least one valid service/);
    await tapText(mia, 'Cooking'); await tapText(mia, 'Cleaning'); await fill(mia, 'About you', 'South Indian meals, spotless kitchens');
    await tapText(mia, 'Save profile'); await waitAlert(mia, /Saved: Your profile will appear in search once you confirm your email/);
  });
  await step('"I\'ve confirmed" before confirming says not yet; resend is accepted by the server', async () => {
    await tapText(mia, "I've confirmed"); await waitAlert(mia, /Not confirmed yet/);
    // right after sign-up the 60s cooldown applies; the app must show the server's message, not crash
    await tapText(mia, 'Resend email'); await waitAlert(mia, /Couldn't send: We just sent you an email/);
  });
  await confirmEmail('mia@x.com');
  await step('after clicking the emailed link, "I\'ve confirmed" removes the banner', async () => {
    await tapText(mia, "I've confirmed"); await waitAlert(mia, /Thanks!: Your email is confirmed/);
    await mia.waitForFunction(() => !document.body.innerText.includes('Confirm your email (mia@x.com)'));
  });
  await step('session survives an app restart (token kept in storage)', async () => {
    await mia.reload(); await mia.waitForSelector('text=Sign out (Mia Fernandes)');
    assert.ok(await mia.getByText('Requests', { exact: true }).isVisible()); assert.ok(await mia.getByText('Profile', { exact: true }).isVisible());
  });

  console.log('\nHousehold (Tom)');
  const tom = await open();
  await step('sign up as household, confirm email, search by service chip and city', async () => {
    await signUp(tom, 'seeker', 'Tom Baker', 'tom@x.com'); await waitAlert(tom, /Check your email/);
    await tom.waitForSelector('text=Request contact');
  });
  await step('unconfirmed household is refused with the server\'s message', async () => {
    await fill(tom, 'City / area', 'Chennai'); await tom.waitForFunction(() => document.body.innerText.includes('Mia Fernandes') && !document.body.innerText.includes('Sunita Devi')); // list is filtered
    await tapText(tom, 'Request contact'); await tom.waitForSelector('text=Request Mia Fernandes');
    await fill(tom, 'Your phone', '98765 43210'); await tapText(tom, 'Send request'); await waitAlert(tom, /Couldn't send: Please verify your email address first/);
    await tapText(tom, 'Cancel');
  });
  await confirmEmail('tom@x.com');
  await step('after confirming, the request goes through', async () => {
    await tapText(tom, "I've confirmed"); await waitAlert(tom, /Thanks!/);
    await tapText(tom, 'Cooking'); await tom.waitForSelector('text=Mia Fernandes'); assert.equal(await tom.getByText('Sunita Devi').count(), 0, 'city filter should hide others'); assert.equal(await tom.getByText('Request contact').count(), 1);
    await tapText(tom, 'Request contact'); await fill(tom, 'Your phone', '98765 43210'); await fill(tom, 'When do you need help?', 'Mornings'); await fill(tom, 'Details', '3BHK, <b>no onions</b>');
    await tapText(tom, 'Send request'); await waitAlert(tom, /Request sent: You'll see Mia Fernandes's phone number once they accept/);
  });
  await step('Tom sees the request as pending without Mia\'s number', async () => {
    await tapText(tom, 'Requests'); await tom.waitForSelector('text=pending'); assert.equal(await tom.getByText(/90000 55555/).count(), 0);
  });

  console.log('\nBack to Mia');
  await step('Mia sees the incoming request (HTML shown as text) and accepts', async () => {
    await tapText(mia, 'Requests'); await mia.waitForSelector('text=Tom Baker'); assert.ok(await mia.getByText('3BHK, <b>no onions</b>').isVisible());
    assert.ok(await mia.getByText('Call 98765 43210').isVisible()); await tapText(mia, 'Accept'); await mia.waitForSelector('text=accepted');
  });

  console.log('\nTom again');
  await step('pull-to-refresh equivalent: reopening Requests shows "accepted" and a Call button with Mia\'s number', async () => {
    await tom.reload(); await tom.waitForSelector('text=Sign out (Tom Baker)'); await tapText(tom, 'Requests');
    await tom.waitForSelector('text=accepted'); assert.ok(await tom.getByText('Call +91 90000 55555').isVisible());
  });
  await step('Tom rates Mia 5★; the rating shows in search', async () => {
    await tapText(tom, '5★'); await tom.waitForSelector('text=You rated this'); await tapText(tom, 'Find');
    await tom.waitForSelector('text=Mia Fernandes'); assert.ok(await tom.getByText(/★ 5 \(1\)/).isVisible());
  });
  await step('delete account: asks for the password, then signs out and removes Tom\'s data', async () => {
    await tapText(tom, 'Account'); await fill(tom, 'Password', 'wrong-password'); await tapText(tom, 'Delete my account'); await waitAlert(tom, /Couldn't delete: wrong password/);
    await fill(tom, 'Password', 'password123'); await tapText(tom, 'Delete my account'); await waitAlert(tom, /Account deleted/);
    await tom.waitForSelector('text=Sign in');
    const r = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tom@x.com', password: 'password123' }) });
    assert.equal(r.status, 401);
  });
  await step('Mia\'s inbox no longer contains the deleted household\'s request', async () => {
    await mia.reload(); await mia.waitForSelector('text=Sign out (Mia Fernandes)'); await tapText(mia, 'Requests'); await mia.waitForSelector('text=Nothing here yet.');
  });
  await step('sign out works; wrong password is refused; the right one signs Mia back in', async () => {
    await tapText(mia, 'Sign out (Mia Fernandes)'); await mia.waitForSelector('text=Sign in');
    const submit = () => mia.locator('xpath=(//*[normalize-space()="Sign in"])[last()]').click();
    await tapText(mia, 'Sign in'); await fill(mia, 'Email', 'mia@x.com'); await fill(mia, 'Password (8+ characters)', 'wrong-password-1'); await submit();
    await waitAlert(mia, /wrong email or password/);
    await fill(mia, 'Password (8+ characters)', 'password123'); await submit(); await mia.waitForSelector('text=Sign out (Mia Fernandes)');
  });
  await step('no unexpected errors in the app', async () => assert.deepEqual(errors, []));
  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SCRIPT CRASHED', e); process.exit(2); });
