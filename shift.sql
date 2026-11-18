-- =====================================================================
-- Fast Education — smenali xodimlar (ish kunlari aniq emas)
-- Xodim kelgan kuni «Ishga keldim»ni bosadi → shu kunning vazifalari yoqiladi.
-- SQL Editor → New query → to'liq qo'ying → Run (branch_admin.sql dan KEYIN).
-- Qayta ishga tushirish xavfsiz.
-- Kelish belgisi duty_logs jadvalida '@in:<xodim_id>' kaliti bilan saqlanadi.
-- =====================================================================

create or replace function public._staff_obj(d jsonb, p_id text)
returns jsonb language sql immutable as $$
  select s from jsonb_array_elements(coalesce(d->'staff','[]'::jsonb)) s where s->>'id' = p_id limit 1
$$;
revoke execute on function public._staff_obj(jsonb, text) from public, anon, authenticated;

-- Ishga keldim
create or replace function public.checkin(p_token uuid, p_day date, p_staff_id text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; st jsonb; cur public.duty_logs; ln timestamp := public._local_now(); k text := '@in:' || p_staff_id; atv text;
begin
  a := public._require(p_token, false);
  select data into d from public.app_state where id = 1;
  st := public._staff_obj(d, p_staff_id);
  if st is null then raise exception 'staff_not_found'; end if;
  select * into cur from public.duty_logs where day = p_day and duty_id = k;
  if a.role = 'staff' then
    if a.person_id is distinct from p_staff_id then raise exception 'not_allowed'; end if;
    if p_day <> ln::date then raise exception 'only_today'; end if;
    if cur.duty_id is not null then return jsonb_build_object('log', jsonb_build_object('s', cur.status, 'at', cur.at)); end if;
    atv := to_char(ln, 'HH24:MI');
  elsif a.role = 'admin' and public._admin_can(a, d, 'staff', p_staff_id) then
    -- admin: bosganda belgilaydi, qayta bosganda olib tashlaydi
    if cur.duty_id is not null then
      delete from public.duty_logs where day = p_day and duty_id = k;
      return jsonb_build_object('log', null);
    end if;
    atv := case when p_day = ln::date then to_char(ln, 'HH24:MI') else '08:00' end;
  else
    raise exception 'not_allowed';
  end if;
  insert into public.duty_logs(day, duty_id, status, at, by_user) values (p_day, k, 'd', atv, a.username)
  on conflict (day, duty_id) do nothing;
  return jsonb_build_object('log', jsonb_build_object('s', 'd', 'at', atv));
end $$;

-- Vazifa belgilash (filial adminlari va smenali xodimlar hisobga olingan)
create or replace function public.tick(p_token uuid, p_day date, p_duty_id text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare a public.accounts; d jsonb; duty jsonb; sobj jsonb; cur public.duty_logs; cin public.duty_logs; ln timestamp := public._local_now();
        late_min int; due int; nowm int; st text; atv text; is_shift boolean;
begin
  a := public._require(p_token, false);
  select data into d from public.app_state where id = 1;
  select x into duty from jsonb_array_elements(coalesce(d->'duties','[]'::jsonb)) x where x->>'id' = p_duty_id limit 1;
  if duty is null then raise exception 'duty_not_found'; end if;
  sobj := public._staff_obj(d, duty->>'staffId');
  is_shift := coalesce((sobj->>'shift')::boolean, false);
  select * into cur from public.duty_logs where day = p_day and duty_id = p_duty_id;
  select * into cin from public.duty_logs where day = p_day and duty_id = '@in:' || (duty->>'staffId');

  if a.role <> 'admin' then
    if a.role <> 'staff' or duty->>'staffId' is distinct from a.person_id then raise exception 'not_allowed'; end if;
    if p_day <> ln::date then raise exception 'only_today'; end if;
    if is_shift and cin.duty_id is null then raise exception 'not_checked_in'; end if;
    if cur.duty_id is not null then
      delete from public.duty_logs where day = p_day and duty_id = p_duty_id;
      return jsonb_build_object('log', null);
    end if;
    late_min := coalesce((d->'settings'->>'lateMin')::int, 30);
    due  := split_part(duty->>'time', ':', 1)::int * 60 + split_part(duty->>'time', ':', 2)::int;
    -- smenali xodim: kechikish ishga kelgan vaqtidan hisoblanadi
    if is_shift and cin.at ~ '^\d{1,2}:\d{2}$' then
      due := greatest(due, split_part(cin.at, ':', 1)::int * 60 + split_part(cin.at, ':', 2)::int);
    end if;
    nowm := extract(hour from ln)::int * 60 + extract(minute from ln)::int;
    st := case when nowm > due + late_min then 'l' else 'd' end;
    atv := to_char(ln, 'HH24:MI');
  else
    if not public._admin_can(a, d, 'staff', duty->>'staffId') then raise exception 'not_allowed'; end if;
    if is_shift and cin.duty_id is null then
      insert into public.duty_logs(day, duty_id, status, at, by_user) values (p_day, '@in:' || (duty->>'staffId'), 'd', '08:00', a.username)
      on conflict (day, duty_id) do nothing;
    end if;
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

revoke execute on function public.checkin(uuid,date,text) from public;
grant execute on function public.checkin(uuid,date,text), public.tick(uuid,date,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
-- Tayyor!
