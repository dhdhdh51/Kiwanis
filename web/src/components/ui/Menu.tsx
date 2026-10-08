import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface Props {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; 'aria-expanded': boolean }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
}

/** Lightweight dropdown rendered in a portal (so it is never clipped by cards or scroll containers). */
export function Menu({ trigger, items, align = 'right' }: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    let left = align === 'right' ? anchor.right - w : anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 6);
    setPos({ top, left });
  }, [anchor, align]);

  useEffect(() => {
    if (!anchor) return;
    const close = () => {
      setAnchor(null);
      setPos(null);
    };
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [anchor]);

  return (
    <>
      {trigger({
        onClick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect());
        },
        'aria-expanded': !!anchor,
      })}
      {anchor &&
        createPortal(
          <div
            ref={ref}
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[60] min-w-52 animate-fade-in rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#1b1b27]"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((it, i) => (
              <div key={i}>
                {it.divider && <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />}
                <button
                  role="menuitem"
                  disabled={it.disabled}
                  className={clsx('menu-item disabled:opacity-40', it.danger && 'text-red-600 dark:text-red-400')}
                  onClick={() => {
                    setAnchor(null);
                    setPos(null);
                    it.onClick();
                  }}
                >
                  <span className="opacity-80">{it.icon}</span>
                  {it.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
