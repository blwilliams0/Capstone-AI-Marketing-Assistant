import { useState, type ReactNode } from 'react';

export const inputClass = 'mt-1 block w-full rounded-md border border-studio-taupe bg-studio-pearl px-3 py-2 text-studio-ink';
export const buttonClass =
  'rounded-md bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-studio-linen disabled:text-studio-muted';
export const secondaryButtonClass =
  'rounded-md border border-studio-taupe bg-studio-pearl px-4 py-2 text-sm font-semibold text-studio-ink disabled:cursor-not-allowed hover:bg-stone-100 disabled:bg-studio-linen disabled:text-studio-muted';

/** The supplied brand file can be added locally without a code change. */
export function StudioIdentity({ sidebar = false }: { sidebar?: boolean }) {
  const [assetMissing, setAssetMissing] = useState(false);
  return (
    <div>
      {assetMissing
        ? <p className="font-serif text-3xl font-semibold leading-none">The Pocket</p>
        : <img src="/brand/the-pocket-logo.png" alt="The Pocket, Carmel-by-the-Sea"
            onError={() => setAssetMissing(true)}
            className={sidebar ? 'max-h-16 max-w-28 object-contain brightness-0 invert' : 'max-h-24 w-auto object-contain'} />}
      <p className={`mt-2 text-xs font-semibold tracking-widest uppercase ${sidebar ? 'text-studio-ivory' : 'text-studio-muted'}`}>Marketing Studio</p>
    </div>
  );
}

/** Centered single-column page used before sign-in completes. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-studio-slate px-5 py-10 text-studio-ink">
      <div className="w-full max-w-lg rounded-xl border border-studio-linen bg-studio-pearl p-6 shadow-xl sm:p-9">
        <header className="mb-7"><StudioIdentity /><p className="mt-4 text-sm text-studio-muted">A creative workspace for The Pocket’s team.</p></header>
        {children}
      </div>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-studio-linen bg-studio-pearl p-4 text-studio-ink sm:p-5">
      {title && <h2 className="mb-4 font-serif text-xl">{title}</h2>}
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
