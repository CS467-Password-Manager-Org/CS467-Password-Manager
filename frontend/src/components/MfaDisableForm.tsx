import { useState } from 'react';
import type { ServerResponse } from '../serverAPI';
import type { MfaStatusResponse } from '@app/shared';

export function MfaDisableForm({
  disableMfa,
  onDisabled,
}: {
  disableMfa: (code: string) => Promise<ServerResponse<MfaStatusResponse | null>>;
  onDisabled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const [disableError, setDisableError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRemove = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    if (!/^[0-9]{6}$/.test(code)) {
      setDisableError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setDisableError('');
    setSubmitting(true);

    const { publicErrorMessage } = await disableMfa(code);
    setSubmitting(false);
    if (publicErrorMessage) {
      setDisableError(publicErrorMessage);
      setCode('');
      return;
    }

    setConfirming(false);
    setCode('');
    onDisabled();
  };

  const handleCancel = () => {
    setConfirming(false);
    setCode('');
    setDisableError('');
  };

  if (!confirming) {
    return (
      <section className="card">
        <h3>Multi-Factor Authentication</h3>
        <p className="muted">Multi-factor authentication is enabled.</p>
        <div className="actions">
          <button type="button" onClick={() => setConfirming(true)}>
            Remove MFA
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Remove Multi-Factor Authentication</h3>
      <p className="muted">
        Enter a current code from your authenticator app to confirm removing MFA from your
        account.
      </p>

      <form>
        <div className="field card-narrow">
          <label htmlFor="mfa-disable-code">Enter the code from your app</label>
          <input
            id="mfa-disable-code"
            type="text"
            inputMode="numeric"
            maxLength={7}
            autoComplete="one-time-code"
            placeholder="6-digit code"
            onInput={(ev) => setCode(ev.currentTarget.value.replace(/\s/g, '').slice(0, 6))}
            value={code}
          />
        </div>
        <div className="actions">
          <button className="primary" onClick={handleRemove} disabled={submitting}>
            Remove MFA
          </button>
          <button type="button" onClick={handleCancel} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>

      {disableError && (
        <div>
          <p className="error">Error: {disableError}</p>
        </div>
      )}
    </section>
  );
}
