-- Green Pocket Snooker Zone database schema
-- Run this entire file in Supabase SQL Editor as project owner.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.snooker_tables (
  id uuid primary key default gen_random_uuid(),
  table_number integer not null unique,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.snooker_tables(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running','ended')),
  started_by uuid not null references public.profiles(id),
  ended_by uuid references public.profiles(id),
  billable_minutes integer,
  amount_paise bigint,
  created_at timestamptz not null default now()
);

create unique index if not exists one_running_session_per_table
on public.play_sessions(table_id) where status='running';

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.play_sessions(id),
  amount_paise bigint not null check (amount_paise >= 0),
  method text not null check (method in ('cash','upi')),
  invoice_no text not null unique,
  paid_at timestamptz not null default now(),
  received_by uuid not null references public.profiles(id)
);

create sequence if not exists public.invoice_seq start 1;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  amount_paise bigint not null check (amount_paise > 0),
  description text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles(id)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true $$;

create or replace function public.audit(p_action text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public
as $$ begin
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),p_action,coalesce(p_details,'{}'::jsonb));
end; $$;

create or replace function public.start_play_session(p_table_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if public.current_role() not in ('owner','staff') then raise exception 'Unauthorised account'; end if;
  if not exists(select 1 from public.snooker_tables where id=p_table_id and active=true) then raise exception 'Table is unavailable'; end if;
  insert into public.play_sessions(table_id,started_by) values(p_table_id,auth.uid()) returning id into v_id;
  perform public.audit('session_started',jsonb_build_object('session_id',v_id,'table_id',p_table_id));
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
  v_amount := ceil(v_minutes * 25000.0 / 60.0)::bigint;
  update public.play_sessions set ended_at=clock_timestamp(),ended_by=auth.uid(),status='ended',
    billable_minutes=v_minutes,amount_paise=v_amount where id=v.id;
  perform public.audit('session_ended',jsonb_build_object('session_id',v.id,'table_id',p_table_id,'minutes',v_minutes,'amount_paise',v_amount));
  return v.id;
end; $$;

create or replace function public.receive_session_payment(p_session_id uuid,p_method text)
returns text language plpgsql security definer set search_path=public
as $$
declare v public.play_sessions%rowtype; v_invoice text;
begin
  if public.current_role() not in ('owner','staff') then raise exception 'Unauthorised account'; end if;
  if p_method not in ('cash','upi') then raise exception 'Invalid payment method'; end if;
  select * into v from public.play_sessions where id=p_session_id and status='ended' for update;
  if not found then raise exception 'Completed session not found'; end if;
  if exists(select 1 from public.payments where session_id=p_session_id) then raise exception 'Payment already recorded'; end if;
  v_invoice := 'GP-' || lpad(nextval('public.invoice_seq')::text,6,'0');
  insert into public.payments(session_id,amount_paise,method,invoice_no,received_by)
  values(v.id,v.amount_paise,p_method,v_invoice,auth.uid());
  perform public.audit('payment_received',jsonb_build_object('session_id',v.id,'method',p_method,'amount_paise',v.amount_paise,'invoice_no',v_invoice));
  return v_invoice;
end; $$;

create or replace function public.add_snooker_table()
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_num integer; v_id uuid;
begin
  if public.current_role() <> 'owner' then raise exception 'Owner permission required'; end if;
  select coalesce(max(table_number),0)+1 into v_num from public.snooker_tables;
  insert into public.snooker_tables(table_number,label) values(v_num,'Table '||v_num) returning id into v_id;
  perform public.audit('table_added',jsonb_build_object('table_number',v_num));
  return v_id;
end; $$;

create or replace function public.record_cash_reconciliation(p_opening_cash_paise bigint,p_counted_cash_paise bigint)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if public.current_role() <> 'owner' then raise exception 'Owner permission required'; end if;
  if p_opening_cash_paise < 0 or p_counted_cash_paise < 0 then raise exception 'Cash values cannot be negative'; end if;
  perform public.audit('cash_reconciled',jsonb_build_object('opening_cash_paise',p_opening_cash_paise,'counted_cash_paise',p_counted_cash_paise,'reconciled_at',now()));
end; $$;

-- Enable row-level security.
alter table public.profiles enable row level security;
alter table public.snooker_tables enable row level security;
alter table public.play_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

create policy "profile read self or owner" on public.profiles for select to authenticated
using (id=auth.uid() or public.current_role()='owner');
create policy "tables read signed-in" on public.snooker_tables for select to authenticated
using (public.current_role() in ('owner','staff'));
create policy "sessions read signed-in" on public.play_sessions for select to authenticated
using (public.current_role() in ('owner','staff'));
create policy "payments read signed-in" on public.payments for select to authenticated
using (public.current_role() in ('owner','staff'));
create policy "expenses read owner" on public.expenses for select to authenticated
using (public.current_role()='owner');
create policy "expenses insert owner" on public.expenses for insert to authenticated
with check (public.current_role()='owner' and created_by=auth.uid());
create policy "audit read owner" on public.audit_log for select to authenticated
using (public.current_role()='owner');

-- No direct client-side writes to sessions, payments, tables, profiles or audit log.
revoke insert, update, delete on public.play_sessions from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;
revoke insert, update, delete on public.snooker_tables from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.audit_log from anon, authenticated;
grant execute on function public.start_play_session(uuid) to authenticated;
grant execute on function public.end_play_session(uuid) to authenticated;
grant execute on function public.receive_session_payment(uuid,text) to authenticated;
grant execute on function public.add_snooker_table() to authenticated;
grant execute on function public.record_cash_reconciliation(bigint,bigint) to authenticated;

-- Create the first five tables.
insert into public.snooker_tables(table_number,label)
select n,'Table '||n from generate_series(1,5) n
on conflict (table_number) do nothing;

-- IMPORTANT: create the first auth user in Supabase Authentication, then run:
-- insert into public.profiles(id,full_name,role)
-- values ('AUTH-USER-UUID','Owner Name','owner');
-- Add staff in Authentication, then insert their UUID with role='staff'.
