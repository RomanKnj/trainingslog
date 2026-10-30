-- Rangliste für den Trainingslog. Einmal im SQL Editor des Supabase-Projekts ausführen.
-- Die Tabellen sind von außen nicht lesbar oder schreibbar (RLS ohne Regeln, Rechte entzogen). Die Seite
-- spricht nur mit den Funktionen rl_* unten. Wer den Gruppen-Code kennt, sieht die Rangliste; ändern kann
-- ein Mitglied nur die eigene Zeile, dafür liegt ein geheimer Schlüssel auf dessen Gerät (hier nur als Hash).
-- Gespeichert werden Name und Ranglisten-Zahlen, keine Übungen und keine Gewichte.

create table public.rl_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.rl_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.rl_groups (id) on delete cascade,
  name text not null,
  secret_hash text not null,
  points integer not null default 0,
  visits_week integer not null default 0,
  visits_month integer not null default 0,
  streak_weeks integer not null default 0,
  week_start date,          -- zu welcher Woche visits_week gehört (Montag)
  month_key text,           -- zu welchem Monat visits_month gehört (JJJJ-MM)
  updated_at timestamptz not null default now()
);
create unique index rl_members_name on public.rl_members (group_id, lower(name));

alter table public.rl_groups enable row level security;
alter table public.rl_members enable row level security;
revoke all on public.rl_groups, public.rl_members from anon, authenticated;

create function public.rl_hash(p_secret text) returns text
language sql immutable set search_path = ''
as $$ select encode(extensions.digest(p_secret, 'sha256'), 'hex') $$;

create function public.rl_clean_name(p_name text) returns text
language plpgsql immutable set search_path = ''
as $$
declare v text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v) < 2 or char_length(v) > 24 then
    raise exception 'Name: 2 bis 24 Zeichen';
  end if;
  return v;
end $$;

create function public.rl_add_member(p_group uuid, p_name text) returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := public.rl_clean_name(p_name);
  v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if (select count(*) from public.rl_members where group_id = p_group) >= 30 then
    raise exception 'Gruppe ist voll (höchstens 30)';
  end if;
  if exists (select 1 from public.rl_members where group_id = p_group and lower(name) = lower(v_name)) then
    raise exception 'Dieser Name ist in der Gruppe schon vergeben';
  end if;
  insert into public.rl_members (group_id, name, secret_hash)
    values (p_group, v_name, public.rl_hash(v_secret)) returning id into v_id;
  return json_build_object('member_id', v_id, 'secret', v_secret, 'name', v_name);
end $$;

create function public.rl_create_group(p_group_name text, p_member_name text) returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne I, O, 0, 1
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
  v_group uuid;
begin
  if (select count(*) from public.rl_groups) >= 200 then
    raise exception 'Es können gerade keine Gruppen angelegt werden';
  end if;
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.rl_groups (code, name)
    values (v_code, public.rl_clean_name(p_group_name)) returning id into v_group;
  return public.rl_add_member(v_group, p_member_name)::jsonb
    || jsonb_build_object('code', v_code, 'group_name', public.rl_clean_name(p_group_name));
end $$;

create function public.rl_join_group(p_code text, p_member_name text) returns json
language plpgsql security definer set search_path = ''
as $$
declare v_group public.rl_groups;
begin
  select * into v_group from public.rl_groups where code = upper(trim(p_code));
  if not found then raise exception 'Diesen Gruppen-Code gibt es nicht'; end if;
  return public.rl_add_member(v_group.id, p_member_name)::jsonb
    || jsonb_build_object('code', v_group.code, 'group_name', v_group.name);
end $$;

create function public.rl_push(p_member_id uuid, p_secret text, p_points integer, p_visits_week integer,
                               p_visits_month integer, p_streak_weeks integer, p_week_start date, p_month_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_points not between 0 and 10000000 or p_visits_week not between 0 and 7 or p_visits_month not between 0 and 31
     or p_streak_weeks not between 0 and 5000 or p_month_key !~ '^\d{4}-\d{2}$' then
    raise exception 'Ungültige Werte';
  end if;
  update public.rl_members
     set points = p_points, visits_week = p_visits_week, visits_month = p_visits_month, streak_weeks = p_streak_weeks,
         week_start = p_week_start, month_key = p_month_key, updated_at = now()
   where id = p_member_id and secret_hash = public.rl_hash(p_secret);
  if not found then raise exception 'Mitglied nicht gefunden'; end if;
end $$;

create function public.rl_board(p_code text) returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object('group_name', g.name, 'members', coalesce((
    select json_agg(json_build_object('id', m.id, 'name', m.name, 'points', m.points, 'visits_week', m.visits_week,
             'visits_month', m.visits_month, 'streak_weeks', m.streak_weeks, 'week_start', m.week_start,
             'month_key', m.month_key, 'updated_at', m.updated_at) order by m.points desc)
    from public.rl_members m where m.group_id = g.id), '[]'::json))
  from public.rl_groups g where g.code = upper(trim(p_code))
$$;

create function public.rl_leave(p_member_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.rl_members where id = p_member_id and secret_hash = public.rl_hash(p_secret);
  if not found then raise exception 'Mitglied nicht gefunden'; end if;
end $$;

-- Nur diese fünf sind von außen aufrufbar, die Helfer nicht.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.rl_create_group(text, text), public.rl_join_group(text, text),
  public.rl_push(uuid, text, integer, integer, integer, integer, date, text),
  public.rl_board(text), public.rl_leave(uuid, text) to anon, authenticated;
