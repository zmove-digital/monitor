-- Tokens de notificação (FCM) dos dispositivos dos donos de sites.
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id) where enabled;

alter table public.push_tokens enable row level security;

drop policy if exists "Owners manage their push tokens" on public.push_tokens;
create policy "Owners manage their push tokens"
  on public.push_tokens
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
