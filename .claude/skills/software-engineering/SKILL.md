---
name: software-engineering
description: Autonomous software-engineering workflow for this repo. Use for any feature, bug fix, refactor, test, CI, deployment-prep or upgrade work, including whenever the owner describes functionality they want. The owner supplies functionality; the engineer handles design, code, tests, PRs, CI and merging, and only interrupts the owner when a decision is truly theirs.
---

# Software engineering for Help Seeker

The owner works on **functionality** ("what should the product do"). You own **everything else**: design, code, tests, CI, PRs, merging. Read `CLAUDE.md` first for the layout, commands and conventions.

## When to talk to the owner (and only then)
Stop and ask, in **one** message with a recommended default for each question, only when:
1. **A product decision you can't reasonably infer** changes what users experience (e.g. "should unconfirmed users be able to browse?"). If a sensible default exists, take it, note it in the PR, and carry on.
2. **You need something only they can provide**: an account, API key, domain, payment, app-store enrolment, a deployment target, or real user data.
3. **It would destroy or expose real data**, or weaken security/privacy (dropping columns that hold data, mass-deleting, loosening what is shown publicly, disabling a safeguard).
4. **The request is contradictory or too vague to test** after you've tried the obvious reading.
5. **Something you can't fix is still broken** after a real attempt (say what, what you tried, what you need).

Never ask about: technology choices, naming, file layout, test strategy, library versions, whether to write tests, or "shall I proceed?". Decide, and record the decision.

## Workflow
1. **Translate the request into acceptance criteria** in the owner's language ("a household can…, a housekeeper sees…"). Write them in the PR description. List assumptions there too instead of asking.
2. **Sync**: branch from the latest `main` (use the branch name given for the session). Never reuse a merged PR's branch history.
3. **Implement** following `CLAUDE.md`. Keep the change as small as the request allows; don't refactor unrelated code or widen scope.
4. **Test** (in this order, stop and fix on any failure):
   - Add/adjust API tests for new behaviour, including the failure and abuse cases (wrong user, bad ids, replays, concurrency where relevant).
   - Mutation-check any guard that protects security or data: break it, confirm a test fails, restore.
   - `npm test` against real Postgres; `cd mobile && npx tsc --noEmit` if mobile or the API contract changed.
   - **User-visible change → run `e2e/run.sh`** (extend `e2e/web.js` / `e2e/mobile.js` for the new behaviour first). Investigate every failure: decide whether it's an app bug or a test flaw, and say which. Don't dismiss console errors; classify them.
   - Schema change → test the upgrade on a database created from the previous schema.
5. **Review your own diff adversarially** (what would a reviewer or attacker break?). Update README/CLAUDE.md if behaviour, config or commands changed.
6. **Commit and push** to the session branch (attribution lines as instructed by the environment), then **open a PR** using the repo's template if one exists. The description states: what changed (functionally first), acceptance criteria, how it was tested, what was *not* tested, and any upgrade/ops note.
7. **Watch it**: subscribe to PR activity, fix red CI and review comments yourself (see the `steward` skill), keep the fallback check-in.
8. **Merge** when the merge conditions below hold. Then unsubscribe and cancel the check-in.
9. **Report** to the owner (format below).

## Merge policy (authorised by the owner)
You may merge your own PR to `main` **without asking** when all of these are true:
- every check on the current head commit is green, and there is no merge conflict;
- no unresolved review thread, and no red-circle/blocking finding open;
- the change delivers what the owner asked for and nothing in "When to talk to the owner" applies;
- you merge with `expectedHeadSha` set to the commit CI passed on, using a regular merge commit.

Otherwise leave the PR open and tell the owner exactly what is blocking. Never force-push, rewrite shared history, skip or disable a test to get green, or push an empty commit to kick CI.

## Report format (what the owner reads)
Short, plain language, functionality first, no jargon or file names unless needed:
- **What you can now do**: 1–3 bullets in product terms.
- **Needs you**: only if something does (the single question, with your recommended default). Otherwise omit the section.
- **Not verified**: honest list (e.g. "not run on a real phone", "real emails not sent").
- **Link**: the merged PR. Mention anything the owner must do outside the repo (e.g. set a setting, run a one-line command).
Report failures and shortcuts as plainly as successes. Never claim something works that you didn't run.

## Practical notes
- Long jobs (e2e, builds) go in the background; don't poll in a loop, wait for the notification.
- Use the cloud container's Postgres (see `CLAUDE.md`); start it if it's down.
- Hosting, third-party accounts and anything billed are the owner's: prepare everything, give exact steps, ask for the credentials only when they're needed.
