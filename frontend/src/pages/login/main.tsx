import '@/app.css';
import { createRoot } from 'react-dom/client';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/ui/password-input';
import FluidOrb from '@/components/ui/fluid-orb';
import { RareUiCredit } from '@/RareUiCredit';

function Login() {
  // Bumped on every failure so the error remounts and shakes again.
  const [failures, setFailures] = useState(0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: form.get('user'), password: form.get('password') }),
    });
    if (res.ok) window.location.href = '/';
    else setFailures((n) => n + 1);
  }

  return (
    <div className="dc-ambient min-h-screen flex flex-col items-center justify-center bg-base-200 p-4">
      <div className="login-card card bg-base-300 border border-primary/20 shadow-2xl w-full max-w-sm">
        <div className="card-body items-center pt-10 pb-8">
          <div className="relative grid place-items-center">
            <FluidOrb size={130} color="#dc2626" className="absolute opacity-80 shadow-[0_0_60px_rgba(220,38,38,0.45)]" />
            <img src="/static/logo.png" alt="DogeClaw" className="login-logo relative w-44" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-br from-white to-accent bg-clip-text text-transparent">DogeClaw</h1>
          <p className="text-xs text-base-content/50 mb-4 tracking-wide">wow. much AI. very agent.</p>
          <form id="form" onSubmit={submit} className="w-full flex flex-col gap-3">
            <input type="text" name="user" placeholder="Username" autoComplete="username" required className="input w-full" />
            <PasswordInput name="password" placeholder="Password" required strength={false} className="max-w-none" />
            <button type="submit" className="btn btn-primary w-full mt-1">Sign In</button>
          </form>
          {failures > 0 && <div key={failures} className="error text-error text-sm text-center mt-3" id="error">Invalid credentials</div>}
          <div className="text-[0.7rem] text-base-content/40 tracking-widest mt-5">SUCH SECURE <span className="login-dot">●</span> VERY LOGIN <span className="login-dot">●</span> WOW</div>
        </div>
      </div>
      <RareUiCredit />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Login />);
