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
});
