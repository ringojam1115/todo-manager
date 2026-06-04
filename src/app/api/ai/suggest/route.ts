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

  const { graph_id, target_date, language } = await req.json() as { graph_id: string; target_date: string; language?: string };
  if (!graph_id || !target_date) {
    return NextResponse.json({ error: 'graph_id and target_date required' }, { status: 400 });
  }
  const lang = language ?? 'Japanese';

  const { data: graph, error: graphErr } = await supabase
    .from('graphs')
    .select('*')
    .eq('id', graph_id)
    .single();

  if (graphErr || !graph) return NextResponse.json({ error: 'Graph not found' }, { status: 404 });

  const { data: existingTodos } = await supabase
    .from('todos')
    .select('id, text, completed, indent_level, position')
    .eq('user_id', user.id)
    .eq('date', target_date)
    .order('position');

  const graphSummary = JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2);
  const existingList = (existingTodos ?? [])
    .map((t) => `${'  '.repeat(t.indent_level)}${t.completed ? '[x]' : '[ ]'} ${t.text}`)
    .join('\n');

  const systemPrompt = `You are a productivity assistant. Based on the user's knowledge graph of tasks and habits, suggest todos for the target date. Respond with JSON only. Write all todo text in ${lang}.

Output format:
{
  "new_groups": [
    { "parent": "string", "subtasks": ["string", ...] }
  ],
  "existing_task_subtasks": [
    { "existing": "exact text of an existing todo", "subtasks": ["string", ...] }
  ]
}

Rules:
- "new_groups": brand-new task ideas. Every group MUST have a "parent". "subtasks" may be empty (parent only) or list 1-4 actionable subtasks. NEVER produce subtasks without a parent.
- "existing_task_subtasks": OPTIONAL — include only when you can genuinely break an existing todo into useful subtasks. "existing" MUST exactly match the text of one of the existing todos listed below, and the group MUST have at least one subtask. Omit this key entirely if there is nothing useful to add.
- Suggest 3-8 items in total across both sections.
- Be specific and actionable.
- Do not repeat todos already on the list.`;

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
  type NewGroup = { parent?: string; subtasks?: string[] };
  type ExistingGroup = { existing?: string; subtasks?: string[] };
  let parsed: { new_groups?: NewGroup[]; existing_task_subtasks?: ExistingGroup[] };
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

  type ItemRow = {
    suggestion_id: string;
    text: string;
    indent_level: number;
    order: number;
    adopted: boolean;
    existing_todo_id?: string;
    parent_existing_todo_id?: string;
  };
  const items: ItemRow[] = [];
  let order = 0;

  // New task groups: parent (+ optional subtasks). Never subtask-only.
  for (const group of parsed.new_groups ?? []) {
    const parent = group.parent?.trim();
    if (!parent) continue;
    items.push({ suggestion_id: suggestion.id, text: parent, indent_level: 0, order: order++, adopted: false });
    for (const sub of group.subtasks ?? []) {
      const text = sub?.trim();
      if (!text) continue;
      items.push({ suggestion_id: suggestion.id, text, indent_level: 1, order: order++, adopted: false });
    }
  }

  // Subtasks for existing todos: a read-only parent row + adoptable subtasks.
  for (const group of parsed.existing_task_subtasks ?? []) {
    const match = (existingTodos ?? []).find((t) => t.text === group.existing);
    const subtasks = (group.subtasks ?? []).map((s) => s?.trim()).filter(Boolean) as string[];
    if (!match || subtasks.length === 0) continue;
    items.push({
      suggestion_id: suggestion.id,
      text: match.text,
      indent_level: match.indent_level,
      order: order++,
      adopted: false,
      existing_todo_id: match.id,
    });
    for (const text of subtasks) {
      items.push({
        suggestion_id: suggestion.id,
        text,
        indent_level: Math.min(4, match.indent_level + 1),
        order: order++,
        adopted: false,
        parent_existing_todo_id: match.id,
      });
    }
  }

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
