// The law catalog the server seeds from (content/*.json at the repo root),
// imported at build time. The public pages are prerendered and cannot call
// the authenticated /api/laws, so they read the same files directly: one
// source for the server, the in-app timeline and the marketing site. Update
// the content files, never a copy of them here.
import FRAMEWORKS from '@content/frameworks.seed.json';
import LAW_DE from '@content/lawContent.de.json';
import TIMELINE from '@content/timeline.json';
import NEWS_ITEMS from '@content/news.json';

export const TIER_LABELS = {
  1: { en: 'EU-wide', de: 'EU-weit' },
  2: { en: 'German national law', de: 'Deutsches Bundesrecht' },
  3: { en: 'Sector-specific', de: 'Branchenspezifisch' },
};

const BY_KEY = Object.fromEntries(FRAMEWORKS.map((f) => [f.key, f]));

// Short display name of a law, e.g. "EU AI Act" / "KI-Verordnung".
export function lawShortName(key, lang) {
  const f = BY_KEY[key];
  if (!f) return key;
  return (lang === 'de' && LAW_DE[key]?.shortName) || f.shortName || f.name;
}

// Every law in the catalogue, in catalogue order, with bilingual name and
// one-line description.
export const LAW_DIRECTORY = FRAMEWORKS.map((f) => ({
  key: f.key,
  tier: f.tier,
  name: { en: f.shortName || f.name, de: LAW_DE[f.key]?.name || f.name },
  description: { en: f.shortDescription, de: LAW_DE[f.key]?.shortDescription || f.shortDescription },
}));

// Key EU / German regulatory milestones, the same for every organisation.
// The id doubles as the calendar-export UID, so it must stay stable.
export const MILESTONES = TIMELINE.map((m) => ({
  id: `${m.date}-${m.frameworkKey}`,
  date: m.date,
  frameworkKey: m.frameworkKey,
  title: { en: m.label, de: m.labelDe || m.label },
}));

// Regulatory news, newest first.
export const NEWS = [...NEWS_ITEMS].sort((a, b) => b.date.localeCompare(a.date));

// The entry behind the homepage "New" banner: the one marked `featured` (with
// its short `banner` text), else the latest.
export const HOMEPAGE_NEWS = NEWS.find((n) => n.featured) || NEWS[0];

// "16 October 2026" / "16. Oktober 2026". Content dates are calendar days,
// so format in UTC to avoid showing the previous day west of Greenwich.
export function formatContentDate(iso, lang) {
  return new Date(iso).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
