import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold text-brand-700">Flowgate</p>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
