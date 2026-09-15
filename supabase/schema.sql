create extension if not exists vector;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'intern' check (role in ('admin', 'intern')),
  api_key_encrypted text,
  api_key_iv text,
  api_key_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create table if not exists public.kb_sources (
  id text primary key,
  source_type text not null,
  source_title text not null,
  source_path text not null,
  source_url text,
  status text not null,
  updated_at timestamptz not null,
  metadata jsonb
);

create table if not exists public.kb_chunks (
  id text primary key,
  content text not null,
  source_id text not null references public.kb_sources(id) on delete cascade,
  source_path text not null,
  source_type text not null,
  source_title text not null,
  source_url text,
  chunk_index integer not null,
  embedding vector(1536),
  metadata jsonb
);

alter table public.kb_sources enable row level security;
alter table public.kb_chunks enable row level security;

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 10);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index if not exists conversation_messages_conversation_created_idx on public.conversation_messages(conversation_id, created_at);
