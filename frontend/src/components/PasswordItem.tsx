import { useState } from 'react';
import { generateSuggestedPassword, type VaultItemSecret } from '@app/crypto';
import { PasswordWarnings } from './PasswordWarnings';

export interface DecryptedVaultItem extends VaultItemSecret {
  id: string;
}

export function PasswordItem({
  item,
  existingPasswords,
  onDelete,
  onEdit,
}: {
  item: DecryptedVaultItem;
  existingPasswords: readonly VaultItemSecret[];
  onDelete: (id: string) => Promise<void>;
  onEdit: (
    id: string,
    update: { siteName: string; username: string; password: string },
  ) => Promise<string>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSiteName, setEditSiteName] = useState(item.siteName);
  const [editUsername, setEditUsername] = useState(item.username);
  const [editPassword, setEditPassword] = useState(item.password);
  const [editError, setEditError] = useState('');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(item.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete the password entry for ${item.siteName}?`)) {
      return;
    }
    await onDelete(item.id);
  };

  const startEditing = () => {
    setEditSiteName(item.siteName);
    setEditUsername(item.username);
    setEditPassword(item.password);
    setEditError('');
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditError('');
  };

  const handleSaveEdit = async (ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    ev.preventDefault();

    setEditError('');

    if (!editSiteName || !editUsername || !editPassword) {
      setEditError('All fields are required.');
      return;
    }

    const errorMessage = await onEdit(item.id, {
      siteName: editSiteName,
      username: editUsername,
      password: editPassword,
    });

    if (errorMessage) {
      setEditError(errorMessage);
      return;
    }

    setEditing(false);
  };

  if (editing) {
    return (
      <div className="password-item">
        <form>
          <input
            type="text"
            placeholder="Site name"
            onInput={(ev) => setEditSiteName(ev.currentTarget.value)}
            value={editSiteName}
          />
          <input
            type="text"
            placeholder="Username"
            onInput={(ev) => setEditUsername(ev.currentTarget.value)}
            value={editUsername}
          />
          <input
            type="password"
            placeholder="Password"
            onInput={(ev) => setEditPassword(ev.currentTarget.value)}
            value={editPassword}
          />
          <button type="button" onClick={() => setEditPassword(generateSuggestedPassword())}>
            Generate
          </button>
          <button type="button" onClick={handleSaveEdit}>
            Save
          </button>
          <button type="button" onClick={cancelEditing}>
            Cancel
          </button>
        </form>

        <PasswordWarnings password={editPassword} existingPasswords={existingPasswords} />

        {editError && (
          <div>
            <p>Error: {editError}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="password-item">
      <h5>{item.siteName}</h5>
      <p>Username: {item.username}</p>
      <p>Password: {revealed ? item.password : '••••••••'}</p>
      <div>
        <button type="button" onClick={() => setRevealed((prev) => !prev)}>
          {revealed ? 'Hide' : 'Reveal'}
        </button>
        <button type="button" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button type="button" onClick={startEditing}>
          Edit
        </button>
        <button type="button" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
