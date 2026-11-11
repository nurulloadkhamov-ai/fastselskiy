-- =====================================================================
-- Fast Education — adolatli baholash tizimi: Supabase sozlamasi
-- Supabase → SQL Editor → New query → shu faylni to'liq qo'ying → Run
-- Skriptni qayta ishga tushirish xavfsiz (ma'lumotlar o'chmaydi).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Jadvallar ----------
create table if not exists public.app_state(
  id int primary key default 1 check (id = 1),
  data jsonb,
  version int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_state(id, data, version) values (1, null, 0) on conflict (id) do nothing;

create table if not exists public.accounts(
  username   text primary key,
  pass_hash  text not null,
  role       text not null check (role in ('admin','teacher','staff')),
  person_id  text,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions(
  token      uuid primary key default gen_random_uuid(),
  username   text not null references public.accounts(username) on delete cascade on update cascade,
  expires_at timestamptz not null
);

create table if not exists public.duty_logs(
  day     date not null,
  duty_id text not null,
  status  text not null check (status in ('d','l')),
  at      text,
  by_user text,
  primary key (day, duty_id)
);

-- Jadvallarga to'g'ridan-to'g'ri kirish yopiq: faqat quyidagi funksiyalar orqali
alter table public.app_state enable row level security;
alter table public.accounts  enable row level security;
alter table public.sessions  enable row level security;
alter table public.duty_logs enable row level security;
revoke all on public.app_state, public.accounts, public.sessions, public.duty_logs from anon, authenticated;

-- Boshlang'ich admin: login "admin", parol "fast2026" (kirgach albatta o'zgartiring!)
insert into public.accounts(username, pass_hash, role, person_id)
values ('admin', extensions.crypt('fast2026', extensions.gen_salt('bf')), 'admin', null)
on conflict (username) do nothing;

-- ---------- Ichki yordamchilar ----------
create or replace function public._session(p_token uuid)
returns public.accounts language sql stable security definer
set search_path = public, extensions as $$
  select a.* from public.sessions s join public.accounts a on a.username = s.username
  where s.token = p_token and s.expires_at > now()
$$;

create or replace function public._require(p_token uuid, p_admin boolean)
returns public.accounts language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  select * into a from public._session(p_token);
  if a.username is null then raise exception 'no_session'; end if;
  if p_admin and a.role <> 'admin' then raise exception 'not_admin'; end if;
  return a;
end $$;

create or replace function public._local_now()
returns timestamp language sql stable as $$ select now() at time zone 'Asia/Tashkent' $$;

revoke execute on function public._session(uuid), public._require(uuid, boolean), public._local_now() from public, anon, authenticated;

-- ---------- Kirish / chiqish ----------
create or replace function public.login(p_username text, p_password text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; t uuid;
begin
  select * into a from public.accounts where username = lower(trim(p_username));
  if a.username is null or a.pass_hash <> extensions.crypt(p_password, a.pass_hash) then
    perform pg_sleep(0.7);
    raise exception 'login_failed';
  end if;
  delete from public.sessions where expires_at < now();
  insert into public.sessions(username, expires_at) values (a.username, now() + interval '30 days') returning token into t;
  return jsonb_build_object('token', t, 'username', a.username, 'role', a.role, 'person_id', a.person_id);
end $$;

create or replace function public.logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.sessions where token = p_token
$$;

create or replace function public.change_password(p_token uuid, p_old text, p_new text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  if a.pass_hash <> extensions.crypt(p_old, a.pass_hash) then raise exception 'wrong_password'; end if;
  if length(p_new) < 6 then raise exception 'short_password'; end if;
  update public.accounts set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf')) where username = a.username;
  delete from public.sessions where username = a.username and token <> p_token;
end $$;

-- ---------- Ma'lumotlarni o'qish ----------
create or replace function public.get_state(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; v int; lg jsonb; ln timestamp := public._local_now();
begin
  a := public._require(p_token, false);
  select data, version into d, v from public.app_state where id = 1;
  select coalesce(jsonb_object_agg(to_char(day,'YYYY-MM-DD') || '|' || duty_id, jsonb_build_object('s', status, 'at', at)), '{}'::jsonb)
    into lg from public.duty_logs where day >= (ln::date - 45);
  -- Shikoyatlar matni: admin hammasini, ustoz faqat o'zinikini ko'radi, xodim ko'rmaydi
  if a.role <> 'admin' and d is not null then
    d := jsonb_set(d, '{complaints}', coalesce((
      select jsonb_agg(c) from jsonb_array_elements(coalesce(d->'complaints','[]'::jsonb)) c
      where a.role = 'teacher' and c->>'teacherId' = a.person_id), '[]'::jsonb));
  end if;
  return jsonb_build_object('data', d, 'version', v, 'logs', lg,
    'today', to_char(ln, 'YYYY-MM-DD'), 'now', to_char(ln, 'HH24:MI'),
    'me', jsonb_build_object('username', a.username, 'role', a.role, 'person_id', a.person_id));
end $$;

-- ---------- Admin: ma'lumotlarni saqlash ----------
create or replace function public.admin_save(p_token uuid, p_data jsonb, p_version int)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare nv int;
begin
  perform public._require(p_token, true);
  update public.app_state set data = p_data, version = version + 1, updated_at = now()
   where id = 1 and version = p_version returning version into nv;
  if nv is null then return jsonb_build_object('conflict', true); end if;
  return jsonb_build_object('version', nv);
end $$;

create or replace function public.admin_replace_logs(p_token uuid, p_logs jsonb)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  perform public._require(p_token, true);
  delete from public.duty_logs where true;
  insert into public.duty_logs(day, duty_id, status, at, by_user)
  select split_part(key, '|', 1)::date, split_part(key, '|', 2), value->>'s', value->>'at', 'demo'
  from jsonb_each(coalesce(p_logs, '{}'::jsonb));
end $$;

-- ---------- Kunlik vazifani belgilash ----------
create or replace function public.tick(p_token uuid, p_day date, p_duty_id text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; duty jsonb; cur public.duty_logs; ln timestamp := public._local_now();
        late_min int; due int; nowm int; st text; atv text;
begin
  a := public._require(p_token, false);
  select data into d from public.app_state where id = 1;
  select x into duty from jsonb_array_elements(coalesce(d->'duties','[]'::jsonb)) x where x->>'id' = p_duty_id limit 1;
  if duty is null then raise exception 'duty_not_found'; end if;
  select * into cur from public.duty_logs where day = p_day and duty_id = p_duty_id;

  if a.role <> 'admin' then
    if a.role <> 'staff' or duty->>'staffId' is distinct from a.person_id then raise exception 'not_allowed'; end if;
    if p_day <> ln::date then raise exception 'only_today'; end if;
    if cur.duty_id is not null then
      delete from public.duty_logs where day = p_day and duty_id = p_duty_id;
      return jsonb_build_object('log', null);
    end if;
    -- Kechikish server vaqti bo'yicha hisoblanadi (Toshkent vaqti)
    late_min := coalesce((d->'settings'->>'lateMin')::int, 30);
    due  := split_part(duty->>'time', ':', 1)::int * 60 + split_part(duty->>'time', ':', 2)::int;
    nowm := extract(hour from ln)::int * 60 + extract(minute from ln)::int;
    st := case when nowm > due + late_min then 'l' else 'd' end;
    atv := to_char(ln, 'HH24:MI');
  else
    if cur.duty_id is null then
      st := 'd'; atv := case when p_day = ln::date then to_char(ln, 'HH24:MI') else duty->>'time' end;
    elsif cur.status = 'd' then
      st := 'l'; atv := cur.at;
    else
      delete from public.duty_logs where day = p_day and duty_id = p_duty_id;
      return jsonb_build_object('log', null);
    end if;
  end if;
  insert into public.duty_logs(day, duty_id, status, at, by_user) values (p_day, p_duty_id, st, atv, a.username)
  on conflict (day, duty_id) do update set status = excluded.status, at = excluded.at, by_user = excluded.by_user;
  return jsonb_build_object('log', jsonb_build_object('s', st, 'at', atv));
end $$;

-- ---------- Topshiriq holatini o'zgartirish ----------
create or replace function public.set_task_status(p_token uuid, p_task_id text, p_status text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; t jsonb; idx int; nv int; ln timestamp := public._local_now();
begin
  a := public._require(p_token, false);
  if p_status not in ('yangi','jarayonda','bajarildi') then raise exception 'bad_status'; end if;
  select data into d from public.app_state where id = 1 for update;
  select x, (o - 1)::int into t, idx from jsonb_array_elements(coalesce(d->'tasks','[]'::jsonb)) with ordinality as e(x, o)
   where x->>'id' = p_task_id limit 1;
  if t is null then raise exception 'task_not_found'; end if;
  if a.role <> 'admin' then
    if t->>'type' <> a.role or t->>'assigneeId' is distinct from a.person_id then raise exception 'not_allowed'; end if;
    if t->>'status' = 'bajarildi' then raise exception 'already_done'; end if;
    if p_status = 'yangi' then raise exception 'not_allowed'; end if;
  end if;
  t := t || jsonb_build_object('status', p_status,
         'doneAt', case when p_status = 'bajarildi' then to_jsonb(to_char(ln, 'YYYY-MM-DD')) else 'null'::jsonb end);
  update public.app_state set data = jsonb_set(d, array['tasks', idx::text], t), version = version + 1, updated_at = now()
   where id = 1 returning version into nv;
  return jsonb_build_object('version', nv, 'task', t);
end $$;

-- ---------- Admin: foydalanuvchilar ----------
create or replace function public.list_accounts(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  perform public._require(p_token, true);
  return coalesce((select jsonb_agg(jsonb_build_object('username', username, 'role', role, 'person_id', person_id) order by role, username)
                   from public.accounts), '[]'::jsonb);
end $$;

create or replace function public.upsert_account(p_token uuid, p_username text, p_password text, p_role text, p_person_id text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare u text := lower(trim(p_username)); ex public.accounts; me public.accounts;
begin
  me := public._require(p_token, true);
  if u !~ '^[a-z0-9._-]{3,32}$' then raise exception 'bad_username'; end if;
  if p_role not in ('admin','teacher','staff') then raise exception 'bad_role'; end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then raise exception 'short_password'; end if;
  select * into ex from public.accounts where username = u;
  if ex.username is null then
    if p_password is null or p_password = '' then raise exception 'password_required'; end if;
    insert into public.accounts(username, pass_hash, role, person_id)
    values (u, extensions.crypt(p_password, extensions.gen_salt('bf')), p_role, nullif(p_person_id, ''));
  else
    if ex.username = me.username and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
    update public.accounts set role = p_role, person_id = nullif(p_person_id, ''),
      pass_hash = case when p_password is null or p_password = '' then pass_hash else extensions.crypt(p_password, extensions.gen_salt('bf')) end
     where username = u;
    if p_password is not null and p_password <> '' then delete from public.sessions where username = u; end if;
  end if;
end $$;

create or replace function public.delete_account(p_token uuid, p_username text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._require(p_token, true);
  if lower(p_username) = me.username then raise exception 'cannot_delete_self'; end if;
  delete from public.accounts where username = lower(p_username);
end $$;

-- ---------- Ruxsatlar ----------
revoke execute on function public.login(text,text), public.logout(uuid), public.change_password(uuid,text,text),
  public.get_state(uuid), public.admin_save(uuid,jsonb,int), public.admin_replace_logs(uuid,jsonb),
  public.tick(uuid,date,text), public.set_task_status(uuid,text,text), public.list_accounts(uuid),
  public.upsert_account(uuid,text,text,text,text), public.delete_account(uuid,text) from public;
grant execute on function public.login(text,text), public.logout(uuid), public.change_password(uuid,text,text),
  public.get_state(uuid), public.admin_save(uuid,jsonb,int), public.admin_replace_logs(uuid,jsonb),
  public.tick(uuid,date,text), public.set_task_status(uuid,text,text), public.list_accounts(uuid),
  public.upsert_account(uuid,text,text,text,text), public.delete_account(uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
-- Tayyor! Endi saytga admin / fast2026 bilan kiring.
