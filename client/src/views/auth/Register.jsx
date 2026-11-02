import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '@/apis/authApi';
import { useT } from '@/hooks/useT';
import { Banner } from '@/components/ui/Ui';
import PasswordField from '@/components/ui/PasswordField';

const MODES = ['test', 'production'];

// The first question at sign-up (AVV or not): a data protection officer may not
// conclude a contract just to try the product, so "test" creates an account with
// no AVV and no real data; "production" concludes the AVV as part of sign-up.
function ModeChoice({ mode, onChange, t }) {
  return (
    <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 16px' }} data-testid="mode-choice">
      <legend className="label" style={{ padding: 0 }}>{t('auth.modeQuestion')}</legend>
      <div className="stack" style={{ gap: 8 }}>
        {MODES.map((m) => (
          <label
            key={m}
            className="row"
            style={{
              gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '10px 12px', borderRadius: 'var(--radius)',
              border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            <input type="radio" name="accountType" data-testid={`mode-${m}`} style={{ marginTop: 3 }} checked={mode === m} onChange={() => onChange(m)} />
            <span>
              <strong className="small">{t(m === 'test' ? 'auth.modeTest' : 'auth.modeProduction')}</strong>
              <span className="small muted" style={{ display: 'block' }}>{t(m === 'test' ? 'auth.modeTestHint' : 'auth.modeProductionHint')}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Register() {
  const { t, lang } = useT();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(MODES.includes(params.get('mode')) ? params.get('mode') : null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  const password = watch('password', '');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (data) => {
    setError(''); setBusy(true);
    try {
      const common = {
        fullName: data.fullName, email: data.email, password: data.password, accountType: mode,
        // Optional: left out when blank, so the server falls back to a default name.
        organizationName: data.organizationName?.trim() || undefined,
      };
      await authApi.register(mode === 'test'
        ? { ...common, noRealDataConfirmed: true, lang }
        : { ...common, organizationLegalForm: data.organizationLegalForm, organizationAddress: data.organizationAddress, avvAccepted: true });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div>
        <h2 style={{ marginBottom: 12 }}>{t('auth.checkEmail')}</h2>
        <Banner kind="success" data-testid="register-success">
          {t('auth.registerSuccess')}
        </Banner>
        <Link className="btn btn-outline btn-block" to="/login" style={{ marginTop: 8 }}>{t('auth.backToSignIn')}</Link>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>{t('auth.createYourAccount')}</h2>
      {error && <Banner kind="error">{error}</Banner>}
      <ModeChoice mode={mode} onChange={setMode} t={t} />
      {mode && (
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label className="label">{t('auth.fullName')}</label>
          <input className="input" data-testid="fullName" {...register('fullName', { required: t('auth.nameRequired') })} />
          {errors.fullName && <div className="error-text">{errors.fullName.message}</div>}
        </div>
        <div className="field">
          <label className="label">{t('auth.companyName')}</label>
          <input className="input" data-testid="organizationName" placeholder={t('auth.companyPlaceholder')} {...register('organizationName')} />
        </div>
        {mode === 'production' && (
          <>
            <div className="field">
              <label className="label">{t('auth.legalForm')}</label>
              <input className="input" data-testid="organizationLegalForm" placeholder={t('auth.legalFormPlaceholder')} {...register('organizationLegalForm')} />
            </div>
            <div className="field">
              <label className="label">{t('auth.address')}</label>
              <input
                className="input"
                data-testid="organizationAddress"
                placeholder={t('auth.addressPlaceholder')}
                {...register('organizationAddress', { required: t('auth.addressRequired') })}
              />
              {errors.organizationAddress && <div className="error-text">{errors.organizationAddress.message}</div>}
            </div>
          </>
        )}
        <div className="field">
          <label className="label">{t('auth.email')}</label>
          <input className="input" type="email" data-testid="email" {...register('email', { required: t('auth.emailRequired') })} />
          {errors.email && <div className="error-text">{errors.email.message}</div>}
        </div>
        <PasswordField
          label={t('auth.password')}
          testId="password"
          showMeter
          value={password}
          hint={t('auth.passwordHint')}
          error={errors.password?.message}
          field={register('password', { required: t('auth.passwordRequired'), minLength: { value: 8, message: t('auth.min8') } })}
        />
        {mode === 'production' ? (
          <div className="field">
            <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" data-testid="avvAccepted" style={{ marginTop: 3 }} {...register('avvAccepted', { required: t('auth.avvRequired') })} />
              <span className="small">
                {t('auth.avvLabelBefore')}{' '}
                <a href="/avv" target="_blank" rel="noreferrer" data-testid="avv-link">{t('auth.avvLinkText')}</a>
                {' '}{t('auth.avvLabelAfter')}
              </span>
            </label>
            {errors.avvAccepted && <div className="error-text">{errors.avvAccepted.message}</div>}
          </div>
        ) : (
          <div className="field">
            <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" data-testid="noRealDataConfirmed" style={{ marginTop: 3 }} {...register('noRealDataConfirmed', { required: t('auth.noRealDataRequired') })} />
              <span className="small">{t('auth.noRealData')}</span>
            </label>
            {errors.noRealDataConfirmed && <div className="error-text">{errors.noRealDataConfirmed.message}</div>}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" data-testid="submit" disabled={busy}>
          {busy ? t('auth.creating') : t('auth.create')}
        </button>
      </form>
      )}
      <div className="row" style={{ marginTop: 16, justifyContent: 'center', gap: 5 }}>
        <span className="small muted">{t('auth.alreadyHave')}</span>
        <Link className="small" to="/login">{t('auth.signIn')}</Link>
      </div>
    </div>
  );
}
