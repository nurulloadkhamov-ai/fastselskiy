-- =====================================================================
-- Fast Education — murojaatlar (muammo/taklif) va menejer xabarlari
-- SQL Editor → New query → shu faylni to'liq qo'ying → Run
-- (setup.sql va telegram.sql dan KEYIN). Qayta ishga tushirish xavfsiz.
-- =====================================================================

create table if not exists public.tickets(
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  author     text not null references public.accounts(username) on delete cascade on update cascade,
  kind       text not null check (kind in ('muammo','taklif')),
  anon       boolean not null default false,
  text       text not null check (length(text) between 1 and 4000),
  status     text not null default 'yangi' check (status in ('yangi','jarayonda','hal')),
  updated_at timestamptz not null default now()
);
create table if not exists public.ticket_replies(
  id         bigserial primary key,
  ticket_id  bigint not null references public.tickets(id) on delete cascade,
  created_at timestamptz not null default now(),
  author     text references public.accounts(username) on delete set null on update cascade,
  from_admin boolean not null,
  text       text not null check (length(text) between 1 and 4000)
);
create table if not exists public.announcements(
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  author      text references public.accounts(username) on delete set null on update cascade,
  target      text not null,
  target_label text not null,
  recipients  text[] not null,
  text        text not null check (length(text) between 1 and 4000)
);
create table if not exists public.announcement_reads(
  ann_id   bigint not null references public.announcements(id) on delete cascade,
  username text not null,
  read_at  timestamptz not null default now(),
  primary key (ann_id, username)
);
-- Bot suhbat holati (masalan: "javob matnini kutyapman")
create table if not exists public.tg_chat_state(
  chat_id bigint primary key,
  state   text not null,
  data    jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);

alter table public.tickets            enable row level security;
alter table public.ticket_replies     enable row level security;
alter table public.announcements      enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.tg_chat_state      enable row level security;
revoke all on public.tickets, public.ticket_replies, public.announcements, public.announcement_reads, public.tg_chat_state from anon, authenticated;
grant all on public.tickets, public.ticket_replies, public.announcements, public.announcement_reads, public.tg_chat_state to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Botga bildirishnoma (bot sozlanmagan bo'lsa jim o'tadi)
create or replace function public._msg_notify(p_event text, p_body jsonb)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  begin
    perform public._tg_job('notify', p_body || jsonb_build_object('event', p_event));
  exception when others then null;
  end;
end $$;

-- ---------- Murojaatlar ----------
create or replace function public.ticket_create(p_token uuid, p_kind text, p_text text, p_anon boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; nid bigint;
begin
  a := public._require(p_token, false);
  if a.role = 'admin' then raise exception 'not_allowed'; end if;
  if p_kind not in ('muammo','taklif') then raise exception 'bad_kind'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'empty_text'; end if;
  insert into public.tickets(author, kind, anon, text) values (a.username, p_kind, coalesce(p_anon, false), trim(p_text)) returning id into nid;
  perform public._msg_notify('ticket_new', jsonb_build_object('id', nid));
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.ticket_reply(p_token uuid, p_ticket bigint, p_text text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; t public.tickets; rid bigint;
begin
  a := public._require(p_token, false);
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'ticket_not_found'; end if;
  if a.role <> 'admin' and t.author <> a.username then raise exception 'not_allowed'; end if;
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
begin
  perform public._require(p_token, true);
  if p_status not in ('yangi','jarayonda','hal') then raise exception 'bad_status'; end if;
  update public.tickets set status = p_status, updated_at = now() where id = p_ticket;
  if not found then raise exception 'ticket_not_found'; end if;
  perform public._msg_notify('ticket_status', jsonb_build_object('id', p_ticket));
end $$;

-- ---------- Menejer xabarlari ----------
-- p_target: 'all' | 'teachers' | 'staff' | 'branch:<id>' | 'role:<reception|cleaner|academic>' | 'user:<login>'
create or replace function public.ann_send(p_token uuid, p_target text, p_label text, p_text text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; rec text[]; nid bigint; v text := split_part(p_target, ':', 2);
begin
  a := public._require(p_token, true);
  if coalesce(trim(p_text), '') = '' then raise exception 'empty_text'; end if;
  select data into d from public.app_state where id = 1;
  if p_target = 'all' then
    select array_agg(username) into rec from public.accounts where role in ('teacher','staff');
  elsif p_target = 'teachers' then
    select array_agg(username) into rec from public.accounts where role = 'teacher';
  elsif p_target = 'staff' then
    select array_agg(username) into rec from public.accounts where role = 'staff';
  elsif p_target like 'branch:%' then
    select array_agg(ac.username) into rec from public.accounts ac
     where (ac.role = 'teacher' and exists (select 1 from jsonb_array_elements(coalesce(d->'teachers','[]'::jsonb)) t where t->>'id' = ac.person_id and t->>'branchId' = v))
        or (ac.role = 'staff'   and exists (select 1 from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = ac.person_id and s->>'branchId' = v));
  elsif p_target like 'role:%' then
    select array_agg(ac.username) into rec from public.accounts ac
     where ac.role = 'staff' and exists (select 1 from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = ac.person_id and s->>'role' = v);
  elsif p_target like 'user:%' then
    select array_agg(username) into rec from public.accounts where username = lower(v);
  else
    raise exception 'bad_target';
  end if;
  if rec is null or array_length(rec, 1) is null then raise exception 'no_recipients'; end if;
  insert into public.announcements(author, target, target_label, recipients, text)
  values (a.username, p_target, coalesce(nullif(trim(p_label), ''), p_target), rec, trim(p_text)) returning id into nid;
  perform public._msg_notify('ann', jsonb_build_object('id', nid));
  return jsonb_build_object('id', nid, 'count', array_length(rec, 1));
end $$;

create or replace function public.ann_read(p_token uuid, p_ids bigint[])
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  insert into public.announcement_reads(ann_id, username)
  select x.id, a.username from public.announcements x where x.id = any(p_ids) and a.username = any(x.recipients)
  on conflict do nothing;
end $$;

-- ---------- Hammasini o'qish ----------
create or replace function public.messages_load(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts; tk jsonb; an jsonb;
begin
  a := public._require(p_token, false);
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
   where a.role = 'admin' or t.author = a.username;

  if a.role = 'admin' then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'author', x.author, 'target', x.target, 'label', x.target_label, 'text', x.text,
        'total', array_length(x.recipients, 1),
        'read', (select count(*) from public.announcement_reads r where r.ann_id = x.id),
        'readers', (select coalesce(jsonb_agg(r.username), '[]'::jsonb) from public.announcement_reads r where r.ann_id = x.id),
        'recipients', to_jsonb(x.recipients)) order by x.id desc), '[]'::jsonb)
      into an from (select * from public.announcements order by id desc limit 200) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'author', x.author, 'label', x.target_label, 'text', x.text,
        'read', exists (select 1 from public.announcement_reads r where r.ann_id = x.id and r.username = a.username)) order by x.id desc), '[]'::jsonb)
      into an from (select * from public.announcements where a.username = any(recipients) order by id desc limit 200) x;
  end if;
  return jsonb_build_object('tickets', tk, 'anns', an);
end $$;

-- ---------- Ruxsatlar ----------
revoke execute on function public._msg_notify(text, jsonb) from public, anon, authenticated;
revoke execute on function public.ticket_create(uuid,text,text,boolean), public.ticket_reply(uuid,bigint,text), public.ticket_status(uuid,bigint,text),
  public.ann_send(uuid,text,text,text), public.ann_read(uuid,bigint[]), public.messages_load(uuid) from public;
grant execute on function public.ticket_create(uuid,text,text,boolean), public.ticket_reply(uuid,bigint,text), public.ticket_status(uuid,bigint,text),
  public.ann_send(uuid,text,text,text), public.ann_read(uuid,bigint[]), public.messages_load(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
-- Tayyor!
