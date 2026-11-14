import type { ReactNode } from 'react';

export const inputClass = 'mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2';
export const buttonClass =
  'rounded-md bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButtonClass =
  'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-100 disabled:opacity-50';

/** Centered single-column page used before sign-in completes. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-8 text-2xl font-semibold">The Pocket Marketing Assistant</h1>
        {children}
      </div>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-stone-200">
      {title && <h2 className="mb-4 text-lg font-medium">{title}</h2>}
      {children}
    </section>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-stone-200 bg-stone-50 text-stone-700',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}
