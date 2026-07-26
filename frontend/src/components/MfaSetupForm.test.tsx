import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MfaSetupForm } from './MfaSetupForm';

function renderMfaSetupForm(overrides = {}) {
  const props = {
    enrollMfa: vi.fn().mockResolvedValue({
      data: { secret: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/test' },
      publicErrorMessage: '',
    }),
    activateMfa: vi.fn().mockResolvedValue({ data: { mfaEnabled: true }, publicErrorMessage: '' }),
    onEnabled: vi.fn(),
    ...overrides,
  };

  render(<MfaSetupForm {...props} />);
  return props;
}

describe('MfaSetupForm', () => {
  it('shows a set up MFA button initially', () => {
    renderMfaSetupForm();

    expect(screen.getByText('Set up MFA')).toBeInTheDocument();
  });

  it('starts enrollment and shows the secret when the set up button is clicked', async () => {
    const props = renderMfaSetupForm();

    fireEvent.click(screen.getByText('Set up MFA'));

    await waitFor(() => expect(props.enrollMfa).toHaveBeenCalled());
    expect(await screen.findByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6-digit code')).toBeInTheDocument();
  });

  it('shows an error message when enrollment fails', async () => {
    renderMfaSetupForm({
      enrollMfa: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Error starting MFA setup.' }),
    });

    fireEvent.click(screen.getByText('Set up MFA'));

    expect(await screen.findByText('Error: Error starting MFA setup.')).toBeInTheDocument();
  });

  it('activates MFA and calls onEnabled when the code is correct', async () => {
    const props = renderMfaSetupForm();

    fireEvent.click(screen.getByText('Set up MFA'));
    await screen.findByPlaceholderText('6-digit code');

    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Activate'));

    await waitFor(() => expect(props.activateMfa).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(props.onEnabled).toHaveBeenCalled());
  });

  it('shows an error message when the code is incorrect', async () => {
    const props = renderMfaSetupForm({
      activateMfa: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Incorrect code. Please try again.' }),
    });

    fireEvent.click(screen.getByText('Set up MFA'));
    await screen.findByPlaceholderText('6-digit code');

    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Activate'));

    expect(await screen.findByText('Error: Incorrect code. Please try again.')).toBeInTheDocument();
    expect(props.onEnabled).not.toHaveBeenCalled();
  });

  it('does not activate when the code is empty', async () => {
    const props = renderMfaSetupForm();

    fireEvent.click(screen.getByText('Set up MFA'));
    await screen.findByPlaceholderText('6-digit code');

    fireEvent.click(screen.getByText('Activate'));

    expect(props.activateMfa).not.toHaveBeenCalled();
  });

  it('cancels enrollment and returns to the initial view', async () => {
    renderMfaSetupForm();

    fireEvent.click(screen.getByText('Set up MFA'));
    await screen.findByPlaceholderText('6-digit code');

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByText('Set up MFA')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('6-digit code')).not.toBeInTheDocument();
  });
});
