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
      <section>
        <h3>Multi-Factor Authentication</h3>
        <p>Add an extra layer of security to your account with an authenticator app.</p>
        <button type="button" onClick={handleStartEnrollment}>
          Set up MFA
        </button>

        {enrollError && (
          <div>
            <p>Error: {enrollError}</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section>
      <h3>Set up Multi-Factor Authentication</h3>
      <p>Scan this QR code with your authenticator app:</p>
      {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="MFA QR code" />}

      <p>Or enter this key manually:</p>
      <p>
        <code>{enrollData.secret}</code>
      </p>

      <form>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="6-digit code"
          onInput={(ev) => setCode(ev.currentTarget.value)}
          value={code}
        />
        <button onClick={handleActivate}>Activate</button>
        <button type="button" onClick={handleCancel}>
          Cancel
        </button>
      </form>

      {activateError && (
        <div>
          <p>Error: {activateError}</p>
        </div>
      )}
    </section>
  );
}
