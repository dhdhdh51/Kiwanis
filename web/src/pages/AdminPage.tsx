import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, Ban, CheckCircle2, Database, Film, HardDrive, MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UploadCloud, Users, XCircle } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate, timeAgo } from '../lib/format';
import { errorMessage, toast } from '../lib/toast';
import type { Paged, Video } from '../lib/types';
import { ui } from '../lib/ui';
import { Menu } from '../components/ui/Menu';
import { Modal } from '../components/ui/Modal';
import { ProgressBar, Spinner } from '../components/ui/misc';
import { Thumbnail } from '../components/video/VideoCard';

interface AdminStats {
  users: number;
  suspendedUsers: number;
  videos: number;
  storageUsed: number;
  storageAllocated: number;
  activeUploads: number;
  uploadsCompleted24h: number;
  uploadsFailed24h: number;
  bytesUploaded24h: number;
  storageDriver: string;
  ffmpeg: boolean;
  defaultStorageLimit: number;
}
interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  storageLimit: number;
  storageUsed: number;
  videoCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}
interface AdminUpload {
  id: string;
  user: string;
  filename: string;
  size: number;
  uploadedBytes: number;
  totalChunks: number;
  status: string;
  error: string | null;
  ip: string | null;
  createdAt: string;
  updatedAt: string;
}
interface AdminActivity {
  id: string;
  type: string;
  message: string;
  user: string | null;
  ip: string | null;
  createdAt: string;
}

type Tab = 'overview' | 'users' | 'videos' | 'uploads' | 'activity';
const GB = 1024 ** 3;

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-zinc-500">
      <span>
        {total.toLocaleString()} total · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary h-8 px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-secondary h-8 px-3" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function useDebounced(v: string) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), 300);
    return () => clearTimeout(t);
  }, [v]);
  return d;
}

function Overview() {
  const { data: s } = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), refetchInterval: 10_000 });
  if (!s) return <div className="flex justify-center py-16"><Spinner /></div>;
  const cards: [typeof Users, string, string, string?][] = [
    [Users, 'Users', s.users.toLocaleString(), s.suspendedUsers ? `${s.suspendedUsers} suspended` : undefined],
    [Film, 'Videos', s.videos.toLocaleString()],
    [Database, 'Storage used', formatBytes(s.storageUsed), `of ${formatBytes(s.storageAllocated)} allocated`],
    [UploadCloud, 'Active uploads', s.activeUploads.toLocaleString()],
    [CheckCircle2, 'Uploads (24h)', s.uploadsCompleted24h.toLocaleString(), formatBytes(s.bytesUploaded24h)],
    [XCircle, 'Failed (24h)', s.uploadsFailed24h.toLocaleString()],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(([Icon, label, value, sub]) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <Icon size={15} /> {label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="text-xs text-zinc-500">{sub}</div>}
          </div>
        ))}
      </div>
      <div className="card p-5">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">Platform storage</span>
          <span className="text-zinc-500">
            {formatBytes(s.storageUsed)} used / {formatBytes(s.storageAllocated)} allocated in quotas
          </span>
        </div>
        <ProgressBar value={(s.storageUsed / Math.max(1, s.storageAllocated)) * 100} />
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>
            Storage driver: <strong className="text-zinc-800 uppercase dark:text-zinc-200">{s.storageDriver}</strong>
          </span>
          <span>
            Server processing (ffmpeg): <strong className={s.ffmpeg ? 'text-emerald-600' : 'text-amber-600'}>{s.ffmpeg ? 'available' : 'not installed'}</strong>
          </span>
          <span>Default quota: {formatBytes(s.defaultStorageLimit)}</span>
        </div>
      </div>
    </div>
  );
}

function QuotaDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [gb, setGb] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setGb(user ? String(Math.round((user.storageLimit / GB) * 100) / 100) : ''), [user]);
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title="Storage limit"
      description={user?.email}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={busy || !(Number(gb) >= 0)}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/admin/users/${user!.id}`, { method: 'PATCH', body: { storageLimit: Math.round(Number(gb) * GB) } });
                await qc.invalidateQueries({ queryKey: ['admin'] });
                toast.success('Storage limit updated');
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label className="block">
        <span className="label">Limit (GB)</span>
        <input className="input" type="number" min={0} step="any" value={gb} onChange={(e) => setGb(e.target.value)} />
      </label>
      {user && <p className="mt-2 text-xs text-zinc-500">Currently using {formatBytes(user.storageUsed)}.</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[10, 50, 100, 500, 1000].map((n) => (
          <button key={n} className="chip border border-zinc-200 px-2.5 py-1 dark:border-white/10" onClick={() => setGb(String(n))}>
            {n >= 1000 ? `${n / 1000} TB` : `${n} GB`}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [quotaUser, setQuotaUser] = useState<AdminUser | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'users', dq, page], queryFn: () => api<Paged<AdminUser>>(`/api/admin/users${qs({ q: dq, page })}`) });
  const patch = async (u: AdminUser, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
      await qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
        <input className="input pl-9" placeholder="Search users by name or email" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            <tr className="border-b border-zinc-100 dark:border-white/5">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Storage</th>
              <th className="px-4 py-3 text-right">Videos</th>
              <th className="px-4 py-3">Last login</th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {isLoading && (
              <tr>
                <td colSpan={6} className="py-10 text-center"><Spinner /></td>
              </tr>
            )}
            {data?.items.map((u) => {
              const pct = (u.storageUsed / Math.max(1, u.storageLimit)) * 100;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      {u.name}
                      {u.role === 'ADMIN' && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Admin</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('chip', u.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300')}>
                      {u.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="w-56 px-4 py-3">
                    <ProgressBar value={pct} thin tone={pct > 95 ? 'red' : pct > 80 ? 'amber' : 'brand'} />
                    <div className="mt-1 text-xs text-zinc-500">
                      {formatBytes(u.storageUsed)} / {formatBytes(u.storageLimit)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.videoCount}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-3">
                    <Menu
                      items={[
                        { label: 'Change storage limit', icon: <HardDrive size={16} />, onClick: () => setQuotaUser(u) },
                        ...(u.id !== me?.id
                          ? [
                              u.status === 'ACTIVE'
                                ? { label: 'Suspend user', icon: <Ban size={16} />, onClick: () => patch(u, { status: 'SUSPENDED' }, 'User suspended') }
                                : { label: 'Reactivate user', icon: <CheckCircle2 size={16} />, onClick: () => patch(u, { status: 'ACTIVE' }, 'User reactivated') },
                              u.role === 'ADMIN'
                                ? { label: 'Remove admin role', icon: <ShieldOff size={16} />, onClick: () => patch(u, { role: 'USER' }, 'Admin role removed') }
                                : { label: 'Make admin', icon: <ShieldCheck size={16} />, onClick: () => patch(u, { role: 'ADMIN' }, 'User is now an admin') },
                              {
                                label: 'Delete user',
                                icon: <Trash2 size={16} />,
                                danger: true,
                                divider: true,
                                onClick: () =>
                                  ui.confirm({
                                    title: `Delete ${u.email}?`,
                                    message: `The account and all ${u.videoCount} videos (${formatBytes(u.storageUsed)}) will be permanently deleted from storage. This cannot be undone.`,
                                    confirmLabel: 'Delete user',
                                    danger: true,
                                    onConfirm: async () => {
                                      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                                      await qc.invalidateQueries({ queryKey: ['admin'] });
                                      toast.success('User deleted');
                                    },
                                  }),
                              },
                            ]
                          : []),
                      ]}
                      trigger={(p) => (
                        <button {...p} className="btn-icon btn-ghost h-8 w-8" aria-label="User actions">
                          <MoreVertical size={16} />
                        </button>
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
      <QuotaDialog user={quotaUser} onClose={() => setQuotaUser(null)} />
    </div>
  );
}

function VideosTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'videos', dq, page],
    queryFn: () => api<Paged<Video & { owner: { email: string; name: string } }>>(`/api/admin/videos${qs({ q: dq, page })}`),
  });
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
        <input className="input pl-9" placeholder="Search all videos" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
      </div>
      <div className="card divide-y divide-zinc-100 overflow-hidden dark:divide-white/5">
        {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
        {data?.items.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
            <Thumbnail video={v} className="aspect-video w-24 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {v.filename}
                {v.deletedAt && <span className="chip ml-2 bg-zinc-100 text-zinc-600 dark:bg-white/10">In trash</span>}
              </div>
              <div className="truncate text-xs text-zinc-500">
                {v.owner.email} · {formatBytes(v.size)} · {v.format.toUpperCase()} · {formatDate(v.createdAt, true)}
                {v.share?.active && ' · shared'}
              </div>
            </div>
            <button
              className="btn-ghost h-8 px-2.5 text-xs text-red-600 dark:text-red-400"
              onClick={() =>
                ui.confirm({
                  title: 'Delete this video permanently?',
                  message: `“${v.filename}” owned by ${v.owner.email} will be erased from storage. This cannot be undone.`,
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: async () => {
                    await api(`/api/admin/videos/${v.id}`, { method: 'DELETE' });
                    await qc.invalidateQueries({ queryKey: ['admin'] });
                    toast.success('Video deleted');
                  },
                })
              }
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        ))}
        {data && !data.items.length && <p className="py-10 text-center text-sm text-zinc-500">No videos found</p>}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
    </div>
  );
}

const UPLOAD_STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  EXPIRED: 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300',
  ABORTED: 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300',
};

function UploadsTab() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'uploads', status, page],
    queryFn: () => api<Paged<AdminUpload>>(`/api/admin/uploads${qs({ status, page })}`),
    refetchInterval: 5000,
  });
  return (
    <div className="space-y-3">
      <select className="input w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
        <option value="">All statuses</option>
        {['ACTIVE', 'COMPLETED', 'FAILED', 'EXPIRED', 'ABORTED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
      </select>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            <tr className="border-b border-zinc-100 dark:border-white/5">
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
            {isLoading && <tr><td colSpan={5} className="py-10 text-center"><Spinner /></td></tr>}
            {data?.items.map((u) => (
              <tr key={u.id}>
                <td className="max-w-64 px-4 py-3">
                  <div className="truncate font-medium">{u.filename}</div>
                  <div className="text-xs text-zinc-500">{formatBytes(u.size)} · {u.totalChunks} chunks</div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.user}
                  {u.ip && <div className="text-zinc-500">{u.ip}</div>}
                </td>
                <td className="w-48 px-4 py-3">
                  <ProgressBar value={(u.uploadedBytes / Math.max(1, u.size)) * 100} thin tone={u.status === 'FAILED' ? 'red' : u.status === 'COMPLETED' ? 'green' : 'brand'} />
                  <div className="mt-1 text-xs text-zinc-500">{formatBytes(u.uploadedBytes)}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('chip', UPLOAD_STATUS_STYLE[u.status])}>{u.status.toLowerCase()}</span>
                  {u.error && <div className="mt-1 max-w-48 truncate text-xs text-red-600" title={u.error}>{u.error}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{timeAgo(u.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
    </div>
  );
}

function ActivityTab() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'activity', type, page],
    queryFn: () => api<Paged<AdminActivity>>(`/api/admin/activity${qs({ type, page })}`),
    refetchInterval: 10_000,
  });
  return (
    <div className="space-y-3">
      <select className="input w-auto" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
        <option value="">All activity</option>
        <option value="upload">Uploads</option>
        <option value="auth">Authentication</option>
        <option value="video">Videos</option>
        <option value="admin">Admin actions</option>
      </select>
      <div className="card divide-y divide-zinc-100 overflow-hidden dark:divide-white/5">
        {isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
        {data?.items.map((a) => (
          <div key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span
              className={clsx(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                a.type.includes('failed') || a.type.includes('deleted') ? 'bg-red-500' : a.type.startsWith('upload') ? 'bg-brand-500' : a.type.startsWith('admin') ? 'bg-amber-500' : 'bg-emerald-500',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="break-words">{a.message}</div>
              <div className="text-xs text-zinc-500">
                <code>{a.type}</code>
                {a.user && ` · ${a.user}`}
                {a.ip && ` · ${a.ip}`}
              </div>
            </div>
            <span className="shrink-0 text-xs text-zinc-500" title={formatDate(a.createdAt, true)}>{timeAgo(a.createdAt)}</span>
          </div>
        ))}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: [Tab, string, typeof Users][] = [
    ['overview', 'Overview', Activity],
    ['users', 'Users', Users],
    ['videos', 'Videos', Film],
    ['uploads', 'Uploads', UploadCloud],
    ['activity', 'Activity log', Activity],
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="text-amber-500" /> Admin
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Manage users, storage limits, videos and monitor upload activity.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition',
              tab === key ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white',
            )}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersTab />}
      {tab === 'videos' && <VideosTab />}
      {tab === 'uploads' && <UploadsTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}
