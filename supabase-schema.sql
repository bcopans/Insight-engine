-- Run this in your Supabase SQL editor

create table sessions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  roadmap_name text,
  roadmap_items jsonb default '[]',
  themes jsonb default '[]',
  probing_questions jsonb default '[]',
  roadmap_analysis jsonb default '[]',
  new_opportunities jsonb default '[]',
  session_count integer default 0
);

-- Enable row level security (optional but recommended)
alter table sessions enable row level security;

-- Allow all operations for now (tighten this when you add auth)
create policy "Allow all" on sessions for all using (true);
