-- =====================================================================
-- Fast Education — Telegram bot sozlamasi
-- 1) Avval "telegram" Edge Function'ni joylang (README'ga qarang).
-- 2) Keyin shu faylni SQL Editor'da to'liq ishga tushiring (Run).
-- 3) So'ng alohida so'rovda:  select public.tg_setup('BOT_TOKEN');
-- Skriptni qayta ishga tushirish xavfsiz.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- Jadvallar ----------
alter table public.accounts add column if not exists tg_chat_id bigint;
create unique index if not exists accounts_tg_chat_id_key on public.accounts(tg_chat_id) where tg_chat_id is not null;

create table if not exists public.tg_config(key text primary key, value text not null);
create table if not exists public.tg_codes(
  code text primary key,
  username text not null references public.accounts(username) on delete cascade on update cascade,
  expires_at timestamptz not null
);
create table if not exists public.tg_sent(key text primary key, at timestamptz not null default now());

alter table public.tg_config enable row level security;
alter table public.tg_codes  enable row level security;
alter table public.tg_sent   enable row level security;
revoke all on public.tg_config, public.tg_codes, public.tg_sent from anon, authenticated;
grant all on public.tg_config, public.tg_codes, public.tg_sent, public.accounts, public.app_state, public.duty_logs, public.sessions to service_role;

insert into public.tg_config(key, value) values
  ('cron_secret',    encode(extensions.gen_random_bytes(24), 'hex')),
  ('webhook_secret', encode(extensions.gen_random_bytes(24), 'hex')),
  ('function_url',   'https://zxsgwnwryakbygczxwtq.supabase.co/functions/v1/telegram'),
  ('site_url',       'https://nurulloadkhamov-ai.github.io/fastselskiy/')
on conflict (key) do nothing;

-- ---------- Sayt uchun: Telegramni ulash ----------
create or replace function public.tg_link_code(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; c text;
begin
  a := public._require(p_token, false);
  delete from public.tg_codes where expires_at < now() or username = a.username;
  c := encode(extensions.gen_random_bytes(12), 'hex');
  insert into public.tg_codes(code, username, expires_at) values (c, a.username, now() + interval '15 minutes');
  return jsonb_build_object('code', c,
    'bot', (select value from public.tg_config where key = 'bot_username'),
    'linked', a.tg_chat_id is not null);
end $$;

create or replace function public.tg_unlink(p_token uuid)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts;
begin
  a := public._require(p_token, false);
  update public.accounts set tg_chat_id = null where username = a.username;
end $$;

create or replace function public.list_accounts(p_token uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  perform public._require(p_token, true);
  return coalesce((select jsonb_agg(jsonb_build_object('username', username, 'role', role, 'person_id', person_id, 'tg', tg_chat_id is not null) order by role, username)
                   from public.accounts), '[]'::jsonb);
end $$;

-- ---------- Bot uchun (faqat server): Telegram foydalanuvchisi nomidan qisqa sessiya ----------
create or replace function public.tg_session(p_chat bigint)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare u text; t uuid;
begin
  select username into u from public.accounts where tg_chat_id = p_chat;
  if u is null then raise exception 'not_linked'; end if;
  delete from public.sessions where expires_at < now();
  insert into public.sessions(username, expires_at) values (u, now() + interval '2 minutes') returning token into t;
  return t;
end $$;

-- ---------- Bot funksiyasini chaqirish ----------
create or replace function public._tg_job(p_job text, p_body jsonb default '{}'::jsonb)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare u text; s text;
begin
  select value into u from public.tg_config where key = 'function_url';
  select value into s from public.tg_config where key = 'cron_secret';
  if u is null or s is null or not exists (select 1 from public.tg_config where key = 'bot_token') then return; end if;
  perform net.http_post(url := u, body := p_body || jsonb_build_object('job', p_job),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fe-secret', s),
    timeout_milliseconds := 20000);
end $$;

-- Admin ma'lumot o'zgartirganda (yangi topshiriq, baho, shikoyat...) botga xabar beriladi
create or replace function public._tg_on_state()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  if old.data is null or new.data is null then return new; end if;
  begin
    perform public._tg_job('diff', jsonb_build_object('old', jsonb_build_object(
      'tasks',      (select coalesce(jsonb_object_agg(x->>'id', x->>'status'), '{}'::jsonb) from jsonb_array_elements(coalesce(old.data->'tasks', '[]'::jsonb)) x),
      'evals',      (select coalesce(jsonb_agg(x->>'id'), '[]'::jsonb) from jsonb_array_elements(coalesce(old.data->'evals', '[]'::jsonb)) x),
      'ratings',    (select coalesce(jsonb_agg(x->>'id'), '[]'::jsonb) from jsonb_array_elements(coalesce(old.data->'ratings', '[]'::jsonb)) x),
      'complaints', (select coalesce(jsonb_object_agg(x->>'id', x->>'status'), '{}'::jsonb) from jsonb_array_elements(coalesce(old.data->'complaints', '[]'::jsonb)) x)
    )));
  exception when others then null;  -- bot ishlamasa ham sayt saqlashda davom etadi
  end;
  return new;
end $$;

drop trigger if exists tg_state_change on public.app_state;
create trigger tg_state_change after update on public.app_state for each row execute function public._tg_on_state();

-- ---------- Bir martalik sozlash: bot tokeni + jadval ----------
-- Toshkent = UTC+5. Ertalab 07:02, kechqurun 20:33, dushanba 09:07, eslatmalar har 5 daqiqada.
create or replace function public.tg_setup(p_bot_token text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_bot_token !~ '^[0-9]+:[A-Za-z0-9_-]{30,}$' then raise exception 'Token noto''g''ri ko''rinishda'; end if;
  insert into public.tg_config(key, value) values ('bot_token', p_bot_token)
  on conflict (key) do update set value = excluded.value;
  perform cron.schedule('fe-tg-reminders', '*/5 * * * *', 'select public._tg_job(''reminders'')');
  perform cron.schedule('fe-tg-morning',   '2 2 * * *',   'select public._tg_job(''morning'')');
  perform cron.schedule('fe-tg-evening',   '33 15 * * *', 'select public._tg_job(''evening'')');
  perform cron.schedule('fe-tg-weekly',    '7 4 * * 1',   'select public._tg_job(''weekly'')');
  perform public._tg_job('setup');
  return 'Tayyor! 10 soniyadan keyin: select public.tg_status();';
end $$;

-- Tekshirish: bot ulandimi
create or replace function public.tg_status()
returns jsonb language sql security definer
set search_path = public, extensions as $$
  select jsonb_build_object(
    'bot', (select value from public.tg_config where key = 'bot_username'),
    'setup', (select value from public.tg_config where key = 'setup_result'),
    'ulangan_foydalanuvchilar', (select count(*) from public.accounts where tg_chat_id is not null),
    'oxirgi_javoblar', (select coalesce(jsonb_agg(jsonb_build_object('status', status_code, 'xato', error_msg, 'javob', left(content, 200)) order by id desc), '[]'::jsonb)
                        from (select * from net._http_response order by id desc limit 3) r)
  )
$$;

-- ---------- Ruxsatlar ----------
revoke execute on function public.tg_session(bigint), public._tg_job(text, jsonb), public._tg_on_state(),
  public.tg_setup(text), public.tg_status() from public, anon, authenticated;
grant execute on function public.tg_session(bigint) to service_role;
grant execute on function public.tick(uuid,date,text), public.set_task_status(uuid,text,text), public.get_state(uuid) to service_role;
revoke execute on function public.tg_link_code(uuid), public.tg_unlink(uuid) from public;
grant execute on function public.tg_link_code(uuid), public.tg_unlink(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
