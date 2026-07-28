import { useEffect, useState } from 'react';
import type { ServerResponse } from '../serverAPI';
import type { MeResponse, VaultItem } from '@app/shared';
import type { VaultItemSecret } from '@app/crypto';
import { PasswordItem, type DecryptedVaultItem } from '../components/PasswordItem';

function CreatePasswordForm({
  encryptVaultItem,
  createVaultItem,
  encryptionKey,
  onSaved,
}: {
  encryptVaultItem: (item: VaultItemSecret, key: CryptoKey) => Promise<string>;
  createVaultItem: (encryptedData: string) => Promise<ServerResponse<VaultItem | null>>;
  encryptionKey: CryptoKey | undefined;
  onSaved: () => Promise<void>;
}) {
  const [formSiteName, setFormSiteName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [createError, setCreateError] = useState('');

  const handleCreatePassword = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    if (!formSiteName || !formUsername || !formPassword || !encryptionKey) {
      return;
    }

    setCreateError('');

    try {
      const encryptedData = await encryptVaultItem(
        { siteName: formSiteName, username: formUsername, password: formPassword },
        encryptionKey,
      );
      const { publicErrorMessage } = await createVaultItem(encryptedData);
      if (publicErrorMessage) {
        setCreateError(publicErrorMessage);
        return;
      }

      setFormSiteName('');
      setFormUsername('');
      setFormPassword('');
      await onSaved();
    } catch (e) {
      console.error(e);
      setCreateError('Error saving password.');
    }
  };

  return (
    <section>
      <h3>Create New Password Entry</h3>
      <form>
        <input
          type="text"
          placeholder="Site name"
          onInput={(ev) => setFormSiteName(ev.currentTarget.value)}
          value={formSiteName}
        />
        <input
          type="text"
          placeholder="Username"
          onInput={(ev) => setFormUsername(ev.currentTarget.value)}
          value={formUsername}
        />
        <input
          type="password"
          placeholder="Password"
          onInput={(ev) => setFormPassword(ev.currentTarget.value)}
          value={formPassword}
        />
        <button onClick={handleCreatePassword}>Save</button>
      </form>

      {createError && (
        <div>
          <p>Error: {createError}</p>
        </div>
      )}
    </section>
  );
}

export function PasswordsPage({
  fetchVaultItems,
  decryptVaultItem,
  encryptVaultItem,
  createVaultItem,
  updateVaultItem,
  deleteVaultItem,
  encryptionKey,
  fetchMe,
  redirect,
}: {
  fetchVaultItems: () => Promise<ServerResponse<VaultItem[] | null>>;
  decryptVaultItem: (payload: string, key: CryptoKey) => Promise<VaultItemSecret>;
  encryptVaultItem: (item: VaultItemSecret, key: CryptoKey) => Promise<string>;
  createVaultItem: (encryptedData: string) => Promise<ServerResponse<VaultItem | null>>;
  updateVaultItem: (id: string, encryptedData: string) => Promise<ServerResponse<VaultItem | null>>;
  deleteVaultItem: (id: string) => Promise<ServerResponse<null>>;
  encryptionKey: CryptoKey | undefined;
  fetchMe: () => Promise<ServerResponse<MeResponse | null>>;
  redirect: (route: string) => void;
}) {
  const [passwords, setPasswords] = useState<DecryptedVaultItem[] | null>(null);
  const [passwordsError, setPasswordsError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [userEmail, setUserEmail] = useState('');

  const loadPasswords = async (key: CryptoKey) => {
    const response = await fetchVaultItems();
    if (response.publicErrorMessage) {
      setPasswordsError(response.publicErrorMessage);
      return;
    }

    const vaultItems = response.data;
    if (!vaultItems) {
      setPasswordsError('Error fetching passwords');
      return;
    }

    try {
      const passwords = await Promise.all(
        vaultItems.map(async (item) => ({
          ...(await decryptVaultItem(item.encryptedData, key)),
          id: item.id,
        })),
      );
      setPasswordsError('');
      setPasswords(passwords);
    } catch {
      setPasswordsError('Unable to load your passwords.');
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteError('');
    const { publicErrorMessage } = await deleteVaultItem(id);
    if (publicErrorMessage) {
      setDeleteError(publicErrorMessage);
      return;
    }

    if (encryptionKey) {
      await loadPasswords(encryptionKey);
    }
  };

  const handleEdit = async (
    id: string,
    update: { siteName: string; username: string; password: string },
  ): Promise<string> => {
    if (!encryptionKey) {
      return 'Error updating password.';
    }

    try {
      const encryptedData = await encryptVaultItem(update, encryptionKey);
      const { publicErrorMessage } = await updateVaultItem(id, encryptedData);
      if (publicErrorMessage) {
        return publicErrorMessage;
      }

      await loadPasswords(encryptionKey);
      return '';
    } catch (e) {
      console.error(e);
      return 'Error updating password.';
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await fetchMe();
      const email = data?.email ?? '';
      setUserEmail(email);

      if (!email || !encryptionKey) {
        redirect('/login');
        return;
      }

      await loadPasswords(encryptionKey);
    };

    fetchData();
  }, []);

  return (
    <div>
      <h2>Passwords</h2>
      {userEmail && <p>Logged in as {userEmail}</p>}
      <section className="basic-flex">
        {passwordsError && (
          <section>
            <h2>Error: {passwordsError}</h2>
          </section>
        )}

        {deleteError && (
          <section>
            <h2>Error: {deleteError}</h2>
          </section>
        )}

        {passwords &&
          !passwordsError &&
          passwords.length > 0 &&
          passwords.map((p) => (
            <PasswordItem item={p} onDelete={handleDelete} onEdit={handleEdit} key={p.id} />
          ))}
      </section>

      {passwords && !passwordsError && passwords.length === 0 && <div>No passwords found.</div>}

      <CreatePasswordForm
        encryptVaultItem={encryptVaultItem}
        createVaultItem={createVaultItem}
        encryptionKey={encryptionKey}
        onSaved={async () => {
          if (encryptionKey) {
            await loadPasswords(encryptionKey);
          }
        }}
      />
    </div>
  );
}
