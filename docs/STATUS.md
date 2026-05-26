# TrueRating — STATUS.md

_Updated by tech-lead after each phase. This is the single source of truth for where we are._

---

## Current phase: 8 — Release-readiness check

**Last updated:** 2026-05-25
**Overall status:** 🟢 Core build complete — manual browser verification done

---

## Phase checklist

| # | Phase | Owner | Status | Notes |
|---|-------|-------|--------|-------|
| 0 | Architecture + ADR-0001 | tech-lead | ✅ Done | `docs/adr/0001-overall-architecture.md` |
| 1 | Project scaffold + build pipeline | extension-engineer | ✅ Done | esbuild, tsconfig strict, dist/ |
| 2 | Rating math + unit tests | ratings-scientist | ✅ Done | 42 tests passing, canonical assertion passes |
| 3 | Selectors (Amazon.in) | extension-engineer | ✅ Done | Live-verified 2026-05-25, `src/selectors.ts` |
| 4 | Content scripts (de-sponsor + badge) | extension-engineer | ✅ Done | Badges visible, dim working, min 50 reviews |
| 5 | Popup UI + settings persistence | extension-engineer | ✅ Done | storage.local, onChanged, no tabs permission |
| 6 | Fixture + degradation tests | qa-resilience-engineer | ✅ Done | 63/63 tests passing |
| 7 | Security & privacy audit | security-privacy-guardian | ✅ PASS | See audit below |
| 8 | Release-readiness check | tech-lead | ⬜ Pending | |
| 9 | Manual browser test + screenshots | owner | ✅ Done | Badges visible on Amazon.in search |

---

## 60-second demo path

**Setup (once):** Load unpacked extension from `dist/` in Chrome (Developer mode).

1. **(0–10s)** Open `https://www.amazon.in/s?k=headphones`
2. **(10–20s)** Point to any product card — show `TR 3.xx★` badge next to the native star count
3. **(20–30s)** Point to a sponsored card — show it dimmed at 35% opacity with "Ad" tag. Hover to show it brightens.
4. **(30–40s)** Open DevTools → Network tab → reload → show **zero requests** from TrueRating
5. **(40–50s)** Click TrueRating toolbar icon → toggle "Hide" → sponsored cards disappear → toggle "Dim" → they return dimmed
6. **(50–60s)** Click "Wilson" in popup → badges update live (no page reload) — scores shown as % confidence

**Key talking point:** The product with 3.9★ from 200,000 ratings gets a higher TR score than a 4.0★ product with 200 ratings — because 200,000 ratings can be trusted, 200 cannot.

---

## Security & Privacy Audit — PASS ✅

**Auditor:** security-privacy-guardian
**Date:** 2026-05-25

| Check | Finding | Verdict |
|---|---|---|
| Network egress | Zero `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` in source and built bundle | ✅ PASS |
| Manifest permissions | `storage` only. Host: `*.amazon.in/*` only. No `tabs`, `history`, `cookies`, `webRequest`, `<all_urls>` | ✅ PASS |
| Remote code | No `eval`, no `new Function`, no remote script loads. CSP: `script-src 'self'` | ✅ PASS |
| Read-only | No form submission, no add-to-cart, no affiliate injection, no automation | ✅ PASS |
| Data handling | Only user settings persisted in `chrome.storage.local`. No PII, no browsing data, no page content logged | ✅ PASS |
| Dependencies | Zero runtime dependencies. All devDependencies (esbuild, vitest, typescript) compile-time only | ✅ PASS |
| Fail-safe | All DOM operations wrapped in try/catch. Broken selectors leave page untouched (degradation tests prove it) | ✅ PASS |

**Overall verdict: PASS. No blocks.**

---

## Open owner decisions

1. **Flipkart** — selectors not yet added. v0.1 scope is Amazon.in only. Flipkart is v0.2.
2. **Chrome Web Store** — this is an unpacked/sideloaded POC. ToS and store policy review required before public distribution (owner + counsel, not the crew's call).
3. **Icons** — placeholder removed from manifest. Add before any distribution.
4. **"Bought in past month" signal** — recommended for v0.2 as a display-only label alongside the badge (not baked into the score).

---

## ADRs

| ID | Title | Status |
|----|-------|--------|
| 0001 | Overall architecture | Accepted |
