import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PasswordStrengthInput } from './PasswordStrengthInput';

function ControlledInput({ userInputs }: { userInputs?: string[] }) {
  const [value, setValue] = useState('');
  return <PasswordStrengthInput value={value} onChange={setValue} userInputs={userInputs} />;
}

describe('PasswordStrengthInput', () => {
  it('does not show a strength meter before the user types', () => {
    render(<ControlledInput />);

    expect(screen.queryByText(/Strength:/)).not.toBeInTheDocument();
  });

  it('shows a very weak rating for a common password', () => {
    render(<ControlledInput />);

    fireEvent.change(screen.getByPlaceholderText('Enter password...'), {
      target: { value: 'password' },
    });

    expect(screen.getByText('Very Weak')).toBeInTheDocument();
  });

  it('shows a stronger rating for a long passphrase', () => {
    render(<ControlledInput />);

    fireEvent.change(screen.getByPlaceholderText('Enter password...'), {
      target: { value: 'correct-horse-battery-staple-9x' },
    });

    expect(screen.getByText(/Strong/)).toBeInTheDocument();
  });

  it('toggles password visibility', () => {
    render(<ControlledInput />);
    const input = screen.getByPlaceholderText('Enter password...');

    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(input).toHaveAttribute('type', 'text');
  });
});
