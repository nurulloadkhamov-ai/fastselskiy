-- =====================================================================
-- Fast Education — filial adminlari
-- Bosh admin: branch_id bo'sh (hamma filiallar). Filial admini: branch_id = filial.
-- SQL Editor → New query → to'liq qo'ying → Run (setup, telegram, messages dan KEYIN).
-- Qayta ishga tushirish xavfsiz.
-- =====================================================================

alter table public.accounts add column if not exists branch_id text;

-- Shaxs (ustoz/xodim) qaysi filialda
create or replace function public._pbranch(d jsonb, p_role text, p_pid text)
returns text language sql immutable as $$
  select case
    when p_role = 'teacher' then (select t->>'branchId' from jsonb_array_elements(coalesce(d->'teachers','[]'::jsonb)) t where t->>'id' = p_pid limit 1)
    when p_role = 'staff'   then (select s->>'branchId' from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = p_pid limit 1)
  end
$$;

-- Element filial adminiga tegishlimi
create or replace function public._owned(x jsonb, kind text, b text, tset text[], sset text[])
returns boolean language sql immutable as $$
  select coalesce(case kind
    when 'branchId'  then x->>'branchId' = b
    when 'teacherId' then (x->>'teacherId') = any(tset)
    when 'staffId'   then (x->>'staffId') = any(sset)
    when 'task'      then (x->>'type' = 'teacher' and (x->>'assigneeId') = any(tset)) or (x->>'type' = 'staff' and (x->>'assigneeId') = any(sset))
  end, false)
$$;

-- Eski va yangi ro'yxatni birlashtirish: filial admini faqat o'z filialiga tegishlini o'zgartira oladi
create or replace function public._merge_arr(o jsonb, n jsonb, kind text, b text, tset text[], sset text[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    -- 1) boshqa filiallarniki — eskisicha qoladi
    select ox as x from jsonb_array_elements(coalesce(o,'[]'::jsonb)) ox where not public._owned(ox, kind, b, tset, sset)
    union all
    -- 2) o'z filialiniki — yangisi olinadi (boshqa filialnikini "egallab olish" mumkin emas)
    select nx from jsonb_array_elements(coalesce(n,'[]'::jsonb)) nx
     where public._owned(nx, kind, b, tset, sset)
       and not exists (select 1 from jsonb_array_elements(coalesce(o,'[]'::jsonb)) ox where ox->>'id' = nx->>'id' and not public._owned(ox, kind, b, tset, sset))
    union all
    -- 3) o'z filialinikini boshqa filialga o'tkazishga urinish — eskisi qoladi
    select ox from jsonb_array_elements(coalesce(o,'[]'::jsonb)) ox
     where public._owned(ox, kind, b, tset, sset)
       and exists (select 1 from jsonb_array_elements(coalesce(n,'[]'::jsonb)) nx where nx->>'id' = ox->>'id' and not public._owned(nx, kind, b, tset, sset))
  ) q
$$;

create or replace function public._merge_branch(o jsonb, n jsonb, b text)
returns jsonb language plpgsql immutable as $$
declare r jsonb := o; tset text[]; sset text[];
begin
  r := jsonb_set(r, '{teachers}', public._merge_arr(o->'teachers', n->'teachers', 'branchId', b, null, null));
  r := jsonb_set(r, '{staff}',    public._merge_arr(o->'staff',    n->'staff',    'branchId', b, null, null));
  select array_agg(distinct x->>'id') into tset from (
    select x from jsonb_array_elements(coalesce(o->'teachers','[]'::jsonb)) x where x->>'branchId' = b
    union all select x from jsonb_array_elements(r->'teachers') x where x->>'branchId' = b) q;
  select array_agg(distinct x->>'id') into sset from (
    select x from jsonb_array_elements(coalesce(o->'staff','[]'::jsonb)) x where x->>'branchId' = b
    union all select x from jsonb_array_elements(r->'staff') x where x->>'branchId' = b) q;
  tset := coalesce(tset, '{}'); sset := coalesce(sset, '{}');
  r := jsonb_set(r, '{evals}',      public._merge_arr(o->'evals',      n->'evals',      'teacherId', b, tset, sset));
  r := jsonb_set(r, '{ratings}',    public._merge_arr(o->'ratings',    n->'ratings',    'teacherId', b, tset, sset));
  r := jsonb_set(r, '{complaints}', public._merge_arr(o->'complaints', n->'complaints', 'teacherId', b, tset, sset));
  r := jsonb_set(r, '{duties}',     public._merge_arr(o->'duties',     n->'duties',     'staffId',   b, tset, sset));
  r := jsonb_set(r, '{tasks}',      public._merge_arr(o->'tasks',      n->'tasks',      'task',      b, tset, sset));
  -- Filiallar: faqat o'z filialining o'quvchilar soni o'zgaradi; filial qo'shish/o'chirish va sozlamalar — bosh admin
  r := jsonb_set(r, '{branches}', coalesce((
    select jsonb_agg(case when ob->>'id' = b
      then ob || jsonb_build_object('students', coalesce((select nb->'students' from jsonb_array_elements(coalesce(n->'branches','[]'::jsonb)) nb where nb->>'id' = b limit 1), ob->'students'))
      else ob end)
    from jsonb_array_elements(coalesce(o->'branches','[]'::jsonb)) ob), '[]'::jsonb));
  return r;
end $$;

-- Admin shu shaxsni boshqara oladimi
create or replace function public._admin_can(a public.accounts, d jsonb, p_role text, p_pid text)
returns boolean language sql immutable as $$
  select a.role = 'admin' and (a.branch_id is null or public._pbranch(d, p_role, p_pid) = a.branch_id)
$$;

revoke execute on function public._pbranch(jsonb,text,text), public._owned(jsonb,text,text,text[],text[]),
  public._merge_arr(jsonb,jsonb,text,text,text[],text[]), public._merge_branch(jsonb,jsonb,text),
  public._admin_can(public.accounts,jsonb,text,text) from public, anon, authenticated;

-- ---------- Kirish ----------
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
  return jsonb_build_object('token', t, 'username', a.username, 'role', a.role, 'person_id', a.person_id, 'branch_id', a.branch_id);
end $$;

create or replace function public.get_state(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; v int; lg jsonb; ln timestamp := public._local_now();
begin
  a := public._require(p_token, false);
  select data, version into d, v from public.app_state where id = 1;
  select coalesce(jsonb_object_agg(to_char(day,'YYYY-MM-DD') || '|' || duty_id, jsonb_build_object('s', status, 'at', at)), '{}'::jsonb)
    into lg from public.duty_logs where day >= (ln::date - 45);
  if d is not null and not (a.role = 'admin' and a.branch_id is null) then
    d := jsonb_set(d, '{complaints}', coalesce((
      select jsonb_agg(c) from jsonb_array_elements(coalesce(d->'complaints','[]'::jsonb)) c
      where (a.role = 'teacher' and c->>'teacherId' = a.person_id)
         or (a.role = 'admin' and public._pbranch(d, 'teacher', c->>'teacherId') = a.branch_id)), '[]'::jsonb));
  end if;
  return jsonb_build_object('data', d, 'version', v, 'logs', lg,
    'today', to_char(ln, 'YYYY-MM-DD'), 'now', to_char(ln, 'HH24:MI'),
    'me', jsonb_build_object('username', a.username, 'role', a.role, 'person_id', a.person_id, 'branch_id', a.branch_id));
end $$;

-- ---------- Saqlash ----------
create or replace function public.admin_save(p_token uuid, p_data jsonb, p_version int)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; o jsonb; nv int;
begin
  a := public._require(p_token, true);
  if a.branch_id is not null then
    select data into o from public.app_state where id = 1;
    if o is null then raise exception 'not_allowed'; end if;
    p_data := public._merge_branch(o, p_data, a.branch_id);
  end if;
  update public.app_state set data = p_data, version = version + 1, updated_at = now()
   where id = 1 and version = p_version returning version into nv;
  if nv is null then return jsonb_build_object('conflict', true); end if;
  return jsonb_build_object('version', nv);
end $$;

create or replace function public.admin_replace_logs(p_token uuid, p_logs jsonb)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, true);
  if a.branch_id is not null then raise exception 'not_allowed'; end if;
  delete from public.duty_logs where true;
  insert into public.duty_logs(day, duty_id, status, at, by_user)
  select split_part(key, '|', 1)::date, split_part(key, '|', 2), value->>'s', value->>'at', 'demo'
  from jsonb_each(coalesce(p_logs, '{}'::jsonb));
end $$;

-- ---------- Vazifa belgilash ----------
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
    late_min := coalesce((d->'settings'->>'lateMin')::int, 30);
    due  := split_part(duty->>'time', ':', 1)::int * 60 + split_part(duty->>'time', ':', 2)::int;
    nowm := extract(hour from ln)::int * 60 + extract(minute from ln)::int;
    st := case when nowm > due + late_min then 'l' else 'd' end;
    atv := to_char(ln, 'HH24:MI');
  else
    if not public._admin_can(a, d, 'staff', duty->>'staffId') then raise exception 'not_allowed'; end if;
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
  if a.role = 'admin' then
    if not public._admin_can(a, d, t->>'type', t->>'assigneeId') then raise exception 'not_allowed'; end if;
  else
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

-- ---------- Foydalanuvchilar ----------
create or replace function public.list_accounts(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb;
begin
  a := public._require(p_token, true);
  select data into d from public.app_state where id = 1;
  return coalesce((select jsonb_agg(jsonb_build_object('username', x.username, 'role', x.role, 'person_id', x.person_id,
                     'branch_id', x.branch_id, 'tg', x.tg_chat_id is not null) order by x.role, x.username)
                   from public.accounts x
                   where a.branch_id is null or x.username = a.username
                      or (x.role in ('teacher','staff') and public._pbranch(d, x.role, x.person_id) = a.branch_id)), '[]'::jsonb);
end $$;

drop function if exists public.upsert_account(uuid, text, text, text, text);
create or replace function public.upsert_account(p_token uuid, p_username text, p_password text, p_role text, p_person_id text, p_branch_id text default null)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare u text := lower(trim(p_username)); ex public.accounts; me public.accounts; d jsonb; br text := nullif(trim(coalesce(p_branch_id, '')), '');
begin
  me := public._require(p_token, true);
  select data into d from public.app_state where id = 1;
  if u !~ '^[a-z0-9._-]{3,32}$' then raise exception 'bad_username'; end if;
  if p_role not in ('admin','teacher','staff') then raise exception 'bad_role'; end if;
  if p_password is not null and p_password <> '' and length(p_password) < 6 then raise exception 'short_password'; end if;
  if p_role <> 'admin' then br := null; end if;
  select * into ex from public.accounts where username = u;
  if me.branch_id is not null then
    -- filial admini: faqat o'z filialidagi ustoz/xodimga login beradi
    if p_role = 'admin' then raise exception 'not_allowed'; end if;
    if not public._admin_can(me, d, p_role, p_person_id) then raise exception 'not_allowed'; end if;
    if ex.username is not null and not (ex.role in ('teacher','staff') and public._admin_can(me, d, ex.role, ex.person_id)) then raise exception 'username_taken'; end if;
  end if;
  if ex.username is null then
    if p_password is null or p_password = '' then raise exception 'password_required'; end if;
    insert into public.accounts(username, pass_hash, role, person_id, branch_id)
    values (u, extensions.crypt(p_password, extensions.gen_salt('bf')), p_role, nullif(p_person_id, ''), br);
  else
    if ex.username = me.username and (p_role <> 'admin' or br is distinct from me.branch_id) then raise exception 'cannot_demote_self'; end if;
    update public.accounts set role = p_role, person_id = case when p_role = 'admin' then null else nullif(p_person_id, '') end, branch_id = br,
      pass_hash = case when p_password is null or p_password = '' then pass_hash else extensions.crypt(p_password, extensions.gen_salt('bf')) end
     where username = u;
    if p_password is not null and p_password <> '' then delete from public.sessions where username = u; end if;
  end if;
end $$;

create or replace function public.delete_account(p_token uuid, p_username text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare me public.accounts; ex public.accounts; d jsonb;
begin
  me := public._require(p_token, true);
  if lower(p_username) = me.username then raise exception 'cannot_delete_self'; end if;
  select * into ex from public.accounts where username = lower(p_username);
  if ex.username is null then return; end if;
  if me.branch_id is not null then
    select data into d from public.app_state where id = 1;
    if not (ex.role in ('teacher','staff') and public._admin_can(me, d, ex.role, ex.person_id)) then raise exception 'not_allowed'; end if;
  end if;
  delete from public.accounts where username = ex.username;
end $$;

-- ---------- Murojaatlar va xabarlar ----------
create or replace function public._ticket_visible(a public.accounts, d jsonb, t public.tickets)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select t.author = a.username
      or (a.role = 'admin' and (a.branch_id is null or exists (
            select 1 from public.accounts x where x.username = t.author and public._pbranch(d, x.role, x.person_id) = a.branch_id)))
$$;
revoke execute on function public._ticket_visible(public.accounts, jsonb, public.tickets) from public, anon, authenticated;

create or replace function public.ticket_reply(p_token uuid, p_ticket bigint, p_text text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; t public.tickets; rid bigint; d jsonb;
begin
  a := public._require(p_token, false);
  select data into d from public.app_state where id = 1;
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'ticket_not_found'; end if;
  if not public._ticket_visible(a, d, t) then raise exception 'not_allowed'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'empty_text'; end if;
  insert into public.ticket_replies(ticket_id, author, from_admin, text) values (t.id, a.username, a.role = 'admin', trim(p_text)) returning id into rid;
  update public.tickets set updated_at = now(),
    status = case when a.role = 'admin' and status = 'yangi' then 'jarayonda' when a.role <> 'admin' and status = 'hal' then 'jarayonda' else status end
   where id = t.id;
  perform public._msg_notify('ticket_reply', jsonb_build_object('id', t.id, 'reply_id', rid));
  return jsonb_build_object('id', rid);
end $$;

create or replace function public.ticket_status(p_token uuid, p_ticket bigint, p_status text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; t public.tickets; d jsonb;
begin
  a := public._require(p_token, true);
  if p_status not in ('yangi','jarayonda','hal') then raise exception 'bad_status'; end if;
  select data into d from public.app_state where id = 1;
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'ticket_not_found'; end if;
  if not public._ticket_visible(a, d, t) then raise exception 'not_allowed'; end if;
  update public.tickets set status = p_status, updated_at = now() where id = p_ticket;
  perform public._msg_notify('ticket_status', jsonb_build_object('id', p_ticket));
end $$;

create or replace function public.ann_send(p_token uuid, p_target text, p_label text, p_text text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; rec text[]; nid bigint; v text := split_part(p_target, ':', 2);
begin
  a := public._require(p_token, true);
  if coalesce(trim(p_text), '') = '' then raise exception 'empty_text'; end if;
  select data into d from public.app_state where id = 1;
  select array_agg(ac.username) into rec from public.accounts ac
   where ac.role in ('teacher','staff')
     and (a.branch_id is null or public._pbranch(d, ac.role, ac.person_id) = a.branch_id)
     and case
       when p_target = 'all'      then true
       when p_target = 'teachers' then ac.role = 'teacher'
       when p_target = 'staff'    then ac.role = 'staff'
       when p_target like 'branch:%' then public._pbranch(d, ac.role, ac.person_id) = v
       when p_target like 'role:%'   then ac.role = 'staff' and exists (select 1 from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = ac.person_id and s->>'role' = v)
       when p_target like 'user:%'   then ac.username = lower(v)
       else false end;
  if rec is null or array_length(rec, 1) is null then raise exception 'no_recipients'; end if;
  insert into public.announcements(author, target, target_label, recipients, text)
  values (a.username, p_target, coalesce(nullif(trim(p_label), ''), p_target), rec, trim(p_text)) returning id into nid;
  perform public._msg_notify('ann', jsonb_build_object('id', nid));
  return jsonb_build_object('id', nid, 'count', array_length(rec, 1));
end $$;

create or replace function public.messages_load(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; tk jsonb; an jsonb;
begin
  a := public._require(p_token, false);
  select data into d from public.app_state where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'created_at', t.created_at, 'updated_at', t.updated_at, 'kind', t.kind, 'anon', t.anon, 'text', t.text, 'status', t.status,
      'mine', t.author = a.username,
      'author', case when a.role = 'admin' and t.anon then null else t.author end,
      'author_role', case when a.role = 'admin' and t.anon then null else ac.role end,
      'author_person', case when a.role = 'admin' and t.anon then null else ac.person_id end,
      'replies', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.created_at, 'from_admin', r.from_admin, 'text', r.text,
                            'author', case when r.from_admin then r.author when a.role = 'admin' and t.anon then null else r.author end) order by r.id)
                           from public.ticket_replies r where r.ticket_id = t.id), '[]'::jsonb)
    ) order by t.updated_at desc), '[]'::jsonb)
    into tk
    from public.tickets t left join public.accounts ac on ac.username = t.author
   where public._ticket_visible(a, d, t);

  if a.role = 'admin' then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'author', x.author, 'target', x.target, 'label', x.target_label, 'text', x.text,
        'total', array_length(x.recipients, 1),
        'read', (select count(*) from public.announcement_reads r where r.ann_id = x.id),
        'readers', (select coalesce(jsonb_agg(r.username), '[]'::jsonb) from public.announcement_reads r where r.ann_id = x.id),
        'recipients', to_jsonb(x.recipients)) order by x.id desc), '[]'::jsonb)
      into an from (select * from public.announcements where a.branch_id is null or author = a.username order by id desc limit 200) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'author', x.author, 'label', x.target_label, 'text', x.text,
        'read', exists (select 1 from public.announcement_reads r where r.ann_id = x.id and r.username = a.username)) order by x.id desc), '[]'::jsonb)
      into an from (select * from public.announcements where a.username = any(recipients) order by id desc limit 200) x;
  end if;
  return jsonb_build_object('tickets', tk, 'anns', an);
end $$;

-- ---------- Ruxsatlar ----------
revoke execute on function public.upsert_account(uuid,text,text,text,text,text) from public;
grant execute on function public.upsert_account(uuid,text,text,text,text,text) to anon, authenticated;
grant execute on function public.login(text,text), public.get_state(uuid), public.admin_save(uuid,jsonb,int), public.admin_replace_logs(uuid,jsonb),
  public.tick(uuid,date,text), public.set_task_status(uuid,text,text), public.list_accounts(uuid), public.delete_account(uuid,text),
  public.ticket_reply(uuid,bigint,text), public.ticket_status(uuid,bigint,text), public.ann_send(uuid,text,text,text), public.messages_load(uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
-- Tayyor!
