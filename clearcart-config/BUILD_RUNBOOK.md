# BUILD_RUNBOOK.md — building ClearCart with the Claude Code crew

A step-by-step you can follow top to bottom. You are the board/owner; the crew does the work.

## 0. One-time setup (10 min)
1. Install Node.js (LTS, v18+). Verify: `node -v`.
2. Install Claude Code:  `npm install -g @anthropic-ai/claude-code`  then run `claude` once to sign in.
   (If anything here differs, check the official docs: https://docs.claude.com/en/docs/claude-code/overview)
3. Create the project folder and drop in this config:
   ```
   mkdir clearcart && cd clearcart
   # copy CLAUDE.md, PRODUCT_SPEC.md, BUILD_RUNBOOK.md into clearcart/
   # copy the .claude/ folder (with agents/ and skills/) into clearcart/
   git init && git add -A && git commit -m "Bootstrap ClearCart crew + spec"
   ```
4. Start Claude Code in the folder:  `claude`
5. Confirm the crew loaded:  type  `/agents`  — you should see tech-lead, product-steward, ratings-scientist, extension-engineer, qa-resilience-engineer, security-privacy-guardian.
   - Tip: run the main session on a strong model for coordination/judgment; the implementer subagents can run on a faster model (set per-agent in frontmatter or via the subagent model setting).

## 1. Kick off — let the Tech Lead plan
Prompt:
> tech-lead: read CLAUDE.md and PRODUCT_SPEC.md. Produce the v0.1 build plan as ordered steps with handoffs, list your assumptions for me to confirm, and write the first ADR for the overall architecture.

Review the plan. Correct any wrong assumptions. This is your main lever as owner.

## 2. Lock the math first (it's the IP)
> Use the ratings-scientist subagent to implement the pure scoring layer in src/scoring/ per PRODUCT_SPEC.md, with docs/SCORING.md explaining every prior/threshold, and unit tests including 4.0@200 vs 3.9@200k.

Then: `npm test` (or have qa run it). Don't proceed until the canonical assertion passes.

## 3. Build the extension
> Use the extension-engineer subagent to scaffold the MV3 extension, the manifest (two domains only), src/selectors.ts, the content scripts for Amazon.in and Flipkart, the badge + de-sponsor rendering, and the popup. Use src/scoring; make no network calls.

## 4. Harden it
> Use the qa-resilience-engineer subagent to add fixture tests for sponsored detection on both sites and degradation tests that break the selectors and prove the page is left untouched. Then write the 60-second demo script in docs/STATUS.md.

## 5. Security & privacy gate (has veto)
> Use the security-privacy-guardian subagent to audit the manifest, content scripts, dependencies, and data handling against the §3 non-negotiables. Give me a PASS or BLOCKED verdict with file:line evidence.

Fix anything blocked. Re-run until PASS.

## 6. Release-readiness
> Run the release-readiness skill and report PASS/FAIL with evidence for every item.

## 7. Load it in the browser (manual, you do this)
1. `npm run build` (produces dist/).
2. Chrome → chrome://extensions → enable Developer mode → "Load unpacked" → select dist/.
3. Open an Amazon.in and a Flipkart search page. Confirm: sponsored items dimmed, rating badges shown, **Network tab empty**, page behaves normally.
4. Screenshot for the record.

## 8. Iterate
Bring results back to tech-lead. Decide v0.2 (e.g., the opt-in re-sort, a third site) — but only after product-steward signs off on scope.

## Working tips
- Invoke a specialist explicitly with "Use the <name> subagent to …" when you want a focused pass; let tech-lead drive when you want coordination.
- Keep decisions in docs/adr/ and progress in docs/STATUS.md so any new session has context.
- You hold the only override of the security veto — use it consciously and in writing.

## A note on shipping publicly
This runbook builds a private/unpacked POC. Before publishing to the Chrome Web Store or distributing it, review the store's developer program policies and the marketplaces' Terms of Service — ideally with legal counsel. The crew keeps the build conservative precisely so that review is straightforward, but that review is your call as owner, not the crew's.
