import { useState } from 'react';
import { generateSuggestedPassword, type VaultItemSecret } from '@app/crypto';
import { PasswordWarnings } from './PasswordWarnings';
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  PencilIcon,
  TrashIcon,
} from './icons';

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
  const [copyError, setCopyError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editSiteName, setEditSiteName] = useState(item.siteName);
  const [editUsername, setEditUsername] = useState(item.username);
  const [editPassword, setEditPassword] = useState(item.password);
  const [editError, setEditError] = useState('');

  const handleCopy = async () => {
    // A rejected clipboard write used to escape as an unhandled rejection and
    // leave the icon unchanged, so the user believed the password was copied
    // and pasted whatever was on the clipboard before. Denied permission and
    // "document is not focused" are both routine, so the failure has to be
    // shown rather than swallowed.
    try {
      await navigator.clipboard.writeText(item.password);
    } catch {
      setCopyError('Could not copy. Reveal the password and copy it manually.');
      setTimeout(() => setCopyError(''), 4000);
      return;
    }
    setCopyError('');
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
      // The edit form replaces the whole row rather than editing in place: three
      // inputs squeezed into table cells collapse at any narrow width.
      <tr className="password-item">
        <td colSpan={4}>
          <form>
            <div className="stack">
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
                type={revealed ? 'text' : 'password'}
                placeholder="Password"
                autoComplete="new-password"
                onInput={(ev) => setEditPassword(ev.currentTarget.value)}
                value={editPassword}
              />
            </div>
            <div className="actions actions-start">
              <button type="button" onClick={() => setEditPassword(generateSuggestedPassword())}>
                Generate
              </button>
              <button type="button" onClick={() => setRevealed((prev) => !prev)}>
                {revealed ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="primary" onClick={handleSaveEdit}>
                Save
              </button>
              <button type="button" onClick={cancelEditing}>
                Cancel
              </button>
            </div>
          </form>

        <PasswordWarnings password={editPassword} existingPasswords={existingPasswords} />

        {editError && (
          <div>
            <p className="error">Error: {editError}</p>
          </div>
        )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="cell-site" data-label="Site">
        {item.siteName}
      </td>
      <td data-label="Username">{item.username}</td>
      <td className="cell-secret" data-label="Password">
        {revealed ? item.password : '••••••••'}
      </td>
      <td className="cell-actions">
        <div className="icon-row">
          <IconButton
            label={revealed ? 'Hide password' : 'Reveal password'}
            onClick={() => setRevealed((prev) => !prev)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
          <IconButton label={copied ? 'Copied!' : 'Copy password'} onClick={handleCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
          <IconButton label="Edit entry" onClick={startEditing}>
            <PencilIcon />
          </IconButton>
          <IconButton label="Delete entry" className="danger" onClick={handleDelete}>
            <TrashIcon />
          </IconButton>
        </div>
        {copyError && <p className="error">{copyError}</p>}
      </td>
    </tr>
  );
}
