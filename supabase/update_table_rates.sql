-- Green Pocket Snooker Zone: per-table hourly rates
-- Run this ONCE in Supabase SQL Editor after the original schema is installed.
-- Amounts are stored in paise. Existing completed bills are not recalculated.

alter table public.snooker_tables
  add column if not exists hourly_rate_paise bigint not null default 25000
  check (hourly_rate_paise > 0);

alter table public.play_sessions
  add column if not exists hourly_rate_paise bigint;

-- Preserve the currently configured rate for any session already in progress.
update public.play_sessions ps
set hourly_rate_paise = st.hourly_rate_paise
from public.snooker_tables st
where ps.table_id = st.id
  and ps.hourly_rate_paise is null;

-- Set the five requested table rates (₹120, ₹150, ₹210, ₹210, ₹210 per hour).
update public.snooker_tables
set hourly_rate_paise = case table_number
  when 1 then 12000
  when 2 then 15000
  when 3 then 21000
  when 4 then 21000
  when 5 then 21000
  else hourly_rate_paise
end
where table_number between 1 and 5;

alter table public.play_sessions
  alter column hourly_rate_paise set not null;

create or replace function public.start_play_session(p_table_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_id uuid; v_rate bigint;
begin
  if public.current_role() not in ('owner','staff') then raise exception 'Unauthorised account'; end if;
  select hourly_rate_paise into v_rate
  from public.snooker_tables where id=p_table_id and active=true;
  if not found then raise exception 'Table is unavailable'; end if;
  insert into public.play_sessions(table_id,started_by,hourly_rate_paise)
  values(p_table_id,auth.uid(),v_rate) returning id into v_id;
  perform public.audit('session_started',jsonb_build_object('session_id',v_id,'table_id',p_table_id,'hourly_rate_paise',v_rate));
  return v_id;
end; $$;

create or replace function public.end_play_session(p_table_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v public.play_sessions%rowtype; v_minutes integer; v_amount bigint;
begin
  if public.current_role() not in ('owner','staff') then raise exception 'Unauthorised account'; end if;
  select * into v from public.play_sessions where table_id=p_table_id and status='running' for update;
  if not found then raise exception 'No active session for this table'; end if;
  v_minutes := greatest(1,ceil(extract(epoch from (clock_timestamp()-v.started_at))/60.0)::integer);
  v_amount := ceil(v_minutes * v.hourly_rate_paise::numeric / 60.0)::bigint;
  update public.play_sessions set ended_at=clock_timestamp(),ended_by=auth.uid(),status='ended',
    billable_minutes=v_minutes,amount_paise=v_amount where id=v.id;
  perform public.audit('session_ended',jsonb_build_object('session_id',v.id,'table_id',p_table_id,'minutes',v_minutes,'hourly_rate_paise',v.hourly_rate_paise,'amount_paise',v_amount));
  return v.id;
end; $$;

create or replace function public.update_table_rate(p_table_id uuid,p_hourly_rate_paise bigint)
returns void language plpgsql security definer set search_path=public
as $$
declare v_label text;
begin
  if public.current_role() <> 'owner' then raise exception 'Owner permission required'; end if;
  if p_hourly_rate_paise is null or p_hourly_rate_paise <= 0 then raise exception 'Hourly rate must be greater than zero'; end if;
  update public.snooker_tables set hourly_rate_paise=p_hourly_rate_paise
  where id=p_table_id and active=true returning label into v_label;
  if not found then raise exception 'Active table not found'; end if;
  perform public.audit('table_rate_updated',jsonb_build_object('table',v_label,'hourly_rate_paise',p_hourly_rate_paise));
end; $$;

grant execute on function public.start_play_session(uuid) to authenticated;
grant execute on function public.end_play_session(uuid) to authenticated;
grant execute on function public.update_table_rate(uuid,bigint) to authenticated;
