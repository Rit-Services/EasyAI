import { useT } from '@/hooks/useT';
import NewsList from '@/components/news/NewsList';
import { NEWS } from '@/data/catalog';

// In-app regulatory news: the same entries as the public /news page, with the
// law tags linking to each framework's page.
export default function RegulatoryNews() {
  const { t } = useT();
  return (
    <div data-testid="regulatory-news">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('news.eyebrow')}</div>
          <h1>{t('title.news')}</h1>
          <p className="sub">{t('news.sub')}</p>
        </div>
      </div>
      <div style={{ maxWidth: 820 }}>
        <NewsList items={NEWS} lawLink={(key) => `/frameworks/${key}`} />
      </div>
    </div>
  );
}
