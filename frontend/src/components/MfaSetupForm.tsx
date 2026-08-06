import { useState } from 'react';
import QRCode from 'qrcode';
import type { ServerResponse } from '../serverAPI';
import type { MfaEnrollResponse, MfaStatusResponse } from '@app/shared';

export function MfaSetupForm({
  enrollMfa,
  activateMfa,
  onEnabled,
}: {
  enrollMfa: () => Promise<ServerResponse<MfaEnrollResponse | null>>;
  activateMfa: (code: string) => Promise<ServerResponse<MfaStatusResponse | null>>;
  onEnabled: () => void;
}) {
  const [enrollData, setEnrollData] = useState<MfaEnrollResponse | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [enrollError, setEnrollError] = useState('');

  const [code, setCode] = useState('');
  const [activateError, setActivateError] = useState('');

  const handleStartEnrollment = async (
    ev: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    ev.preventDefault();

    setEnrollError('');

    const { data, publicErrorMessage } = await enrollMfa();
    if (!data) {
      setEnrollError(publicErrorMessage);
      return;
    }

    setEnrollData(data);
    try {
      const dataUrl = await QRCode.toDataURL(data.otpauthUri);
      setQrCodeDataUrl(dataUrl);
    } catch (e) {
      console.error(e);
    }
  };

  const handleActivate = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    if (!/^[0-9]{6}$/.test(code)) {
      setActivateError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setActivateError('');

    const { publicErrorMessage } = await activateMfa(code);
    if (publicErrorMessage) {
      setActivateError(publicErrorMessage);
      return;
    }

    onEnabled();
  };

  const handleCancel = () => {
    setEnrollData(null);
    setQrCodeDataUrl('');
    setCode('');
    setActivateError('');
  };

  if (!enrollData) {
    return (
      <section className="card">
        <h3>Multi-Factor Authentication</h3>
        <p className="muted">
          Add an extra layer of security to your account with an authenticator app.
        </p>
        <div className="actions">
          <button type="button" onClick={handleStartEnrollment}>
            Set up MFA
          </button>
        </div>

        {enrollError && (
          <div>
            <p className="error">Error: {enrollError}</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Set up Multi-Factor Authentication</h3>
      <p className="muted">Scan this QR code with your authenticator app:</p>
      {qrCodeDataUrl && <img className="mfa-qr" src={qrCodeDataUrl} alt="MFA QR code" />}

      <p className="muted">Or enter this key manually:</p>
      <p>
        <code className="secret-key">{enrollData.secret}</code>
      </p>

      <form>
        <div className="field card-narrow">
          <label htmlFor="mfa-activation-code">Enter the code from your app</label>
          <input
            id="mfa-activation-code"
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
          <button className="primary" onClick={handleActivate}>
            Activate
          </button>
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </form>

      {activateError && (
        <div>
          <p className="error">Error: {activateError}</p>
        </div>
      )}
    </section>
  );
}
