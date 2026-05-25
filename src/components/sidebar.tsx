'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MiniCalendar from './mini-calendar';

const NAV_ITEMS = [
  { href: '/', label: 'Today' },
  { href: '/tomorrow', label: 'Tomorrow' },
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
    <aside className="w-[220px] flex-shrink-0 h-full flex flex-col bg-gray-50 border-r border-gray-100">
      {/* Logo */}
      <div className="px-4 pt-5 pb-3">
        <span className="text-sm font-semibold text-gray-800 tracking-tight">todo-manager</span>
      </div>

      {/* Navigation */}
      <nav className="px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center px-3 py-1.5 rounded-md text-sm transition-colors ${
              pathname === href
                ? 'bg-gray-200 text-gray-900 font-medium'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Mini Calendar */}
      <div className="mt-5 px-3 border-t border-gray-100 pt-4">
        <MiniCalendar />
      </div>

      {/* Sign out */}
      <div className="mt-auto px-4 pb-5">
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
