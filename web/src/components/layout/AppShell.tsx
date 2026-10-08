import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import {
  Film,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sun,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { formatBytes } from '../../lib/format';
import { useConfig, useStats } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { pickVideos, useUi } from '../../lib/ui';
import { setServerLimits } from '../../upload/engine';
import { Menu } from '../ui/Menu';
import { ProgressBar } from '../ui/misc';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/videos', label: 'Videos', icon: Film },
  { to: '/folders', label: 'Folders', icon: FolderOpen },
  { to: '/shared', label: 'Shared', icon: Share2 },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-lg shadow-brand-500/30">
        <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-white">
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </span>
      <span className="text-[17px]">
        Vid<span className="text-brand-600 dark:text-brand-400">Vault</span>
      </span>
    </Link>
  );
}

function StorageMeter() {
  const { data } = useStats();
  if (!data) return null;
  const pct = data.storageLimit ? (data.storageUsed / data.storageLimit) * 100 : 0;
  return (
    <Link to="/" className="block rounded-2xl bg-zinc-100/80 p-3.5 transition hover:bg-zinc-100 dark:bg-white/5 dark:hover:bg-white/[0.07]">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">Storage</span>
        <span className="text-zinc-500">{pct.toFixed(0)}%</span>
      </div>
      <ProgressBar value={pct} thin tone={pct > 95 ? 'red' : pct > 80 ? 'amber' : 'brand'} />
      <p className="mt-2 text-xs text-zinc-500">
        {formatBytes(data.storageUsed)} of {formatBytes(data.storageLimit)} used
      </p>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col gap-5 px-4 py-5">
      <Logo className="px-2" />
      <button className="btn-primary w-full py-2.5 text-[15px]" onClick={() => (pickVideos(), onNavigate?.())}>
        <UploadCloud size={18} /> Upload Videos
      </button>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white',
              )
            }
          >
            <Icon size={18} /> {label}
          </NavLink>
        ))}
        {user?.role === 'ADMIN' && (
          <NavLink
            to="/admin"
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5',
              )
            }
          >
            <ShieldCheck size={18} /> Admin
          </NavLink>
        )}
      </nav>
      <div className="mt-auto">
        <StorageMeter />
      </div>
    </div>
  );
}

function ThemeButton() {
  const { mode, setMode } = useTheme();
  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  return (
    <Menu
      items={[
        { label: 'Light', icon: <Sun size={16} />, onClick: () => setMode('light') },
        { label: 'Dark', icon: <Moon size={16} />, onClick: () => setMode('dark') },
        { label: 'System', icon: <Monitor size={16} />, onClick: () => setMode('system') },
      ]}
      trigger={(p) => (
        <button {...p} className="btn-icon btn-ghost" aria-label="Theme">
          <Icon size={18} />
        </button>
      )}
    />
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const set = useUi((s) => s.set);
  const [q, setQ] = useState('');
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-zinc-200/70 bg-zinc-50/80 px-3 backdrop-blur-xl sm:gap-3 sm:px-6 lg:h-20 dark:border-white/5 dark:bg-[#0b0b12]/80">
      <button className="btn-icon btn-ghost lg:hidden" onClick={() => set({ sidebarOpen: true })} aria-label="Open menu">
        <MenuIcon size={20} />
      </button>
      <Logo className="lg:hidden" />
      <form
        className="relative hidden max-w-xl flex-1 md:block"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/videos?q=${encodeURIComponent(q)}`);
        }}
      >
        <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-400" />
        <input className="input rounded-2xl py-2.5 pl-10" placeholder="Search your videos" value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search all videos" />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn-icon btn-ghost md:hidden" onClick={() => navigate('/videos')} aria-label="Search">
          <Search size={18} />
        </button>
        <button className="btn-primary hidden sm:inline-flex lg:hidden" onClick={() => pickVideos()}>
          <UploadCloud size={16} /> Upload
        </button>
        <ThemeButton />
        <Menu
          items={[
            { label: 'Settings', icon: <Settings size={16} />, onClick: () => navigate('/settings') },
            ...(user?.role === 'ADMIN' ? [{ label: 'Admin panel', icon: <ShieldCheck size={16} />, onClick: () => navigate('/admin') }] : []),
            { label: 'Sign out', icon: <LogOut size={16} />, onClick: () => void logout().then(() => navigate('/login')), divider: true },
          ]}
          trigger={(p) => (
            <button {...p} className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition hover:bg-zinc-100 sm:pr-3 dark:hover:bg-white/10" aria-label="Account menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-semibold text-white">
                {user?.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{user?.name}</span>
            </button>
          )}
        />
      </div>
    </header>
  );
}

function MobileNav() {
  const items = NAV.slice(0, 4);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-[#0f0f18]/90" aria-label="Mobile">
      {items.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-zinc-500')}>
          <Icon size={20} /> {label}
        </NavLink>
      ))}
      <div className="flex items-center justify-center">
        <button onClick={() => pickVideos()} className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-xl shadow-brand-600/30" aria-label="Upload videos">
          <Plus size={26} />
        </button>
      </div>
      {items.slice(2).map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-zinc-500')}>
          <Icon size={20} /> {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const open = useUi((s) => s.sidebarOpen);
  const set = useUi((s) => s.set);
  const location = useLocation();
  const { data: config } = useConfig();

  useEffect(() => {
    if (config) setServerLimits(config.maxConcurrentFiles, config.maxConcurrentChunks);
  }, [config]);
  useEffect(() => set({ sidebarOpen: false }), [location.pathname, set]);
  // Pages that are not folder-scoped upload to the root.
  useEffect(() => {
    if (!location.pathname.startsWith('/folders')) set({ currentFolderId: null });
  }, [location.pathname, set]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-zinc-200/70 bg-white lg:block dark:border-white/5 dark:bg-[#0f0f18]">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={() => set({ sidebarOpen: false })} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-up bg-white shadow-2xl dark:bg-[#0f0f18]">
            <button className="btn-icon btn-ghost absolute top-4 right-3" onClick={() => set({ sidebarOpen: false })} aria-label="Close menu">
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => set({ sidebarOpen: false })} />
          </aside>
        </div>
      )}
      <Topbar />
      <main className="mx-auto max-w-[1600px] px-3 pt-5 pb-28 sm:px-6 lg:pb-12">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
