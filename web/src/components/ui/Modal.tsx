import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Disable closing by backdrop click / Escape (e.g. while submitting) */
  locked?: boolean;
}

const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md', locked }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !locked && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, locked, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" onClick={() => !locked && onClose()} />
      <div
        ref={panel}
        className={clsx(
          'relative flex max-h-[92vh] w-full animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl dark:bg-[#15151f] dark:ring-1 dark:ring-white/10',
          widths[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
            <div className="min-w-0 flex-1">
              {title && <h2 className="truncate text-lg font-semibold">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
            </div>
            <button className="btn-icon btn-ghost -mt-1 -mr-2" onClick={onClose} disabled={locked} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3.5 sm:px-6 dark:border-white/5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
