import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLangStore } from '@/store/langStore';
import NewsList from '@/components/news/NewsList';
import { NEWS } from '@/data/catalog';

// Public regulatory news: what changed in AI law in Germany and the EU, newest
// first. Entries come from content/news.json, the same file the in-app news
// page reads, so the prerendered page is current with every deploy.
export default function News() {
  const lang = useLangStore((s) => s.lang);
  const de = lang === 'de';

  return (
    <div data-testid="marketing-news">
      <section className="mkt-section" style={{ paddingTop: 64, paddingBottom: 20 }}>
        <div className="content" style={{ maxWidth: 760 }}>
          <div className="eyebrow">{de ? 'Neuigkeiten' : 'News'}</div>
          <h1 className="mkt-h1" style={{ fontSize: 38, textAlign: 'left' }}>
            {de ? 'Was sich im KI-Recht ändert' : 'What is changing in AI law'}
          </h1>
          <p className="mkt-lead" style={{ textAlign: 'left', margin: '16px 0 0' }}>
            {de
              ? 'Neue Gesetze, verschobene Fristen und laufende Gesetzgebungsverfahren, die KI in Deutschland betreffen. Jeder Eintrag nennt seine Quellen.'
              : 'New laws, moved deadlines and bills in progress that affect AI in Germany. Every entry lists its sources.'}
          </p>
        </div>
      </section>

      <section className="mkt-section" style={{ paddingTop: 8 }}>
        <div className="content" style={{ maxWidth: 760 }}>
          <NewsList items={NEWS} />
        </div>
      </section>

      <section className="mkt-cta-band">
        <div className="content" style={{ textAlign: 'center' }}>
          <h2>{de ? 'Welche dieser Gesetze gelten für Sie?' : 'Which of these laws apply to you?'}</h2>
          <p className="mkt-lead-sm" style={{ margin: '10px auto 22px' }}>
            {de
              ? 'Erfassen Sie Ihre KI-Systeme und sehen Sie, welche Pflichten und Fristen Sie betreffen.'
              : 'Register your AI systems and see which obligations and deadlines affect you.'}
          </p>
          <div className="row" style={{ gap: 12, justifyContent: 'center' }}>
            <Link to="/welcome#frameworks" className="btn btn-outline">{de ? 'Alle Regelwerke' : 'All frameworks'}</Link>
            <Link to="/register" className="btn btn-primary">
              {de ? 'Kostenlos starten' : 'Start for free'} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
