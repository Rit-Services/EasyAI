import { Link } from 'react-router-dom';
import { useT } from '@/hooks/useT';
import { useTestAccount } from '@/hooks/useTestAccount';
import { Banner } from '@/components/ui/Ui';

// Permanent reminder on every page of a test account: this is what keeps "no
// AVV" honest, since free text cannot be checked for real personal data.
export default function TestAccountBanner() {
  const { t } = useT();
  const { isTest } = useTestAccount();
  if (!isTest) return null;
  return (
    <Banner kind="warn" data-testid="test-account-banner">
      {t('test.banner')}{' '}
      <Link to="/settings#avv" data-testid="test-account-switch">{t('test.switch')}</Link>
    </Banner>
  );
}
