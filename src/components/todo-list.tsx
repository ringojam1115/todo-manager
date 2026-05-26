'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type Memo = {
  id: string;
  todo_id: string;
  text: string;
  is_pre_edit: boolean;
  created_at: string;
};

interface Props {
  date: string;  // YYYY-MM-DD
  label: string; // "Today" | "Tomorrow" | "May 30"
}

const now = () => new Date().toISOString();
const MAX_INDENT = 4;
const INDENT_PX = 24;

export default function TodoList({ date, label }: Props) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inserting = useRef(false);
  const memoInputRefs = useRef(new Map<string, HTMLInputElement>());
  const memoPendingSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingFocusId = useRef<string | null>(null);
  const pendingMemoFocusId = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocusId.current) return;
    const el = inputRefs.current.get(pendingFocusId.current);
    if (el) {
      el.focus();
      pendingFocusId.current = null;
    }
  }, [todos]);

  useEffect(() => {
    if (!pendingMemoFocusId.current) return;
    const el = memoInputRefs.current.get(pendingMemoFocusId.current);
    if (el) {
      el.focus();
      pendingMemoFocusId.current = null;
    }
  }, [memos]);

  // ── initial load ────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setTodos([]);
    setMemos([]);

    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));

    supabase
      .from('todos')
      .select('*')
      .eq('date', date)
      .order('position')
      .then(async ({ data: todosData }) => {
        if (!todosData) { setLoading(false); return; }
        setTodos(todosData as Todo[]);

        const completedIds = (todosData as Todo[]).filter((t) => t.completed).map((t) => t.id);
        if (completedIds.length > 0) {
          const { data: memosData } = await supabase
            .from('todo_memos')
            .select('*')
            .in('todo_id', completedIds)
            .order('created_at');
          if (memosData) setMemos(memosData as Memo[]);
        }
        setLoading(false);
      });
  }, [date]);

  // ── todo text persistence ───────────────────────────────────────────────────

  const persistText = useCallback((id: string, text: string) => {
    supabase
      .from('todos')
      .update({ text, updated_at: now() })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('text save failed:', error.message);
      });
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

  const handleTextChange = useCallback(
    (id: string, text: string) => {
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
      scheduleTextSave(id, text);
    },
    [scheduleTextSave],
  );

  // ── memo text persistence ───────────────────────────────────────────────────

  const persistMemoText = useCallback((id: string, text: string) => {
    supabase
      .from('todo_memos')
      .update({ text })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('memo save failed:', error.message);
      });
  }, []);

  const scheduleMemoSave = useCallback(
    (id: string, text: string) => {
      const existing = memoPendingSaves.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        persistMemoText(id, text);
        memoPendingSaves.current.delete(id);
      }, 500);
      memoPendingSaves.current.set(id, timer);
    },
    [persistMemoText],
  );

  const flushMemoSave = useCallback(
    (id: string, text: string) => {
      const timer = memoPendingSaves.current.get(id);
      if (!timer) return;
      clearTimeout(timer);
      memoPendingSaves.current.delete(id);
      persistMemoText(id, text);
    },
    [persistMemoText],
  );

  const handleMemoTextChange = useCallback(
    (id: string, text: string) => {
      setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, text } : m)));
      scheduleMemoSave(id, text);
    },
    [scheduleMemoSave],
  );

  // ── flat ordered list of focusable inputs (todos interleaved with their memos) ──

  const flatItems = useMemo(() => {
    const items: { type: 'todo' | 'memo'; id: string }[] = [];
    for (const todo of todos) {
      items.push({ type: 'todo', id: todo.id });
      if (todo.completed) {
        for (const memo of memos.filter((m) => m.todo_id === todo.id && !m.is_pre_edit)) {
          items.push({ type: 'memo', id: memo.id });
        }
      }
    }
    return items;
  }, [todos, memos]);

  const focusItem = useCallback((item: { type: 'todo' | 'memo'; id: string }) => {
    (item.type === 'todo' ? inputRefs.current : memoInputRefs.current).get(item.id)?.focus();
  }, []);

  // ── todo handlers ───────────────────────────────────────────────────────────

  const toggleCompleted = useCallback(async (id: string, completed: boolean) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, completed } : t)));
    await supabase.from('todos').update({ completed, updated_at: now() }).eq('id', id);

    if (completed) {
      const { data, error } = await supabase
        .from('todo_memos')
        .insert({ todo_id: id, text: '', is_pre_edit: false })
        .select()
        .single();
      if (!error && data) {
        pendingMemoFocusId.current = data.id;
        setMemos((prev) => [...prev, data as Memo]);
      }
    } else {
      setMemos((prev) =>
        prev.map((m) => (m.todo_id === id && !m.is_pre_edit ? { ...m, is_pre_edit: true } : m)),
      );
      await supabase
        .from('todo_memos')
        .update({ is_pre_edit: true })
        .eq('todo_id', id)
        .eq('is_pre_edit', false);
    }
  }, []);

  const handleIndent = useCallback(async (id: string, currentIndent: number, delta: number) => {
    const next = Math.max(0, Math.min(MAX_INDENT, currentIndent + delta));
    if (next === currentIndent) return;
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, indent_level: next } : t)));
    await supabase.from('todos').update({ indent_level: next, updated_at: now() }).eq('id', id);
  }, []);

  const insertAfter = useCallback(
    async (index: number, indentLevel: number) => {
      if (inserting.current) return;
      inserting.current = true;
      try {
        const prev = todos[index];
        const next = todos[index + 1];
        const position =
          next == null ? (prev?.position ?? 0) + 1 : (prev.position + next.position) / 2;

        const { data, error } = await supabase
          .from('todos')
          .insert({ text: '', completed: false, indent_level: indentLevel, date, position, updated_at: now(), user_id: userId })
          .select()
          .single();

        if (error) { console.error('insertAfter failed:', error.message); return; }
        if (!data) return;

        pendingFocusId.current = data.id;
        setTodos((prevTodos) => [
          ...prevTodos.slice(0, index + 1),
          data as Todo,
          ...prevTodos.slice(index + 1),
        ]);
      } finally {
        inserting.current = false;
      }
    },
    [todos, date, userId],
  );

  const deleteTodo = useCallback(
    async (id: string, index: number, text: string) => {
      flushTextSave(id, text);
      const prevTodo = todos[index - 1];
      setTodos((prev) => prev.filter((t) => t.id !== id));
      setMemos((prev) => prev.filter((m) => m.todo_id !== id));
      await supabase.from('todos').delete().eq('id', id);
      if (prevTodo) {
        setTimeout(() => {
          const el = inputRefs.current.get(prevTodo.id);
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 0);
      }
    },
    [todos, flushTextSave],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, todo: Todo, index: number) => {
      if (e.nativeEvent.isComposing) return;
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
        case 'ArrowUp': {
          const idx = flatItems.findIndex((item) => item.id === todo.id);
          if (idx > 0) { e.preventDefault(); focusItem(flatItems[idx - 1]); }
          break;
        }
        case 'ArrowDown': {
          const idx = flatItems.findIndex((item) => item.id === todo.id);
          if (idx < flatItems.length - 1) { e.preventDefault(); focusItem(flatItems[idx + 1]); }
          break;
        }
      }
    },
    [insertAfter, handleIndent, deleteTodo, flatItems, focusItem],
  );

  const createFirst = useCallback(async () => {
    const { data, error } = await supabase
      .from('todos')
      .insert({ text: '', completed: false, indent_level: 0, date, position: 0, updated_at: now(), user_id: userId })
      .select()
      .single();
    if (error) { console.error('createFirst failed:', error.message); return; }
    if (data) {
      pendingFocusId.current = data.id;
      setTodos([data as Todo]);
    }
  }, [date, userId]);

  // ── memo handlers ───────────────────────────────────────────────────────────

  const addMemo = useCallback(async (todoId: string, afterMemoId?: string) => {
    const { data, error } = await supabase
      .from('todo_memos')
      .insert({ todo_id: todoId, text: '', is_pre_edit: false })
      .select()
      .single();
    if (error) { console.error('addMemo failed:', error.message); return; }
    if (!data) return;

    pendingMemoFocusId.current = data.id;
    setMemos((prev) => {
      if (!afterMemoId) return [...prev, data as Memo];
      const idx = prev.findIndex((m) => m.id === afterMemoId);
      if (idx === -1) return [...prev, data as Memo];
      return [...prev.slice(0, idx + 1), data as Memo, ...prev.slice(idx + 1)];
    });
  }, []);

  const deleteMemo = useCallback(
    async (memo: Memo, todoId: string) => {
      flushMemoSave(memo.id, memo.text);
      const activeMemos = memos.filter((m) => m.todo_id === todoId && !m.is_pre_edit);
      const memoIndex = activeMemos.findIndex((m) => m.id === memo.id);
      const prevMemo = activeMemos[memoIndex - 1];

      setMemos((prev) => prev.filter((m) => m.id !== memo.id));
      await supabase.from('todo_memos').delete().eq('id', memo.id);

      if (prevMemo) {
        setTimeout(() => {
          const el = memoInputRefs.current.get(prevMemo.id);
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 0);
      }
    },
    [memos, flushMemoSave],
  );

  const handleMemoKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, memo: Memo, todoId: string) => {
      if (e.nativeEvent.isComposing) return;
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          addMemo(todoId, memo.id);
          break;
        case 'Backspace':
          if (memo.text === '') { e.preventDefault(); deleteMemo(memo, todoId); }
          break;
        case 'ArrowUp': {
          const idx = flatItems.findIndex((item) => item.id === memo.id);
          if (idx > 0) { e.preventDefault(); focusItem(flatItems[idx - 1]); }
          break;
        }
        case 'ArrowDown': {
          const idx = flatItems.findIndex((item) => item.id === memo.id);
          if (idx < flatItems.length - 1) { e.preventDefault(); focusItem(flatItems[idx + 1]); }
          break;
        }
      }
    },
    [addMemo, deleteMemo, flatItems, focusItem],
  );

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium text-gray-400 tracking-wide mb-1">{dateLabel}</p>
        <h1 className="text-2xl font-semibold text-gray-900">{label}</h1>
      </header>

      <ul>
        {todos.map((todo, index) => {
          const todoMemos = memos.filter((m) => m.todo_id === todo.id);
          const preEditMemos = todoMemos.filter((m) => m.is_pre_edit);
          const activeMemos = todoMemos.filter((m) => !m.is_pre_edit);

          return (
            <Fragment key={todo.id}>
              <li
                className="flex items-center gap-3 py-0.5"
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
                  className={`flex-1 bg-transparent text-base outline-none placeholder-gray-300 leading-relaxed ${
                    todo.completed ? 'line-through text-gray-300' : 'text-gray-800'
                  }`}
                />
              </li>

              {todo.completed && (
                <>
                  {preEditMemos.map((memo) => (
                    <li
                      key={memo.id}
                      className="flex items-baseline gap-2 py-0.5"
                      style={{ paddingLeft: todo.indent_level * INDENT_PX + INDENT_PX }}
                    >
                      <span className="text-gray-300 flex-shrink-0 select-none">·</span>
                      <span className="text-sm text-gray-400">
                        <span className="text-gray-300 mr-1">pre-edit note:</span>
                        {memo.text}
                      </span>
                    </li>
                  ))}
                  {activeMemos.map((memo) => (
                    <li
                      key={memo.id}
                      className="flex items-center gap-2 py-0.5"
                      style={{ paddingLeft: todo.indent_level * INDENT_PX + INDENT_PX }}
                    >
                      <span className="text-gray-400 flex-shrink-0 select-none leading-none">·</span>
                      <input
                        ref={(el) => {
                          if (el) memoInputRefs.current.set(memo.id, el);
                          else memoInputRefs.current.delete(memo.id);
                        }}
                        type="text"
                        value={memo.text}
                        placeholder="Add a note…"
                        onChange={(e) => handleMemoTextChange(memo.id, e.target.value)}
                        onKeyDown={(e) => handleMemoKeyDown(e, memo, todo.id)}
                        onBlur={(e) => flushMemoSave(memo.id, e.target.value)}
                        className="flex-1 bg-transparent text-sm outline-none placeholder-gray-300 text-gray-500 leading-relaxed"
                      />
                    </li>
                  ))}
                </>
              )}
            </Fragment>
          );
        })}
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
  );
}
