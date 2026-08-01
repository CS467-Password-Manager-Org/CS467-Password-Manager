import { useEffect, useState } from 'react';
import {
  deriveKeys,
  decryptVaultItem,
  encryptVaultItem,
  generateSalt,
  type DerivedKeys,
} from '@app/crypto';

import './App.css';
import { LoginPage } from './pages/LoginPage';
import { loadEncryptionKey, saveEncryptionKey } from './keyStore';
import {
  activateMfa,
  createVaultItem,
  deleteVaultItem,
  enrollMfa,
  fetchMe,
  fetchVaultItems,
  fetchUserSalt,
  login,
  registerNewEmail,
  updateVaultItem,
} from './serverAPI';
import { PasswordsPage } from './pages/PasswordsPage';
import { RegisterPage } from './pages/RegisterPage';

function App() {
  return (
    <section id="center">
      <Routes />
    </section>
  );
}

function Routes() {
  const [path, setPath] = useState(window.location.pathname);
  // The encryption key is held separately because it is the only part that
  // survives a reload. authKey is only needed during login and is never stored.
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | undefined>();
  // Rendering /passwords before the stored key has been read would look exactly
  // like "no key" and bounce the user to /login — the bug this fixes.
  const [keyHydrated, setKeyHydrated] = useState(false);

  const redirect = (newPath: string) => {
    window.history.pushState(null, '', newPath);
    setPath(newPath);
  };

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadEncryptionKey()
      .then((stored) => {
        if (cancelled) return;
        if (stored) setEncryptionKey(stored);
      })
      .finally(() => {
        if (!cancelled) setKeyHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeriveKeys = async (password: string, salt: Uint8Array): Promise<DerivedKeys> => {
    const derived = await deriveKeys(password, salt);
    setEncryptionKey(derived.encryptionKey);
    // Persist so a reload does not lose the ability to decrypt the vault. Only
    // the encryption key is stored; authKey stays in memory.
    await saveEncryptionKey(derived.encryptionKey);
    return derived;
  };

  switch (path) {
    case '/login':
      return (
        <LoginPage
          fetchUserSalt={fetchUserSalt}
          deriveKeys={handleDeriveKeys}
          login={login}
          redirect={redirect}
        />
      );
    case '/register':
      return (
        <RegisterPage
          generateSalt={generateSalt}
          deriveKeys={deriveKeys}
          registerNewUser={registerNewEmail}
          redirect={redirect}
        />
      );
    case '/passwords':
      // Hold the route until the stored key has been read, otherwise the page
      // mounts with no key and immediately redirects to /login on every reload.
      // Render a placeholder rather than null: returning nothing leaves a blank
      // screen for as long as the read takes, which on a slow device reads as a
      // broken page.
      if (!keyHydrated) {
        return (
          <div>
            <h2>Passwords</h2>
            <p>Unlocking your vault…</p>
          </div>
        );
      }
      return (
        <PasswordsPage
          fetchVaultItems={fetchVaultItems}
          decryptVaultItem={decryptVaultItem}
          encryptVaultItem={encryptVaultItem}
          createVaultItem={createVaultItem}
          updateVaultItem={updateVaultItem}
          deleteVaultItem={deleteVaultItem}
          encryptionKey={encryptionKey}
          fetchMe={fetchMe}
          enrollMfa={enrollMfa}
          activateMfa={activateMfa}
          redirect={redirect}
        />
      );
    default:
      return <PageNotFound />;
  }
}

function PageNotFound() {
  return (
    <div>
      <h2>Page Not Found</h2>
    </div>
  );
}

export default App;
