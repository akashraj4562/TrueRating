# CLAUDE.md — ClearCart (working title)

> This file is the company constitution. Claude Code reads it automatically on every session.
> It governs **how the team works**. The **what we build** lives in `PRODUCT_SPEC.md`.
> The **step-by-step to execute** lives in `BUILD_RUNBOOK.md`.

---

## 1. What we are building (one paragraph)

ClearCart is a **Manifest V3 browser extension** for Chrome/Edge that improves the trustworthiness of what a shopper already sees on **Amazon.in** and **Flipkart** product search/listing pages. It does two things on the user's own rendered page: (a) **de-sponsors** — detects and dims/hides ad-labelled results, and (b) **re-weights ratings** — replaces the misleading raw star average with a confidence-weighted score so that a 4.0 from 200 ratings ranks below a 3.9 from 200,000. It is **client-side only**. It never sends data anywhere.

## 2. How this company operates

We run as a small crew of specialist subagents, each defined in `.claude/agents/`. They are not interchangeable assistants; each has a **mandate, decision rights, and the duty to push back**. The point of the crew is *productive disagreement* — if everyone always agrees, the crew is failing.

- **tech-lead** — orchestrator and architect. Sequences work, makes architecture calls, writes short ADRs, resolves conflicts, owns the definition of done. Delegates implementation; does not hoard it.
- **product-steward** — guards user value and scope. Kills feature creep. Owns "never break the page."
- **ratings-scientist** — owns the statistical correctness of the weighting and de-sponsoring logic. The core IP.
- **extension-engineer** — implements the MV3 extension.
- **qa-resilience-engineer** — owns tests and graceful degradation when the sites change their DOM.
- **security-privacy-guardian** — **holds a veto.** Nothing ships if it violates the non-negotiables in §3.

**Conflict rule:** when two agents disagree, tech-lead decides and records why in a one-paragraph ADR under `docs/adr/`. **The security-privacy-guardian's veto cannot be overridden by tech-lead** — only by the human owner, explicitly, in writing.

**Work loop:** spec → architecture (ADR) → implement → test → security/privacy review → release-readiness check → demo to owner. Status is tracked in `docs/STATUS.md`.

## 3. Non-negotiables (the hard gates — the guardian enforces these)

These exist because the entire value proposition is *trust*. Breaking any of them destroys the product's reason to exist.

1. **Client-side only. Zero network egress in the POC.** No analytics, no telemetry, no external API, no "phone home." The extension must function fully with the network tab empty. Verify it.
2. **Minimal permissions.** Host permissions are scoped to the two marketplace domains only. **Never** `<all_urls>`, never broad host access, never tabs/history/cookies/webRequest beyond what is strictly required and justified in an ADR.
3. **No remotely hosted code.** All logic ships in the package (MV3 requires this; we hold to it strictly).
4. **Read-only toward the platform.** We only restyle the user's *own* rendered view. No automation, no add-to-cart, no purchasing, no form submission, no scraping-to-a-server, no affiliate-link injection, no price modification, no bypassing anti-bot or CAPTCHA.
5. **Never break the page.** If a selector fails or data is missing, fail silently and leave the page untouched. The site must work exactly as before if our logic errors.
6. **No deceptive hiding.** De-sponsoring is a user-chosen filter of their own view, off by default-discoverable, and reversible with one toggle. We do not hide legally required disclosures to deceive.
7. **Honesty in the math.** Every statistical default (priors, thresholds) is documented and defensible. No magic numbers without a rationale comment.
8. **Privacy by design.** The only thing we may persist is user settings via `chrome.storage.local`. No browsing data is collected, stored, or transmitted — ever.

> Legal note (owner action, not the crew's call): client-side re-rendering of the user's own session is materially different from server-side scraping, but it still touches platform Terms-of-Service grey areas and web-store policies. We are not lawyers. Before any public distribution, the owner must review platform ToS and web-store developer policies, ideally with counsel. The crew keeps the engineering posture maximally conservative so this review is easy to pass.

## 4. Tech stack & standing decisions

- **Manifest V3**, vanilla TypeScript compiled to JS (no heavy framework in content scripts — keep injection light and resilient). A tiny popup UI for the on/off toggles is fine in plain HTML/TS.
- **Build:** a minimal bundler (esbuild or vite) producing an unpacked extension in `dist/`.
- **No runtime dependencies that make network calls.** Audit every dependency. Prefer zero deps in the content script.
- **Resilient DOM access:** feature-detect, never assume structure; centralize all selectors in one `selectors.ts` so site changes are a one-file fix.
- **Tests:** unit tests for all rating math (this is the IP) and for the sponsored-detection logic, using fixture HTML snapshots. Vitest or node:test.

## 5. Coding standards

- TypeScript strict mode on. No `any` without a justifying comment.
- Pure functions for all scoring math — no DOM access inside the math layer, so it is unit-testable in isolation.
- Every non-obvious decision gets a one-line `// why:` comment.
- Small modules, clear names, no dead code.

## 6. Definition of Done (tech-lead owns; guardian gates)

A change is DONE only when **all** are true:
- Works on current Amazon.in and Flipkart search/listing pages (manually verified with screenshots).
- All §3 non-negotiables verified, including an empty network tab during use.
- Rating math has unit tests covering: zero ratings, tiny samples, huge samples, and the user's canonical example (4.0@200 vs 3.9@200k).
- Degrades gracefully: with selectors deliberately broken, the page is untouched and nothing throws.
- Popup toggle works and settings persist.
- `release-readiness` skill checklist passes.
- A 60-second demo path is documented in `docs/STATUS.md`.

## 7. How to talk to the crew

- Let tech-lead drive: start a session with "tech-lead: read CLAUDE.md and PRODUCT_SPEC.md, then propose the build plan and the first ADR."
- Invoke a specialist directly when you want a focused pass: "Use the security-privacy-guardian subagent to audit the manifest and content script against the §3 non-negotiables."
- The owner (you) is the board. The crew brings you decisions and tradeoffs; it does not make irreversible or out-of-scope calls without you.
