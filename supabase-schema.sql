-- Run this in your Supabase SQL editor
-- Drop old tables if you want a fresh start
-- drop table if exists sessions;
-- drop table if exists documents;

-- Documents table: stores uploaded files + per-file research
create table documents (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text not null,
  extracted_text text,
  themes jsonb default '[]',
  document_summary text,
  key_source text,
  file_size integer,
  mime_type text
);

-- Sessions table: stores full analysis snapshots
create table sessions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  master_themes jsonb default '[]',
  probing_questions jsonb default '[]',
  research_gaps jsonb default '[]',
  cross_cutting_insights jsonb default '[]',
  recommendations jsonb default '[]',
  engineer_estimates jsonb default '[]',
  director_challenges jsonb default '[]',
  rebuttals jsonb default '[]',
  final_summary text,
  roadmap_items jsonb default '[]',
  roadmap_analysis jsonb default '[]',
  roadmap_conflicts jsonb default '[]',
  strategic_gaps jsonb default '[]'
);

-- RLS
alter table documents enable row level security;
alter table sessions enable row level security;
create policy "Allow all" on documents for all using (true);
create policy "Allow all" on sessions for all using (true);
