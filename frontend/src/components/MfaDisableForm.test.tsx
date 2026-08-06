import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MfaDisableForm } from './MfaDisableForm';

function renderMfaDisableForm(overrides = {}) {
  const props = {
    disableMfa: vi.fn().mockResolvedValue({ data: { mfaEnabled: false }, publicErrorMessage: '' }),
    onDisabled: vi.fn(),
    ...overrides,
  };

  render(<MfaDisableForm {...props} />);
  return props;
}

describe('MfaDisableForm', () => {
  it('shows that MFA is enabled and offers to remove it', () => {
    renderMfaDisableForm();

    expect(screen.getByText('Multi-factor authentication is enabled.')).toBeInTheDocument();
    expect(screen.getByText('Remove MFA')).toBeInTheDocument();
  });

  it('shows a code entry field after clicking Remove MFA', () => {
    renderMfaDisableForm();

    fireEvent.click(screen.getByText('Remove MFA'));

    expect(screen.getByPlaceholderText('6-digit code')).toBeInTheDocument();
  });

  it('does not call disableMfa when the code is empty', () => {
    const props = renderMfaDisableForm();

    fireEvent.click(screen.getByText('Remove MFA'));
    fireEvent.click(screen.getByText('Remove MFA'));

    expect(props.disableMfa).not.toHaveBeenCalled();
  });

  it('removes MFA and calls onDisabled when the code is correct', async () => {
    const props = renderMfaDisableForm();

    fireEvent.click(screen.getByText('Remove MFA'));
    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Remove MFA'));

    await waitFor(() => expect(props.disableMfa).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(props.onDisabled).toHaveBeenCalled());
  });

  it('shows an error message when the code is incorrect', async () => {
    const props = renderMfaDisableForm({
      disableMfa: vi
        .fn()
        .mockResolvedValue({ data: null, publicErrorMessage: 'Incorrect code. Please try again.' }),
    });

    fireEvent.click(screen.getByText('Remove MFA'));
    fireEvent.input(screen.getByPlaceholderText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Remove MFA'));

    expect(await screen.findByText('Error: Incorrect code. Please try again.')).toBeInTheDocument();
    expect(props.onDisabled).not.toHaveBeenCalled();
  });

  it('cancels and returns to the initial view', () => {
    renderMfaDisableForm();

    fireEvent.click(screen.getByText('Remove MFA'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('6-digit code')).not.toBeInTheDocument();
    expect(screen.getByText('Multi-factor authentication is enabled.')).toBeInTheDocument();
  });
});
