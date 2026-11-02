import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { organizationApi } from '@/apis/organizationApi';
import { useT } from '@/hooks/useT';

// Accept the AVV: for an organisation that registered before accepting it was
// part of sign-up, or a test account switching to production. Same fields and
// wording as the registration form; the server records it the same way, ends the
// test limits and emails the signed copy.
export default function AvvAcceptForm({ org }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [address, setAddress] = useState(org?.address || '');
  const [legalForm, setLegalForm] = useState(org?.legalForm || '');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (address.trim().length < 4) { setError(t('auth.addressRequired')); return; }
    if (!accepted) { setError(t('auth.avvRequired')); return; }
    setBusy(true);
    try {
      await organizationApi.acceptAvv({
        organizationAddress: address.trim(),
        organizationLegalForm: legalForm.trim(),
        avvAccepted: true,
      });
      qc.invalidateQueries({ queryKey: ['avv'] });
      qc.invalidateQueries({ queryKey: ['organization'] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12, marginTop: 10 }} data-testid="avv-accept-form">
      <p className="small" style={{ margin: 0 }}>{t(org?.accountType === 'test' ? 'set.avvTestIntro' : 'set.avvAcceptIntro')}</p>
      <div>
        <label className="label" htmlFor="avv-address">{t('auth.address')}</label>
        <input id="avv-address" className="input" data-testid="avv-address" placeholder={t('auth.addressPlaceholder')}
          value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="avv-legal-form">{t('auth.legalForm')}</label>
        <input id="avv-legal-form" className="input" data-testid="avv-legal-form" placeholder={t('auth.legalFormPlaceholder')}
          value={legalForm} onChange={(e) => setLegalForm(e.target.value)} />
      </div>
      <label className="row small" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" data-testid="avv-accept-checkbox" style={{ marginTop: 3 }} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>
          {t('auth.avvLabelBefore')}{' '}
          <a href="/avv" target="_blank" rel="noreferrer">{t('auth.avvLinkText')}</a>
          {' '}{t('auth.avvLabelAfter')}
        </span>
      </label>
      {error && <div className="error-text" data-testid="avv-accept-error">{error}</div>}
      <div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy} data-testid="avv-accept-submit">
          {t('set.avvAcceptButton')}
        </button>
      </div>
    </form>
  );
}
