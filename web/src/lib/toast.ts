import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttl?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttl = 4500) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (message: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'success', message, action }),
  error: (message: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'error', message, action }, 7000),
  info: (message: string) => useToasts.getState().push({ kind: 'info', message }),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
