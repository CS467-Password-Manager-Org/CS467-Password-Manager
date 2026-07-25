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
import {
  createVaultItem,
  deleteVaultItem,
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
  const [keys, setKeys] = useState<DerivedKeys | null>();

  const redirect = (newPath: string) => {
    window.history.pushState(null, '', newPath);
    setPath(newPath);
  };

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleDeriveKeys = async (password: string, salt: Uint8Array): Promise<DerivedKeys> => {
    const derived = await deriveKeys(password, salt);
    setKeys(derived);
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
      return (
        <PasswordsPage
          fetchVaultItems={fetchVaultItems}
          decryptVaultItem={decryptVaultItem}
          encryptVaultItem={encryptVaultItem}
          createVaultItem={createVaultItem}
          updateVaultItem={updateVaultItem}
          deleteVaultItem={deleteVaultItem}
          encryptionKey={keys?.encryptionKey}
          fetchMe={fetchMe}
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
