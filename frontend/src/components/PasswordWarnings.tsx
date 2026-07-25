import type { VaultItemSecret } from '@app/crypto';
import { isCommonPassword, isReusedPassword } from '@app/crypto';

export function PasswordWarnings({
  password,
  existingPasswords,
}: {
  password: string;
  existingPasswords: readonly VaultItemSecret[];
}) {
  if (!password) {
    return null;
  }

  const warnings: string[] = [];
  if (isCommonPassword(password)) {
    warnings.push('This password is very common and easy to guess.');
  }
  if (isReusedPassword(password, existingPasswords)) {
    warnings.push('This password is already used for another vault entry.');
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="password-warnings">
      {warnings.map((warning) => (
        <p key={warning}>⚠ {warning}</p>
      ))}
    </div>
  );
}
