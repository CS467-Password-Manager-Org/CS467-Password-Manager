import { useState } from 'react';
import { type LoginResult } from '../serverAPI';
import type { ServerResponse } from '../serverAPI';
import type { SaltResponse } from '@app/shared';
import { base64ToBytes, bytesToBase64, type DerivedKeys } from '@app/crypto';

// Login is a five step process.
//   1. A user enters their email and we fetch the salt associated with that email.
//   2. A user enters their master password. We use this and the salt from step 1
//      to derive an auth key.
//   3. We send the auth key to the server for validation. If the account has MFA
//      enabled, the server rejects this with mfa_required instead of a token.
//   4. If a code is required, the user enters it and we resend the auth key with
//      the code. If it is valid, the server sets a bearer token that authorizes
//      future requests.
//   5. We redirect the user to the passwords page.
export function LoginPage({
  fetchUserSalt,
  deriveKeys,
  login,
  redirect,
}: {
  fetchUserSalt: (email: string) => Promise<ServerResponse<SaltResponse | null>>;
  deriveKeys: (masterPassword: string, salt: Uint8Array) => Promise<DerivedKeys>;
  login: (email: string, authKey: string, code?: string) => Promise<LoginResult>;
  redirect: (newPath: string) => void;
}) {
  const [formEmail, setFormEmail] = useState('');
  const [userSalt, setUserSalt] = useState<Uint8Array | null>(null);
  const [fetchUserSaltError, setFetchUserSaltError] = useState('');

  const [formPassword, setFormPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [authKey, setAuthKey] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [formMfaCode, setFormMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');

  const handleFetchUserSalt = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    // TODO: add client side email format validations
    if (!formEmail) {
      return;
    }

    setUserSalt(null);
    setFetchUserSaltError('');

    const { data, publicErrorMessage } = await fetchUserSalt(formEmail);
    setFetchUserSaltError(publicErrorMessage);
    if (!data) {
      return;
    }
    setUserSalt(base64ToBytes(data.salt));
  };

  const handleGenerateAuthKeyAndLogin = async (
    ev: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    ev.preventDefault();

    // TODO: add client side password validation
    if (!formPassword || !userSalt) {
      return;
    }

    try {
      const { authKey } = await deriveKeys(formPassword, userSalt);
      const authKeyBase64 = bytesToBase64(authKey);
      setAuthKey(authKeyBase64);

      const { data, publicErrorMessage, mfaRequired } = await login(formEmail, authKeyBase64);
      if (mfaRequired) {
        setMfaRequired(true);
        return;
      }

      if (!data) {
        setLoginError(publicErrorMessage);
        return;
      }

      // TODO: store in sessionStorage for now, not secure. We probably want to
      // move to a cookie.
      sessionStorage.setItem('token', data.token);

      redirect('/passwords');
    } catch (e) {
      console.error(e);
      setLoginError('Error logging in.');
    }
  };

  const handleSubmitMfaCode = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    if (!formMfaCode) {
      return;
    }

    setMfaError('');

    try {
      const { data, publicErrorMessage } = await login(formEmail, authKey, formMfaCode);
      if (!data) {
        setMfaError(publicErrorMessage);
        return;
      }

      // TODO: store in sessionStorage for now, not secure. We probably want to
      // move to a cookie.
      sessionStorage.setItem('token', data.token);

      redirect('/passwords');
    } catch (e) {
      console.error(e);
      setMfaError('Error logging in.');
    }
  };

  return (
    <div className="card card-narrow">
      <h2>Sign in</h2>

      {!userSalt ? (
        <>
          <form>
            <div className="field">
              <label htmlFor="login-email">Enter your Email Address</label>
              <input
                id="login-email"
                type="text"
                autoComplete="username"
                onInput={(ev) => {
                  setFormEmail(ev.currentTarget.value);
                }}
                value={formEmail}
              />
            </div>
            <div className="actions">
              <button className="primary" onClick={handleFetchUserSalt}>
                Submit
              </button>
            </div>
          </form>

          {fetchUserSaltError && (
            <div>
              <p className="error">Error: {fetchUserSaltError}</p>
            </div>
          )}
        </>
      ) : mfaRequired ? (
        <>
          <form>
            <div className="field">
              <label htmlFor="login-mfa-code">Enter your Authentication Code</label>
              <input
                id="login-mfa-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="6-digit code"
                onInput={(ev) => setFormMfaCode(ev.currentTarget.value)}
                value={formMfaCode}
              />
            </div>
            <div className="actions">
              <button className="primary" onClick={handleSubmitMfaCode}>
                Submit
              </button>
            </div>
          </form>

          {mfaError && (
            <div>
              <p className="error">Error: {mfaError}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <form>
            <div className="field">
              <label htmlFor="login-password">Enter your Master Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                onInput={(ev) => setFormPassword(ev.currentTarget.value)}
                value={formPassword}
              />
            </div>
            <div className="actions">
              <button className="primary" onClick={handleGenerateAuthKeyAndLogin}>
                Submit
              </button>
            </div>
          </form>

          {loginError && (
            <div>
              <p className="error">Error: {loginError}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
