'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Todo = {
  id: string;
  user_id: string | null;
  text: string;
  date: string;
  completed: boolean;
  indent_level: number;
  position: number;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

const MAX_INDENT = 4;
const INDENT_PX = 24;

export default function TodayPage() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inserting = useRef(false);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });

    supabase
      .from('todos')
      .select('*')
      .eq('date', today)
      .order('position')
      .then(({ data }) => {
        if (data) setTodos(data as Todo[]);
        setLoading(false);
      });
  }, [today]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  // ── text persistence ────────────────────────────────────────────────────────

  const persistText = useCallback((id: string, text: string) => {
    supabase.from('todos').update({ text, updated_at: now() }).eq('id', id);
  }, []);

  const scheduleTextSave = useCallback(
    (id: string, text: string) => {
      const existing = pendingSaves.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        persistText(id, text);
        pendingSaves.current.delete(id);
      }, 500);
      pendingSaves.current.set(id, timer);
    },
    [persistText],
  );

  const flushTextSave = useCallback(
    (id: string, text: string) => {
      const timer = pendingSaves.current.get(id);
      if (!timer) return;
      clearTimeout(timer);
      pendingSaves.current.delete(id);
      persistText(id, text);
    },
    [persistText],
  );

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleTextChange = useCallback(
    (id: string, text: string) => {
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
      scheduleTextSave(id, text);
    },
    [scheduleTextSave],
  );

  const toggleCompleted = useCallback(async (id: string, completed: boolean) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, completed } : t)));
    await supabase.from('todos').update({ completed, updated_at: now() }).eq('id', id);
  }, []);

  const handleIndent = useCallback(async (id: string, currentIndent: number, delta: number) => {
    const next = Math.max(0, Math.min(MAX_INDENT, currentIndent + delta));
    if (next === currentIndent) return;
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, indent_level: next } : t)));
    await supabase.from('todos').update({ indent_level: next, updated_at: now() }).eq('id', id);
  }, []);

  // Insert a new todo after `index` using fractional positioning —
  // never requires updating sibling rows.
  const insertAfter = useCallback(
    async (index: number, indentLevel: number) => {
      if (inserting.current) return;
      inserting.current = true;
      try {
        const prev = todos[index];
        const next = todos[index + 1];
        const position =
          next == null
            ? (prev?.position ?? 0) + 1
            : (prev.position + next.position) / 2;

        const { data, error } = await supabase
          .from('todos')
          .insert({ text: '', completed: false, indent_level: indentLevel, date: today, position, updated_at: now(), user_id: userId })
          .select()
          .single();

        if (error) { console.error('insertAfter failed:', error.code, error.message, error.details, error.hint); return; }
        if (!data) return;

        setTodos((prevTodos) => [
          ...prevTodos.slice(0, index + 1),
          data as Todo,
          ...prevTodos.slice(index + 1),
        ]);

        setTimeout(() => inputRefs.current.get(data.id)?.focus(), 0);
      } finally {
        inserting.current = false;
      }
    },
    [todos, today, userId],
  );

  const deleteTodo = useCallback(
    async (id: string, index: number, text: string) => {
      flushTextSave(id, text);
      const prevTodo = todos[index - 1];
      setTodos((prev) => prev.filter((t) => t.id !== id));
      await supabase.from('todos').delete().eq('id', id);
      if (prevTodo) {
        setTimeout(() => {
          const el = inputRefs.current.get(prevTodo.id);
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }, 0);
      }
    },
    [todos, flushTextSave],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, todo: Todo, index: number) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          insertAfter(index, todo.indent_level);
          break;
        case 'Tab':
          e.preventDefault();
          handleIndent(todo.id, todo.indent_level, e.shiftKey ? -1 : 1);
          break;
        case 'Backspace':
          if (todo.text === '') {
            e.preventDefault();
            deleteTodo(todo.id, index, todo.text);
          }
          break;
      }
    },
    [insertAfter, handleIndent, deleteTodo],
  );

  const createFirst = useCallback(async () => {
    const { data, error } = await supabase
      .from('todos')
      .insert({ text: '', completed: false, indent_level: 0, date: today, position: 0, updated_at: now(), user_id: userId })
      .select()
      .single();
    if (error) { console.error('createFirst failed:', error.code, error.message, error.details, error.hint); return; }
    if (data) {
      setTodos([data as Todo]);
      setTimeout(() => inputRefs.current.get(data.id)?.focus(), 0);
    }
  }, [today, userId]);

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-8 py-12">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 tracking-wide mb-1">{dateLabel}</p>
            <h1 className="text-2xl font-semibold text-gray-900">Today</h1>
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1"
          >
            Sign out
          </button>
        </header>

        <ul>
          {todos.map((todo, index) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 py-1"
              style={{ paddingLeft: todo.indent_level * INDENT_PX }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleCompleted(todo.id, !todo.completed)}
                className="w-4 h-4 flex-shrink-0 cursor-pointer accent-blue-500 rounded"
              />
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(todo.id, el);
                  else inputRefs.current.delete(todo.id);
                }}
                type="text"
                value={todo.text}
                placeholder="New todo"
                onChange={(e) => handleTextChange(todo.id, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, todo, index)}
                onBlur={(e) => flushTextSave(todo.id, e.target.value)}
                className={`flex-1 bg-transparent text-sm outline-none placeholder-gray-300 ${
                  todo.completed ? 'line-through text-gray-300' : 'text-gray-800'
                }`}
              />
            </li>
          ))}
        </ul>

        {todos.length === 0 && (
          <button
            onClick={createFirst}
            className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-gray-500 transition-colors mt-1"
          >
            <span className="text-base leading-none">+</span>
            <span>Add a todo</span>
          </button>
        )}
      </div>
    </main>
  );
}
