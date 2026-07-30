import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import { loadEncryptionKey } from './keyStore';

// jsdom provides no IndexedDB, so the real store would always no-op. Mocking it
// lets us drive the two cases that matter: a key was restored after a reload, or
// there was nothing to restore.
vi.mock('./keyStore', () => ({
  loadEncryptionKey: vi.fn(),
  saveEncryptionKey: vi.fn().mockResolvedValue(undefined),
  clearEncryptionKey: vi.fn().mockResolvedValue(undefined),
}));

const fetchMe = vi.fn();
const fetchVaultItems = vi.fn();

vi.mock('./serverAPI', () => ({
  fetchMe: (...args: unknown[]) => fetchMe(...args),
  fetchVaultItems: (...args: unknown[]) => fetchVaultItems(...args),
  createVaultItem: vi.fn(),
  updateVaultItem: vi.fn(),
  deleteVaultItem: vi.fn(),
  fetchUserSalt: vi.fn(),
  login: vi.fn(),
  registerNewEmail: vi.fn(),
  enrollMfa: vi.fn(),
  activateMfa: vi.fn(),
}));

function visit(path: string) {
  window.history.pushState(null, '', path);
}

describe('App vault key hydration on reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMe.mockResolvedValue({
      data: { id: 'user-1', email: 'user@example.com', mfaEnabled: false },
      publicErrorMessage: '',
    });
    fetchVaultItems.mockResolvedValue({ data: [], publicErrorMessage: '' });
  });

  afterEach(() => {
    visit('/');
  });

  it('keeps the user on /passwords when the stored key is restored', async () => {
    // The scenario from the bug report: sign in, then reload /passwords. React
    // state is gone, but the key comes back from storage and the session is
    // still valid, so the vault should load rather than bouncing to /login.
    vi.mocked(loadEncryptionKey).mockResolvedValue({} as CryptoKey);
    visit('/passwords');

    render(<App />);

    expect(await screen.findByText('Passwords')).toBeInTheDocument();
    await waitFor(() => expect(fetchVaultItems).toHaveBeenCalled());
    expect(window.location.pathname).toBe('/passwords');
  });

  it('does not render the vault before the stored key has been read', async () => {
    // Rendering PasswordsPage while the read is still in flight would look
    // identical to "no key" and redirect, which is exactly the original defect.
    let resolveKey: (key: CryptoKey | null) => void = () => {};
    vi.mocked(loadEncryptionKey).mockReturnValue(
      new Promise<CryptoKey | null>((resolve) => {
        resolveKey = resolve;
      }),
    );
    visit('/passwords');

    render(<App />);

    // Still loading: nothing rendered, and crucially no redirect has happened.
    expect(screen.queryByText('Passwords')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/passwords');

    resolveKey({} as CryptoKey);
    expect(await screen.findByText('Passwords')).toBeInTheDocument();
  });

  it('sends the user to /login when there is no stored key to restore', async () => {
    vi.mocked(loadEncryptionKey).mockResolvedValue(null);
    visit('/passwords');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(fetchVaultItems).not.toHaveBeenCalled();
  });
});
