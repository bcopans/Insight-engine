-- Run this in your Supabase SQL editor

create table sessions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  session_count integer default 0,
  themes jsonb default '[]',
  probing_questions jsonb default '[]',
  research_gaps jsonb default '[]',
  recommendations jsonb default '[]',
  engineer_estimates jsonb default '[]',
  global_flags jsonb default '[]',
  director_challenges jsonb default '[]',
  director_assessment text,
  director_top_priority text,
  director_biggest_concern text,
  rebuttals jsonb default '[]',
  final_summary text,
  roadmap_items jsonb default '[]',
  roadmap_analysis jsonb default '[]',
  roadmap_conflicts jsonb default '[]',
  strategic_gaps jsonb default '[]'
);

alter table sessions enable row level security;
create policy "Allow all" on sessions for all using (true);
