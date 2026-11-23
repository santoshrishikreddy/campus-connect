-- Campus Connect schema and atomic event registration contract.
create extension if not exists pgcrypto;

create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null unique,
    role text
);

create table if not exists public.events (
    id uuid primary key default gen_random_uuid(),
    organizer_id uuid not null references public.users(id) on delete cascade,
    title text not null,
    capacity integer check (capacity is null or capacity >= 0),
    status text
);

create table if not exists public.registrations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    event_id uuid not null references public.events(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint registrations_user_event_unique unique (user_id, event_id)
);

create index if not exists events_organizer_id_idx on public.events (organizer_id);
create index if not exists registrations_event_id_idx on public.registrations (event_id);

-- Keep the application profile row aligned with Supabase Auth identities.
create or replace function public.create_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.users (id, email)
    values (new.id, coalesce(new.email, new.phone, new.id::text))
    on conflict (id) do update set email = excluded.email;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert or update of email on auth.users
for each row execute function public.create_user_profile();

alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;

drop policy if exists "users read own profile" on public.users;
create policy "users read own profile" on public.users
    for select to authenticated using (id = (select auth.uid()));
drop policy if exists "events are publicly readable" on public.events;
create policy "events are publicly readable" on public.events
    for select to anon, authenticated using (true);
drop policy if exists "organizers create their events" on public.events;
create policy "organizers create their events" on public.events
    for insert to authenticated with check (organizer_id = (select auth.uid()));
drop policy if exists "organizers update their events" on public.events;
create policy "organizers update their events" on public.events
    for update to authenticated using (organizer_id = (select auth.uid()))
    with check (organizer_id = (select auth.uid()));
drop policy if exists "organizers delete their events" on public.events;
create policy "organizers delete their events" on public.events
    for delete to authenticated using (organizer_id = (select auth.uid()));
drop policy if exists "users read own registrations" on public.registrations;
create policy "users read own registrations" on public.registrations
    for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "users cancel own registrations" on public.registrations;
create policy "users cancel own registrations" on public.registrations
    for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.users to authenticated;
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select, delete on public.registrations to authenticated;

-- The event row lock serializes capacity checks for concurrent requests.
create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_capacity integer;
    v_status text;
    v_registered_count integer;
    v_registration public.registrations;
begin
    if v_user_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    select capacity, status into v_capacity, v_status
    from public.events where id = p_event_id for update;
    if not found then
        raise exception 'Event not found' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.registrations where user_id = v_user_id and event_id = p_event_id) then
        raise exception 'Duplicate registration' using errcode = 'P0001';
    end if;

    if v_capacity is not null then
        select count(*) into v_registered_count
        from public.registrations where event_id = p_event_id;
        if v_registered_count >= v_capacity then
            raise exception 'Event is full' using errcode = 'P0001';
        end if;
    end if;

    insert into public.registrations (user_id, event_id)
    values (v_user_id, p_event_id) returning * into v_registration;
    return v_registration;
end;
$$;

revoke all on function public.register_for_event(uuid) from public, anon;
grant execute on function public.register_for_event(uuid) to authenticated;
