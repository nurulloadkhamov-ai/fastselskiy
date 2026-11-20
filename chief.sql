-- =====================================================================
-- Fast Education — bosh admin → filial adminlari: topshiriq va xabar
-- SQL Editor → New query → to'liq qo'ying → Run (shift.sql dan KEYIN).
-- Qayta ishga tushirish xavfsiz.
-- Filial adminiga topshiriq: tasks ichida type = 'admin', assigneeId = filial adminining logini.
-- =====================================================================

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
  if a.role = 'admin' and a.branch_id is null then
    null;  -- bosh admin hammasini o'zgartira oladi
  elsif t->>'type' = 'admin' then
    -- filial admini: faqat o'ziga berilgan topshiriq, faqat oldinga
    if a.role <> 'admin' or t->>'assigneeId' is distinct from a.username then raise exception 'not_allowed'; end if;
    if t->>'status' = 'bajarildi' then raise exception 'already_done'; end if;
    if p_status = 'yangi' then raise exception 'not_allowed'; end if;
  elsif a.role = 'admin' then
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

-- Xabar yuborish. Bosh admin uchun qo'shimcha: 'admins' (barcha filial adminlari), 'user:<filial admini logini>'
create or replace function public.ann_send(p_token uuid, p_target text, p_label text, p_text text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; rec text[]; nid bigint; v text := split_part(p_target, ':', 2);
begin
  a := public._require(p_token, true);
  if coalesce(trim(p_text), '') = '' then raise exception 'empty_text'; end if;
  select data into d from public.app_state where id = 1;
  select array_agg(ac.username) into rec from public.accounts ac
   where case
     when p_target = 'admins' then a.branch_id is null and ac.role = 'admin' and ac.branch_id is not null
     when p_target like 'user:%' and ac.role = 'admin' then a.branch_id is null and ac.username = lower(v) and ac.username <> a.username
     else ac.role in ('teacher','staff')
       and (a.branch_id is null or public._pbranch(d, ac.role, ac.person_id) = a.branch_id)
       and case
         when p_target = 'all'      then true
         when p_target = 'teachers' then ac.role = 'teacher'
         when p_target = 'staff'    then ac.role = 'staff'
         when p_target like 'branch:%' then public._pbranch(d, ac.role, ac.person_id) = v
         when p_target like 'role:%'   then ac.role = 'staff' and exists (select 1 from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = ac.person_id and s->>'role' = v)
         when p_target like 'user:%'   then ac.username = lower(v)
         else false end
   end;
  if rec is null or array_length(rec, 1) is null then raise exception 'no_recipients'; end if;
  insert into public.announcements(author, target, target_label, recipients, text)
  values (a.username, p_target, coalesce(nullif(trim(p_label), ''), p_target), rec, trim(p_text)) returning id into nid;
  perform public._msg_notify('ann', jsonb_build_object('id', nid));
  return jsonb_build_object('id', nid, 'count', array_length(rec, 1));
end $$;

-- Xabarlar: filial adminlari bosh admindan kelganlarini ham ko'radi ('inbox')
create or replace function public.messages_load(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; tk jsonb; an jsonb; ib jsonb;
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
      into an from (select * from public.announcements where (a.branch_id is null or author = a.username) and not (a.username = any(recipients)) order by id desc limit 200) x;
  else
    an := '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'author', x.author, 'label', x.target_label, 'text', x.text,
      'read', exists (select 1 from public.announcement_reads r where r.ann_id = x.id and r.username = a.username)) order by x.id desc), '[]'::jsonb)
    into ib from (select * from public.announcements where a.username = any(recipients) order by id desc limit 200) x;
  if a.role = 'admin' then
    return jsonb_build_object('tickets', tk, 'anns', an, 'inbox', ib);
  end if;
  return jsonb_build_object('tickets', tk, 'anns', ib);
end $$;

grant execute on function public.set_task_status(uuid,text,text), public.ann_send(uuid,text,text,text), public.messages_load(uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
-- Tayyor!
