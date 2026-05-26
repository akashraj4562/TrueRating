/**
 * Shared types used by both the popup and content scripts.
 * Lives here so neither imports from the other (which would pollute bundles).
 */

export type SponsorMode  = 'dim' | 'hide' | 'off';
export type RatingMethod = 'bayesian' | 'wilson';

export type Settings = {
  enabled:      boolean;
  sponsorMode:  SponsorMode;
  ratingMethod: RatingMethod;
};

export const DEFAULT_SETTINGS: Settings = {
  enabled:      true,
  sponsorMode:  'dim',       // why: least disruptive default — dims but never hides
  ratingMethod: 'bayesian',
};
