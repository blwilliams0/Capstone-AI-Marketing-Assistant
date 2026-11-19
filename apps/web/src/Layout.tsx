import { NavLink, Outlet } from 'react-router';
import type { Capability } from '@the-pocket/shared';
import { useAuth } from './auth';

interface NavItem {
  to: string;
  label: string;
  /** Shown only when the person has this capability. Informational only: the server enforces access. */
  needs?: Capability;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home' },
  { to: '/assistant', label: 'Ask', needs: 'assistant.use' },
  { to: '/create', label: 'Create a post', needs: 'content.draft' },
  { to: '/posts', label: 'Posts', needs: 'content.view' },
  { to: '/ready', label: 'Ready to post', needs: 'post.record' },
  { to: '/knowledge', label: 'Knowledge', needs: 'knowledge.view' },
  { to: '/activity', label: 'Activity', needs: 'content.view' },
  { to: '/staff', label: 'Staff', needs: 'users.manage' },
];

export function Layout() {
  const { me, signOut } = useAuth();
  if (!me) return null;
  const items = NAV_ITEMS.filter((i) => !i.needs || me.capabilities.includes(i.needs));
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">The Pocket Marketing Assistant</span>
          <nav className="flex gap-4 text-sm">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                className={({ isActive }) => (isActive ? 'font-medium text-stone-900 underline' : 'text-stone-600 hover:text-stone-900')}
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-stone-600">
              {me.name} ({me.role})
            </span>
            <button onClick={() => void signOut()} className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
