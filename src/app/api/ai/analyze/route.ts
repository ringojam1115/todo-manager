import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import OpenAI from 'openai';

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const cookieStore = await cookies();
  const supabase = makeSupabase(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date } = await req.json() as { date: string };
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  // Fetch todos from last 7 days up to target date
  const from = new Date(date + 'T00:00:00');
  from.setDate(from.getDate() - 7);
  const fromStr = from.toISOString().split('T')[0];

  const { data: todos, error: todosErr } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', fromStr)
    .lte('date', date)
    .order('date')
    .order('position');

  if (todosErr) return NextResponse.json({ error: todosErr.message }, { status: 500 });

  const todoIds = (todos ?? []).map((t) => t.id);
  let memos: Record<string, unknown>[] = [];
  if (todoIds.length > 0) {
    const { data: memosData } = await supabase
      .from('todo_memos')
      .select('*')
      .in('todo_id', todoIds)
      .order('created_at');
    memos = memosData ?? [];
  }

  const todosText = (todos ?? [])
    .map((t) => {
      const indent = '  '.repeat(t.indent_level);
      const status = t.completed ? '[x]' : '[ ]';
      const todoMemos = memos.filter((m) => m.todo_id === t.id);
      const memoLines = todoMemos
        .map((m) => `${indent}    memo: ${m.text}`)
        .join('\n');
      return `${indent}${status} ${t.text} (date: ${t.date})${memoLines ? '\n' + memoLines : ''}`;
    })
    .join('\n');

  const systemPrompt = `You are a productivity assistant. Analyze the user's todo history and extract a knowledge graph of tasks, habits, and patterns. Respond with JSON only.

Output format:
{
  "nodes": [{ "id": "string", "label": "string", "type": "task|habit|project|skill" }],
  "edges": [{ "from": "string", "to": "string", "relation": "string" }]
}`;

  const userPrompt = `Here are the user's todos from the past week:\n\n${todosText}\n\nExtract a knowledge graph capturing recurring tasks, projects, skills, and their relationships.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content ?? '{}';
  let graph: { nodes: unknown[]; edges: unknown[] };
  try {
    graph = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  const { data: graphData, error: graphErr } = await supabase
    .from('graphs')
    .insert({ user_id: user.id, nodes: graph.nodes ?? [], edges: graph.edges ?? [] })
    .select()
    .single();

  if (graphErr) return NextResponse.json({ error: graphErr.message }, { status: 500 });

  return NextResponse.json({ graph_id: graphData.id });
}
