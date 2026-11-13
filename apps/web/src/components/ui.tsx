import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { Tone } from '@/lib/format';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
};

export function Button({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium',
        VARIANTS[variant],
      )}
    >
      {children}
    </Link>
  );
}

const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 focus:border-brand-500 disabled:bg-slate-100';

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={cx(inputClass, props.className)} />
);
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...props} className={cx(inputClass, props.className)} />
);
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={cx(inputClass, props.className)} />
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-50 text-blue-800',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-800',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white p-5 shadow-xs', className)}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        small ? 'h-3.5 w-3.5' : 'h-6 w-6',
      )}
    />
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-12 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

export { cx };
