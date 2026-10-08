import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Loader2, Minus } from 'lucide-react';

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('animate-spin', className)} />;
}

export function ProgressBar({ value, className, tone = 'brand', thin }: { value: number; className?: string; tone?: 'brand' | 'green' | 'red' | 'amber'; thin?: boolean }) {
  const colors = {
    brand: 'bg-gradient-to-r from-brand-500 to-accent-500',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
  };
  return (
    <div className={clsx('w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-white/10', thin ? 'h-1.5' : 'h-2.5', className)}>
      <div
        className={clsx('h-full rounded-full transition-[width] duration-300 ease-out', colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={clsx(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
        checked || indeterminate
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-zinc-300 bg-white/90 hover:border-brand-500 dark:border-white/25 dark:bg-black/30',
        className,
      )}
    >
      {indeterminate ? <Minus size={14} strokeWidth={3} /> : checked ? <Check size={14} strokeWidth={3} /> : null}
    </button>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-white/10">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-zinc-300 dark:bg-white/15',
      )}
    >
      <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm transition',
            value === o.value ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FormatBadge({ format }: { format: string }) {
  return <span className="chip bg-black/60 font-semibold tracking-wide text-white uppercase backdrop-blur">{format}</span>;
}
