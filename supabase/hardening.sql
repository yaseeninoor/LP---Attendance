-- Secure attendance punching RPC (UAE local work date).
-- Run after schema.sql on an existing project. Safe to re-run.

create or replace function public.punch_attendance(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_now timestamptz := now();
  v_today date;
  v_row public.attendance%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.employee_id into v_employee_id
  from public.profiles p
  where p.user_id = auth.uid() and p.active = true;

  if v_employee_id is null then
    raise exception 'Your account is not linked to an active employee profile';
  end if;

  v_today := (v_now at time zone 'Asia/Dubai')::date;

  if p_kind = 'in' then
    insert into public.attendance
      (employee_id, work_date, punch_in, status, created_by, updated_by)
    values
      (v_employee_id, v_today, v_now, 'present', auth.uid(), auth.uid())
    on conflict (employee_id, work_date) do update
      set punch_in = excluded.punch_in,
          status = 'present',
          updated_by = auth.uid(),
          updated_at = now()
      where public.attendance.punch_in is null
    returning * into v_row;

    if not found then
      raise exception 'Punch In has already been recorded for today';
    end if;
  elsif p_kind = 'out' then
    update public.attendance
    set punch_out = v_now,
        updated_by = auth.uid(),
        updated_at = now()
    where employee_id = v_employee_id
      and work_date = v_today
      and punch_in is not null
      and punch_out is null
    returning * into v_row;

    if not found then
      raise exception 'Punch In first, or Punch Out has already been recorded';
    end if;
  else
    raise exception 'Invalid punch type';
  end if;

  return jsonb_build_object(
    'work_date', v_row.work_date,
    'punch_in', v_row.punch_in,
    'punch_out', v_row.punch_out,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.punch_attendance(text) from public;
revoke all on function public.punch_attendance(text) from anon;
grant execute on function public.punch_attendance(text) to authenticated;

-- Employees must not directly edit attendance timestamps through the table API.
drop policy if exists "attendance_insert_self_or_hr" on public.attendance;
drop policy if exists "attendance_update_scoped" on public.attendance;
drop policy if exists "attendance_insert_hr_only" on public.attendance;
create policy "attendance_insert_hr_only" on public.attendance
for insert to authenticated
with check (public.is_hr_or_admin());
drop policy if exists "attendance_update_hr_only" on public.attendance;
create policy "attendance_update_hr_only" on public.attendance
for update to authenticated
using (public.is_hr_or_admin())
with check (public.is_hr_or_admin());
