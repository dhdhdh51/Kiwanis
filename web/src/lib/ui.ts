import { create } from 'zustand';
import type { Video } from './types';

/** Global dialog state, so any card/menu/toolbar can open shared dialogs. */
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}

interface UiState {
  player: Video | null;
  share: Video[] | null;
  move: { videos: Video[]; title?: string; onDone?: () => void } | null;
  rename: Video | null;
  details: Video | null;
  confirm: ConfirmOptions | null;
  uploadDialog: { files: File[]; folderId: string | null } | null;
  sidebarOpen: boolean;
  /** Folder that drag-and-drop / Upload button targets on the current page */
  currentFolderId: string | null;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUi = create<UiState>((set) => ({
  player: null,
  share: null,
  move: null,
  rename: null,
  details: null,
  confirm: null,
  uploadDialog: null,
  sidebarOpen: false,
  currentFolderId: null,
  set: (patch) => set(patch),
}));

const ACCEPT = 'video/*,.mp4,.mov,.mkv,.avi,.webm,.m4v';

/** Opens the device file picker (multi-select) and then the upload preview dialog. */
export function pickVideos(folderId: string | null = useUi.getState().currentFolderId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = 'none';
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (!files.length) return;
    const open = useUi.getState().uploadDialog;
    if (open) useUi.getState().set({ uploadDialog: { ...open, files: [...open.files, ...files] } });
    else useUi.getState().set({ uploadDialog: { files, folderId } });
  };
  document.body.appendChild(input);
  input.click();
}

export const ui = {
  play: (v: Video) => useUi.getState().set({ player: v }),
  share: (videos: Video[]) => useUi.getState().set({ share: videos }),
  move: (videos: Video[], title?: string, onDone?: () => void) => useUi.getState().set({ move: { videos, title, onDone } }),
  rename: (v: Video) => useUi.getState().set({ rename: v }),
  details: (v: Video) => useUi.getState().set({ details: v }),
  confirm: (o: ConfirmOptions) => useUi.getState().set({ confirm: o }),
  openUpload: (files: File[] = [], folderId: string | null = null) => useUi.getState().set({ uploadDialog: { files, folderId } }),
};
