-- Stash collaboration backend (run once in Supabase › SQL Editor)
create extension if not exists citext;

-- ---------- profiles: one per account; usernames are unique forever-ish ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check (username ~ '^[a-z0-9](?:[a-z0-9]|[._](?![._])){1,18}[a-z0-9]$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color text default '#4f86e8',
  photo text,
  created_at timestamptz not null default now()
);

-- ---------- spaces: a shared folder or a single shared document ----------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'folder' check (kind in ('folder','doc')),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.space_members (
  space_id uuid references public.spaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create table if not exists public.space_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  type text not null check (type in ('note','link','image','doc','video')),
  title text not null default '',
  body text not null default '',
  link text, ext text, mime text, fname text, size bigint, dur text,
  file_path text,          -- in storage bucket "shared"
  thumb text,              -- small preview (data URL)
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.item_history (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.space_items(id) on delete cascade,
  user_id uuid references public.profiles(id),
  title text, body text,
  created_at timestamptz not null default now()
);
create index if not exists space_items_space on public.space_items(space_id);
create index if not exists item_history_item on public.item_history(item_id, created_at desc);
create index if not exists members_user on public.space_members(user_id);

-- ---------- helpers ----------
create or replace function public.is_member(s uuid) returns boolean
language sql security definer stable set search_path = public as
$$ select exists(select 1 from space_members where space_id = s and user_id = auth.uid()) $$;

create or replace function public.add_owner() returns trigger
language plpgsql security definer set search_path = public as
$$ begin insert into space_members(space_id, user_id, role, added_by) values (new.id, new.owner, 'owner', new.owner); return new; end $$;
drop trigger if exists spaces_add_owner on public.spaces;
create trigger spaces_add_owner after insert on public.spaces for each row execute function public.add_owner();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_items enable row level security;
alter table public.item_history enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "spaces read" on public.spaces;
create policy "spaces read" on public.spaces for select to authenticated using (is_member(id) or owner = auth.uid());
drop policy if exists "spaces create" on public.spaces;
create policy "spaces create" on public.spaces for insert to authenticated with check (owner = auth.uid());
drop policy if exists "spaces rename" on public.spaces;
create policy "spaces rename" on public.spaces for update to authenticated using (is_member(id));
drop policy if exists "spaces delete" on public.spaces;
create policy "spaces delete" on public.spaces for delete to authenticated using (owner = auth.uid());

drop policy if exists "members read" on public.space_members;
create policy "members read" on public.space_members for select to authenticated using (is_member(space_id));
drop policy if exists "members invite" on public.space_members;
create policy "members invite" on public.space_members for insert to authenticated with check (is_member(space_id) and role = 'editor' and added_by = auth.uid());
drop policy if exists "members remove" on public.space_members;
create policy "members remove" on public.space_members for delete to authenticated
  using (user_id = auth.uid() or exists(select 1 from spaces s where s.id = space_id and s.owner = auth.uid()));

drop policy if exists "items all" on public.space_items;
create policy "items all" on public.space_items for all to authenticated using (is_member(space_id)) with check (is_member(space_id));

drop policy if exists "history read" on public.item_history;
create policy "history read" on public.item_history for select to authenticated
  using (exists(select 1 from space_items i where i.id = item_id and is_member(i.space_id)));
drop policy if exists "history write" on public.item_history;
create policy "history write" on public.item_history for insert to authenticated
  with check (user_id = auth.uid() and exists(select 1 from space_items i where i.id = item_id and is_member(i.space_id)));

-- ---------- file storage for shared images/videos/docs ----------
insert into storage.buckets (id, name, public) values ('shared', 'shared', false) on conflict (id) do nothing;
drop policy if exists "shared files read" on storage.objects;
create policy "shared files read" on storage.objects for select to authenticated
  using (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "shared files write" on storage.objects;
create policy "shared files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "shared files delete" on storage.objects;
create policy "shared files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------- live updates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.space_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.space_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.spaces; exception when duplicate_object then null; end;
end $$;
alter table public.space_items replica identity full;
alter table public.space_members replica identity full;

-- ---------- API access (RLS above decides what each person can actually touch) ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.spaces, public.space_members, public.space_items, public.item_history to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
-- rich notes (pages with blocks + free objects)
alter table public.space_items add column if not exists doc jsonb;
alter table public.item_history add column if not exists doc jsonb;
select 'stash setup ok' as result;
