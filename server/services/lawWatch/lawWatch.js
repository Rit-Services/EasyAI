// Monthly law watch: the pure parts (prompts, validation of Claude's answers,
// applying them to the catalog files, integrity checks). Network calls live in
// claudeProxy.js / githubRepo.js; orchestration in scripts/lawWatch.js.
//
// Changes are published without a human in the loop, so everything Claude
// returns is treated as untrusted input: only whitelisted fields, bounded
// sizes, https sources, and an official source for any status or date change.

const FILES = {
  frameworks: 'content/frameworks.seed.json',
  details: 'content/lawDetails.seed.json',
  de: 'content/lawContent.de.json',
  timeline: 'content/timeline.json',
  news: 'content/news.json',
};

// Suffixes of sources accepted as official for status and date changes.
const OFFICIAL_DOMAINS = [
  'europa.eu', 'gesetze-im-internet.de', 'recht.bund.de', 'bgbl.de', 'bundestag.de', 'bundesrat.de',
  'bundesregierung.de', 'bund.de', 'bmj.de', 'bmas.de', 'bmwk.de', 'bundesnetzagentur.de', 'bafin.de',
  'datenschutzkonferenz-online.de',
];

const LIMITS = { updates: 12, newLaws: 3 };
const STATUSES = new Set(['published', 'draft', 'archived']);

// ---------------------------------------------------------------- prompts ---

const SYSTEM = (today) => [
  'You check the legal content of Compliance Check, a web app that explains EU and German AI-related laws',
  'to companies in Germany. Use web search. Prefer official sources: EUR-Lex, gesetze-im-internet.de,',
  'recht.bund.de / Bundesgesetzblatt, dip.bundestag.de, bundesrat.de, the European Commission and German',
  'federal ministries and authorities. Report only what a source confirms; when unsure, report no change.',
  `Today is ${today}. Answer with a single JSON object and nothing else.`,
].join(' ');

function currentEntry(content, key) {
  const f = content.frameworks.find((x) => x.key === key);
  const d = content.details[key] || {};
  const g = content.de[key] || {};
  return {
    en: {
      name: f.name, status: f.status || 'published', reference: f.reference, lawReferenceUrl: f.lawReferenceUrl,
      regulator: f.regulator, shortDescription: f.shortDescription, appliesTo: f.appliesTo,
      keyDates: d.keyDates, whatYouMustDo: d.whatYouMustDo, penalties: d.penalties,
    },
    de: {
      name: g.name, regulator: g.regulator, shortDescription: g.shortDescription, appliesTo: g.appliesTo,
      keyDates: g.keyDates, whatYouMustDo: g.whatYouMustDo, penalties: g.penalties,
    },
    timeline: content.timeline.filter((t) => t.frameworkKey === key).map(({ date, label, labelDe }) => ({ date, label, labelDe })),
    lastReviewedAt: f.lastReviewedAt || null,
  };
}

function checkPrompt(content, key, today) {
  const entry = currentEntry(content, key);
  return {
    system: SYSTEM(today),
    user: [
      `Check our entry for "${entry.en.name}" (key ${key}) for anything outdated or wrong as of today:`,
      'legal status (draft/bill vs in force), key dates and deadlines, what companies must do, penalties,',
      'the responsible authority and the official reference. "draft" means a bill or proposal that is not yet law.',
      '',
      `Current entry: ${JSON.stringify(entry)}`,
      '',
      'If nothing needs changing, answer {"changed": false}. Otherwise answer:',
      '{"changed": true, "summary": "<one sentence: what changed in the law>",',
      ' "update": { only the fields that change, each with English and German text:',
      '   "status": "published" (only when a draft has become law), "reference": "...", "lawReferenceUrl": "https://...",',
      '   "regulator": {"en","de"}, "shortDescription": {"en","de"}, "appliesTo": {"en","de"},',
      '   "keyDates": {"en": [...], "de": [...]}, "whatYouMustDo": {"en": [...], "de": [...]}, "penalties": {"en","de"} },',
      ' "timeline": [{"date": "YYYY-MM-DD", "label": "...", "labelDe": "..."}] (the full new list of milestones for',
      '   this law, only if they change),',
      ' "news": {"date": "YYYY-MM-DD", "title": {"en","de"}, "summary": {"en","de"}} (a short news item about the change',
      '   for our users, or null; "date" is when the change happened, e.g. adoption, publication or entry into force),',
      ' "sources": [{"label": "...", "url": "https://..."}] }',
      'Write plain, short sentences in the same style as the current entry. Keep German and English equivalent.',
    ].join('\n'),
  };
}

function discoveryPrompt(content, today) {
  const known = content.frameworks.map((f) => `${f.key}: ${f.name} (${f.status || 'published'})`).join('\n');
  return {
    system: SYSTEM(today),
    user: [
      'Our catalog covers these laws:',
      known,
      '',
      'Find laws relevant to how companies in Germany build or use AI that are NOT in this list (also not under',
      'another name): EU regulations or directives that apply in Germany, German federal laws, or important sector',
      'rules, which are either in force, adopted, or formally proposed as a bill (government or Commission proposal',
      'or later). Return at most 3, the most relevant first, or none. Answer:',
      '{"laws": [{"key": "snake_case_key", "name": "...", "nameDe": "...", "shortName": "...", "tier": 1 (EU) | 2',
      ' (German national) | 3 (sector), "jurisdiction": "EU" | "DE", "category": "...", "status": "published" (in',
      ' force or adopted) | "draft" (bill or proposal), "reference": "...", "lawReferenceUrl": "https://...",',
      ' "regulator": {"en","de"}, "shortDescription": {"en","de"}, "appliesTo": {"en","de"},',
      ' "keyDates": {"en": [...], "de": [...]}, "whatYouMustDo": {"en": [...], "de": [...]}, "penalties": {"en","de"},',
      ' "news": {"date": "YYYY-MM-DD", "title": {"en","de"}, "summary": {"en","de"}} or null,',
      ' "sources": [{"label": "...", "url": "https://..."}]}]}',
    ].join('\n'),
  };
}

function verifyPrompt(subject, proposal, today) {
  return {
    system: SYSTEM(today),
    user: [
      `A colleague proposes this change to our content about ${subject}. Check every claim in it (dates, status,`,
      'obligations, authorities) against the sources and the current law. Approve only if all of it is correct',
      'and supported. Answer {"approved": true} or {"approved": false, "problems": ["..."]}.',
      '',
      `Proposal: ${JSON.stringify(proposal)}`,
    ].join('\n'),
  };
}

// ------------------------------------------------------------- validation ---

class Invalid extends Error {}

function text(v, { min = 2, max = 1200 } = {}) {
  if (typeof v !== 'string') throw new Invalid('expected text');
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  if (s.length < min || s.length > max) throw new Invalid(`text length ${s.length} outside ${min}-${max}`);
  return s;
}

function url(v) {
  const s = text(v, { min: 10, max: 500 });
  let u;
  try { u = new URL(s); } catch { throw new Invalid(`not a URL: ${s.slice(0, 60)}`); }
  if (u.protocol !== 'https:') throw new Invalid(`not https: ${s.slice(0, 60)}`);
  return u.toString();
}

function isoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Invalid(`bad date ${v}`);
  const y = Number(v.slice(0, 4));
  if (y < 1990 || y > 2040) throw new Invalid(`date out of range ${v}`);
  return v;
}

const bilingual = (v, opts) => ({ en: text(v?.en, opts), de: text(v?.de, opts) });

function list(v, { maxItems = 12, max = 400 } = {}) {
  if (!Array.isArray(v) || v.length < 1 || v.length > maxItems) throw new Invalid('expected a list of 1-12 items');
  return v.map((x) => text(x, { max }));
}

function bilingualList(v) {
  const out = { en: list(v?.en), de: list(v?.de) };
  if (out.en.length !== out.de.length) throw new Invalid('English and German lists differ in length');
  return out;
}

function sources(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 8) throw new Invalid('expected 1-8 sources');
  return v.map((s) => ({ label: text(s?.label, { max: 200 }), url: url(s?.url) }));
}

const isOfficial = (u) => {
  const host = new URL(u).hostname.toLowerCase();
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
};

function news(v, today) {
  if (v == null) return null;
  const date = isoDate(v.date);
  if (date > today) throw new Invalid('news dated in the future');
  return { date, title: bilingual(v.title, { max: 200 }), summary: bilingual(v.summary, { max: 1200 }) };
}

function timeline(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 15) throw new Invalid('timeline must be a list of at most 15 entries');
  return v.map((t) => ({ date: isoDate(t?.date), label: text(t?.label, { max: 300 }), labelDe: text(t?.labelDe, { max: 300 }) }));
}

const UPDATE_FIELDS = {
  reference: (v) => text(v, { max: 400 }),
  lawReferenceUrl: url,
  regulator: (v) => bilingual(v, { max: 600 }),
  shortDescription: (v) => bilingual(v, { max: 600 }),
  appliesTo: (v) => bilingual(v, { max: 600 }),
  keyDates: bilingualList,
  whatYouMustDo: bilingualList,
  penalties: (v) => bilingual(v, { max: 600 }),
};

// Validate one law check answer. Returns null for "no change", otherwise a
// clean proposal; throws Invalid with the reason when it must be rejected.
function validateLawCheck(answer, content, key, today) {
  if (!answer || answer.changed !== true) return null;
  const law = content.frameworks.find((f) => f.key === key);
  const out = { key, summary: text(answer.summary, { max: 400 }), update: {}, ignored: [] };
  const upd = answer.update || {};
  for (const [field, value] of Object.entries(upd)) {
    if (field === 'status') {
      if (value !== 'published' || (law.status || 'published') !== 'draft') throw new Invalid(`status change to ${value} not allowed`);
      out.update.status = 'published';
    } else if (UPDATE_FIELDS[field]) {
      out.update[field] = UPDATE_FIELDS[field](value);
    } else {
      out.ignored.push(field);
    }
  }
  out.timeline = timeline(answer.timeline);
  out.news = news(answer.news, today);
  out.sources = sources(answer.sources);
  if (!Object.keys(out.update).length && !out.timeline && !out.news) return null;
  const sensitive = out.update.status || out.update.keyDates || out.update.reference || out.timeline;
  if (sensitive && !out.sources.some((s) => isOfficial(s.url))) {
    throw new Invalid('status, date or reference change without an official source');
  }
  return out;
}

const KEY_RE = /^[a-z][a-z0-9_]{2,40}$/;

function validateNewLaw(p, content, today) {
  const key = text(p?.key, { max: 41 });
  if (!KEY_RE.test(key)) throw new Invalid(`bad key ${key}`);
  if (content.frameworks.some((f) => f.key === key)) throw new Invalid(`key ${key} already exists`);
  const tier = Number(p.tier);
  if (![1, 2, 3].includes(tier)) throw new Invalid('tier must be 1, 2 or 3');
  if (!['EU', 'DE'].includes(p.jurisdiction)) throw new Invalid('jurisdiction must be EU or DE');
  if (!['published', 'draft'].includes(p.status)) throw new Invalid('status must be published or draft');
  const categories = new Set(content.frameworks.map((f) => f.category).filter(Boolean));
  const law = {
    key,
    name: text(p.name, { max: 160 }),
    nameDe: text(p.nameDe, { max: 160 }),
    shortName: text(p.shortName, { max: 60 }),
    tier,
    jurisdiction: p.jurisdiction,
    category: categories.has(p.category) ? p.category : 'ai',
    status: p.status,
    reference: text(p.reference, { max: 400 }),
    lawReferenceUrl: url(p.lawReferenceUrl),
    regulator: bilingual(p.regulator, { max: 600 }),
    shortDescription: bilingual(p.shortDescription, { max: 600 }),
    appliesTo: bilingual(p.appliesTo, { max: 600 }),
    keyDates: bilingualList(p.keyDates),
    whatYouMustDo: bilingualList(p.whatYouMustDo),
    penalties: bilingual(p.penalties, { max: 600 }),
    news: news(p.news, today),
    sources: sources(p.sources),
  };
  if (!law.sources.some((s) => isOfficial(s.url))) throw new Invalid('new law without an official source');
  return law;
}

// --------------------------------------------------------------- applying ---

function newsId(content, date, key) {
  const base = `${date}-${key.replace(/_/g, '-')}`;
  let id = base;
  for (let i = 2; content.news.some((n) => n.id === id); i += 1) id = `${base}-${i}`;
  return id;
}

function addNews(content, item, frameworkKeys, srcs) {
  const entry = { id: newsId(content, item.date, frameworkKeys[0]), date: item.date, frameworkKeys, title: item.title, summary: item.summary, sources: srcs };
  content.news.push(entry);
  content.news.sort((a, b) => b.date.localeCompare(a.date));
  return entry;
}

function applyLawUpdate(content, p, today) {
  const f = content.frameworks.find((x) => x.key === p.key);
  const d = (content.details[p.key] = content.details[p.key] || {});
  const g = (content.de[p.key] = content.de[p.key] || {});
  const u = p.update;
  if (u.status) delete f.status; // published is the default
  if (u.reference) f.reference = u.reference;
  if (u.lawReferenceUrl) f.lawReferenceUrl = u.lawReferenceUrl;
  for (const field of ['regulator', 'shortDescription', 'appliesTo']) {
    if (u[field]) { f[field] = u[field].en; g[field] = u[field].de; }
  }
  for (const field of ['keyDates', 'whatYouMustDo', 'penalties']) {
    if (u[field]) { d[field] = u[field].en; g[field] = u[field].de; }
  }
  if (p.timeline) {
    content.timeline = content.timeline
      .filter((t) => t.frameworkKey !== p.key)
      .concat(p.timeline.map((t) => ({ date: t.date, frameworkKey: p.key, label: t.label, labelDe: t.labelDe })))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  f.lastReviewedAt = today;
  return p.news ? addNews(content, p.news, [p.key], p.sources) : null;
}

function applyNewLaw(content, law, today) {
  const sortOrder = content.frameworks.reduce((m, f) => Math.max(m, f.sortOrder || 0), 0) + 1;
  content.frameworks.push({
    key: law.key, name: law.name, shortName: law.shortName, tier: law.tier, jurisdiction: law.jurisdiction,
    category: law.category, reference: law.reference, ...(law.status === 'draft' ? { status: 'draft' } : {}),
    regulator: law.regulator.en, lawReferenceUrl: law.lawReferenceUrl, shortDescription: law.shortDescription.en,
    appliesTo: law.appliesTo.en, sortOrder, lastReviewedAt: today,
  });
  content.details[law.key] = { whatYouMustDo: law.whatYouMustDo.en, keyDates: law.keyDates.en, penalties: law.penalties.en };
  content.de[law.key] = {
    name: law.nameDe, shortDescription: law.shortDescription.de, appliesTo: law.appliesTo.de,
    whatYouMustDo: law.whatYouMustDo.de, keyDates: law.keyDates.de, penalties: law.penalties.de, regulator: law.regulator.de,
  };
  return law.news ? addNews(content, law.news, [law.key], law.sources) : null;
}

// A homepage banner pinned to a news entry ends on its featuredUntil date.
function expireFeatured(content, today) {
  const expired = [];
  for (const n of content.news) {
    if (n.featured && n.featuredUntil && n.featuredUntil < today) {
      delete n.featured; delete n.banner; delete n.featuredUntil;
      expired.push(n.id);
    }
  }
  return expired;
}

// --------------------------------------------------------------- checking ---

// Same rules as __tests__/catalogContent.test.js, run before publishing.
function checkCatalog(content) {
  const errors = [];
  const keys = new Set();
  for (const f of content.frameworks) {
    if (!f.key || !f.name || typeof f.tier !== 'number') errors.push(`framework missing key/name/tier: ${f.key}`);
    if (keys.has(f.key)) errors.push(`duplicate framework ${f.key}`);
    if (f.status && !STATUSES.has(f.status)) errors.push(`bad status on ${f.key}`);
    keys.add(f.key);
  }
  for (const k of Object.keys(content.details)) if (!keys.has(k)) errors.push(`details for unknown framework ${k}`);
  for (const k of Object.keys(content.de)) if (!keys.has(k)) errors.push(`German content for unknown framework ${k}`);
  const tl = new Set();
  for (const t of content.timeline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !keys.has(t.frameworkKey) || !t.label || !t.labelDe) errors.push(`bad timeline entry ${t.date} ${t.frameworkKey}`);
    const id = `${t.date}-${t.frameworkKey}`;
    if (tl.has(id)) errors.push(`duplicate timeline entry ${id}`);
    tl.add(id);
  }
  const ids = new Set();
  for (const n of content.news) {
    if (!/^[a-z0-9-]+$/.test(n.id || '') || ids.has(n.id)) errors.push(`bad or duplicate news id ${n.id}`);
    ids.add(n.id);
    if (!n.title?.en || !n.title?.de || !n.summary?.en || !n.summary?.de) errors.push(`news ${n.id} not bilingual`);
    if (!n.frameworkKeys?.length || n.frameworkKeys.some((k) => !keys.has(k))) errors.push(`news ${n.id} has unknown frameworks`);
    if (!n.sources?.length || n.sources.some((s) => !/^https:\/\//.test(s.url || ''))) errors.push(`news ${n.id} sources`);
  }
  if (content.news.filter((n) => n.featured).length > 1) errors.push('more than one featured news entry');
  return errors;
}

// ------------------------------------------------------------ (de)serialize ---

function parseContent(texts) {
  return Object.fromEntries(Object.entries(FILES).map(([name, path]) => [name, JSON.parse(texts[path])]));
}

// Only the files whose content actually changed, formatted like the repo's.
function changedFiles(before, content) {
  const out = {};
  for (const [name, path] of Object.entries(FILES)) {
    const text = `${JSON.stringify(content[name], null, 2)}\n`;
    if (JSON.stringify(JSON.parse(before[path])) !== JSON.stringify(content[name])) out[path] = text;
  }
  return out;
}

module.exports = {
  FILES, LIMITS, OFFICIAL_DOMAINS, Invalid,
  checkPrompt, discoveryPrompt, verifyPrompt,
  validateLawCheck, validateNewLaw, isOfficial,
  applyLawUpdate, applyNewLaw, expireFeatured, checkCatalog,
  parseContent, changedFiles,
};
