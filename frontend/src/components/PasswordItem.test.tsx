import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PasswordItem } from './PasswordItem';

const item = { id: 'item-1', siteName: 'Email', username: 'someone', password: 'super-secret' };

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function renderPasswordItem(overrides = {}) {
  const props = {
    item,
    existingPasswords: [],
    onDelete: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(''),
    ...overrides,
  };

  // The component renders a <tr>, so it needs a table around it or React
  // warns about invalid nesting and the row renders outside any row group.
  render(
    <table>
      <tbody>
        <PasswordItem {...props} />
      </tbody>
    </table>,
  );
  return props;
}

describe('PasswordItem', () => {
  it('renders the site name and username', () => {
    renderPasswordItem();

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('someone')).toBeInTheDocument();
  });

  it('hides the password by default', () => {
    renderPasswordItem();

    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reveal password' })).toBeInTheDocument();
  });

  it('reveals the password when the show button is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));

    expect(screen.getByText(/super-secret/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });

  it('hides the password again when clicked a second time', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));

    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reveal password' })).toBeInTheDocument();
  });

  it('copies the password to the clipboard when the copy button is clicked', async () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('super-secret'));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('asks for confirmation and calls onDelete with the item id when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete the password entry for Email?');
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('item-1'));

    confirmSpy.mockRestore();
  });

  it('does not call onDelete when the confirmation is canceled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows an edit form pre-filled with the current values when Edit is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));

    expect(screen.getByPlaceholderText('Site name')).toHaveValue('Email');
    expect(screen.getByPlaceholderText('Username')).toHaveValue('someone');
    expect(screen.getByPlaceholderText('Password')).toHaveValue('super-secret');
  });

  it('calls onEdit with the updated fields when Save is clicked', async () => {
    const props = renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.input(screen.getByPlaceholderText('Site name'), { target: { value: 'New Site' } });
    fireEvent.input(screen.getByPlaceholderText('Username'), { target: { value: 'newuser' } });
    fireEvent.input(screen.getByPlaceholderText('Password'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(props.onEdit).toHaveBeenCalledWith('item-1', {
        siteName: 'New Site',
        username: 'newuser',
        password: 'new-secret',
      }),
    );
  });

  it('exits edit mode after a successful save', async () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.queryByPlaceholderText('Site name')).not.toBeInTheDocument());
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('shows an error and stays in edit mode when saving fails', async () => {
    const props = renderPasswordItem({
      onEdit: vi.fn().mockResolvedValue('Error updating password.'),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Error: Error updating password.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Site name')).toBeInTheDocument();
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('discards changes and exits edit mode when Cancel is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.input(screen.getByPlaceholderText('Site name'), { target: { value: 'New Site' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Site name')).not.toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('fills in a generated password when Generate is clicked while editing', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.click(screen.getByText('Generate'));

    const passwordInput = screen.getByPlaceholderText('Password') as HTMLInputElement;
    expect(passwordInput.value).not.toBe('');
    expect(passwordInput.value).not.toBe('super-secret');
    expect(passwordInput.value.length).toBeGreaterThanOrEqual(12);
  });

  it('warns when the edited password is a known common password', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.input(screen.getByPlaceholderText('Password'), { target: { value: 'password' } });

    expect(screen.getByText(/very common/)).toBeInTheDocument();
  });

  it('warns when the edited password matches another vault entry', () => {
    renderPasswordItem({
      existingPasswords: [{ siteName: 'Bank', username: 'someone', password: 'shared-secret' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.input(screen.getByPlaceholderText('Password'), { target: { value: 'shared-secret' } });

    expect(screen.getByText(/already used for another vault entry/)).toBeInTheDocument();
  });

  it('does not warn about a password that is neither common nor reused', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }));
    fireEvent.input(screen.getByPlaceholderText('Password'), {
      target: { value: 'Xy9$qzL2!vRt8w' },
    });

    expect(screen.queryByText(/very common/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already used for another vault entry/)).not.toBeInTheDocument();
  });
});
