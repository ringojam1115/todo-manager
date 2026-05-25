create table todos (
  id uuid default gen_random_uuid() primary key,
  text text not null default '',
  completed boolean not null default false,
  indent_level integer not null default 0,
  date date not null,
  -- float8 allows fractional positions so insertions never require shifting other rows
  position float8 not null default 0,
  created_at timestamptz not null default now()
);

alter table todos enable row level security;

-- Open policy for development — restrict by auth.uid() in production
create policy "allow_all" on todos
  for all using (true) with check (true);
