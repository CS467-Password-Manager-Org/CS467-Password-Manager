import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PasswordWarnings } from './PasswordWarnings';

describe('PasswordWarnings', () => {
  it('renders nothing when the password is empty', () => {
    const { container } = render(<PasswordWarnings password="" existingPasswords={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a strong, unused password', () => {
    const { container } = render(
      <PasswordWarnings password="Xy9$qzL2!vRt8w" existingPasswords={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('warns about a common password', () => {
    render(<PasswordWarnings password="password" existingPasswords={[]} />);

    expect(screen.getByText(/very common/)).toBeInTheDocument();
  });

  it('warns about a reused password', () => {
    render(
      <PasswordWarnings
        password="shared-secret"
        existingPasswords={[{ siteName: 'Bank', username: 'someone', password: 'shared-secret' }]}
      />,
    );

    expect(screen.getByText(/already used for another vault entry/)).toBeInTheDocument();
  });

  it('shows both warnings when a password is both common and reused', () => {
    render(
      <PasswordWarnings
        password="password"
        existingPasswords={[{ siteName: 'Bank', username: 'someone', password: 'password' }]}
      />,
    );

    expect(screen.getByText(/very common/)).toBeInTheDocument();
    expect(screen.getByText(/already used for another vault entry/)).toBeInTheDocument();
  });
});
