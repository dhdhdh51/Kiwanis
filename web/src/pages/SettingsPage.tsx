import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Monitor, Moon, Smartphone, Sun, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { copyText, formatBytes, formatDate, timeAgo } from '../lib/format';
import { ui } from '../lib/ui';
import { useConfig, useStats } from '../lib/queries';
import { useTheme } from '../lib/theme';
import { errorMessage, toast } from '../lib/toast';
import type { User } from '../lib/types';
import { useUploads } from '../upload/engine';
import { ProgressBar, Segmented, Spinner } from '../components/ui/misc';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card grid gap-5 p-5 md:grid-cols-[16rem_1fr] md:p-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function NumberField({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-brand-600" />
        <span className="w-8 text-right text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
    </label>
  );
}

interface TokenRow {
  id: string;
  name: string;
  kind: 'app' | 'key';
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function ApiKeys() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['tokens'], queryFn: () => api<{ tokens: TokenRow[] }>('/api/me/tokens') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const tokens = data?.tokens ?? [];
  const revoke = (t: TokenRow) =>
    ui.confirm({
      title: t.kind === 'app' ? `Sign out "${t.name}"?` : `Revoke API key "${t.name}"?`,
      message: t.kind === 'app' ? 'The device will be signed out and its uploads will stop.' : 'Anything using this key will immediately lose access.',
      confirmLabel: t.kind === 'app' ? 'Sign out device' : 'Revoke key',
      danger: true,
      onConfirm: async () => {
        await api(`/api/me/tokens/${t.id}`, { method: 'DELETE' });
        await qc.invalidateQueries({ queryKey: ['tokens'] });
        toast.success(t.kind === 'app' ? 'Device signed out' : 'Key revoked');
      },
    });
  const list = (kind: TokenRow['kind']) => tokens.filter((t) => t.kind === kind);
  const row = (t: TokenRow) => (
    <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
      {t.kind === 'app' ? <Smartphone size={16} className="text-zinc-400" /> : <KeyRound size={16} className="text-zinc-400" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.name}</div>
        <div className="text-xs text-zinc-500">
          <code>{t.prefix}…</code> · created {formatDate(t.createdAt)} · {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : 'never used'}
        </div>
      </div>
      <button className="btn-icon btn-ghost h-8 w-8 text-red-600 dark:text-red-400" onClick={() => revoke(t)} aria-label={`Revoke ${t.name}`}>
        <Trash2 size={15} />
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            const r = await api<{ token: string }>('/api/me/tokens', { body: { name: name.trim() } });
            setCreated(r.token);
            setName('');
            await qc.invalidateQueries({ queryKey: ['tokens'] });
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" placeholder="Key name, e.g. My website" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <button className="btn-primary shrink-0" disabled={busy || !name.trim()}>
          Create key
        </button>
      </form>
      {created && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Copy your new API key now — it won't be shown again.</p>
          <div className="mt-2 flex gap-2">
            <input className="input font-mono text-xs" readOnly value={created} onFocus={(e) => e.target.select()} aria-label="New API key" />
            <button
              className="btn-secondary shrink-0"
              onClick={async () => {
                if (await copyText(created)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>
      )}
      {list('key').length > 0 && <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-white/5 dark:border-white/10">{list('key').map(row)}</ul>}
      {list('app').length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Signed-in devices</div>
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-white/5 dark:border-white/10">{list('app').map(row)}</ul>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Keys give full access to your account — keep them secret and use them only from servers you control. See the{' '}
        <Link to="/developers" className="text-brand-600 hover:underline dark:text-brand-400">
          developer API docs
        </Link>
        .
      </p>
    </div>
  );
}

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { mode, setMode } = useTheme();
  const { data: stats } = useStats();
  const { data: config } = useConfig();
  const settings = useUploads((s) => s.settings);
  const limits = useUploads((s) => s.limits);
  const setSettings = useUploads((s) => s.setSettings);
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Profile" description="Your name is shown on shared video pages.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingName(true);
            try {
              const { user } = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { name } });
              setUser(user);
              toast.success('Profile updated');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSavingName(false);
            }
          }}
        >
          <label className="block">
            <span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input className="input opacity-70" value={user?.email ?? ''} disabled />
          </label>
          <p className="text-xs text-zinc-500">Member since {formatDate(user?.createdAt)}</p>
          <button className="btn-primary" disabled={savingName || !name.trim() || name === user?.name}>
            {savingName && <Spinner size={16} />} Save
          </button>
        </form>
      </Section>

      <Section title="Password" description="Changing your password signs you out on other devices.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.next !== pw.confirm) return toast.error('New passwords do not match');
            setSavingPw(true);
            try {
              await api('/api/me/password', { body: { currentPassword: pw.current, newPassword: pw.next } });
              setPw({ current: '', next: '', confirm: '' });
              toast.success('Password changed');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSavingPw(false);
            }
          }}
        >
          <label className="block">
            <span className="label">Current password</span>
            <input className="input" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">New password</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Confirm new password</span>
              <input className="input" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
          </div>
          <button className="btn-primary" disabled={savingPw}>
            {savingPw && <Spinner size={16} />} Change password
          </button>
        </form>
      </Section>

      <Section title="Appearance">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'light', label: <><Sun size={15} /> Light</> },
            { value: 'dark', label: <><Moon size={15} /> Dark</> },
            { value: 'system', label: <><Monitor size={15} /> System</> },
          ]}
        />
      </Section>

      <Section title="Uploads" description="Tune performance for your connection. Higher values are faster on fast networks.">
        <div className="space-y-5">
          <NumberField
            label="Videos uploaded at the same time"
            hint={`Other selected videos wait in the queue (server maximum: ${limits.maxFiles})`}
            value={Math.min(settings.concurrentFiles, limits.maxFiles)}
            min={1}
            max={limits.maxFiles}
            onChange={(concurrentFiles) => setSettings({ concurrentFiles })}
          />
          <NumberField
            label="Parallel chunks per video"
            hint={`Each video is split into chunks uploaded in parallel (server maximum: ${limits.maxChunks})`}
            value={Math.min(settings.concurrentChunks, limits.maxChunks)}
            min={1}
            max={limits.maxChunks}
            onChange={(concurrentChunks) => setSettings({ concurrentChunks })}
          />
          <NumberField
            label="Automatic retries per chunk"
            hint="Temporary network or server errors are retried with exponential backoff"
            value={settings.maxRetries}
            min={0}
            max={12}
            onChange={(maxRetries) => setSettings({ maxRetries })}
          />
          {config && (
            <p className="text-xs text-zinc-500">
              Maximum file size {formatBytes(config.maxFileSize)} · Supported formats: {config.formats.map((f) => f.ext.toUpperCase()).join(', ')}
            </p>
          )}
        </div>
      </Section>

      <Section title="Android app" description="Upload in the background — keeps going when the app is closed or the screen is off, and resumes after network drops.">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/download/android" className="btn-primary">
            <Smartphone size={16} /> Download for Android
          </a>
          <span className="text-xs text-zinc-500">
            Server address in the app: <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">{window.location.origin}</code>
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Android 7.0+. Allow “Install unknown apps” for your browser when prompted.</p>
      </Section>

      <Section title="API keys" description="Use the VidVault API from your own website or scripts.">
        <ApiKeys />
      </Section>

      <Section title="Storage">
        {stats && (
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>
                {formatBytes(stats.storageUsed)} of {formatBytes(stats.storageLimit)} used
              </span>
              <span className="text-zinc-500">{formatBytes(stats.storageAvailable)} free</span>
            </div>
            <ProgressBar value={(stats.storageUsed / Math.max(1, stats.storageLimit)) * 100} />
            <p className="mt-3 text-xs text-zinc-500">
              Trash uses {formatBytes(stats.trashSize)}. Your storage limit is managed by your administrator.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
