export function HomePage({ redirect }: { redirect: (newPath: string) => void }) {
  return (
    <div>
      <h1>Secure Password Manager</h1>
      <p>
        Your vault is encrypted in your browser. The server only ever stores ciphertext it cannot
        read.
      </p>

      {/*
        Buttons calling redirect() rather than anchors, to match the pushState
        routing the rest of the app uses — a plain <a href> would reload the
        whole bundle and drop the hydrated vault key.

        "Create account" rather than "Sign up": it differs from "Sign in" by a
        single letter, and the two are a well-known source of misclicks.
      */}
      <div className="home-actions">
        <button type="button" onClick={() => redirect('/login')}>
          Sign in
        </button>
        <button type="button" onClick={() => redirect('/register')}>
          Create account
        </button>
      </div>
    </div>
  );
}
