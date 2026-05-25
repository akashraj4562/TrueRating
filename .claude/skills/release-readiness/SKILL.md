---
name: release-readiness
description: Run the production-readiness gate for the ClearCart extension before declaring any version done or packaging it. Use when the tech-lead or owner asks "are we ready to ship/demo?", or after the security-privacy-guardian has reviewed. Produces a PASS/FAIL checklist with evidence.
---

# Release-Readiness Gate (ClearCart)

A version is shippable only when every item below is checked with **evidence** (a command output, a screenshot path, or a test name). No checkbox is "trust me."

## 1. Safety & privacy (blocking — defer to security-privacy-guardian)
- [ ] `grep -rEn "fetch|XMLHttpRequest|WebSocket|sendBeacon|eval|new Function" src/` returns nothing unexpected. (paste output)
- [ ] `manifest.json` host permissions are ONLY the two marketplace domains; no `<all_urls>`; no unused permissions. (paste the permissions block)
- [ ] Network tab is empty during a full session on both sites. (screenshot path)
- [ ] Only `chrome.storage.local` is used, for settings only; no page content or identifiers stored. (cite the code)
- [ ] No platform automation, affiliate injection, or anti-bot circumvention present. (guardian verdict: PASS)

## 2. Correctness (blocking)
- [ ] All scoring unit tests green, including 4.0@200 < 3.9@200k. (test runner output)
- [ ] Sponsored detection passes fixture tests for both sites. (test output)
- [ ] Locale number parsing tests green. (test output)

## 3. Resilience (blocking)
- [ ] Degradation tests green: broken selectors leave the page untouched, nothing throws. (test output)
- [ ] No duplicate badges across SPA navigations / re-runs. (test output)
- [ ] Manual run on a live Amazon.in and Flipkart search page works. (two screenshots)

## 4. UX & scope (product-steward)
- [ ] Only v0.1 features present; nothing out-of-scope crept in. (verdict)
- [ ] Badges legible, aria-labelled, contrast OK; de-sponsor reversible in one click. (screenshot)
- [ ] Defaults are the conservative ones (Dim, annotate-not-reorder). (cite settings)

## 5. Demo
- [ ] `docs/STATUS.md` contains a working 60-second demo script.

## Output
Report each section as PASS or FAIL with the evidence inline. If anything is FAIL, the version is NOT ready; list the minimal fixes and route them to the owning agent.
