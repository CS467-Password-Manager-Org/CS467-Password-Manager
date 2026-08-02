// Parts of this file were generated with AI assistance (Claude Code, Anthropic, 2026).
// Prompts used: "write some very simple tests for loginpage.tsx"
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginPage } from './LoginPage';
import { bytesToBase64 } from '@app/crypto';

const SOME_SALT = new Uint8Array([1, 2, 3]);
const SOME_AUTH_KEY = new Uint8Array([4, 5, 6]);

function renderLoginPage(overrides = {}) {
  const props = {
    fetchUserSalt: vi
      .fn()
      .mockResolvedValue({ data: { salt: bytesToBase64(SOME_SALT) }, publicErrorMessage: '' }),
    deriveKeys: vi.fn().mockResolvedValue({ authKey: SOME_AUTH_KEY, encryptionKey: {} }),
    persistEncryptionKey: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({
      data: { token: 'some-token', tokenType: 'Bearer', expiresIn: 3600 },
      publicErrorMessage: '',
      mfaRequired: false,
    }),
    redirect: vi.fn(),
    ...overrides,
  };

  render(<LoginPage {...props} />);
  return props;
}

describe('LoginPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the email step first', () => {
    renderLoginPage();

    expect(screen.getByText('Enter your Email Address')).toBeInTheDocument();
  });

  it('fetches the salt and advances to the password step on submit', async () => {
    const props = renderLoginPage();

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText('Enter your Master Password')).toBeInTheDocument();
    expect(props.fetchUserSalt).toHaveBeenCalledWith('user@example.com');
  });

  it('does not fetch the salt when the email field is empty', () => {
    const props = renderLoginPage();

    fireEvent.click(screen.getByText('Submit'));

    expect(props.fetchUserSalt).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your Email Address')).toBeInTheDocument();
  });

  it('shows an error message when fetching the salt fails', async () => {
    renderLoginPage({
      fetchUserSalt: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error logging in.' }),
    });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText('Error: Error logging in.')).toBeInTheDocument();
    expect(screen.queryByText('Enter your Master Password')).not.toBeInTheDocument();
  });

  it('logs in and redirects after entering the master password', async () => {
    const props = renderLoginPage();

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));

    await vi.waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/passwords'));
    expect(props.deriveKeys).toHaveBeenCalledWith('super-secret', SOME_SALT);
    expect(props.login).toHaveBeenCalledWith('user@example.com', bytesToBase64(SOME_AUTH_KEY));
    expect(sessionStorage.getItem('token')).toBe('some-token');
  });

  it('shows an error message and does not redirect when login fails', async () => {
    const props = renderLoginPage({
      login: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: 'Invalid credentials.' }),
    });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText('Error: Invalid credentials.')).toBeInTheDocument();
    expect(props.redirect).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('shows a generic error message if login throws', async () => {
    const props = renderLoginPage({
      deriveKeys: vi.fn().mockRejectedValue(new Error('boom')),
    });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText('Error: Error logging in.')).toBeInTheDocument();
    expect(props.redirect).not.toHaveBeenCalled();
  });

  it('shows the MFA code step when the server requires a code', async () => {
    const props = renderLoginPage({
      login: vi.fn().mockResolvedValue({ data: null, publicErrorMessage: '', mfaRequired: true }),
    });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText('Enter your Authentication Code')).toBeInTheDocument();
    expect(props.redirect).not.toHaveBeenCalled();
  });

  it('submits the MFA code and redirects on success', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ data: null, publicErrorMessage: '', mfaRequired: true })
      .mockResolvedValueOnce({
        data: { token: 'some-token', tokenType: 'Bearer', expiresIn: 3600 },
        publicErrorMessage: '',
        mfaRequired: false,
      });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Authentication Code');

    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Submit'));

    await vi.waitFor(() => expect(props.redirect).toHaveBeenCalledWith('/passwords'));
    expect(login).toHaveBeenLastCalledWith(
      'user@example.com',
      bytesToBase64(SOME_AUTH_KEY),
      '123456',
    );
    expect(sessionStorage.getItem('token')).toBe('some-token');
  });

  it('shows an error message and stays on the MFA step when the code is wrong', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ data: null, publicErrorMessage: '', mfaRequired: true })
      .mockResolvedValueOnce({
        data: null,
        publicErrorMessage: 'Incorrect code. Please try again.',
        mfaRequired: false,
      });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Authentication Code');

    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Submit'));

    expect(
      await screen.findByText('Error: Incorrect code. Please try again.'),
    ).toBeInTheDocument();
    expect(props.redirect).not.toHaveBeenCalled();
  });

  it('does not submit the MFA code when the field is empty', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ data: null, publicErrorMessage: '', mfaRequired: true });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Authentication Code');

    fireEvent.click(screen.getByText('Submit'));

    expect(login).toHaveBeenCalledTimes(1);
    expect(props.redirect).not.toHaveBeenCalled();
  });

  // The vault key used to be written to storage the moment it was derived,
  // before the server had seen anything. Two things fell out of that: a correct
  // password whose MFA step was abandoned left the real key on disk with no
  // session, and a wrong password overwrote a good stored key with a useless
  // one, so the next reload could not decrypt the vault.
  it('does not persist the encryption key when the password is wrong', async () => {
    const login = vi
      .fn()
      .mockResolvedValue({ data: null, publicErrorMessage: 'Invalid credentials', mfaRequired: false });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText(/Invalid credentials/)).toBeInTheDocument();
    expect(props.deriveKeys).toHaveBeenCalled();
    expect(props.persistEncryptionKey).not.toHaveBeenCalled();
  });

  it('does not persist the encryption key while the MFA code is still outstanding', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ data: null, publicErrorMessage: '', mfaRequired: true });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Authentication Code');

    // The password was correct, but no token exists yet, so nothing may be stored.
    expect(props.persistEncryptionKey).not.toHaveBeenCalled();
  });

  it('persists the encryption key once a token has been issued', async () => {
    const props = renderLoginPage();

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(props.persistEncryptionKey).toHaveBeenCalledTimes(1));
    expect(props.redirect).toHaveBeenCalledWith('/passwords');
  });

  it('persists the encryption key only after the MFA code is accepted', async () => {
    const login = vi
      .fn()
      .mockResolvedValueOnce({ data: null, publicErrorMessage: '', mfaRequired: true })
      .mockResolvedValueOnce({
        data: { token: 'some-token', tokenType: 'Bearer', expiresIn: 900 },
        publicErrorMessage: '',
        mfaRequired: false,
      });
    const props = renderLoginPage({ login });

    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Master Password');

    fireEvent.input(document.querySelector('input[type="password"]')!, {
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Enter your Authentication Code');
    expect(props.persistEncryptionKey).not.toHaveBeenCalled();

    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(props.persistEncryptionKey).toHaveBeenCalledTimes(1));
    expect(props.redirect).toHaveBeenCalledWith('/passwords');
  });
});
