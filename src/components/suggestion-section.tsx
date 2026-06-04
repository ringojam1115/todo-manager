'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getSuggestionLanguage } from './settings-modal';

type SuggestionItem = {
  id: string;
  suggestion_id: string;
  text: string;
  indent_level: number;
  order: number;
  adopted: boolean;
  adopted_todo_id: string | null;
  existing_todo_id: string | null;
  parent_existing_todo_id: string | null;
};

interface Props {
  date: string;
  onAdopted?: () => void;
}

const INDENT_PX = 24;

export default function SuggestionSection({ date, onAdopted }: Props) {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // New-group parent/subtask relationships, inferred from order + indent_level.
  // (Scenario-B rows carry explicit existing/parent ids and are skipped here.)
  const { childrenOf, parentOfSubtask } = useMemo(() => {
    const childrenOf = new Map<string, SuggestionItem[]>();
    const parentOfSubtask = new Map<string, SuggestionItem>();
    let currentParent: SuggestionItem | null = null;
    for (const it of [...items].sort((a, b) => a.order - b.order)) {
      if (it.existing_todo_id || it.parent_existing_todo_id) {
        currentParent = null;
        continue;
      }
      if (it.indent_level === 0) {
        currentParent = it;
        childrenOf.set(it.id, []);
      } else if (currentParent) {
        childrenOf.get(currentParent.id)!.push(it);
        parentOfSubtask.set(it.id, currentParent);
      }
    }
    return { childrenOf, parentOfSubtask };
  }, [items]);

  useEffect(() => {
    setItems([]);
    setOpen(false);

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: suggestion } = await supabase
        .from('suggestions')
        .select('id')
        .eq('user_id', user.id)
        .eq('target_date', date)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!suggestion) return;

      const { data: savedItems } = await supabase
        .from('suggestion_items')
        .select('*')
        .eq('suggestion_id', suggestion.id)
        .order('order');
      if (savedItems && savedItems.length > 0) {
        setItems(savedItems as SuggestionItem[]);
        setOpen(true);
      }
    });
  }, [date]);

  // Creep the progress bar toward `target` so the long AI call feels responsive.
  function creepTo(target: number) {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      setProgress((p) => {
        if (p >= target - 0.5) return target;
        return p + (target - p) * 0.08;
      });
    }, 150);
  }

  function stopCreep() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

  useEffect(() => stopCreep, []);

  async function generate() {
    setLoading(true);
    setError(null);
    setItems([]);
    setOpen(true);
    setProgress(0);

    try {
      // Phase 1: analyze (0% → 45%)
      creepTo(45);
      const analyzeRes = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      if (!analyzeRes.ok) {
        const e = await analyzeRes.json();
        throw new Error(e.error ?? 'Analyze failed');
      }
      const { graph_id } = await analyzeRes.json() as { graph_id: string };

      // Phase 2: suggest (50% → 90%)
      setProgress(50);
      creepTo(90);
      const suggestRes = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph_id, target_date: date, language: getSuggestionLanguage() }),
      });
      if (!suggestRes.ok) {
        const e = await suggestRes.json();
        throw new Error(e.error ?? 'Suggest failed');
      }
      const { items: newItems } = await suggestRes.json() as { items: SuggestionItem[] };
      stopCreep();
      setProgress(100);
      setItems(newItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      stopCreep();
      setLoading(false);
    }
  }

  // New-group parent → append the parent and all its subtasks to the end of the
  // list (a parent-only group just appends the single item).
  async function adoptNewItem(item: SuggestionItem) {
    const group = [item, ...(childrenOf.get(item.id) ?? [])];

    const { data: lastTodo } = await supabase
      .from('todos')
      .select('position')
      .eq('date', date)
      .order('position', { ascending: false })
      .limit(1);

    let position = lastTodo?.[0]?.position ?? 0;
    const { data: { user } } = await supabase.auth.getUser();
    const adoptedTodoIds = new Map<string, string>(); // suggestion item id → todo id

    for (const g of group) {
      position += 1;
      const { data: todo, error: todoErr } = await supabase
        .from('todos')
        .insert({
          text: g.text,
          completed: false,
          indent_level: g.indent_level,
          date,
          position,
          updated_at: new Date().toISOString(),
          user_id: user?.id ?? null,
        })
        .select()
        .single();

      if (todoErr || !todo) continue;
      adoptedTodoIds.set(g.id, todo.id);
      await supabase
        .from('suggestion_items')
        .update({ adopted: true, adopted_todo_id: todo.id, adopted_at: new Date().toISOString() })
        .eq('id', g.id);
    }

    if (adoptedTodoIds.size === 0) return;
    setItems((prev) =>
      prev.map((i) =>
        adoptedTodoIds.has(i.id) ? { ...i, adopted: true, adopted_todo_id: adoptedTodoIds.get(i.id)! } : i,
      ),
    );
    onAdopted?.();
  }

  // Undo a new-group adoption: delete the todo(s) that were added and reset the
  // suggestion item(s) back to unadopted.
  async function unadoptNewItem(item: SuggestionItem) {
    const group = [item, ...(childrenOf.get(item.id) ?? [])];
    const itemIds = group.map((g) => g.id);

    // Read the authoritative adopted_todo_id values from the DB rather than
    // trusting client state.
    const { data: rows } = await supabase
      .from('suggestion_items')
      .select('adopted_todo_id')
      .in('id', itemIds);
    const todoIds = (rows ?? [])
      .map((r) => r.adopted_todo_id)
      .filter((id): id is string => Boolean(id));

    // Clear the reference first — the suggestion_items.adopted_todo_id foreign
    // key forbids deleting a todo while a suggestion still points at it.
    await supabase
      .from('suggestion_items')
      .update({ adopted: false, adopted_todo_id: null, adopted_at: null })
      .in('id', itemIds);

    if (todoIds.length > 0) {
      const { error: delErr } = await supabase.from('todos').delete().in('id', todoIds);
      if (delErr) console.error('unadopt delete failed:', delErr.message);
    }

    setItems((prev) =>
      prev.map((i) => (itemIds.includes(i.id) ? { ...i, adopted: false, adopted_todo_id: null } : i)),
    );
    onAdopted?.();
  }

  // Subtask for an existing todo → insert directly under that parent in the list,
  // then remove it from the suggestion panel (and the parent row if it was the last one).
  async function adoptSubtaskOfExisting(item: SuggestionItem) {
    const parentId = item.parent_existing_todo_id;
    if (!parentId) return;

    const { data: dateTodos } = await supabase
      .from('todos')
      .select('id, position, indent_level')
      .eq('date', date)
      .order('position');

    const ordered = dateTodos ?? [];
    const parentIdx = ordered.findIndex((t) => t.id === parentId);
    const { data: { user } } = await supabase.auth.getUser();

    let position: number;
    let indentLevel: number;
    if (parentIdx === -1) {
      // Parent no longer exists — fall back to appending at the end.
      position = (ordered[ordered.length - 1]?.position ?? 0) + 1;
      indentLevel = item.indent_level;
    } else {
      const parent = ordered[parentIdx];
      const next = ordered[parentIdx + 1];
      position = next == null ? parent.position + 1 : (parent.position + next.position) / 2;
      indentLevel = Math.min(4, parent.indent_level + 1);
    }

    const { data: todo, error: todoErr } = await supabase
      .from('todos')
      .insert({
        text: item.text,
        completed: false,
        indent_level: indentLevel,
        date,
        position,
        updated_at: new Date().toISOString(),
        user_id: user?.id ?? null,
      })
      .select()
      .single();

    if (todoErr || !todo) return;

    // Was this the last remaining subtask for this existing parent?
    const remaining = items.filter(
      (i) => i.parent_existing_todo_id === parentId && i.id !== item.id,
    );
    const idsToRemove = [item.id];
    if (remaining.length === 0) {
      const parentRow = items.find((i) => i.existing_todo_id === parentId);
      if (parentRow) idsToRemove.push(parentRow.id);
    }

    await supabase.from('suggestion_items').delete().in('id', idsToRemove);
    setItems((prev) => prev.filter((i) => !idsToRemove.includes(i.id)));
    onAdopted?.();
  }

  return (
    <div className="max-w-2xl mx-auto px-8 pb-6">
      <div className="border-t border-gray-100 pt-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-400 tracking-wide uppercase">AI Suggestions</span>
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            {!loading && <span className="text-sm leading-none">↻</span>}
            <span>{loading ? 'Generating…' : open ? 'Regenerate' : 'Generate'}</span>
            {loading && (
              <svg width="13" height="13" viewBox="0 0 14 14" className="-rotate-90 flex-shrink-0">
                <circle cx="7" cy="7" r="6" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                <circle
                  cx="7"
                  cy="7"
                  r="6"
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 6}
                  strokeDashoffset={2 * Math.PI * 6 * (1 - progress / 100)}
                  className="transition-all duration-150 ease-out"
                />
              </svg>
            )}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-2">{error}</p>
        )}

        {open && !loading && items.length === 0 && !error && (
          <p className="text-sm text-gray-300">No suggestions generated.</p>
        )}

        {!loading && items.length > 0 && (
          <ul className="space-y-0.5">
            {items.map((item) => {
              // Read-only row mirroring an existing todo (parent context, no plus).
              if (item.existing_todo_id) {
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 py-1"
                    style={{ paddingLeft: item.indent_level * INDENT_PX }}
                  >
                    <span
                      title="Existing todo"
                      className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-300 text-xs leading-none"
                    >
                      ▸
                    </span>
                    <span className="text-sm text-gray-400">{item.text}</span>
                  </li>
                );
              }

              // Suggested subtask for an existing todo → adopt under its parent.
              if (item.parent_existing_todo_id) {
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 py-1"
                    style={{ paddingLeft: item.indent_level * INDENT_PX }}
                  >
                    <button
                      onClick={() => adoptSubtaskOfExisting(item)}
                      title="Add as subtask"
                      className="flex-shrink-0 w-4 h-4 rounded border text-xs flex items-center justify-center transition-colors border-gray-300 text-gray-300 hover:border-blue-400 hover:text-blue-400"
                    >
                      +
                    </button>
                    <span className="text-sm text-gray-500">{item.text}</span>
                  </li>
                );
              }

              // New-group subtask → not adoptable on its own; it comes along when
              // its parent is added. Shown with a passive marker (no plus).
              if (parentOfSubtask.has(item.id)) {
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 py-1"
                    style={{ paddingLeft: item.indent_level * INDENT_PX }}
                  >
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-300 text-xs leading-none">
                      {item.adopted ? '✓' : '·'}
                    </span>
                    <span className={`text-sm ${item.adopted ? 'text-gray-300 line-through' : 'text-gray-500'}`}>
                      {item.text}
                    </span>
                  </li>
                );
              }

              // New-group parent (with or without subtasks) → adopt the whole group.
              const hasChildren = (childrenOf.get(item.id)?.length ?? 0) > 0;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2 py-1"
                  style={{ paddingLeft: item.indent_level * INDENT_PX }}
                >
                  <button
                    onClick={() => (item.adopted ? unadoptNewItem(item) : adoptNewItem(item))}
                    title={
                      item.adopted
                        ? 'Remove from todo list'
                        : hasChildren
                          ? 'Add task with its subtasks'
                          : 'Add to todo list'
                    }
                    className={`group/btn flex-shrink-0 w-4 h-4 rounded border text-xs flex items-center justify-center transition-colors ${
                      item.adopted
                        ? 'border-blue-300 bg-blue-50 text-blue-400 hover:border-red-300 hover:bg-red-50 hover:text-red-400'
                        : 'border-gray-300 text-gray-300 hover:border-blue-400 hover:text-blue-400'
                    }`}
                  >
                    {item.adopted ? (
                      <>
                        <span className="group-hover/btn:hidden leading-none">✓</span>
                        <span className="hidden group-hover/btn:inline leading-none">×</span>
                      </>
                    ) : (
                      '+'
                    )}
                  </button>
                  <span className={`text-sm ${item.adopted ? 'text-gray-300 line-through' : 'text-gray-500'}`}>
                    {item.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
