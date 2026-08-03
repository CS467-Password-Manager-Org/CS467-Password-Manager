// Registration happens in three steps.
// 1. A user enters their email and chooses a master password.
// 2. We generate a salt random salt and derive and auth key from the salt +
//    master password.
// 3a. We submit the salt, auth key, and email to the server. If the values are valid
//    we redirect to the login page.
// 3b. If the values are invalid (ie email already registered) we clear the
//    the form values and display an error message instructing the user to try
//    again.
import type { RegisterResponse } from '@app/shared';
import { useState } from 'react';
import type { ServerResponse } from '../serverAPI';
import type { DerivedKeys } from '@app/crypto';

// registration they are redirected to the login page.
export function RegisterPage({
  generateSalt,
  deriveKeys,
  registerNewUser,
  redirect,
}: {
  generateSalt: () => Uint8Array;
  deriveKeys: (masterPassword: string, salt: Uint8Array) => Promise<DerivedKeys>;
  registerNewUser: (
    email: string,
    authKey: Uint8Array,
    salt: Uint8Array,
  ) => Promise<ServerResponse<RegisterResponse | null>>;
  redirect: (newPath: string) => void;
}) {
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [registerError, setRegisterError] = useState('');

  const handleRegisterNewEmail = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    // TODO: add client side email and password validation
    if (!formEmail || !formPassword) {
      return;
    }

    try {
      const userSalt = generateSalt();
      const { authKey } = await deriveKeys(formPassword, userSalt);
      const { publicErrorMessage } = await registerNewUser(formEmail, authKey, userSalt);
      if (publicErrorMessage) {
        setRegisterError(publicErrorMessage);
        return;
      }

      redirect('/login');
    } catch (e) {
      console.error(e);
      setRegisterError('Error setting up your account.');
    }
  };

  return (
    <div className="card card-narrow">
      <h2>Create your account</h2>

      <form>
        <div className="field">
          <label htmlFor="register-email">Enter your email address</label>
          <input
            id="register-email"
            type="text"
            autoComplete="username"
            onInput={(ev) => {
              setFormEmail(ev.currentTarget.value);
            }}
            value={formEmail}
          />
        </div>

        <div className="field">
          <label htmlFor="register-password">Enter your new Master Password</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            onInput={(ev) => setFormPassword(ev.currentTarget.value)}
            value={formPassword}
          />
        </div>

        <div className="actions">
          <button className="primary" onClick={handleRegisterNewEmail}>
            Submit
          </button>
        </div>
      </form>

      {registerError && (
        <div>
          <p className="error">Error: {registerError}</p>
        </div>
      )}
    </div>
  );
}
