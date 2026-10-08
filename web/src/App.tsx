import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui/misc';
import { Toaster } from './components/ui/Toaster';
import { UploadDialog } from './components/upload/UploadDialog';
import { UploadPanel } from './components/upload/UploadPanel';
import { DropOverlay } from './components/upload/DropOverlay';
import { PlayerModal } from './components/dialogs/PlayerModal';
import { ShareDialog } from './components/dialogs/ShareDialog';
import { ConfirmDialog, DetailsDialog, MoveDialog, RenameDialog } from './components/dialogs/MiscDialogs';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages';
import { DashboardPage } from './pages/Dashboard';
import { FoldersPage, NotFoundPage, SharedPage, TrashPage, VideosPage } from './pages/LibraryPages';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { SharePage } from './pages/SharePage';
import { EmbedPage } from './pages/EmbedPage';
import { DevelopersPage } from './pages/DevelopersPage';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={28} className="text-brand-500" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <>
      {children}
      {/* Global, app-wide upload & dialog layer: uploads survive page navigation */}
      <UploadDialog />
      <UploadPanel />
      <DropOverlay />
      <PlayerModal />
      <ShareDialog />
      <MoveDialog />
      <RenameDialog />
      <DetailsDialog />
      <ConfirmDialog />
    </>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <>{children}</> : <Navigate to="/" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function Root() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/s/:token', element: <SharePage /> },
      { path: '/embed/:token', element: <EmbedPage /> },
      { path: '/developers', element: <DevelopersPage /> },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'videos', element: <VideosPage /> },
          { path: 'folders', element: <FoldersPage /> },
          { path: 'folders/:folderId', element: <FoldersPage /> },
          { path: 'shared', element: <SharedPage /> },
          { path: 'trash', element: <TrashPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'admin', element: <RequireAdmin><AdminPage /></RequireAdmin> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
