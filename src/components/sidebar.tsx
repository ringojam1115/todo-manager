'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MiniCalendar from './mini-calendar';

const NAV_ITEMS = [
  { href: '/',         label: 'Today',    icon: '☀' },
  { href: '/tomorrow', label: 'Tomorrow', icon: '→' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="w-[220px] flex-shrink-0 h-full flex flex-col bg-stone-100 border-r border-stone-200">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 flex items-center gap-2">
        <span className="text-base leading-none">☑</span>
        <span className="text-sm font-semibold text-stone-700 tracking-tight">todo-manager</span>
      </div>

      {/* Navigation */}
      <nav className="px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                isActive
                  ? 'bg-white text-stone-800 font-medium shadow-sm'
                  : 'text-stone-500 hover:bg-stone-200/60 hover:text-stone-700'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Mini Calendar */}
      <div className="mt-5 px-3 pt-4 border-t border-stone-200">
        <MiniCalendar />
      </div>

      {/* Sign out */}
      <div className="mt-auto px-4 pb-5">
        <button
          onClick={handleSignOut}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
