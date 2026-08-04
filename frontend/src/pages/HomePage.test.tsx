// Parts of this file were generated with AI assistance (GitHub Copilot CLI, 2026).
// Prompts used: "fix the homepage so we don't land on 'Page Not Found' — a simple
// UI with buttons to the other pages and a title"
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HomePage } from './HomePage';

function renderHomePage() {
  const redirect = vi.fn();
  render(<HomePage redirect={redirect} />);
  return { redirect };
}

describe('HomePage', () => {
  it('names the product', () => {
    renderHomePage();

    expect(screen.getByRole('heading', { name: 'Secure Password Manager' })).toBeInTheDocument();
  });

  it('sends a returning user to the login page', () => {
    const { redirect } = renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('sends a new user to the registration page', () => {
    const { redirect } = renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(redirect).toHaveBeenCalledWith('/register');
  });
});
