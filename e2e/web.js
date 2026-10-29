const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
// Runs against a freshly seeded database (see e2e/run.sh). Confirmation/reset links are read from the server's log,
// because without RESEND_API_KEY the server prints emails instead of sending them.
const U = process.env.E2E_URL || 'http://localhost:3120', LOG = process.env.E2E_LOG || process.argv[2];
const results = []; const pageErrors = [];
const step = async (name, fn) => {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); }
  catch (e) { results.push([false, name]); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); }
};
const mailLink = (email, kind) => {
  const blocks = fs.readFileSync(LOG, 'utf8').split('[mail] ').filter(b => b.startsWith('to=' + email) && b.includes(kind));
  return /http:\/\/\S+\?token=\S+/.exec(blocks[blocks.length - 1])[0];
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const page = async () => { const p = await (await b.newContext()).newPage(); p.on('pageerror', e => pageErrors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && pageErrors.push('console: ' + m.text())); await p.goto(U); return p; };
  const count = async (p) => Number((await p.textContent('#count')).split(' ')[0]);
  const flashText = async (p, sel = '.msg:not([hidden])') => (await p.locator(sel).last().textContent()).trim();
  const register = async (p, role, name, email, pw = 'password123') => {
    await p.click('#signin'); await p.selectOption('#register-form [name=role]', role);
    await p.fill('#register-form [name=name]', name); await p.fill('#register-form [name=email]', email);
    await p.fill('#register-form [name=password]', pw); await p.click('#register-form button[type=submit]');
  };
  const login = async (p, email, pw) => {
    await p.click('#signin'); await p.fill('#login-form [name=email]', email); await p.fill('#login-form [name=password]', pw);
    await p.click('#login-form button[type=submit]');
  };
  const confirmEmail = async (email) => { const p = await page(); await p.goto(mailLink(email, 'verify.html')); await p.waitForSelector('#status:has-text("confirmed")'); await p.close(); };

  console.log('\n1. Public site and API security (production mode)');
  const anon = await page();
  await step('landing page lists the 4 seeded housekeepers', async () => { await anon.waitForSelector('.hk'); assert.equal(await count(anon), 4); });
  await step('search results never include phone numbers or emails', async () => {
    const body = await (await fetch(U + '/api/housekeepers')).text();
    assert.ok(!/phone|email|98000/i.test(body), 'leaked: ' + body.slice(0, 200));
  });
  await step('protected endpoints refuse anonymous calls', async () => {
    for (const [m, p] of [['GET', '/api/requests'], ['PUT', '/api/profile'], ['POST', '/api/requests'], ['POST', '/api/account/delete']]) {
      const r = await fetch(U + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 401, `${m} ${p} -> ${r.status}`);
    }
  });
  await step('session cookie is HttpOnly, Secure, SameSite=Lax; token is not in the body', async () => {
    const r = await fetch(U + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cookie@x.com', name: 'C', password: 'password123', role: 'seeker' }) });
    const c = r.headers.get('set-cookie'); assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/);
    assert.equal((await r.json()).token, undefined);
  });
  await step('path traversal and unknown routes are 404', async () => {
    assert.equal((await fetch(U + '/..%2f..%2fpackage.json')).status, 404);
    assert.equal((await fetch(U + '/server/app.js')).status, 404);
    assert.equal((await fetch(U + '/api/nope')).status, 404);
  });

  console.log('\n2. Housekeeper signs up (Hema)');
  const hk = await page();
  await register(hk, 'housekeeper', 'Hema Patel', 'hema@x.com');
  await step('lands on profile form with a "confirm your email" banner', async () => {
    await hk.waitForSelector('#profile-form:visible'); assert.ok(await hk.locator('#verify-banner').isVisible());
  });
  await step('can save a profile while unconfirmed', async () => {
    await hk.fill('#profile-form [name=city]', 'Goa'); await hk.fill('#profile-form [name=phone]', '+91 90000 12345');
    await hk.fill('#profile-form [name=rate]', '90'); await hk.fill('#profile-form [name=exp]', '6');
    await hk.selectOption('#p-avail', 'Part-time');
    for (const s of ['Cooking', 'Dishwashing', 'Cleaning']) await hk.check(`[name=svc][value=${s}]`);
    await hk.fill('#profile-form [name=bio]', 'Home-style cooking & tidy kitchens');
    await hk.click('#profile-form button[type=submit]'); await hk.waitForSelector('.msg:has-text("once you confirm your email")');
  });
  await step('is hidden from search until confirmed', async () => { await anon.reload(); await anon.waitForSelector('.hk'); assert.equal(await count(anon), 4); });

  console.log('\n3. Household signs up (Sam) and is held back until confirming');
  const sk = await page();
  await register(sk, 'seeker', 'Sam Rivera', 'sam@x.com');
  await step('can browse but contacting is refused with a clear message', async () => {
    await sk.waitForSelector('#results button[data-hk]'); await sk.click('#results button[data-hk] >> nth=0');
    await sk.fill('#req-form [name=phone]', '98765 43210'); await sk.click('#req-form button[type=submit]');
    await sk.waitForSelector('.msg.err'); assert.match(await flashText(sk, '.msg.err'), /verify your email/i);
    await sk.click('#dlg-cancel');
  });
  await step('"I\'ve confirmed" before confirming says not yet; a second resend is rate-limited', async () => {
    await sk.click('#recheck-verify'); await sk.waitForSelector('.msg.err:has-text("Not confirmed yet")');
    await sk.click('#resend-verify'); await sk.waitForSelector('.msg.err:has-text("wait a minute")');
  });

  console.log('\n4. Email confirmation');
  await step('confirmation links work, are single-use, and get hidden from the address bar', async () => {
    const link = mailLink('hema@x.com', 'verify.html'); const p = await page(); await p.goto(link);
    await p.waitForSelector('#status:has-text("confirmed")'); assert.ok(!p.url().includes('token'));
    await p.goto(link); await p.waitForSelector('#status.err'); await p.close();
  });
  await confirmEmail('sam@x.com');
  await step('banners disappear after "I\'ve confirmed"', async () => {
    for (const p of [hk, sk]) { await p.click('#recheck-verify'); await p.waitForSelector('.msg:has-text("Thanks")'); assert.ok(!(await p.locator('#verify-banner').isVisible())); }
  });

  console.log('\n5. Search and filters');
  await step('Hema now appears (5 housekeepers)', async () => { await anon.reload(); await anon.waitForSelector('.hk'); assert.equal(await count(anon), 5); });
  await step('service + city filter finds exactly Hema', async () => {
    await sk.click('[data-tab=find]'); await sk.selectOption('#f-service', 'Cooking'); await sk.fill('#f-city', 'goa'); await sk.waitForTimeout(500);
    assert.equal(await count(sk), 1); assert.match(await sk.textContent('#results'), /Hema Patel/);
  });
  await step('max rate, availability and sorting work', async () => {
    await sk.fill('#f-city', ''); await sk.selectOption('#f-service', ''); await sk.fill('#f-rate', '100'); await sk.waitForTimeout(500);
    assert.deepEqual((await sk.locator('.hk h3').allTextContents()).sort(), ['Hema Patel']);
    await sk.fill('#f-rate', ''); await sk.selectOption('#f-avail', 'Weekends'); await sk.waitForTimeout(500);
    assert.deepEqual(await sk.locator('.hk h3').allTextContents(), ['Anita Sharma']);
    await sk.selectOption('#f-avail', ''); await sk.selectOption('#f-sort', 'rate'); await sk.waitForTimeout(500);
    const rates = (await sk.locator('.hk .rate').allTextContents()).map(t => Number(t.replace(/\D/g, '')));
    assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
  });
  await step('LIKE wildcards in the city box are treated literally', async () => {
    await sk.selectOption('#f-sort', 'rating'); await sk.fill('#f-city', '%'); await sk.waitForTimeout(500); assert.equal(await count(sk), 0); await sk.fill('#f-city', '');
  });

  console.log('\n6. Request → accept → phone reveal → review');
  await step('Sam sends Hema a request containing HTML', async () => {
    await sk.selectOption('#f-service', 'Cooking'); await sk.fill('#f-city', 'Goa'); await sk.waitForTimeout(500);
    await sk.click('#results button[data-hk]'); await sk.fill('#req-form [name=phone]', '98765 43210');
    await sk.fill('#req-form [name=when]', 'Weekday evenings'); await sk.fill('#req-form [name=note]', '2BHK <img src=x onerror="window.pwned=1"> need dinner');
    await sk.click('#req-form button[type=submit]'); await sk.waitForSelector('.msg:has-text("Request sent")');
  });
  await step('duplicate pending request is rejected', async () => {
    await sk.click('#results button[data-hk]'); await sk.fill('#req-form [name=phone]', '98765 43210'); await sk.click('#req-form button[type=submit]');
    await sk.waitForSelector('.msg.err:has-text("already have a pending request")'); await sk.click('#dlg-cancel');
  });
  await step('Hema sees it with Sam\'s number; the HTML is shown as text, not run', async () => {
    await hk.click('[data-tab=requests]'); await hk.waitForSelector('text=98765 43210');
    assert.ok((await hk.textContent('#req-list')).includes('<img src=x')); assert.equal(await hk.evaluate(() => window.pwned), undefined);
    assert.equal(await hk.locator('#req-list img').count(), 0);
  });
  await step('before accepting, Sam cannot see Hema\'s phone', async () => {
    await sk.click('[data-tab=requests]'); await sk.waitForSelector('.badge.pending'); assert.ok(!(await sk.textContent('#req-list')).includes('90000'));
  });
  await step('Hema accepts; Sam now sees her phone', async () => {
    await hk.click('button[data-act=accepted]'); await hk.waitForSelector('.badge.accepted');
    await sk.click('[data-tab=find]'); await sk.click('[data-tab=requests]'); await sk.waitForSelector('text=+91 90000 12345');
  });
  console.log('\n6b. Messages between Sam and Hema');
  await step('Sam opens the chat (empty) and sends a message that contains HTML', async () => {
    await sk.click('[data-tab=requests]'); await sk.click('button[data-chat]'); await sk.waitForSelector('#chat-dlg[open]');
    await sk.waitForSelector('#chat-log .empty'); assert.match(await sk.textContent('#chat-log'), /No messages yet/); assert.match(await sk.textContent('#chat-title'), /Chat with Hema/);
    await sk.fill('#chat-form [name=body]', 'Hi Hema! <b>Monday</b> works? <img src=x onerror="window.pwned2=1">');
    await sk.click('#chat-form button[type=submit]'); await sk.waitForSelector('#chat-log .bubble.mine');
    assert.equal(await sk.locator('#chat-log b, #chat-log img').count(), 0, 'message HTML must be shown as text');
    assert.ok((await sk.textContent('#chat-log')).includes('<b>Monday</b>'));
  });
  await step('Hema\'s Requests tab shows "1 new" through the real background refresh (no reload)', async () => {
    await hk.waitForSelector('nav button:has-text("(1 new)")', { timeout: 35000 });
  });
  await step('Hema opens it: sees the text (not HTML), the badge clears, she replies', async () => {
    await hk.click('[data-tab=requests]'); await hk.waitForSelector('button[data-chat]:has-text("1 new")'); await hk.click('button[data-chat]');
    await hk.waitForSelector('#chat-log .bubble:not(.mine)');
    assert.ok((await hk.textContent('#chat-log')).includes('<b>Monday</b>')); assert.equal(await hk.locator('#chat-log b, #chat-log img').count(), 0);
    assert.equal(await hk.evaluate(() => window.pwned2), undefined);
    await hk.waitForFunction(() => !document.querySelector('nav').innerText.includes('new'), null, { timeout: 8000 });
    await hk.fill('#chat-form [name=body]', 'Yes, Monday 9am works.\nSee you then!'); await hk.click('#chat-form button[type=submit]'); await hk.waitForSelector('#chat-log .bubble.mine');
  });
  await step('Sam\'s open chat picks up the reply on its own (multi-line kept)', async () => {
    await sk.waitForSelector('#chat-log .bubble:not(.mine)', { timeout: 12000 });
    assert.match(await sk.textContent('#chat-log .bubble:not(.mine)'), /Monday 9am works\.\s*See you then!/);
    assert.equal(await sk.locator('#chat-log .bubble').count(), 2);
  });
  await step('closing the chats leaves no unread anywhere', async () => {
    await hk.click('#chat-close'); await sk.click('#chat-close');
    await sk.waitForFunction(() => !document.querySelector('nav').innerText.includes('new')); await sk.click('[data-tab=requests]');
    assert.equal(await sk.locator('button[data-chat]:has-text("new")').count(), 0);
  });
  await step('Sam reviews 5 stars once; rating shows on the search card', async () => {
    await sk.selectOption('#req-list select', '5'); await sk.click('button[data-review]'); await sk.waitForSelector('text=You rated this');
    await sk.click('[data-tab=find]'); await sk.selectOption('#f-service', ''); await sk.fill('#f-city', 'Goa'); await sk.waitForTimeout(500);
    assert.match(await sk.textContent('.hk .meta'), /★ 5 \(1\)/);
  });

  console.log('\n7. Decline path with a seeded housekeeper (Ravi)');
  const rv = await page();
  await step('Sam requests Ravi; Ravi declines; Sam sees "declined" and no phone', async () => {
    await sk.fill('#f-city', 'Delhi'); await sk.waitForTimeout(500); await sk.click('#results button[data-hk]');
    await sk.fill('#req-form [name=phone]', 'abc'); assert.equal(await sk.evaluate(() => document.querySelector('#req-form [name=phone]').validity.patternMismatch), true, 'browser should reject a non-phone value');
    await sk.fill('#req-form [name=phone]', '(022) 2345-6789'); assert.equal(await sk.evaluate(() => document.querySelector('#req-form [name=phone]').validity.valid), true);
    await sk.click('#req-form button[type=submit]'); await sk.waitForSelector('.msg:has-text("Request sent")');
    await login(rv, 'ravi@example.com', 'demo-pass-123'); await rv.click('[data-tab=requests]'); await rv.waitForSelector('button[data-act=declined]');
    await rv.click('button[data-act=declined]'); await rv.waitForSelector('.badge.declined');
    await sk.click('[data-tab=requests]'); await sk.waitForSelector('.badge.declined'); assert.ok(!(await sk.textContent('#req-list')).includes('98000 44444'));
  });
  await step('only the accepted request offers Messages (the declined one does not)', async () => {
    await sk.click('[data-tab=requests]'); await sk.waitForSelector('.badge.declined'); assert.equal(await sk.locator('button[data-chat]').count(), 1);
  });
  await step('a housekeeper can hire others too, but her own card says "This is you" with no contact button', async () => {
    await rv.click('[data-tab=find]'); await rv.waitForSelector('.hk'); const n = await rv.locator('.hk').count();
    assert.equal(await rv.locator('button[data-hk]').count(), n - 1); assert.equal(await rv.locator('.hk:has-text("This is you")').count(), 1);
  });

  console.log('\n8. Forgot password');
  await step('Sam resets his password; the old session is signed out everywhere', async () => {
    const other = await page(); await other.click('#signin'); await other.click('#forgot');
    await other.fill('#forgot-form [name=email]', 'sam@x.com'); await other.click('#forgot-form button[type=submit]');
    await other.waitForSelector('.msg:has-text("reset link is on its way")');
    await other.goto(mailLink('sam@x.com', 'reset.html')); await other.fill('[name=password]', 'a-new-password-9'); await other.click('button[type=submit]'); await other.waitForSelector('#done:visible');
    await sk.reload(); await sk.waitForSelector('#signin'); // old session is gone
    await login(sk, 'sam@x.com', 'password123'); await sk.waitForSelector('.msg.err');
    await sk.fill('#login-form [name=password]', 'a-new-password-9'); await sk.click('#login-form button[type=submit]'); await sk.waitForSelector('#logout');
  });
  await step('unknown email gets the same answer as a real one', async () => {
    const o = await page(); await o.click('#signin'); await o.click('#forgot'); await o.fill('#forgot-form [name=email]', 'nobody@nowhere.com');
    await o.click('#forgot-form button[type=submit]'); await o.waitForSelector('.msg:has-text("reset link is on its way")');
  });

  console.log('\n9. Delete account');
  await step('wrong password is refused', async () => {
    await hk.click('[data-tab=account]'); await hk.fill('#delete-form [name=password]', 'nope-nope-nope'); hk.once('dialog', d => d.accept());
    await hk.click('#delete-form button[type=submit]'); await hk.waitForSelector('.msg.err:has-text("wrong password")');
  });
  await step('Hema deletes her account: gone from search, cannot sign in, her requests vanish for Sam', async () => {
    await hk.fill('#delete-form [name=password]', 'password123'); hk.once('dialog', d => d.accept());
    await hk.click('#delete-form button[type=submit]'); await hk.waitForSelector('.msg:has-text("deleted")');
    await anon.reload(); await anon.waitForSelector('.hk'); assert.equal(await count(anon), 4);
    await login(hk, 'hema@x.com', 'password123'); await hk.waitForSelector('.msg.err');
    await sk.click('[data-tab=requests]'); await sk.waitForSelector('#req-list .card'); assert.ok(!(await sk.textContent('#req-list')).includes('Hema'));
  });

  console.log('\n10. One person does both (Dana)');
  const dn = await page();
  await register(dn, 'both', 'Dana Cruz', 'dana@x.com');
  await step('signing up as "both" lands on the profile form, and the Requests tab has only the sent list until she offers services', async () => {
    await dn.waitForSelector('#profile-form:visible'); await confirmEmail('dana@x.com');
    await dn.click('[data-tab=requests]'); await dn.waitForSelector('#req-list h3:has-text("Requests I sent")');
    assert.equal(await dn.locator('#req-list h3:has-text("Requests I received")').count(), 0);
  });
  await step('Dana saves a profile and the Requests tab now shows both lists', async () => {
    await dn.click('[data-tab=profile]');
    await dn.fill('#profile-form [name=city]', 'Kochi'); await dn.fill('#profile-form [name=phone]', '+91 91111 22222');
    await dn.fill('#profile-form [name=rate]', '70'); await dn.check('[name=svc][value=Cleaning]');
    await dn.click('#profile-form button[type=submit]'); await dn.waitForSelector('.msg:has-text("Profile saved")');
    await dn.click('[data-tab=requests]'); await dn.waitForSelector('#req-list h3:has-text("Requests I received")');
    assert.equal(await dn.locator('#req-list h3:has-text("Requests I sent")').count(), 1);
  });
  await step('Dana sees her own card as "This is you" and can hire someone else', async () => {
    await dn.click('[data-tab=find]'); await dn.fill('#f-city', 'Kochi'); await dn.waitForSelector('#count:has-text("1 housekeeper found")'); await dn.waitForSelector('.hk:has-text("This is you")');
    assert.equal(await dn.locator('button[data-hk]').count(), 0);
    await dn.fill('#f-city', 'Delhi'); await dn.waitForSelector('#results button[data-hk]'); await dn.waitForSelector('.hk:has-text("Ravi")'); await dn.click('#results button[data-hk] >> nth=0');
    await dn.fill('#req-form [name=phone]', '91111 22222'); await dn.click('#req-form button[type=submit]'); await dn.waitForSelector('.msg:has-text("Request sent")');
  });
  await step('Sam hires Dana; Dana accepts under "received" and still sees what she sent', async () => {
    await sk.click('[data-tab=find]'); await sk.fill('#f-city', 'Kochi'); await sk.waitForSelector('#count:has-text("1 housekeeper found")'); await sk.waitForSelector('.hk:has-text("Dana Cruz")'); await sk.click('#results button[data-hk]');
    await sk.fill('#req-form [name=phone]', '98765 43210'); await sk.click('#req-form button[type=submit]'); await sk.waitForSelector('.msg:has-text("Request sent")');
    await dn.click('[data-tab=requests]'); await dn.waitForSelector('button[data-act=accepted]'); await dn.click('button[data-act=accepted]'); await dn.waitForSelector('.badge.accepted');
    assert.equal(await dn.locator('#req-list h3').count(), 2); assert.ok((await dn.textContent('#req-list')).includes('Sam Rivera'));
  });

  console.log('\n11. Owner-only sample data');
  const ow = await page();
  await register(ow, 'seeker', 'Olive Owner', 'owner@x.com');
  await step('the owner sees no sample-data card until the email is confirmed', async () => {
    await ow.click('[data-tab=account]'); await ow.waitForSelector('#delete-form:visible'); assert.equal(await ow.locator('#admin-card').count(), 0);
  });
  await step('after confirming, the card appears; one click adds 12 sample housekeepers that only the owner sees', async () => {
    await confirmEmail('owner@x.com'); await ow.reload(); await ow.click('[data-tab=account]'); await ow.waitForSelector('#admin-card:visible');
    await anon.reload(); await anon.waitForSelector('.hk'); const before = await count(anon); await ow.click('button[data-sample=add]'); await ow.waitForSelector('.msg:has-text("Sample data added")');
    await ow.waitForSelector('#sample-status:has-text("12 sample housekeepers")');
    await ow.click('[data-tab=find]'); await ow.waitForSelector('.hk .tag:has-text("sample")'); assert.equal(await ow.locator('.hk .tag:has-text("sample")').count(), 12);
    await anon.reload(); await anon.waitForSelector('.hk'); assert.equal(await count(anon), before);
    await sk.click('[data-tab=find]'); await sk.fill('#f-city', 'Pusad'); await sk.waitForSelector('#count:has-text("0 housekeepers")');
  });
  await step('other signed-in people never see the card, and one click removes the sample data again', async () => {
    await sk.click('[data-tab=account]'); await sk.waitForSelector('#delete-form:visible'); assert.equal(await sk.locator('#admin-card').count(), 0); assert.ok(!(await sk.content()).includes('Add sample data'));
    await ow.click('[data-tab=account]'); await ow.click('button[data-sample=remove]'); await ow.waitForSelector('.msg:has-text("Sample data removed")');
    await ow.click('[data-tab=find]'); await ow.fill('#f-city', 'Pusad'); await ow.waitForSelector('#count:has-text("0 housekeepers")');
  });

  console.log('\n12. Languages');
  const L = (lang) => JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'i18n', lang + '.json'), 'utf8'));
  const hi = L('hi'), mr = L('mr'), ml = L('ml'), ta = L('ta');
  let fakeIp = 0; // the sign-in limiter allows 20 attempts per client address, so each language scenario gets its own (the server trusts X-Forwarded-For in this run)
  const own = (opts = {}) => ({ ...opts, extraHTTPHeaders: { 'x-forwarded-for': `10.20.0.${++fakeIp}` } });
  const pageWith = async (opts) => { const p = await (await b.newContext(own(opts))).newPage(); p.on('pageerror', e => pageErrors.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && pageErrors.push('console: ' + m.text())); await p.goto(U); return p; };
  const pick = async (p, code) => { await p.selectOption('#lang-select', code); await p.waitForFunction((c) => document.documentElement.lang === c, code); };
  const lg = await page();
  await step('English by default: <html lang="en">, a labelled picker listing every language in its own script, each option tagged with its language', async () => {
    await lg.waitForSelector('.hk'); assert.equal(await lg.evaluate(() => document.documentElement.lang), 'en');
    assert.equal((await lg.textContent('label.lang-pick span')).trim(), 'Language');
    assert.equal(await lg.locator('label.lang-pick select#lang-select').count(), 1, 'the select is inside a label, so it has an accessible name');
    const opts = await lg.$$eval('#lang-select option', os => os.map(o => [o.value, o.lang, o.textContent]));
    assert.deepEqual(opts, [['en', 'en', 'English'], ['hi', 'hi', 'हिन्दी'], ['mr', 'mr', 'मराठी'], ['bn', 'bn', 'বাংলা'], ['ta', 'ta', 'தமிழ்'], ['te', 'te', 'తెలుగు'], ['kn', 'kn', 'ಕನ್ನಡ'], ['ml', 'ml', 'മലയാളം'], ['gu', 'gu', 'ગુજરાતી'], ['pa', 'pa', 'ਪੰਜਾਬੀ']]);
  });
  await step('switching to Hindi changes the page text at once, keeps what was typed, and stays on the same screen', async () => {
    await lg.fill('#f-city', 'Pune'); await lg.selectOption('#f-service', 'Cooking'); await lg.waitForTimeout(400);
    const namesBefore = await lg.locator('.hk h3').allTextContents();
    await pick(lg, 'hi');
    assert.equal((await lg.textContent('nav button.active')).trim(), hi['nav.find']);
    assert.equal((await lg.textContent('#filters label:first-child span')).trim(), hi['filter.service']);
    assert.equal(await lg.inputValue('#f-city'), 'Pune'); assert.equal(await lg.inputValue('#f-service'), 'Cooking'); // typed text and the chosen service survive; the value is still English
    assert.equal((await lg.textContent('#f-service option[value=Cooking]')).trim(), hi['service.Cooking']);
    assert.equal((await lg.textContent('#f-service option[value=""]')).trim(), hi['filter.any']);
    assert.equal(await lg.getAttribute('#f-city', 'placeholder'), hi['filter.city_ph']);
    assert.equal((await lg.title()), hi['app.title']);
    assert.equal(await lg.evaluate(() => document.querySelector('label.lang-pick select').value), 'hi');
    assert.deepEqual(await lg.locator('.hk h3').allTextContents(), namesBefore, 'names written by users are never translated');
    await lg.fill('#f-city', ''); await lg.selectOption('#f-service', ''); await lg.waitForTimeout(400);
  });
  await step('the choice is remembered after a reload; <html lang> follows it', async () => {
    await lg.reload(); await lg.waitForSelector('.hk');
    assert.equal(await lg.evaluate(() => document.documentElement.lang), 'hi'); assert.equal(await lg.inputValue('#lang-select'), 'hi');
    assert.equal(await lg.evaluate(() => localStorage.getItem('hs-lang')), 'hi');
    assert.equal((await lg.textContent('nav button.active')).trim(), hi['nav.find']);
  });
  await step('Marathi: search by service still works, results show translated service names, availability and ₹ rates with normal digits', async () => {
    await pick(lg, 'mr');
    await lg.selectOption('#f-service', 'Cooking'); await lg.waitForTimeout(500);
    const tags = await lg.locator('.hk .tag').allTextContents();
    assert.ok(tags.length > 0 && tags.includes(mr['service.Cooking']), tags.join());
    assert.ok(!tags.some(t => t === 'Cooking'), 'English service names should be translated');
    assert.match(await lg.textContent('#count'), /^\d+ /); assert.ok((await lg.textContent('#count')).includes(mr['results.found'].other.replace('{n}', '').trim()) || (await lg.textContent('#count')).includes(mr['results.found'].one.replace('{n}', '').trim()));
    for (const r of await lg.locator('.hk .rate').allTextContents()) assert.match(r.trim(), /^₹\d+\/तास$/);
    assert.match(await lg.textContent('.hk .meta'), new RegExp(Object.values({ f: mr['avail.Full-time'], p: mr['avail.Part-time'], w: mr['avail.Weekends'] }).join('|')));
    await lg.selectOption('#f-avail', 'Weekends'); await lg.waitForTimeout(500);
    assert.deepEqual(await lg.locator('.hk h3').allTextContents(), []);   // nobody cooks on weekends in the seed: empty state in Marathi, not an error
    assert.equal((await lg.textContent('#results')).trim(), mr['results.none']);
    await lg.selectOption('#f-avail', ''); await lg.selectOption('#f-service', ''); await lg.waitForTimeout(400);
  });
  await step('forms keep their input and the signed-out state when the language changes', async () => {
    await lg.click('#signin'); await lg.fill('#register-form [name=name]', 'राम <b>'); await lg.fill('#register-form [name=email]', 'ram@x.com');
    await lg.selectOption('#register-form [name=role]', 'housekeeper');
    await pick(lg, 'ta');
    assert.equal(await lg.inputValue('#register-form [name=name]'), 'राम <b>'); assert.equal(await lg.inputValue('#register-form [name=email]'), 'ram@x.com');
    assert.equal(await lg.inputValue('#register-form [name=role]'), 'housekeeper');
    assert.equal((await lg.textContent('#register-form h2')).trim(), ta['register.title']);
    assert.equal((await lg.textContent('#register-form [name=role] option[value=housekeeper]')).trim(), ta['register.role.housekeeper']);
    assert.ok(await lg.locator('#auth').isVisible());
  });
  await step('signed-in screens switch without signing out; request cards, status, plural counts and dates follow the language', async () => {
    await pick(sk, 'hi');
    assert.equal((await sk.textContent('#logout')).trim(), hi['auth.signout']); assert.ok(await sk.locator('#logout').isVisible());
    await sk.click('[data-tab=requests]'); await sk.waitForSelector('.badge');
    assert.equal((await sk.textContent('.badge.declined')).trim(), hi['status.declined']);
    assert.equal((await sk.textContent('#req-title')).trim(), hi['req.title']);
    assert.ok((await sk.textContent('#req-list h3')).includes(hi['req.sent']));
    assert.ok(!/[०-९]/.test(await sk.textContent('#req-list')), 'dates and numbers keep Latin digits');
    await pick(sk, 'en');
    assert.equal((await sk.textContent('#logout')).trim(), 'Sign out'); assert.ok((await sk.textContent('.badge.declined')).trim() === 'declined');
  });
  await step('server errors appear in the chosen language (and in the server\'s own English when English is chosen)', async () => {
    const o = await pageWith(); await pick(o, 'hi');
    await o.click('#signin'); await o.fill('#login-form [name=email]', 'nobody@x.com'); await o.fill('#login-form [name=password]', 'wrong-password'); await o.click('#login-form button[type=submit]');
    await o.waitForSelector('.msg.err'); assert.equal((await o.textContent('.msg.err')).trim(), hi['err.wrong_credentials']);
    await pick(o, 'en'); await o.click('#login-form button[type=submit]'); await o.waitForFunction(() => document.querySelector('.msg.err')?.textContent === 'wrong email or password');
    await o.close();
  });
  await step('the confirmation email is sent in the language that was selected when signing up', async () => {
    const o = await pageWith(); await pick(o, 'mr');
    await register(o, 'seeker', 'Maya', 'maya-mr@x.com');
    await o.waitForSelector('#msg:not([hidden])');
    const log = fs.readFileSync(LOG, 'utf8'); const block = log.split('[mail] ').find(x => x.startsWith('to=maya-mr@x.com'));
    assert.ok(block.startsWith('to=maya-mr@x.com lang=mr subject=' + mr['email.verify.subject']), block.slice(0, 120));
    assert.match(block, /नमस्कार Maya,/); assert.match(block, /verify\.html\?token=/);
    assert.equal((await o.textContent('#msg')).trim(), mr['register.welcome']);
    await o.close();
  });
  await step('a first visit follows the browser language when supported, otherwise English', async () => {
    for (const [locale, want] of [['ta-IN', 'ta'], ['hi', 'hi'], ['pa-IN', 'pa'], ['fr-FR', 'en'], ['pa-PK', 'en']]) {
      const p = await pageWith({ locale }); await p.waitForSelector('.hk');
      assert.equal(await p.evaluate(() => document.documentElement.lang), want, locale); assert.equal(await p.inputValue('#lang-select'), want, locale);
      assert.equal(await p.evaluate(() => localStorage.getItem('hs-lang')), null, 'detecting the language does not store a choice'); await p.close();
    }
  });
  await step('broken storage does not break the page', async () => {
    const p = await (await b.newContext(own({ locale: 'en-US' }))).newPage();
    await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    p.on('pageerror', e => pageErrors.push(e.message)); await p.goto(U); await p.waitForSelector('.hk'); await pick(p, 'gu');
    assert.equal((await p.textContent('nav button.active')).trim(), L('gu')['nav.find']); await p.close();
  });
  await step('verify and reset pages follow the saved language and have a picker too', async () => {
    const ctx = await b.newContext(own({ locale: 'en-US' })); await ctx.addInitScript(() => { try { if (!localStorage.getItem('hs-lang')) localStorage.setItem('hs-lang', 'bn'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', e => pageErrors.push(e.message));
    await p.goto(U + '/verify.html'); await p.waitForFunction(() => document.documentElement.lang === 'bn');
    assert.equal((await p.textContent('#status')).trim(), L('bn')['verifypage.no_token']); assert.equal(await p.title(), L('bn')['verifypage.title']);
    await pick(p, 'kn'); assert.equal((await p.textContent('#status')).trim(), L('kn')['verifypage.no_token']);
    await p.goto(U + '/reset.html'); await p.waitForFunction(() => document.documentElement.lang === 'kn');
    assert.equal((await p.textContent('#msg')).trim(), L('kn')['reset.no_token']); assert.equal((await p.textContent('#reset-form h2')).trim(), L('kn')['reset.heading']);
    await p.close();
  });
  await step('the emailed-link page shows a translated server error and a translated "next" sentence with a real link', async () => {
    const ctx = await b.newContext(own({ locale: 'en-US' })); await ctx.addInitScript(() => { try { localStorage.setItem('hs-lang', 'hi'); } catch {} });
    const p = await ctx.newPage(); p.on('pageerror', e => pageErrors.push(e.message));
    await p.goto(U + '/verify.html?token=bogus'); await p.waitForSelector('#status.err');
    assert.equal((await p.textContent('#status')).trim(), hi['err.verify_link_invalid']);
    assert.equal(await p.locator('#next a[href="/"]').count(), 1); assert.ok((await p.textContent('#next')).startsWith(hi['verifypage.next_fail'].split('{link}')[0]));
    await p.close();
  });
  await step('long scripts fit a 360px phone: nothing overflows sideways, no button or field text is cut off (Malayalam, Tamil)', async () => {
    const overflow = (p) => p.evaluate(() => {
      const bad = [];
      if (document.documentElement.scrollWidth > window.innerWidth) bad.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
      for (const el of document.querySelectorAll('button, .tag, .badge, label, h1, h2, h3, legend, .msg, select')) {
        if (el.offsetParent === null) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(el.tagName + ' ' + (el.textContent || '').trim().slice(0, 30));
        const r = el.getBoundingClientRect(); if (r.right > window.innerWidth + 1 || r.left < -1) bad.push('outside viewport: ' + el.tagName + ' ' + (el.textContent || '').trim().slice(0, 30));
      }
      return bad;
    });
    for (const code of ['ml', 'ta']) {
      const ctx = await b.newContext(own({ viewport: { width: 360, height: 740 }, locale: 'en-US' })); await ctx.addInitScript((c) => { try { localStorage.setItem('hs-lang', c); } catch {} }, code);
      const p = await ctx.newPage(); p.on('pageerror', e => pageErrors.push(e.message)); await p.goto(U); await p.waitForSelector('.hk');
      assert.deepEqual(await overflow(p), [], code + ' find');
      await p.click('#signin'); assert.deepEqual(await overflow(p), [], code + ' sign in / create account');
      await p.click('#forgot'); assert.deepEqual(await overflow(p), [], code + ' forgot');
      await login(p, 'ravi@example.com', 'demo-pass-123'); await p.waitForSelector('#logout');
      for (const tabName of ['profile', 'requests', 'account', 'find']) { await p.click(`[data-tab=${tabName}]`); await p.waitForTimeout(300); assert.deepEqual(await overflow(p), [], `${code} ${tabName}`); }
      await p.click('#results button[data-hk]'); await p.waitForSelector('#dlg[open]'); assert.deepEqual(await overflow(p), [], code + ' request dialog');
      assert.ok((await p.evaluate(() => getComputedStyle(document.body).lineHeight)) !== 'normal'); assert.ok(parseFloat(await p.evaluate(() => getComputedStyle(document.body).lineHeight)) >= 16 * 1.7 - 0.5, 'Indic scripts get a taller line');
      await p.screenshot({ path: process.env.E2E_SHOTS ? `${process.env.E2E_SHOTS}/web-${code}-360.png` : '/dev/null', fullPage: false }).catch(() => {});
      await ctx.close();
    }
  });

  console.log('\n13. Health');
  await step('no browser errors', async () => assert.deepEqual(pageErrors, []));
  await step('server log has no errors or stack traces', async () => {
    const log = fs.readFileSync(LOG, 'utf8'); assert.ok(!/internal error|TypeError|Error:|at .*\.js:\d+/.test(log), log.split('\n').filter(l => /rror/.test(l)).slice(0, 3).join(' | '));
  });
  await b.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT CRASHED', e); process.exit(2); });
