'use client';

import { useEffect, useState } from 'react';
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

  async function generate() {
    setLoading(true);
    setError(null);
    setItems([]);
    setOpen(true);

    try {
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
      setItems(newItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function adoptItem(item: SuggestionItem) {
    const { data: existingTodos } = await supabase
      .from('todos')
      .select('position')
      .eq('date', date)
      .order('position', { ascending: false })
      .limit(1);

    const lastPosition = existingTodos?.[0]?.position ?? 0;
    const { data: { user } } = await supabase.auth.getUser();

    const { data: todo, error: todoErr } = await supabase
      .from('todos')
      .insert({
        text: item.text,
        completed: false,
        indent_level: item.indent_level,
        date,
        position: lastPosition + 1,
        updated_at: new Date().toISOString(),
        user_id: user?.id ?? null,
      })
      .select()
      .single();

    if (todoErr || !todo) return;

    await supabase
      .from('suggestion_items')
      .update({ adopted: true, adopted_todo_id: todo.id, adopted_at: new Date().toISOString() })
      .eq('id', item.id);

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, adopted: true, adopted_todo_id: todo.id } : i)));
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
            <span className="text-sm leading-none">{loading ? '…' : '↻'}</span>
            <span>{loading ? 'Generating…' : open ? 'Regenerate' : 'Generate'}</span>
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-2">{error}</p>
        )}

        {open && !loading && items.length === 0 && !error && (
          <p className="text-sm text-gray-300">No suggestions generated.</p>
        )}

        {items.length > 0 && (
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 py-1"
                style={{ paddingLeft: item.indent_level * INDENT_PX }}
              >
                <button
                  onClick={() => !item.adopted && adoptItem(item)}
                  disabled={item.adopted}
                  title={item.adopted ? 'Adopted' : 'Add to todo list'}
                  className={`flex-shrink-0 w-4 h-4 rounded border text-xs flex items-center justify-center transition-colors ${
                    item.adopted
                      ? 'border-blue-300 bg-blue-50 text-blue-400 cursor-default'
                      : 'border-gray-300 text-gray-300 hover:border-blue-400 hover:text-blue-400'
                  }`}
                >
                  {item.adopted ? '✓' : '+'}
                </button>
                <span className={`text-sm ${item.adopted ? 'text-gray-300 line-through' : 'text-gray-500'}`}>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
