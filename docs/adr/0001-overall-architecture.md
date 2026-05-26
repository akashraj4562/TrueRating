# ADR-0001 — Overall Architecture

**Status:** Accepted  
**Date:** 2026-05-25  
**Author:** tech-lead  

---

## Context

ClearCart is a MV3 browser extension that modifies the rendered DOM of Amazon.in and Flipkart search/listing pages — client-side only, zero network egress. It does two things: de-sponsor (dim/hide ad-labelled results) and re-weight ratings (Bayesian shrinkage badge). We need an architecture that is:

- Light enough to inject safely into third-party pages
- Resilient when the site changes its HTML
- Testable without a browser (especially the math, which is the IP)
- Easy to maintain as two sites diverge over time

---

## Options considered

**A. One monolithic content script per site**  
Simple to start. Everything — selectors, math, badge rendering — lives in one file per site. Problem: math and selectors are tangled, making unit testing the math impossible without a DOM. When one site changes, the blast radius is the whole script.

**B. Shared core + thin site-specific adapters** ← chosen  
A shared `src/scoring/` layer (pure functions, no DOM) is imported by thin adapter scripts for each site (`src/content/amazon.ts`, `src/content/flipkart.ts`). All selectors live in one file (`src/selectors.ts`). esbuild bundles each adapter into its own content script for the manifest.

---

## Decision

**Option B.** The directory layout is:

```
src/
  scoring/
    bayesian.ts       # Bayesian shrinkage — pure math
    wilson.ts         # Wilson lower bound — pure math
    index.ts          # scoreItem(item, context) entry point
  selectors.ts        # ALL DOM selectors for both sites, one place to fix
  content/
    amazon.ts         # Amazon.in adapter (thin: read DOM → score → render)
    flipkart.ts       # Flipkart adapter
    shared.ts         # Badge rendering, de-sponsor rendering, shared utils
  popup/
    popup.html
    popup.ts          # Reads/writes chrome.storage.local; no math, no DOM scraping
dist/                 # esbuild output — what gets loaded by Chrome
docs/
  adr/
  SCORING.md          # Every prior and threshold explained (ratings-scientist writes)
  STATUS.md           # Progress tracker (tech-lead maintains)
```

**Build:** esbuild (not Vite). Reason: simpler config, faster, no framework overhead, produces clean single-file bundles for each content script. Vite's dev-server model adds complexity with no benefit for extensions.

**Tests:** Vitest. Reason: first-class TypeScript support, fast, works without a browser for the pure math layer. Fixture HTML snapshots for sponsored-detection tests.

**Content script injection timing:** `document_idle`. Reason: both sites render results with their own JS; injecting before idle means the product cards don't exist yet.

---

## Consequences

- The math layer (`src/scoring/`) is fully unit-testable without a browser. This is mandatory — it's the IP.
- Site-specific breakage (Amazon or Flipkart changing their HTML) is a one-file fix in `selectors.ts` plus the affected adapter.
- Adding a third site in v0.2 means adding one adapter file and a few selectors — the core is untouched.
- esbuild must be configured to produce two separate bundles (one per content script) and one popup bundle.
- No framework in the content scripts. Vanilla TS only. DOM manipulation is direct and guarded with null checks.
