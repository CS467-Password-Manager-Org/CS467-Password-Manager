import { useState } from 'react';
import type { VaultItemSecret } from '@app/crypto';

export interface DecryptedVaultItem extends VaultItemSecret {
  id: string;
}

export function PasswordItem({
  item,
  onDelete,
}: {
  item: DecryptedVaultItem;
  onDelete: (id: string) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

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
        <button type="button" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
