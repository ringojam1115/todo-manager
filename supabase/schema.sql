-- Reference: actual table structure as of 2026-05-25
-- Run in Supabase SQL Editor only if building from scratch.

create table todos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  text          text not null default '',
  date          date not null,
  completed     boolean not null default false,
  indent_level  integer not null default 0,
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table todo_memos (
  id          uuid primary key default gen_random_uuid(),
  todo_id     uuid references todos(id) on delete cascade,
  text        text not null default '',
  is_pre_edit boolean not null default false,
  created_at  timestamptz not null default now()
);

create table graphs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  nodes      jsonb not null default '[]',
  edges      jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  graph_id    uuid references graphs(id) on delete cascade,
  target_date date not null,
  created_at  timestamptz not null default now()
);

create table suggestion_items (
  id              uuid primary key default gen_random_uuid(),
  suggestion_id   uuid references suggestions(id) on delete cascade,
  text            text not null default '',
  indent_level    integer not null default 0,
  "order"         integer not null default 0,
  adopted         boolean not null default false,
  adopted_at      timestamptz,
  adopted_todo_id uuid references todos(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Open RLS policy for development — restrict by auth.uid() in production
alter table todos enable row level security;
create policy "allow_all" on todos for all using (true) with check (true);
