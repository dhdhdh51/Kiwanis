import clsx from 'clsx';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '../../lib/toast';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 sm:top-auto sm:bottom-5 sm:left-5 sm:items-start">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-zinc-800 dark:ring-1 dark:ring-white/10"
        >
          {t.kind === 'success' ? (
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
          ) : t.kind === 'error' ? (
            <XCircle size={18} className="shrink-0 text-red-400" />
          ) : (
            <Info size={18} className="shrink-0 text-sky-400" />
          )}
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              className={clsx('font-semibold text-brand-300 hover:text-brand-200')}
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="text-zinc-400 hover:text-white" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
