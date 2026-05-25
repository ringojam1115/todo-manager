'use client';

import { useCallback, useState } from 'react';
import TodoList from './todo-list';
import SuggestionSection from './suggestion-section';

interface Props {
  date: string;
  label: string;
}

export default function PageContent({ date, label }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const handleAdopted = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <TodoList key={refreshKey} date={date} label={label} />
      <SuggestionSection date={date} onAdopted={handleAdopted} />
    </>
  );
}
