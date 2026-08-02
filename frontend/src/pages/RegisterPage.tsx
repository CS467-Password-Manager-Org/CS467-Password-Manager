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
import { PasswordStrengthInput } from '../components/PasswordStrengthInput';

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
    <div>
      <h2>Register a new account</h2>

      <form>
        <h3>Enter your email address</h3>
        <input
          type="text"
          onInput={(ev) => {
            setFormEmail(ev.currentTarget.value);
          }}
          value={formEmail}
        />

        <h3>Enter your new Master Password</h3>
        <PasswordStrengthInput value={formPassword} onChange={setFormPassword} userInputs={[formEmail]} />
        <button onClick={handleRegisterNewEmail}>Submit</button>
      </form>

      {registerError && (
        <div>
          <p>Error: {registerError}</p>
        </div>
      )}
    </div>
  );
}
