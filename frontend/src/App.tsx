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
  disableMfa,
  enrollMfa,
  fetchMe,
  fetchVaultItems,
  fetchUserSalt,
  login,
  logout,
  registerNewEmail,
  updateVaultItem,
} from './serverAPI';
import { PasswordsPage } from './pages/PasswordsPage';
import { RegisterPage } from './pages/RegisterPage';
import { HomePage } from './pages/HomePage';

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
    return derived;
  };

  // Deliberately separate from deriving the key. Derivation happens before the
  // server has seen anything, so persisting there wrote the key to disk on the
  // strength of a password nobody had checked: a correct password with the MFA
  // step abandoned left the real vault key stored with no session behind it,
  // and a mistyped password overwrote a good stored key with a useless one,
  // breaking decryption on the next reload. The caller persists only once the
  // server has issued a token.
  const persistEncryptionKey = async (key: CryptoKey): Promise<void> => {
    await saveEncryptionKey(key);
  };

  switch (path) {
    // Without this the root URL fell through to PageNotFound, so opening the
    // site at all looked broken.
    case '/':
      return <HomePage redirect={redirect} />;
    case '/login':
      return (
        <LoginPage
          fetchUserSalt={fetchUserSalt}
          deriveKeys={handleDeriveKeys}
          persistEncryptionKey={persistEncryptionKey}
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
          logout={logout}
          disableMfa={disableMfa}
          redirect={redirect}
          onLoggedOut={() => setEncryptionKey(undefined)}
        />
      );
    default:
      return <PageNotFound redirect={redirect} />;
  }
}

function PageNotFound({ redirect }: { redirect: (newPath: string) => void }) {
  return (
    <div>
      <h2>Page Not Found</h2>
      {/* A dead end with no way out is the reason the root route was reported. */}
      <button type="button" onClick={() => redirect('/')}>
        Go to the home page
      </button>
    </div>
  );
}

export default App;
