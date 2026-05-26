/**
 * ClearCart popup — settings UI.
 *
 * Reads settings from chrome.storage.local on open.
 * Writes settings back on every change.
 * Content scripts react via chrome.storage.onChanged — no messaging needed,
 * no "tabs" permission required.
 *
 * Step 5 will wire full logic. This skeleton confirms storage round-trips work.
 */

import { DEFAULT_SETTINGS } from '../types.js';
import type { Settings, SponsorMode, RatingMethod } from '../types.js';

const DEFAULTS: Settings = DEFAULT_SETTINGS;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const masterToggle  = document.getElementById('masterToggle')  as HTMLInputElement;
const modeDim       = document.getElementById('mode-dim')       as HTMLButtonElement;
const modeHide      = document.getElementById('mode-hide')      as HTMLButtonElement;
const modeOff       = document.getElementById('mode-off')       as HTMLButtonElement;
const methodBayes   = document.getElementById('method-bayesian')as HTMLButtonElement;
const methodWilson  = document.getElementById('method-wilson')  as HTMLButtonElement;
const scoreHint     = document.getElementById('scoreHint')      as HTMLParagraphElement;

const HINTS: Record<RatingMethod, string> = {
  bayesian:
    'Bayesian: adjusts star averages for review volume — a 3.9 from 200k ratings ranks above a 4.0 from 200.',
  wilson:
    'Wilson: shows the lower confidence bound — heavily penalises items with very few reviews.',
};

// ── Render ────────────────────────────────────────────────────────────────────

function render(s: Settings): void {
  masterToggle.checked = s.enabled;

  [modeDim, modeHide, modeOff].forEach((btn) => btn.classList.remove('active'));
  const activeModeBtn = { dim: modeDim, hide: modeHide, off: modeOff }[s.sponsorMode];
  activeModeBtn.classList.add('active');
  activeModeBtn.setAttribute('aria-pressed', 'true');

  [methodBayes, methodWilson].forEach((btn) => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });
  const activeMethodBtn = s.ratingMethod === 'bayesian' ? methodBayes : methodWilson;
  activeMethodBtn.classList.add('active');
  activeMethodBtn.setAttribute('aria-pressed', 'true');

  scoreHint.textContent = HINTS[s.ratingMethod];
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return stored as Settings;
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const settings = await loadSettings();
  render(settings);

  masterToggle.addEventListener('change', () =>
    saveSettings({ enabled: masterToggle.checked }),
  );

  modeDim.addEventListener('click',  () => saveSettings({ sponsorMode: 'dim'  }));
  modeHide.addEventListener('click', () => saveSettings({ sponsorMode: 'hide' }));
  modeOff.addEventListener('click',  () => saveSettings({ sponsorMode: 'off'  }));

  methodBayes.addEventListener('click',  () => {
    render({ ...settings, ratingMethod: 'bayesian' });
    saveSettings({ ratingMethod: 'bayesian' });
  });
  methodWilson.addEventListener('click', () => {
    render({ ...settings, ratingMethod: 'wilson' });
    saveSettings({ ratingMethod: 'wilson' });
  });
}

init().catch(console.error);
