-- Vigia's first-party analytics schema.
-- Visitor IP addresses are intentionally not part of this schema.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  verified_at timestamptz,
  verification_method text check (
    verification_method is null
    or verification_method in ('dns_txt', 'meta_tag', 'file')
  ),
  created_at timestamptz not null default now(),
  constraint sites_domain_format check (
    length(domain) between 4 and 253
    and domain = lower(domain)
    and domain !~ '[/@:?#]'
  ),
  constraint sites_verification_state check (
    (verified_at is null and verification_method is null)
    or (verified_at is not null and verification_method is not null)
  )
);

create unique index if not exists sites_domain_unique
  on public.sites (domain);

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  event_type text not null default 'page_view'
    check (event_type in ('page_view', 'page_exit')),
  -- Random, short-lived visitor session identifier; not an account identifier.
  visitor_session_id uuid not null,
  page_path text not null check (length(page_path) between 1 and 2048),
  occurred_at timestamptz not null default now(),
  page_duration_seconds integer
    check (page_duration_seconds is null or page_duration_seconds between 0 and 86400),
  referrer_domain text check (
    referrer_domain is null or length(referrer_domain) <= 253
  ),
  country_code text check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  city text check (city is null or length(city) <= 120),
  provider text check (provider is null or length(provider) <= 160)
);

create index if not exists site_events_site_time_idx
  on public.site_events (site_id, occurred_at desc);
create index if not exists site_events_session_idx
  on public.site_events (site_id, visitor_session_id, occurred_at desc);

create table if not exists public.live_visitors (
  visitor_session_id uuid primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  page_path text not null check (length(page_path) between 1 and 2048),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  country_code text check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  city text check (city is null or length(city) <= 120),
  provider text check (provider is null or length(provider) <= 160),
  constraint live_visitor_expiry_order check (expires_at > last_seen_at)
);

create index if not exists live_visitors_site_expiry_idx
  on public.live_visitors (site_id, expires_at);

create table if not exists public.site_verification_challenges (
  site_id uuid primary key references public.sites (id) on delete cascade,
  method text not null check (method in ('dns_txt', 'meta_tag', 'file')),
  token_digest text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.sites enable row level security;
alter table public.site_events enable row level security;
alter table public.live_visitors enable row level security;
alter table public.site_verification_challenges enable row level security;

drop policy if exists "Owners can read their sites" on public.sites;
create policy "Owners can read their sites"
  on public.sites for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owners can register unverified sites" on public.sites;
create policy "Owners can register unverified sites"
  on public.sites for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and verified_at is null
    and verification_method is null
  );

drop policy if exists "Owners can delete their sites" on public.sites;
create policy "Owners can delete their sites"
  on public.sites for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owners can read their site's events" on public.site_events;
create policy "Owners can read their site's events"
  on public.site_events for select to authenticated
  using (
    exists (
      select 1
      from public.sites
      where sites.id = site_events.site_id
        and sites.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can read active visitors on their sites" on public.live_visitors;
create policy "Owners can read active visitors on their sites"
  on public.live_visitors for select to authenticated
  using (
    expires_at > now()
    and exists (
      select 1
      from public.sites
      where sites.id = live_visitors.site_id
        and sites.owner_id = (select auth.uid())
    )
  );

-- Browser clients may read only their own rows. Ingestion, presence updates,
-- challenge management, and setting verified_at are reserved for a trusted server.
revoke all on public.sites from anon, authenticated;
revoke all on public.site_events from anon, authenticated;
revoke all on public.live_visitors from anon, authenticated;
revoke all on public.site_verification_challenges from anon, authenticated;

grant select, insert, delete on public.sites to authenticated;
grant select on public.site_events to authenticated;
grant select on public.live_visitors to authenticated;

grant all on public.sites to service_role;
grant all on public.site_events to service_role;
grant all on public.live_visitors to service_role;
grant all on public.site_verification_challenges to service_role;
grant usage, select on sequence public.site_events_id_seq to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_visitors'
  ) then
    alter publication supabase_realtime add table public.live_visitors;
  end if;
end
$$;
