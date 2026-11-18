-- =====================================================================
-- Fast Education — saytdagi 🔔 bildirishnomalar va telefon (push) bildirishnomalari
-- SQL Editor → New query → to'liq qo'ying → Run (oldingi barcha SQL fayllardan KEYIN,
-- va bot kodini yangilab Deploy qilgandan keyin). Qayta ishga tushirish xavfsiz.
-- =====================================================================

create table if not exists public.notifications(
  id         bigserial primary key,
  username   text not null references public.accounts(username) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  kind       text not null default 'info',
  title      text not null,
  body       text not null default '',
  link       text not null default 'dashboard',
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications(username, id desc);

create table if not exists public.push_subs(
  endpoint   text primary key,
  username   text not null references public.accounts(username) on delete cascade on update cascade,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.push_subs     enable row level security;
revoke all on public.notifications, public.push_subs from anon, authenticated;
grant all on public.notifications, public.push_subs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- Sayt uchun ----------
create or replace function public.notif_list(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'at', n.created_at, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link, 'read', n.read_at is not null) order by n.id desc)
                       from (select * from public.notifications where username = a.username order by id desc limit 50) n), '[]'::jsonb),
    'unread', (select count(*) from public.notifications where username = a.username and read_at is null));
end $$;

-- p_ids = null → hammasi o'qildi
create or replace function public.notif_read(p_token uuid, p_ids bigint[])
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  update public.notifications set read_at = now()
   where username = a.username and read_at is null and (p_ids is null or id = any(p_ids));
end $$;

create or replace function public.push_public_key()
returns text language sql stable security definer
set search_path = public as $$
  select value from public.tg_config where key = 'vapid_public'
$$;

create or replace function public.push_subscribe(p_token uuid, p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'bad_endpoint'; end if;
  insert into public.push_subs(endpoint, username, p256dh, auth, ua) values (p_endpoint, a.username, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set username = excluded.username, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
end $$;

create or replace function public.push_unsubscribe(p_token uuid, p_endpoint text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  delete from public.push_subs where endpoint = p_endpoint and username = a.username;
end $$;

-- Sinov: o'zimga bildirishnoma yuborish (Profil → "Sinab ko'rish")
create or replace function public.notif_test(p_token uuid)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  perform public._tg_job('push_test', jsonb_build_object('username', a.username));
end $$;

-- ---------- Ruxsatlar ----------
revoke execute on function public.notif_list(uuid), public.notif_read(uuid,bigint[]), public.push_public_key(),
  public.push_subscribe(uuid,text,text,text,text), public.push_unsubscribe(uuid,text), public.notif_test(uuid) from public;
grant execute on function public.notif_list(uuid), public.notif_read(uuid,bigint[]), public.push_public_key(),
  public.push_subscribe(uuid,text,text,text,text), public.push_unsubscribe(uuid,text), public.notif_test(uuid) to anon, authenticated, service_role;

-- Push kalitlarini (VAPID) bot funksiyasi yaratadi
select public._tg_job('vapid');

notify pgrst, 'reload schema';
-- Tayyor! 10 soniyadan keyin tekshirish: select public.push_public_key();  (uzun matn chiqishi kerak)
