import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  disableMfa: vi.fn(),
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

    // Assert on text unique to the loaded vault rather than the heading, which
    // the loading placeholder also renders — waiting on a shared string can
    // resolve against the placeholder and race the transition.
    expect(await screen.findByText(/Logged in as/)).toBeInTheDocument();
    await waitFor(() => expect(fetchVaultItems).toHaveBeenCalled());
    expect(window.location.pathname).toBe('/passwords');
  });

  it('shows a placeholder, not the vault, until the stored key has been read', async () => {
    // Rendering PasswordsPage while the read is still in flight would look
    // identical to "no key" and redirect, which is exactly the original defect.
    // Rendering nothing at all leaves a blank screen, so a placeholder stands in.
    let resolveKey: (key: CryptoKey | null) => void = () => {};
    vi.mocked(loadEncryptionKey).mockReturnValue(
      new Promise<CryptoKey | null>((resolve) => {
        resolveKey = resolve;
      }),
    );
    visit('/passwords');

    render(<App />);

    // Placeholder is up, the vault has not loaded, and crucially no redirect.
    expect(screen.getByText('Unlocking your vault…')).toBeInTheDocument();
    expect(fetchVaultItems).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/passwords');

    resolveKey({} as CryptoKey);
    await waitFor(() => expect(fetchVaultItems).toHaveBeenCalled());
    expect(screen.queryByText('Unlocking your vault…')).not.toBeInTheDocument();
  });

  it('sends the user to /login when there is no stored key to restore', async () => {
    vi.mocked(loadEncryptionKey).mockResolvedValue(null);
    visit('/passwords');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(fetchVaultItems).not.toHaveBeenCalled();
  });
});

describe('App routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadEncryptionKey).mockResolvedValue(null);
  });

  afterEach(() => {
    visit('/');
  });

  it('shows the home page at the root URL rather than Page Not Found', async () => {
    // The reported bug: opening the site at / rendered the 404 page, so the
    // app looked broken before a user could reach either entry point.
    visit('/');

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Secure Password Manager' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Page Not Found')).not.toBeInTheDocument();
  });

  it('still shows Page Not Found for a route that does not exist', async () => {
    visit('/no-such-page');

    render(<App />);

    expect(await screen.findByText('Page Not Found')).toBeInTheDocument();
  });

  it('offers a way back home from Page Not Found', async () => {
    visit('/no-such-page');

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go to the home page' }));

    expect(window.location.pathname).toBe('/');
    expect(
      await screen.findByRole('heading', { name: 'Secure Password Manager' }),
    ).toBeInTheDocument();
  });
});
