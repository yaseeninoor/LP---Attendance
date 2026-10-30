-- LP HRM starter schema for Supabase PostgreSQL
-- Run in Supabase SQL Editor. Review policies before storing real employee data.

create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  full_name text not null,
  email text unique,
  phone text,
  department text,
  designation text,
  joining_date date,
  employment_status text not null default 'active' check (employment_status in ('active','inactive','on_leave','terminated')),
  manager_id uuid references public.employees(id) on delete set null,
  basic_salary numeric(12,2) not null default 0 check (basic_salary >= 0),
  allowances numeric(12,2) not null default 0 check (allowances >= 0),
  standard_daily_hours numeric(4,2) not null default 8 check (standard_daily_hours > 0 and standard_daily_hours <= 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid unique references public.employees(id) on delete set null,
  display_name text,
  role text not null default 'employee' check (role in ('admin','hr','supervisor','employee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null default current_date,
  punch_in timestamptz,
  punch_out timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  status text not null default 'present' check (status in ('present','absent','leave','holiday','rest_day','correction_pending')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, work_date),
  check (punch_out is null or punch_in is null or punch_out >= punch_in)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual','sick','unpaid','emergency','other')),
  start_date date not null,
  end_date date not null,
  days numeric(5,2) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  check (end_date >= start_date)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','reviewed','approved','paid')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  basic_salary numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  overtime_amount numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  other_additions numeric(12,2) not null default 0,
  net_salary numeric(12,2) generated always as (basic_salary + allowances + overtime_amount + other_additions - deductions) stored,
  notes text,
  unique(payroll_run_id, employee_id)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid() and active = true limit 1;
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select employee_id from public.profiles where user_id = auth.uid() and active = true limit 1;
$$;

create or replace function public.is_hr_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin','hr'), false);
$$;

alter table public.employees enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance enable row level security;
alter table public.leave_requests enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;
alter table public.audit_log enable row level security;

-- Employees: HR/Admin see and manage all; employees see their own profile; supervisors see direct reports.
drop policy if exists "employees_read_scoped" on public.employees;
create policy "employees_read_scoped" on public.employees for select to authenticated
using (
  public.is_hr_or_admin()
  or id = public.current_employee_id()
  or manager_id = public.current_employee_id()
);
drop policy if exists "employees_manage_hr" on public.employees;
create policy "employees_manage_hr" on public.employees for all to authenticated
using (public.is_hr_or_admin()) with check (public.is_hr_or_admin());

-- Profiles: users can read their own profile; only Admin manages role/profile assignments.
drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
using (user_id = auth.uid() or public.current_app_role() = 'admin');
drop policy if exists "profiles_admin_manage" on public.profiles;
create policy "profiles_admin_manage" on public.profiles for all to authenticated
using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- Attendance: employees read their own; supervisors read direct reports; HR/Admin read/manage all.
drop policy if exists "attendance_read_scoped" on public.attendance;
create policy "attendance_read_scoped" on public.attendance for select to authenticated
using (
  public.is_hr_or_admin()
  or employee_id = public.current_employee_id()
  or exists (select 1 from public.employees e where e.id = attendance.employee_id and e.manager_id = public.current_employee_id())
);
drop policy if exists "attendance_insert_self_or_hr" on public.attendance;
create policy "attendance_insert_self_or_hr" on public.attendance for insert to authenticated
with check (public.is_hr_or_admin() or employee_id = public.current_employee_id());
drop policy if exists "attendance_update_scoped" on public.attendance;
create policy "attendance_update_scoped" on public.attendance for update to authenticated
using (public.is_hr_or_admin() or employee_id = public.current_employee_id())
with check (public.is_hr_or_admin() or employee_id = public.current_employee_id());
drop policy if exists "attendance_delete_hr" on public.attendance;
create policy "attendance_delete_hr" on public.attendance for delete to authenticated
using (public.is_hr_or_admin());

-- Leave requests: employees submit/read own; HR/Admin and direct supervisors review.
drop policy if exists "leave_read_scoped" on public.leave_requests;
create policy "leave_read_scoped" on public.leave_requests for select to authenticated
using (
  public.is_hr_or_admin()
  or employee_id = public.current_employee_id()
  or exists (select 1 from public.employees e where e.id = leave_requests.employee_id and e.manager_id = public.current_employee_id())
);
drop policy if exists "leave_insert_self" on public.leave_requests;
create policy "leave_insert_self" on public.leave_requests for insert to authenticated
with check (employee_id = public.current_employee_id());
drop policy if exists "leave_update_reviewers" on public.leave_requests;
create policy "leave_update_reviewers" on public.leave_requests for update to authenticated
using (
  public.is_hr_or_admin()
  or exists (select 1 from public.employees e where e.id = leave_requests.employee_id and e.manager_id = public.current_employee_id())
)
with check (
  public.is_hr_or_admin()
  or exists (select 1 from public.employees e where e.id = leave_requests.employee_id and e.manager_id = public.current_employee_id())
);

-- Payroll: only HR/Admin can read or write payroll runs/items.
drop policy if exists "payroll_runs_hr_only" on public.payroll_runs;
create policy "payroll_runs_hr_only" on public.payroll_runs for all to authenticated
using (public.is_hr_or_admin()) with check (public.is_hr_or_admin());
drop policy if exists "payroll_items_hr_or_self_read" on public.payroll_items;
create policy "payroll_items_hr_or_self_read" on public.payroll_items for select to authenticated
using (public.is_hr_or_admin() or employee_id = public.current_employee_id());
drop policy if exists "payroll_items_hr_write" on public.payroll_items;
create policy "payroll_items_hr_write" on public.payroll_items for all to authenticated
using (public.is_hr_or_admin()) with check (public.is_hr_or_admin());

-- Audit logs are only visible to Admin/HR; insert should be performed by trusted server functions.
drop policy if exists "audit_log_read_hr" on public.audit_log;
create policy "audit_log_read_hr" on public.audit_log for select to authenticated
using (public.is_hr_or_admin());

-- Important: do not put the Supabase service_role key in browser code.
