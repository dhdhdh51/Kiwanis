import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function apply(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b12' : '#fafafa');
}

export const useTheme = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>((set) => ({
  mode: (localStorage.getItem('vv-theme') as ThemeMode) || 'system',
  setMode: (mode) => {
    localStorage.setItem('vv-theme', mode);
    apply(mode);
    set({ mode });
  },
}));

apply(useTheme.getState().mode);
media.addEventListener('change', () => apply(useTheme.getState().mode));

export const isDark = () => document.documentElement.classList.contains('dark');
