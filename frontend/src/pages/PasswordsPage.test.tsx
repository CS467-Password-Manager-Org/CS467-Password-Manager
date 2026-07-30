// Parts of this file were generated with AI assistance (Claude Code, Anthropic, 2026).
// Prompts used: "write some very simple tests for passwordspage.tsx"
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PasswordsPage } from './PasswordsPage';
import { clearEncryptionKey } from '../keyStore';

// jsdom has no IndexedDB, so the real key store would silently no-op. Mock it to
// assert on the calls instead — what matters here is when the key is discarded,
// not how it is stored.
vi.mock('../keyStore', () => ({
  clearEncryptionKey: vi.fn().mockResolvedValue(undefined),
  loadEncryptionKey: vi.fn().mockResolvedValue(null),
  saveEncryptionKey: vi.fn().mockResolvedValue(undefined),
}));

const STUB_KEY = {} as CryptoKey;

function renderPasswordsPage(overrides = {}) {
  const props = {
    fetchVaultItems: vi.fn().mockResolvedValue({ data: [], publicErrorMessage: '' }),
    decryptVaultItem: vi.fn(),
    encryptVaultItem: vi.fn().mockResolvedValue('encrypted-blob'),
    createVaultItem: vi
      .fn()
      .mockResolvedValue({
        data: { id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' },
        publicErrorMessage: '',
      }),
    updateVaultItem: vi
      .fn()
      .mockResolvedValue({
        data: { id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' },
        publicErrorMessage: '',
      }),
    deleteVaultItem: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: '' }),
    encryptionKey: STUB_KEY,
    fetchMe: vi
      .fn()
      .mockResolvedValue({ data: { id: 'user-1', email: 'user@example.com', mfaEnabled: false }, publicErrorMessage: '' }),
    enrollMfa: vi.fn(),
    activateMfa: vi.fn(),
    redirect: vi.fn(),
    ...overrides,
  };

  render(<PasswordsPage {...props} />);
  return props;
}

function fillOutCreateForm(siteName: string, username: string, password: string) {
  const textboxes = screen.getAllByRole('textbox');
  fireEvent.input(textboxes[0], { target: { value: siteName } });
  fireEvent.input(textboxes[1], { target: { value: username } });
  fireEvent.input(document.querySelector('input[type="password"]')!, {
    target: { value: password },
  });
}

describe('PasswordsPage', () => {
  it('renders the page heading', async () => {
    const props = renderPasswordsPage();

    expect(screen.getByText('Passwords')).toBeInTheDocument();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
  });

  it('calls fetchVaultItems on mount', async () => {
    const props = renderPasswordsPage();

    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
    expect(props.decryptVaultItem).not.toHaveBeenCalled();
  });

  it('shows a no passwords message when there are no passwords', async () => {
    renderPasswordsPage();

    expect(await screen.findByText('No passwords found.')).toBeInTheDocument();
  });

  it('renders decrypted passwords once loaded', async () => {
    renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Username: someone')).toBeInTheDocument();
    expect(screen.getByText(/Password:/)).toBeInTheDocument();
    expect(screen.queryByText(/plaintext/)).not.toBeInTheDocument();
    expect(screen.queryByText('No passwords found.')).not.toBeInTheDocument();
  });

  it('shows an error message when fetching vault items fails', async () => {
    const decryptVaultItem = vi.fn();
    renderPasswordsPage({
      fetchVaultItems: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error fetching passwords.' }),
      decryptVaultItem,
    });

    expect(await screen.findByText('Error: Error fetching passwords.')).toBeInTheDocument();
    expect(decryptVaultItem).not.toHaveBeenCalled();
    expect(screen.queryByText('No passwords found.')).not.toBeInTheDocument();
  });

  it('shows an error message when decrypting a vault item fails', async () => {
    renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    expect(await screen.findByText('Error: Unable to load your passwords.')).toBeInTheDocument();
  });

  it('shows who is logged in when an auth token is present', async () => {
    renderPasswordsPage();

    expect(await screen.findByText('Logged in as user@example.com')).toBeInTheDocument();
  });

  it('does not show a logged in message when there is no auth token', async () => {
    renderPasswordsPage({
      fetchMe: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: 'Error fetching account details.' }),
    });

    await waitFor(() => expect(screen.queryByText(/Logged in as/)).not.toBeInTheDocument());
  });

  it('redirects to login when there is no auth token', async () => {
    const props = renderPasswordsPage({
      fetchMe: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: 'Error fetching account details.' }),
    });

    await waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/login'));
  });

  it('redirects to login when there is no encryption key', async () => {
    const props = renderPasswordsPage({ encryptionKey: undefined });

    await waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/login'));
  });

  it('does not fetch or decrypt vault items when redirecting to login', async () => {
    const props = renderPasswordsPage({ encryptionKey: undefined });

    await waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/login'));
    expect(props.fetchVaultItems).not.toHaveBeenCalled();
    expect(props.decryptVaultItem).not.toHaveBeenCalled();
  });

  it('does not redirect when both the user and encryption key are present', async () => {
    const props = renderPasswordsPage();

    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
    expect(props.redirect).not.toHaveBeenCalled();
  });

  it('renders the create password form', async () => {
    const props = renderPasswordsPage();

    expect(screen.getByText('Create New Password Entry')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Site name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
  });

  it('does not create a password when a field is empty', async () => {
    const props = renderPasswordsPage();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Save'));

    expect(props.encryptVaultItem).not.toHaveBeenCalled();
    expect(props.createVaultItem).not.toHaveBeenCalled();
  });

  it('encrypts and saves a new password entry on submit', async () => {
    const props = renderPasswordsPage();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fillOutCreateForm('Example Site', 'someone', 'super-secret');
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(props.encryptVaultItem).toHaveBeenCalledWith(
        { siteName: 'Example Site', username: 'someone', password: 'super-secret' },
        STUB_KEY,
      ),
    );
    expect(props.createVaultItem).toHaveBeenCalledWith('encrypted-blob');
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalledTimes(2));
  });

  it('clears the form after successfully saving a new password entry', async () => {
    const props = renderPasswordsPage();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fillOutCreateForm('Example Site', 'someone', 'super-secret');
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByPlaceholderText('Site name')).toHaveValue(''));
    expect(screen.getByPlaceholderText('Username')).toHaveValue('');
    expect(screen.getByPlaceholderText('Password')).toHaveValue('');
  });

  it('shows an error message when saving a new password entry fails', async () => {
    const props = renderPasswordsPage({
      createVaultItem: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error saving password.' }),
    });
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fillOutCreateForm('Example Site', 'someone', 'super-secret');
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Error: Error saving password.')).toBeInTheDocument();
  });

  it('shows a generic error message if encrypting the new password entry throws', async () => {
    const props = renderPasswordsPage({
      encryptVaultItem: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fillOutCreateForm('Example Site', 'someone', 'super-secret');
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Error: Error saving password.')).toBeInTheDocument();
  });

  it('fills in a generated password when Generate is clicked on the create form', async () => {
    const props = renderPasswordsPage();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Generate'));

    const passwordInput = screen.getByPlaceholderText('Password') as HTMLInputElement;
    expect(passwordInput.value).not.toBe('');
    expect(passwordInput.value.length).toBeGreaterThanOrEqual(12);
  });

  it('warns when the new password is a known common password', async () => {
    const props = renderPasswordsPage();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());

    fireEvent.input(screen.getByPlaceholderText('Password'), { target: { value: 'password' } });

    expect(screen.getByText(/very common/)).toBeInTheDocument();
  });

  it('warns when the new password matches an existing vault entry', async () => {
    const props = renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'shared-secret' }),
    });
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
    expect(await screen.findByText('Email')).toBeInTheDocument();

    const createSection = within(screen.getByText('Create New Password Entry').closest('section')!);
    fireEvent.input(createSection.getByPlaceholderText('Password'), {
      target: { value: 'shared-secret' },
    });

    expect(screen.getByText(/already used for another vault entry/)).toBeInTheDocument();
  });

  it('deletes a password entry and reloads the list when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(props.deleteVaultItem).toHaveBeenCalledWith('item-1'));
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalledTimes(2));

    confirmSpy.mockRestore();
  });

  it('does not delete a password entry when the confirmation is canceled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));

    expect(props.deleteVaultItem).not.toHaveBeenCalled();
    expect(props.fetchVaultItems).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('shows an error message when deleting a password entry fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
      deleteVaultItem: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error deleting password.' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));

    expect(await screen.findByText('Error: Error deleting password.')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(props.fetchVaultItems).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('encrypts and saves changes when editing a password entry', async () => {
    const props = renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit'));
    const editForm = within(document.querySelector('.password-item form')!);
    fireEvent.input(editForm.getByPlaceholderText('Site name'), { target: { value: 'New Site' } });
    fireEvent.input(editForm.getByPlaceholderText('Username'), { target: { value: 'newuser' } });
    fireEvent.input(editForm.getByPlaceholderText('Password'), { target: { value: 'new-secret' } });
    fireEvent.click(editForm.getByText('Save'));

    await waitFor(() =>
      expect(props.encryptVaultItem).toHaveBeenCalledWith(
        { siteName: 'New Site', username: 'newuser', password: 'new-secret' },
        STUB_KEY,
      ),
    );
    expect(props.updateVaultItem).toHaveBeenCalledWith('item-1', 'encrypted-blob');
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalledTimes(2));
  });

  it('shows a set up MFA prompt when MFA is not enabled', async () => {
    const props = renderPasswordsPage();

    expect(await screen.findByText('Set up MFA')).toBeInTheDocument();
    expect(screen.queryByText('Multi-factor authentication is enabled.')).not.toBeInTheDocument();
    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
  });

  it('shows MFA is enabled instead of the setup prompt when the account has MFA on', async () => {
    renderPasswordsPage({
      fetchMe: vi.fn().mockResolvedValue({
        data: { id: 'user-1', email: 'user@example.com', mfaEnabled: true },
        publicErrorMessage: '',
      }),
    });

    expect(await screen.findByText('Multi-factor authentication is enabled.')).toBeInTheDocument();
    expect(screen.queryByText('Set up MFA')).not.toBeInTheDocument();
  });

  it('shows an error message when saving an edited password entry fails', async () => {
    renderPasswordsPage({
      fetchVaultItems: vi.fn().mockResolvedValue({
        data: [{ id: 'item-1', encryptedData: 'encrypted-blob', createdAt: '', updatedAt: '' }],
        publicErrorMessage: '',
      }),
      decryptVaultItem: vi
        .fn()
        .mockResolvedValue({ siteName: 'Email', username: 'someone', password: 'plaintext' }),
      updateVaultItem: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error updating password.' }),
    });

    expect(await screen.findByText('Email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit'));
    const editForm = within(document.querySelector('.password-item form')!);
    fireEvent.click(editForm.getByText('Save'));

    expect(await screen.findByText('Error: Error updating password.')).toBeInTheDocument();
  });
});

describe('PasswordsPage session and vault key handling', () => {
  beforeEach(() => {
    vi.mocked(clearEncryptionKey).mockClear();
  });

  it('stays on the page after a reload when the stored key was restored', async () => {
    // A reload clears React state, but the encryption key is read back from
    // IndexedDB before this page mounts, so the user should not be bounced.
    const props = renderPasswordsPage();

    await waitFor(() => expect(props.fetchVaultItems).toHaveBeenCalled());
    expect(props.redirect).not.toHaveBeenCalled();
    expect(clearEncryptionKey).not.toHaveBeenCalled();
  });

  it('clears the stored key and redirects when the session is no longer valid', async () => {
    // fetchMe returning no user means the token is missing, expired, or revoked.
    // The key must not outlive the session that justified holding it.
    const props = renderPasswordsPage({
      fetchMe: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: 'nope' }),
    });

    await waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/login'));
    expect(clearEncryptionKey).toHaveBeenCalled();
    expect(props.fetchVaultItems).not.toHaveBeenCalled();
  });

  it('redirects without clearing when the session is valid but no key is available', async () => {
    // Reached when IndexedDB is unavailable, so the key could not survive the
    // reload. There is nothing stored to clear; the user re-derives it by
    // signing in again.
    const props = renderPasswordsPage({ encryptionKey: undefined });

    await waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/login'));
    expect(clearEncryptionKey).not.toHaveBeenCalled();
    expect(props.fetchVaultItems).not.toHaveBeenCalled();
  });
});
