-- ============================================================
-- HTC FIELD OPS — ADDITIONAL SQL
-- Run this AFTER supabase_schema.sql
-- ============================================================

-- PIN verification function (called from app.js kiosk)
-- Uses pgcrypto to safely compare hashed PINs
create extension if not exists pgcrypto;

create or replace function verify_employee_pin(p_employee_id uuid, p_pin text)
returns boolean language plpgsql security definer as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash from profiles where id = p_employee_id;
  if stored_hash is null then return false; end if;
  return stored_hash = crypt(p_pin, stored_hash);
end;
$$;

-- Set a PIN for an employee (run this for each employee)
-- Example: select set_employee_pin('uuid-here', '1234');
create or replace function set_employee_pin(p_employee_id uuid, p_pin text)
returns void language plpgsql security definer as $$
begin
  update profiles
  set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_employee_id;
end;
$$;

-- Only admins can call set_employee_pin
revoke execute on function set_employee_pin from public;
grant execute on function set_employee_pin to authenticated;

-- Allow all authenticated users to call verify_employee_pin
grant execute on function verify_employee_pin to authenticated;

-- ============================================================
-- ADMIN HELPER: view clocked-in status with last ping
-- ============================================================
create or replace view employee_status as
select
  p.id,
  p.first_name || ' ' || p.last_name as name,
  p.initials,
  p.role,
  te.id as time_entry_id,
  te.clock_in_at,
  j.name as job_name,
  te.clock_in_lat,
  te.clock_in_lng,
  lp.lat as last_ping_lat,
  lp.lng as last_ping_lng,
  lp.pinged_at as last_ping_at,
  case when te.id is not null then true else false end as is_clocked_in
from profiles p
left join time_entries te on te.employee_id = p.id and te.clock_out_at is null
left join jobs j on te.job_id = j.id
left join lateral (
  select lat, lng, pinged_at from location_pings
  where employee_id = p.id
  order by pinged_at desc limit 1
) lp on true
where p.is_active = true;

-- RLS on the view
create policy "employee_status_admin" on profiles for select using (is_admin());
