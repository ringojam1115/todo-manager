'use client';

import { useCallback, useEffect, useState } from 'react';
import TodoList from './todo-list';
import SuggestionSection from './suggestion-section';

function localDateString(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

interface Props {
  date?: string;
  dateOffset?: number;
  label: string;
}

export default function PageContent({ date: dateProp, dateOffset, label }: Props) {
  const [date, setDate] = useState<string | null>(dateProp ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const handleAdopted = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (dateOffset !== undefined) {
      setDate(localDateString(dateOffset));
    }
  }, [dateOffset]);

  if (!date) return null;

  return (
    <>
      <TodoList key={refreshKey} date={date} label={label} />
      <SuggestionSection date={date} onAdopted={handleAdopted} />
    </>
  );
}
