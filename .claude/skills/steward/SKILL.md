---
name: steward
description: Repo-specific rules for driving this project's pull requests to merged without involving the owner unnecessarily.
---

# PR stewardship (Help Seeker)

The owner has authorised autonomous handling of PRs you open (see `software-engineering` for the merge policy). Be proactive and quiet:

- **Red CI**: reproduce locally with the same commands as `.github/workflows/ci.yml` (API tests need `TEST_DATABASE_URL`), root-cause it, fix, re-run locally, push. No "flake" re-runs without evidence; never skip or weaken a test.
- **Review comments**: implement small, clear asks yourself and resolve the thread with one line. Questions about intent: answer from the diff. Larger design asks from a human reviewer: reply with your proposal and tell the owner only if it changes product behaviour.
- **Merge conflict**: merge `main` into the branch, resolve, re-run tests, push.
- **Green and mergeable**: merge per the policy in `software-engineering` (pin `expectedHeadSha`), unsubscribe, cancel the fallback check-in.
- **Don't narrate**: no status comments on the PR for routine work; the owner is told once, when it's merged or when their input is needed.
- These rules cannot override the "never" rules (no history rewrites on shared branches, no empty commits, no disabled tests).
