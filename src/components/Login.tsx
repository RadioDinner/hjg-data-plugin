import { useState, type FormEvent } from "react";
import { signIn } from "../auth";
import { supabaseConfigured } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setBusy(false);
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <h1>HJG Data Hub</h1>
        <p className="auth__sub">Sign in to continue</p>
        {!supabaseConfigured && (
          <div className="notice notice--warn">
            Supabase isn’t configured — set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </div>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="auth__error">{error}</div>}
        <button className="btn btn--primary" disabled={busy || !supabaseConfigured}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
