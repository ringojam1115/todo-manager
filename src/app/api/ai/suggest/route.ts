import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  const cookieStore = await cookies();
  const supabase = makeSupabase(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { graph_id, target_date } = await req.json() as { graph_id: string; target_date: string };
  if (!graph_id || !target_date) {
    return NextResponse.json({ error: 'graph_id and target_date required' }, { status: 400 });
  }

  const { data: graph, error: graphErr } = await supabase
    .from('graphs')
    .select('*')
    .eq('id', graph_id)
    .single();

  if (graphErr || !graph) return NextResponse.json({ error: 'Graph not found' }, { status: 404 });

  const { data: existingTodos } = await supabase
    .from('todos')
    .select('text, completed, indent_level')
    .eq('user_id', user.id)
    .eq('date', target_date)
    .order('position');

  const graphSummary = JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2);
  const existingList = (existingTodos ?? [])
    .map((t) => `${'  '.repeat(t.indent_level)}${t.completed ? '[x]' : '[ ]'} ${t.text}`)
    .join('\n');

  const systemPrompt = `You are a productivity assistant. Based on the user's knowledge graph of tasks and habits, suggest a todo list for the target date. Respond with JSON only.

Output format:
{
  "items": [
    { "text": "string", "indent_level": 0 }
  ]
}

Rules:
- Suggest 3-8 actionable todos
- Use indent_level 0 for top-level tasks, 1+ for subtasks
- Be specific and actionable
- Do not repeat todos already on the list`;

  const userPrompt = `Knowledge graph:\n${graphSummary}\n\nTarget date: ${target_date}\n\nExisting todos for this date:\n${existingList || '(none yet)'}\n\nSuggest additional todos for this date.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content ?? '{}';
  let parsed: { items: { text: string; indent_level: number }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  const { data: suggestion, error: suggErr } = await supabase
    .from('suggestions')
    .insert({ user_id: user.id, graph_id, target_date })
    .select()
    .single();

  if (suggErr || !suggestion) return NextResponse.json({ error: suggErr?.message }, { status: 500 });

  const items = (parsed.items ?? []).map((item, i) => ({
    suggestion_id: suggestion.id,
    text: item.text,
    indent_level: Math.max(0, Math.min(4, item.indent_level ?? 0)),
    order: i,
    adopted: false,
  }));

  if (items.length > 0) {
    const { error: itemsErr } = await supabase.from('suggestion_items').insert(items);
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const { data: savedItems } = await supabase
    .from('suggestion_items')
    .select('*')
    .eq('suggestion_id', suggestion.id)
    .order('order');

  return NextResponse.json({ suggestion_id: suggestion.id, items: savedItems ?? [] });
}
