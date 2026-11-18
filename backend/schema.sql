-- Campus Connect schema based on ../database.png.
-- Run this in the Supabase SQL Editor. The policies below intentionally allow
-- unauthenticated public CRUD, matching the requested no-auth API.

create extension if not exists pgcrypto;

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    role text
);

create table if not exists public.events (
    id uuid primary key default gen_random_uuid(),
    organizer_id uuid references public.users(id) on delete set null,
    title text not null,
    capacity integer,
    status text
);

create table if not exists public.registrations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    event_id uuid not null references public.events(id) on delete cascade,
    created_at timestamptz not null default now()
);

create index if not exists events_organizer_id_idx
    on public.events (organizer_id);
create index if not exists registrations_user_id_idx
    on public.registrations (user_id);
create index if not exists registrations_event_id_idx
    on public.registrations (event_id);

alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;

drop policy if exists "public users access" on public.users;
create policy "public users access" on public.users
    for all to anon, authenticated using (true) with check (true);

drop policy if exists "public events access" on public.events;
create policy "public events access" on public.events
    for all to anon, authenticated using (true) with check (true);

drop policy if exists "public registrations access" on public.registrations;
create policy "public registrations access" on public.registrations
    for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.users to anon, authenticated;
grant select, insert, update, delete on public.events to anon, authenticated;
grant select, insert, update, delete on public.registrations to anon, authenticated;
