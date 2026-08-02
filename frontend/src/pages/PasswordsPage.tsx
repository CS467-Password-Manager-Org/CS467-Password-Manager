import { useEffect, useState } from 'react';
import type { ServerResponse } from '../serverAPI';
import { PasswordItem, type DecryptedVaultItem } from '../components/PasswordItem';
import { MfaSetupForm } from '../components/MfaSetupForm';
import type { MeResponse, MfaEnrollResponse, MfaStatusResponse, VaultItem } from '@app/shared';
import { generateSuggestedPassword, type VaultItemSecret } from '@app/crypto';
import { PasswordWarnings } from '../components/PasswordWarnings';
import { clearEncryptionKey } from '../keyStore';

function CreatePasswordForm({
  encryptVaultItem,
  createVaultItem,
  encryptionKey,
  existingPasswords,
  onSaved,
}: {
  encryptVaultItem: (item: VaultItemSecret, key: CryptoKey) => Promise<string>;
  createVaultItem: (encryptedData: string) => Promise<ServerResponse<VaultItem | null>>;
  encryptionKey: CryptoKey | undefined;
  existingPasswords: readonly VaultItemSecret[];
  onSaved: () => Promise<void>;
}) {
  const [formSiteName, setFormSiteName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [revealed, setRevealed] = useState(false);

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
    <section className="card">
      <h3>Create New Password Entry</h3>
      <form>
        <div className="stack">
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
            type={revealed ? 'text' : 'password'}
            placeholder="Password"
            autoComplete="new-password"
            onInput={(ev) => setFormPassword(ev.currentTarget.value)}
            value={formPassword}
          />
        </div>
        <div className="actions">
          <button type="button" onClick={() => setFormPassword(generateSuggestedPassword())}>
            Generate
          </button>
          <button type="button" onClick={() => setRevealed((prev) => !prev)}>
            {revealed ? 'Hide' : 'Show'}
          </button>
          <button className="primary" onClick={handleCreatePassword}>
            Save
          </button>
        </div>
      </form>

      <PasswordWarnings password={formPassword} existingPasswords={existingPasswords} />

      {createError && (
        <div>
          <p className="error">Error: {createError}</p>
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
  enrollMfa,
  activateMfa,
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
  enrollMfa: () => Promise<ServerResponse<MfaEnrollResponse | null>>;
  activateMfa: (code: string) => Promise<ServerResponse<MfaStatusResponse | null>>;
  redirect: (route: string) => void;
}) {
  const [passwords, setPasswords] = useState<DecryptedVaultItem[] | null>(null);
  const [passwordsError, setPasswordsError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  // Tri-state: null means "not known yet". Defaulting to false made the page
  // claim MFA was off before /me answered, so a user who has MFA enabled was
  // briefly told their account was unprotected and offered a setup form.
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);

  const loadPasswords = async (key: CryptoKey) => {
    await applyVaultItems(await fetchVaultItems(), key);
  };

  // Split out so the initial load can fetch items alongside /me and hand the
  // response in, rather than waiting for /me to resolve first.
  const applyVaultItems = async (
    response: Awaited<ReturnType<typeof fetchVaultItems>>,
    key: CryptoKey,
  ) => {
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
      // Fire both together. They are independent — each only needs the token —
      // and serialising them cost a full extra round-trip on every page load,
      // which is what made the vault appear noticeably after the rest of the
      // page. The items request is skipped when there is no key, since nothing
      // could be decrypted with it anyway.
      const [me, itemsResponse] = await Promise.all([
        fetchMe(),
        encryptionKey ? fetchVaultItems() : Promise.resolve(null),
      ]);

      const email = me.data?.email ?? '';
      setUserEmail(email);
      setMfaEnabled(me.data?.mfaEnabled ?? false);

      // No valid session: the token is missing, expired, or was revoked. Drop the
      // stored encryption key as well, so it never outlives the session that
      // justified holding it, then send the user to sign in again.
      if (!email) {
        await clearEncryptionKey();
        redirect('/login');
        return;
      }

      // Session is valid but the vault key is unavailable — for example when
      // IndexedDB is blocked, so the key could not survive the reload. Signing in
      // again is the only way to re-derive it from the master password.
      if (!encryptionKey) {
        redirect('/login');
        return;
      }

      if (itemsResponse) {
        await applyVaultItems(itemsResponse, encryptionKey);
      }
    };

    fetchData();
  }, []);

  return (
    <div>
      <h2>Passwords</h2>
      {userEmail && <p className="muted">Logged in as {userEmail}</p>}

      {mfaEnabled === null ? null : mfaEnabled ? (
        <p className="muted">Multi-factor authentication is enabled.</p>
      ) : (
        <MfaSetupForm
          enrollMfa={enrollMfa}
          activateMfa={activateMfa}
          onEnabled={() => setMfaEnabled(true)}
        />
      )}

      {passwordsError && <p className="error">Error: {passwordsError}</p>}
      {deleteError && <p className="error">Error: {deleteError}</p>}

      {passwords && !passwordsError && passwords.length > 0 && (
        // Wrapper scrolls instead of the page: a vault entry can hold a long
        // site name or password, and a table that overflows the viewport would
        // otherwise push the whole layout sideways.
        <div className="table-wrap">
          <table className="vault-table">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Username</th>
                <th scope="col">Password</th>
                <th scope="col" className="cell-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {passwords.map((p) => (
                <PasswordItem
                  item={p}
                  existingPasswords={passwords.filter((other) => other.id !== p.id)}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  key={p.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {passwords && !passwordsError && passwords.length === 0 && (
        <div className="empty-state">No passwords found.</div>
      )}

      <CreatePasswordForm
        encryptVaultItem={encryptVaultItem}
        createVaultItem={createVaultItem}
        encryptionKey={encryptionKey}
        existingPasswords={passwords ?? []}
        onSaved={async () => {
          if (encryptionKey) {
            await loadPasswords(encryptionKey);
          }
        }}
      />
    </div>
  );
}
