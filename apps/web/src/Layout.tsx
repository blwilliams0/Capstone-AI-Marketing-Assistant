import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import type { Capability } from '@the-pocket/shared';
import { StudioIdentity } from './ui';
import { useAuth } from './auth';

interface NavItem {
  to: string;
  label: string;
  /** Shown only when the person has this capability. Informational only: the server enforces access. */
  needs?: Capability;
}

const groups: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { to: '/', label: 'Overview' },
    { to: '/assistant', label: 'AI Advisor', needs: 'assistant.use' },
    { to: '/knowledge', label: 'Brand Studio', needs: 'knowledge.view' },
    { to: '/posts', label: 'Content', needs: 'content.view' },
    { to: '/calendar', label: 'Marketing Calendar', needs: 'content.view' },
    { to: '/photo-guide', label: 'Photo Guide', needs: 'content.view' },
  ] },
  { title: 'Management', items: [
    { to: '/posts?filter=review', label: 'Approvals', needs: 'post.approve' },
    { to: '/ready', label: 'Ready to Post', needs: 'post.record' },
    { to: '/reminders', label: 'Reminders' },
  ] },
  { title: 'Administration', items: [
    { to: '/interviews', label: 'Brand Interviews', needs: 'interview.conduct' },
    { to: '/staff', label: 'Staff Management', needs: 'users.manage' },
    { to: '/activity', label: 'Activity History', needs: 'content.view' },
  ] },
];

/** Unread reminders, refreshed on each page change and every two minutes. */
function useUnreadReminders(): number {
  const { me, apiFetch } = useAuth();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const check = () =>
      apiFetch('/api/notifications')
        .then(async (r) => (r.ok ? ((await r.json()) as { unread: number }).unread : 0))
        .then((n) => alive && setUnread(n))
        .catch(() => {});
    void check();
    const timer = setInterval(check, 2 * 60 * 1000);
    // The Reminders page announces changes (marked read) so the badge updates at once.
    window.addEventListener('reminders-changed', check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('reminders-changed', check);
    };
  }, [me, apiFetch, pathname]);
  return unread;
}

export function Layout() {
  const { me, signOut } = useAuth();
  const { pathname, search } = useLocation();
  const unread = useUnreadReminders();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    if (!open) return;
    setOpen(false);
    menuButton.current?.focus();
  }

  if (!me) return null;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#workspace" className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-3">Skip to workspace</a>
      <aside className="bg-stone-900 text-stone-50 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-auto"
        onKeyDown={(event) => { if (event.key === 'Escape') closeMenu(); }}>
        <div className="flex items-center justify-between px-6 py-5 lg:py-8">
          <StudioIdentity sidebar />
          <button ref={menuButton} type="button" className="rounded-md border border-stone-400 px-3 py-2 text-sm lg:hidden"
            aria-controls="studio-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Close menu' : 'Menu'}
          </button>
        </div>
        <div id="studio-navigation" className={`${open ? 'flex' : 'hidden'} flex-1 flex-col justify-between px-4 pb-5 lg:flex`}>
          <nav aria-label="Studio" className="space-y-6">
            {groups.map(({ title, items }) => {
              const allowed = items.filter((item) => !item.needs || me.capabilities.includes(item.needs));
              if (!allowed.length) return null;
              return (
                <section key={title} aria-label={title}>
                  <p className="mb-1 px-3 text-xs font-medium text-stone-300">{title}</p>
                  <ul className="space-y-0.5">
                    {allowed.map(({ to, label }) => {
                      const [path, query] = to.split('?');
                      const active = query ? pathname === path && search === `?${query}`
                        : (pathname === path && !(path === '/posts' && search === '?filter=review'))
                          || (path !== '/' && pathname.startsWith(`${path}/`));
                      return (
                        <li key={to}>
                          <Link to={to} aria-current={active ? 'page' : false} onClick={closeMenu}
                            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${active ? 'bg-studio-ivory font-semibold text-studio-ink' : 'hover:bg-stone-700/65'}`}>
                            {label}
                            {to === '/reminders' && unread > 0 && (
                              <span className="rounded-full bg-stone-300 px-2 text-xs text-stone-900" aria-label={`${unread} unread`}>{unread}</span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
          <div className="mt-6 border-t border-stone-400/50 px-3 pt-4 text-sm">
            <p className="font-medium">{me.name}</p>
            <p className="capitalize text-stone-300">{me.role}</p>
            <button onClick={() => void signOut()} className="mt-3 underline underline-offset-4">Sign out</button>
          </div>
        </div>
      </aside>
      <main id="workspace" tabIndex={-1} className="mx-auto w-full max-w-7xl min-w-0 px-4 py-7 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
