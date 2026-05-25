'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

type Cell = { day: number; dateStr: string; isCurrentMonth: boolean };

export default function MiniCalendar() {
  const router = useRouter();
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [todoDates, setTodoDates] = useState<Set<string>>(new Set());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  useEffect(() => {
    const firstDay = toDateStr(year, month, 1);
    const lastDay = toDateStr(year, month, new Date(year, month + 1, 0).getDate());
    supabase
      .from('todos')
      .select('date')
      .gte('date', firstDay)
      .lte('date', lastDay)
      .then(({ data }) => {
        if (data) setTodoDates(new Set(data.map((t: { date: string }) => t.date)));
      });
  }, [year, month]);

  // Build calendar cells
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: Cell[] = [];

  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    cells.push({ day: d, dateStr: toDateStr(prevYear, prevMonth, d), isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: toDateStr(year, month, d), isCurrentMonth: true });
  }

  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const nextYear = month === 11 ? year + 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    cells.push({ day: nextDay, dateStr: toDateStr(nextYear, nextMonth, nextDay), isCurrentMonth: false });
    nextDay++;
  }

  function handleDateClick(dateStr: string) {
    if (dateStr === todayStr) router.push('/');
    else if (dateStr === tomorrowStr) router.push('/tomorrow');
    else router.push(`/date/${dateStr}`);
  }

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">{monthLabel}</span>
        <div className="flex gap-0.5">
          <button
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm"
          >
            ‹
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm"
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="flex justify-center">
            <span className="text-[10px] text-gray-400 w-6 text-center">{d}</span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((cell, i) => {
          const isToday = cell.dateStr === todayStr;
          const hasTodos = todoDates.has(cell.dateStr);

          return (
            <button
              key={i}
              onClick={() => handleDateClick(cell.dateStr)}
              className={`flex flex-col items-center justify-center h-7 w-full rounded-full transition-colors ${
                isToday ? 'bg-gray-900' : 'hover:bg-gray-200'
              }`}
            >
              <span
                className={`text-[11px] leading-none ${
                  isToday
                    ? 'text-white'
                    : cell.isCurrentMonth
                      ? 'text-gray-700'
                      : 'text-gray-300'
                }`}
              >
                {cell.day}
              </span>
              {hasTodos && (
                <span
                  className={`mt-0.5 w-1 h-1 rounded-full ${
                    isToday ? 'bg-white opacity-70' : 'bg-gray-400'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
