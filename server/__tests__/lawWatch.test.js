// The monthly law watch publishes without a human in the loop, so what Claude
// returns must be validated strictly before it touches the catalog.
const fs = require('fs');
const path = require('path');
const lw = require('../services/lawWatch/lawWatch');

const TODAY = '2026-11-01';
const dir = path.join(__dirname, '..', '..', 'content');
const texts = Object.fromEntries(Object.values(lw.FILES).map((p) => [p, fs.readFileSync(path.join(dir, path.basename(p)), 'utf8')]));
const fresh = () => lw.parseContent(texts);

const OFFICIAL = [{ label: 'BGBl.', url: 'https://www.recht.bund.de/bgbl/1/2026/300/VO.html' }];
const PRESS = [{ label: 'Some blog', url: 'https://example-law-blog.com/post' }];

describe('law watch: validating Claude answers', () => {
  it('treats "no change" as nothing to do', () => {
    expect(lw.validateLawCheck({ changed: false }, fresh(), 'gdpr', TODAY)).toBeNull();
  });

  it('accepts a bilingual date update backed by an official source', () => {
    const p = lw.validateLawCheck({
      changed: true,
      summary: 'Bill passed the Bundestag.',
      update: { keyDates: { en: ['Passed on 5 November 2026.'], de: ['Am 5. November 2026 beschlossen.'] } },
      news: { date: '2026-10-30', title: { en: 'Bill passed', de: 'Gesetz beschlossen' }, summary: { en: 'It passed.', de: 'Es wurde beschlossen.' } },
      sources: OFFICIAL,
    }, fresh(), 'deepfake_law', TODAY);
    expect(p.update.keyDates.de).toEqual(['Am 5. November 2026 beschlossen.']);
    expect(p.news.date).toBe('2026-10-30');
  });

  it('rejects a date or status change backed only by non-official sources', () => {
    expect(() => lw.validateLawCheck({
      changed: true, summary: 'x is now law', update: { status: 'published' }, sources: PRESS,
    }, fresh(), 'deepfake_law', TODAY)).toThrow(lw.Invalid);
  });

  it('only lets a draft become published, never the other way round', () => {
    expect(() => lw.validateLawCheck({
      changed: true, summary: 'repealed?', update: { status: 'draft' }, sources: OFFICIAL,
    }, fresh(), 'gdpr', TODAY)).toThrow(/status change/);
    expect(() => lw.validateLawCheck({
      changed: true, summary: 'already law', update: { status: 'published' }, sources: OFFICIAL,
    }, fresh(), 'gdpr', TODAY)).toThrow(/status change/);
  });

  it('rejects mismatched English/German lists, non-https links and future-dated news', () => {
    const base = { changed: true, summary: 'A change.', sources: OFFICIAL };
    expect(() => lw.validateLawCheck({ ...base, update: { keyDates: { en: ['a date', 'b date'], de: ['ein Datum'] } } }, fresh(), 'gdpr', TODAY)).toThrow(/differ/);
    expect(() => lw.validateLawCheck({ ...base, update: { lawReferenceUrl: 'http://eur-lex.europa.eu/x' } }, fresh(), 'gdpr', TODAY)).toThrow(/https/);
    expect(() => lw.validateLawCheck({ ...base, news: { date: '2026-12-24', title: { en: 'tt', de: 'tt' }, summary: { en: 'ss', de: 'ss' } } }, fresh(), 'gdpr', TODAY)).toThrow(/future/);
  });

  it('ignores fields it does not know instead of writing them', () => {
    const p = lw.validateLawCheck({
      changed: true, summary: 'Fines changed.', update: { penalties: { en: 'Up to EUR 1m.', de: 'Bis 1 Mio. EUR.' }, tier: 1, sortOrder: -5 }, sources: PRESS,
    }, fresh(), 'gdpr', TODAY);
    expect(p.ignored).toEqual(['tier', 'sortOrder']);
    expect(Object.keys(p.update)).toEqual(['penalties']);
  });

  it('only recognises official domains by their real host', () => {
    expect(lw.isOfficial('https://eur-lex.europa.eu/eli/reg/2026/1744/oj')).toBe(true);
    expect(lw.isOfficial('https://www.gesetze-im-internet.de/ki-mig/')).toBe(true);
    expect(lw.isOfficial('https://europa.eu.attacker.com/x')).toBe(false);
    expect(lw.isOfficial('https://notbund.de/x')).toBe(false);
  });

  it('validates a new law and refuses an existing key or one without an official source', () => {
    const raw = {
      key: 'ai_liability_new', name: 'New AI Liability Act', nameDe: 'Neues KI-Haftungsgesetz', shortName: 'KI-HaftG',
      tier: 2, jurisdiction: 'DE', category: 'liability', status: 'draft', reference: 'Government bill 2026',
      lawReferenceUrl: 'https://dip.bundestag.de/vorgang/123', regulator: { en: 'Courts', de: 'Gerichte' },
      shortDescription: { en: 'A planned law.', de: 'Ein geplantes Gesetz.' }, appliesTo: { en: 'AI makers.', de: 'KI-Hersteller.' },
      keyDates: { en: ['Cabinet: 1 Oct 2026.'], de: ['Kabinett: 1. Okt. 2026.'] },
      whatYouMustDo: { en: ['Watch it.'], de: ['Beobachten.'] }, penalties: { en: 'Not set yet.', de: 'Noch offen.' },
      news: null, sources: [{ label: 'DIP', url: 'https://dip.bundestag.de/vorgang/123' }],
    };
    expect(lw.validateNewLaw(raw, fresh(), TODAY).key).toBe('ai_liability_new');
    expect(() => lw.validateNewLaw({ ...raw, key: 'gdpr' }, fresh(), TODAY)).toThrow(/exists/);
    expect(() => lw.validateNewLaw({ ...raw, sources: PRESS }, fresh(), TODAY)).toThrow(/official/);
  });
});

describe('law watch: applying changes', () => {
  it('writes English and German fields, replaces the timeline for that law and adds news', () => {
    const c = fresh();
    const p = lw.validateLawCheck({
      changed: true,
      summary: 'Passed parliament.',
      update: { status: 'published', keyDates: { en: ['In force since 1 Nov 2026.'], de: ['In Kraft seit 1. Nov. 2026.'] } },
      timeline: [{ date: '2026-11-01', label: 'Deepfake law in force', labelDe: 'Deepfake-Gesetz in Kraft' }],
      news: { date: '2026-11-01', title: { en: 'Deepfake law in force', de: 'Deepfake-Gesetz in Kraft' }, summary: { en: 'It applies.', de: 'Es gilt.' } },
      sources: OFFICIAL,
    }, c, 'deepfake_law', TODAY);
    const item = lw.applyLawUpdate(c, p, TODAY);
    const f = c.frameworks.find((x) => x.key === 'deepfake_law');
    expect(f.status).toBeUndefined();
    expect(f.lastReviewedAt).toBe(TODAY);
    expect(c.details.deepfake_law.keyDates).toEqual(['In force since 1 Nov 2026.']);
    expect(c.de.deepfake_law.keyDates).toEqual(['In Kraft seit 1. Nov. 2026.']);
    expect(c.timeline.filter((t) => t.frameworkKey === 'deepfake_law')).toHaveLength(1);
    expect(item.id).toBe('2026-11-01-deepfake-law');
    expect(c.news[0].id).toBe(item.id);
    expect(lw.checkCatalog(c)).toEqual([]);
  });

  it('adds a new law with its German content and keeps the catalog valid', () => {
    const c = fresh();
    const law = lw.validateNewLaw({
      key: 'ai_liability_new', name: 'New AI Liability Act', nameDe: 'Neues KI-Haftungsgesetz', shortName: 'KI-HaftG',
      tier: 2, jurisdiction: 'DE', category: 'unknown_category', status: 'draft', reference: 'Government bill 2026',
      lawReferenceUrl: 'https://dip.bundestag.de/vorgang/123', regulator: { en: 'Courts', de: 'Gerichte' },
      shortDescription: { en: 'A planned law.', de: 'Ein geplantes Gesetz.' }, appliesTo: { en: 'AI makers.', de: 'KI-Hersteller.' },
      keyDates: { en: ['Cabinet: 1 Oct 2026.'], de: ['Kabinett: 1. Okt. 2026.'] },
      whatYouMustDo: { en: ['Watch it.'], de: ['Beobachten.'] }, penalties: { en: 'Not set yet.', de: 'Noch offen.' },
      news: null, sources: [{ label: 'DIP', url: 'https://dip.bundestag.de/vorgang/123' }],
    }, c, TODAY);
    lw.applyNewLaw(c, law, TODAY);
    const f = c.frameworks.find((x) => x.key === 'ai_liability_new');
    expect(f.status).toBe('draft');
    expect(f.category).toBe('ai'); // unknown categories fall back
    expect(c.de.ai_liability_new.name).toBe('Neues KI-Haftungsgesetz');
    expect(lw.checkCatalog(c)).toEqual([]);
  });

  it('ends a featured homepage banner after its date', () => {
    const c = fresh();
    expect(lw.expireFeatured(c, '2027-11-30')).toEqual([]);
    expect(lw.expireFeatured(c, '2027-12-01')).toEqual(['2026-07-ai-act-digital-omnibus']);
    expect(c.news.some((n) => n.featured)).toBe(false);
  });

  it('reports only files whose content changed', () => {
    const c = fresh();
    expect(lw.changedFiles(texts, c)).toEqual({});
    c.frameworks[0].lastReviewedAt = TODAY;
    expect(Object.keys(lw.changedFiles(texts, c))).toEqual([lw.FILES.frameworks]);
  });

  it('the current catalog passes its own pre-publish check', () => {
    expect(lw.checkCatalog(fresh())).toEqual([]);
  });
});
