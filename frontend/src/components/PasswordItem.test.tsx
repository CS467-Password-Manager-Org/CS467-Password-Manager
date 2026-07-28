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
    onDelete: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(''),
    ...overrides,
  };

  render(<PasswordItem {...props} />);
  return props;
}

describe('PasswordItem', () => {
  it('renders the site name and username', () => {
    renderPasswordItem();

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Username: someone')).toBeInTheDocument();
  });

  it('hides the password by default', () => {
    renderPasswordItem();

    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument();
    expect(screen.getByText('Reveal')).toBeInTheDocument();
  });

  it('reveals the password when the show button is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByText('Reveal'));

    expect(screen.getByText(/super-secret/)).toBeInTheDocument();
    expect(screen.getByText('Hide')).toBeInTheDocument();
  });

  it('hides the password again when clicked a second time', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByText('Reveal'));
    fireEvent.click(screen.getByText('Hide'));

    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument();
    expect(screen.getByText('Reveal')).toBeInTheDocument();
  });

  it('copies the password to the clipboard when the copy button is clicked', async () => {
    renderPasswordItem();

    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('super-secret'));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('asks for confirmation and calls onDelete with the item id when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPasswordItem();

    fireEvent.click(screen.getByText('Delete'));

    expect(confirmSpy).toHaveBeenCalledWith('Delete the password entry for Email?');
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('item-1'));

    confirmSpy.mockRestore();
  });

  it('does not call onDelete when the confirmation is canceled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = renderPasswordItem();

    fireEvent.click(screen.getByText('Delete'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows an edit form pre-filled with the current values when Edit is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByPlaceholderText('Site name')).toHaveValue('Email');
    expect(screen.getByPlaceholderText('Username')).toHaveValue('someone');
    expect(screen.getByPlaceholderText('Password')).toHaveValue('super-secret');
  });

  it('calls onEdit with the updated fields when Save is clicked', async () => {
    const props = renderPasswordItem();

    fireEvent.click(screen.getByText('Edit'));
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

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.queryByPlaceholderText('Site name')).not.toBeInTheDocument());
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('shows an error and stays in edit mode when saving fails', async () => {
    const props = renderPasswordItem({
      onEdit: vi.fn().mockResolvedValue('Error updating password.'),
    });

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Error: Error updating password.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Site name')).toBeInTheDocument();
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('discards changes and exits edit mode when Cancel is clicked', () => {
    renderPasswordItem();

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.input(screen.getByPlaceholderText('Site name'), { target: { value: 'New Site' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Site name')).not.toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });
});
