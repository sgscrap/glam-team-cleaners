/**
 * Everything the social card's pixels depend on, in one place.
 *
 * The card is rendered by `npm run social` (scripts/social-preview.py), which asks Node for
 * this object rather than reading data.js itself — so the field list has one owner, and the
 * generator cannot bake a field the guard does not check, or the reverse.
 *
 * That matters because the card is the one asset nothing on the page displays: if the hero
 * headline changes and the card is not regenerated, every share of the site still shows the
 * old words, and nothing local would ever reveal it. The guard in checks.js compares the copy
 * the card carries against this object and fails the build, which is the only thing that
 * makes the drift visible.
 */
import { site, hero, team } from './data.js';

/** The canvas the card is rendered at: 1200x630, the size every platform previews at. */
export const SOCIAL_CARD_SIZE = [1200, 630];

/** The text chunk the card carries its provenance in, so the image describes itself. */
export const SOCIAL_CARD_PROVENANCE_KEYWORD = 'social-preview-source';

/**
 * The copy and imagery baked into the card. `name` and `est` are uppercased by the renderer
 * for the eyebrow and footer marks, so they are stored as data.js holds them, and `portrait` is
 * the master the card is rendered from rather than a file the page serves — the card is a
 * separate asset at its own size, not a derivative of the page's pipeline.
 */
export const socialCardSource = () => ({
  name: site.name,
  est: site.est,
  tagline: site.tagline,
  lead: hero.lead,
  accent: hero.accent,
  portrait: team.portrait.master,
});
