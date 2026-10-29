import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { lawShortName, formatContentDate } from '@/data/catalog';

// Regulatory news entries (content/news.json): date, headline, summary, the
// laws each one touches and its sources. Shared by the public /news page and
// the in-app news page; `lawLink(key)` turns the law tags into links where
// the reader can open the law (in-app only).
export default function NewsList({ items, lawLink }) {
  const { t, lang } = useT();
  // Links such as the homepage banner point at one entry (/news#<id>); the
  // router does not scroll to hashes by itself.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <div className="stack" style={{ gap: 14 }}>
      {items.map((item) => (
        <article key={item.id} id={item.id} className="card" data-testid="news-item">
          <div className="card-body">
            <time className="eyebrow" dateTime={item.date}>{formatContentDate(item.date, lang)}</time>
            <h2 style={{ fontSize: 18, lineHeight: 1.35, margin: '6px 0 8px' }}>{item.title[lang] || item.title.en}</h2>
            <p style={{ margin: 0, color: 'var(--ink-soft)' }}>{item.summary[lang] || item.summary.en}</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {item.frameworkKeys.map((k) => (lawLink
                ? <Link key={k} to={lawLink(k)} className="tag-pill">{lawShortName(k, lang)}</Link>
                : <span key={k} className="tag-pill">{lawShortName(k, lang)}</span>))}
            </div>
            <div className="muted small" style={{ marginTop: 12 }}>
              {t('news.sources')}:{' '}
              {item.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ' · '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.label} <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
