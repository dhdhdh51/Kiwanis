import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Cloud, Film, Gauge, Lock, MailCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/toast';
import { Logo } from '../components/layout/AppShell';
import { Spinner } from '../components/ui/misc';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0d0b1f] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-brand-600/40 blur-3xl" />
        <div className="absolute -right-32 -bottom-48 h-[30rem] w-[30rem] rounded-full bg-accent-500/25 blur-3xl" />
        <div className="relative">
          <Logo className="text-white" />
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">The cloud drive built for video.</h2>
          <p className="mt-4 text-white/70">Upload dozens of videos at once, organise them in folders, stream anywhere and share securely.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              [Gauge, 'Parallel, resumable chunked uploads for huge files'],
              [Film, 'Instant streaming with a built-in player'],
              [Lock, 'Private by default, password-protected share links'],
              [Cloud, 'Object storage with signed, expiring URLs'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Gauge;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                    <I size={16} />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your video library">
      <form
        className="space-y-4"
        onSubmit={run(async () => {
          await login(email, password);
          navigate(from, { replace: true });
        })}
      >
        <ErrorBox error={error} />
        <label className="block">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="label flex justify-between">
            Password
            <Link to="/forgot-password" className="font-normal text-brand-600 hover:underline dark:text-brand-400">
              Forgot password?
            </Link>
          </span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner size={16} />} Sign in
        </button>
        <p className="text-center text-sm text-zinc-500">
          New to VidVault?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, run } = useSubmit();

  return (
    <AuthLayout title="Create your account" subtitle="Start storing and sharing your videos">
      <form
        className="space-y-4"
        onSubmit={run(async () => {
          if (password !== confirm) throw new Error('Passwords do not match');
          await register(name, email, password);
          navigate('/', { replace: true });
        })}
      >
        <ErrorBox error={error} />
        <label className="block">
          <span className="label">Name</span>
          <input className="input" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="mt-1 block text-xs text-zinc-500">At least 8 characters</span>
        </label>
        <label className="block">
          <span className="label">Confirm password</span>
          <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner size={16} />} Create account
        </button>
        <p className="text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password">
      {sent ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
            <MailCheck size={26} />
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">If an account exists for <strong>{email}</strong>, a reset link is on its way. The link expires in 1 hour.</p>
          <Link to="/login" className="btn-secondary w-full">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={run(async () => {
            await api('/api/auth/forgot-password', { body: { email } });
            setSent(true);
          })}
        >
          <ErrorBox error={error} />
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Spinner size={16} />} Send reset link
          </button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-brand-600 hover:underline dark:text-brand-400">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <div className="space-y-5 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Your password has been updated. For security, you've been signed out on all devices.</p>
          <Link to="/login" className="btn-primary w-full">
            Sign in
          </Link>
        </div>
      ) : !token ? (
        <ErrorBox error="This reset link is missing its token. Please request a new one." />
      ) : (
        <form
          className="space-y-4"
          onSubmit={run(async () => {
            if (password !== confirm) throw new Error('Passwords do not match');
            await api('/api/auth/reset-password', { body: { token, password } });
            setDone(true);
          })}
        >
          <ErrorBox error={error} />
          <label className="block">
            <span className="label">New password</span>
            <input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="label">Confirm new password</span>
            <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Spinner size={16} />} Update password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
