// The catalog is data, not code: a new framework or classification rule is a
// JSON edit. That means a typo in a rule's question code, or a missing German
// translation, would not fail until `npm run seed` runs inside the container at
// deploy time — and the server CMD chains with &&, so a bad seed means the pod
// never starts. These checks catch it here instead.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'content');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));

describe('catalog integrity', () => {
  it('every content file is valid JSON', () => {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      expect(() => read(f), f).not.toThrow();
    }
  });

  it('frameworks have the fields the seeder maps', () => {
    for (const f of read('frameworks.seed.json')) {
      expect(f.key, JSON.stringify(f)).toBeTruthy();
      expect(f.name, f.key).toBeTruthy();
      expect(typeof f.tier, f.key).toBe('number');
    }
  });

  it('framework keys are unique', () => {
    const keys = read('frameworks.seed.json').map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lawDetails only describe frameworks that exist', () => {
    const keys = new Set(read('frameworks.seed.json').map((f) => f.key));
    for (const k of Object.keys(read('lawDetails.seed.json'))) expect(keys.has(k), k).toBe(true);
  });

  it('timeline entries are valid dates on known frameworks', () => {
    const keys = new Set(read('frameworks.seed.json').map((f) => f.key));
    for (const e of read('timeline.json')) {
      expect(e.date, e.label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.date)), e.label).toBe(false);
      expect(keys.has(e.frameworkKey), e.frameworkKey).toBe(true);
      expect(e.label, e.date).toBeTruthy();
      expect(e.labelDe, e.label).toBeTruthy();
    }
    // The client derives each milestone's calendar-export UID from date + framework.
    const ids = read('timeline.json').map((e) => `${e.date}-${e.frameworkKey}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('per-framework review dates are valid days', () => {
    for (const f of read('frameworks.seed.json').filter((x) => x.lastReviewedAt)) {
      expect(f.lastReviewedAt, f.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(f.lastReviewedAt)), f.key).toBe(false);
    }
  });

  it('at most one news entry is featured on the homepage, with a bilingual banner', () => {
    const featured = read('news.json').filter((n) => n.featured);
    expect(featured.length).toBeLessThanOrEqual(1);
    for (const n of featured) {
      if (n.banner) for (const lang of ['en', 'de']) expect(n.banner[lang], `${n.id} banner.${lang}`).toBeTruthy();
    }
  });

  it('data-protection profile obligations only reference existing questions, and German covers all of it', () => {
    const profile = read('gdprProfile.seed.json');
    const de = read('gdprProfile.de.json');
    const codes = new Set(profile.questions.map((q) => q.code));
    // Condition leaves are "code" / "!code" strings or { op: [code, ...] } objects.
    const refs = [];
    const walk = (node) => {
      if (typeof node === 'string') refs.push(node.replace(/^!/, ''));
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === 'all' || k === 'any') walk(v);
          else if (Array.isArray(v) && typeof v[0] === 'string') refs.push(v[0]);
        }
      }
    };
    for (const o of profile.obligations) walk(o.when);
    for (const r of refs) expect(codes.has(r), `unknown question "${r}"`).toBe(true);
    for (const q of profile.questions) expect(de.questions[q.code], `DE question ${q.code}`).toBeTruthy();
    for (const o of profile.obligations) expect(de.obligations[o.id], `DE obligation ${o.id}`).toBeTruthy();
    for (const q of profile.questions.filter((x) => x.options)) {
      for (const opt of q.options) expect(de.questions[q.code].options?.[opt.value], `DE option ${q.code}.${opt.value}`).toBeTruthy();
    }
  });

  it('news entries are bilingual, dated, sourced and point at known frameworks', () => {
    const keys = new Set(read('frameworks.seed.json').map((f) => f.key));
    const news = read('news.json');
    expect(new Set(news.map((n) => n.id)).size).toBe(news.length);
    for (const n of news) {
      expect(n.id, JSON.stringify(n)).toMatch(/^[a-z0-9-]+$/);
      expect(n.date, n.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(n.date)), n.id).toBe(false);
      for (const lang of ['en', 'de']) {
        expect(n.title?.[lang], `${n.id} title.${lang}`).toBeTruthy();
        expect(n.summary?.[lang], `${n.id} summary.${lang}`).toBeTruthy();
      }
      expect(n.frameworkKeys?.length, n.id).toBeGreaterThan(0);
      for (const k of n.frameworkKeys) expect(keys.has(k), `${n.id}: ${k}`).toBe(true);
      expect(n.sources?.length, n.id).toBeGreaterThan(0);
      for (const s of n.sources) {
        expect(s.label, n.id).toBeTruthy();
        expect(s.url, n.id).toMatch(/^https:\/\//);
      }
    }
  });

  describe('classification questionnaire', () => {
    const cl = read('classification.seed.json');
    const codes = new Set(cl.questions.map((q) => q.code));

    it('question codes are unique', () => {
      expect(codes.size).toBe(cl.questions.length);
    });

    it('every rule condition points at a question that exists', () => {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.q) expect(codes.has(node.q), `rule references unknown question "${node.q}"`).toBe(true);
        for (const key of ['all', 'any']) if (Array.isArray(node[key])) node[key].forEach(walk);
      };
      cl.rules.forEach((r) => walk(r.conditions));
    });

    it('every rule yields a valid risk category', () => {
      const valid = ['prohibited', 'high', 'limited', 'minimal'];
      for (const r of cl.rules) expect(valid, r.explanation).toContain(r.resultRiskCategory);
    });

    it('every question has a German translation', () => {
      const de = read('classification.de.json').questions;
      for (const q of cl.questions) {
        expect(de[q.code], `missing German translation for "${q.code}"`).toBeTruthy();
        expect(de[q.code].prompt, q.code).toBeTruthy();
      }
    });
  });

  it('German law content only covers frameworks that exist', () => {
    const keys = new Set(read('frameworks.seed.json').map((f) => f.key));
    for (const k of Object.keys(read('lawContent.de.json'))) expect(keys.has(k), k).toBe(true);
  });

  it('the AI Act reflects the Digital Omnibus deferral', () => {
    // Guards against a regression to the pre-amendment dates: high-risk
    // obligations moved off 2 August 2026 (Regulation (EU) 2026/1744).
    const dates = read('lawDetails.seed.json').eu_ai_act.keyDates.join(' ');
    expect(dates).toContain('2 December 2027');
    expect(dates).toContain('2 August 2028');
    expect(dates).not.toMatch(/High-risk rules[^.]*apply from 2 August 2026/);

    const codes = new Set(read('classification.seed.json').questions.map((q) => q.code));
    expect(codes.has('generate_csam')).toBe(true);
    expect(codes.has('generate_ncii')).toBe(true);
  });
});
