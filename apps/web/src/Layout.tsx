import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import type { Capability } from '@the-pocket/shared';
import { StudioIcon, iconPaths } from './advisor/Composer';
import { StudioIdentity } from './ui';
import { useAuth } from './auth';

interface NavItem {
  to: string;
  label: string;
  icon: keyof typeof iconPaths;
  /** Shown only when the person has this capability. Informational only: the server enforces access. */
  needs?: Capability;
}

const groups: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { to: '/', label: 'At a Glance', icon: 'home' },
    { to: '/assistant', label: 'AI Advisor', icon: 'chat', needs: 'assistant.use' },
    { to: '/knowledge', label: 'Brand Studio', icon: 'book', needs: 'knowledge.view' },
    { to: '/visual', label: 'Visual Studio', icon: 'photo', needs: 'content.draft' },
    { to: '/feed-planner', label: 'Feed Preview', icon: 'grid', needs: 'content.draft' },
    { to: '/posts', label: 'Content', icon: 'file', needs: 'content.view' },
    { to: '/calendar', label: 'Marketing Calendar', icon: 'calendar', needs: 'content.view' },
    { to: '/photo-guide', label: 'Photo Guide', icon: 'photo', needs: 'content.view' },
  ] },
  { title: 'Management', items: [
    { to: '/posts?filter=review', label: 'Approvals', icon: 'check', needs: 'post.approve' },
    { to: '/ready', label: 'Ready to Post', icon: 'check', needs: 'post.record' },
    { to: '/reminders', label: 'Reminders', icon: 'bell' },
  ] },
  { title: 'Administration', items: [
    { to: '/interviews', label: 'Brand Interviews', icon: 'chat', needs: 'interview.conduct' },
    { to: '/staff', label: 'Staff Management', icon: 'person', needs: 'users.manage' },
    { to: '/activity', label: 'Activity History', icon: 'file', needs: 'content.view' },
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
  const preferenceKey = `pocket.navigation.${me?.restaurantId}.${me?.userId}`;
  const [mode, setMode] = useState<'expanded' | 'rail' | 'focus'>(() => {
    try {
      const stored = localStorage.getItem(preferenceKey);
      return stored === 'rail' || stored === 'focus' ? stored : 'expanded';
    } catch { return 'expanded'; }
  });
  const restoreButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  function changeMode(next: typeof mode) {
    try { localStorage.setItem(preferenceKey, next); } catch { /* The layout still works for this visit. */ }
    setMode(next);
    if (next === 'focus' || mode !== 'expanded') {
      requestAnimationFrame(() => (next === 'focus' ? restoreButton : collapseButton).current?.focus());
    }
  }
  const menuButton = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    if (!open) return;
    setOpen(false);
    menuButton.current?.focus();
  }

  if (!me) return null;
  return (
    <div className={`min-h-screen lg:grid ${mode === 'rail' ? 'lg:grid-cols-[4.75rem_minmax(0,1fr)]' : mode === 'focus' ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[15rem_minmax(0,1fr)]'}`}>
      <a href="#workspace" className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-white focus:p-3">Skip to workspace</a>
      <aside className={`bg-stone-900 text-stone-50 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:overflow-auto ${mode === 'focus' ? 'lg:hidden' : 'lg:flex'}`}
        onKeyDown={(event) => { if (event.key === 'Escape') closeMenu(); }}>
        <div className={`flex items-center justify-between px-5 py-4 lg:py-6 ${mode === 'rail' ? 'lg:justify-center lg:px-2' : ''}`}>
          <Link to="/" aria-label="The Pocket Marketing Studio, At a Glance" title="At a Glance" onClick={closeMenu} className="rounded">
            <span className={mode === 'rail' ? 'lg:hidden' : ''}><StudioIdentity sidebar /></span>
            {mode === 'rail' && <span aria-hidden="true" className="hidden font-serif text-2xl font-semibold lg:block">TP</span>}
          </Link>
          <button ref={menuButton} type="button" className="rounded-md border border-stone-400 px-3 py-2 text-sm lg:hidden"
            aria-controls="studio-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Close menu' : 'Menu'}
          </button>
        </div>
        <div id="studio-navigation" className={`${open ? 'flex' : 'hidden'} flex-1 flex-col justify-between px-4 pb-5 lg:flex ${mode === 'rail' ? 'lg:px-2' : ''}`}>
          <nav aria-label="Studio" className="space-y-6">
            {groups.map(({ title, items }) => {
              const allowed = items.filter((item) => !item.needs || me.capabilities.includes(item.needs));
              if (!allowed.length) return null;
              return (
                <section key={title} aria-label={title}>
                  <p className={`mb-1 px-3 text-xs font-medium text-stone-300 ${mode === 'rail' ? 'lg:sr-only' : ''}`}>{title}</p>
                  <ul className="space-y-0.5">
                    {allowed.map(({ to, label, icon }) => {
                      const [path, query] = to.split('?');
                      const active = query ? pathname === path && search === `?${query}`
                        : (pathname === path && !(path === '/posts' && search === '?filter=review'))
                          || (path !== '/' && pathname.startsWith(`${path}/`));
                      return (
                        <li key={to}>
                          <Link to={to} title={label} aria-label={to === '/reminders' && unread ? `${label}, ${unread} unread` : label} aria-current={active ? 'page' : false} onClick={closeMenu}
                            className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm ${mode === 'rail' ? 'lg:justify-center' : ''} ${active ? 'bg-studio-ivory font-semibold text-studio-ink' : 'hover:bg-stone-700/65'}`}>
                            <StudioIcon name={icon} /><span className={mode === 'rail' ? 'lg:sr-only' : ''}>{label}</span>
                            {to === '/reminders' && unread > 0 && (
                              <span className={`ml-auto rounded-full bg-stone-300 px-2 text-xs text-stone-900 ${mode === 'rail' ? 'lg:absolute lg:right-0 lg:top-0 lg:px-1' : ''}`} aria-label={`${unread} unread`}>{unread}</span>
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
            <p className={mode === 'rail' ? 'font-medium lg:sr-only' : 'font-medium'}>{me.name}</p>
            <p className={`capitalize text-stone-300 ${mode === 'rail' ? 'lg:sr-only' : ''}`}>{me.role}</p>
            <button onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="mt-3 flex items-center gap-2 underline underline-offset-4"><StudioIcon name="exit" /><span className={mode === 'rail' ? 'lg:sr-only' : ''}>Sign out</span></button>
          </div>
        </div>
        {mode === 'expanded' && <button ref={collapseButton} type="button"
          aria-label="Collapse navigation" title="Collapse navigation"
          className="mx-4 mb-4 hidden self-end rounded p-1 text-studio-ivory hover:bg-stone-700 lg:block"
          onClick={() => changeMode('focus')}><StudioIcon name="left" /></button>}
      </aside>
      <main id="workspace" tabIndex={-1} className={`mx-auto w-full max-w-7xl min-w-0 px-4 py-7 sm:px-8 relative lg:py-10`}>
        {mode !== 'expanded' && <button ref={restoreButton} type="button" aria-label="Expand navigation" title="Expand navigation"
          className="absolute left-1 top-2 hidden rounded p-1 text-studio-muted hover:bg-studio-linen lg:block"
          onClick={() => changeMode('expanded')}><StudioIcon name="right" /></button>}
        <Outlet />
      </main>
    </div>
  );
}
