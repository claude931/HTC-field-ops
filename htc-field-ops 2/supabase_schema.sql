-- ============================================================
-- HTC FIELD OPS — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "postgis"; -- for geo tracking

-- ============================================================
-- ENUMS
-- ============================================================
create type user_role as enum ('field', 'foreman', 'project_manager', 'office', 'admin');
create type job_status as enum ('bidding', 'awarded', 'active', 'punch_list', 'completed', 'dnb');
create type tool_condition as enum ('excellent', 'good', 'fair', 'needs_repair', 'retired');
create type timecard_status as enum ('in_progress', 'submitted', 'approved', 'rejected');
create type transfer_direction as enum ('shop_to_site', 'site_to_site', 'site_to_shop');

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  initials text generated always as (upper(left(first_name,1) || left(last_name,1))) stored,
  role user_role not null default 'field',
  pin_hash text, -- bcrypt hash of 4-digit PIN for kiosk
  phone text,
  email text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- JOBS
-- ============================================================
create table jobs (
  id uuid primary key default uuid_generate_v4(),
  job_number text unique not null, -- e.g. "413/417"
  name text not null,              -- e.g. "Church St Apartments"
  address text,
  city text,
  state text default 'WA',
  status job_status default 'active',
  foreman_id uuid references profiles(id),
  start_date date,
  estimated_end_date date,
  actual_end_date date,
  contract_value numeric(12,2),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed real jobs from your spreadsheet
insert into jobs (job_number, name, address, city, status) values
  ('413/417', 'Church St Apartments', '413-417 Church St', 'Sandpoint', 'active'),
  ('NLH', 'Nespelem Longhouse', 'Nespelem', 'Nespelem', 'active'),
  ('BM', 'Browns Manor', 'Browns Manor Dr', 'Sandpoint', 'active'),
  ('FIX', 'Fix Res.', 'Various', 'Sandpoint', 'active'),
  ('SHOP', 'Shop / Warehouse', '123 Shop Rd', 'Sandpoint', 'active'),
  ('CAR', 'Kootenai County Coroners', 'Coeur d Alene', 'Coeur d Alene', 'active');

-- ============================================================
-- TOOL CATEGORIES
-- ============================================================
create table tool_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  sort_order int default 0
);

insert into tool_categories (name, sort_order) values
  ('Air', 1), ('Guns & Drills', 2), ('Saws & Cutting', 3),
  ('Measuring & Layout', 4), ('Fastening', 5), ('Lifting & Material Handling', 6),
  ('Safety', 7), ('Electrical', 8), ('Plumbing', 9), ('Misc', 10);

-- ============================================================
-- MASTER INVENTORY (source of truth for all tools)
-- ============================================================
create table tools (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid references tool_categories(id),
  name text not null,
  size_type text,
  item_key text generated always as (name || ' | ' || coalesce(size_type,'')) stored,
  total_owned int default 0 check (total_owned >= 0),
  min_shop_stock int default 0,
  is_consumable boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- TOOL LOCATIONS (live inventory per job site)
-- ============================================================
create table tool_locations (
  id uuid primary key default uuid_generate_v4(),
  tool_id uuid references tools(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  quantity int default 0 check (quantity >= 0),
  updated_at timestamptz default now(),
  unique(tool_id, job_id)
);

-- ============================================================
-- TRANSFER LOG
-- ============================================================
create table tool_transfers (
  id uuid primary key default uuid_generate_v4(),
  tool_id uuid references tools(id),
  from_job_id uuid references jobs(id),
  to_job_id uuid references jobs(id),
  quantity int not null check (quantity > 0),
  condition tool_condition default 'good',
  transferred_by uuid references profiles(id),
  notes text,
  transferred_at timestamptz default now()
);

-- ============================================================
-- TIME ENTRIES
-- ============================================================
create table time_entries (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id),
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  clock_in_lat numeric(10,7),
  clock_in_lng numeric(10,7),
  clock_out_lat numeric(10,7),
  clock_out_lng numeric(10,7),
  work_description text,
  hours_worked numeric(5,2) generated always as (
    case when clock_out_at is not null
    then round(extract(epoch from (clock_out_at - clock_in_at))/3600.0, 2)
    else null end
  ) stored,
  is_edited boolean default false,
  edited_by uuid references profiles(id),
  edited_at timestamptz,
  edit_reason text,
  created_at timestamptz default now()
);

-- ============================================================
-- LOCATION PINGS (background GPS every 15 min while clocked in)
-- ============================================================
create table location_pings (
  id uuid primary key default uuid_generate_v4(),
  time_entry_id uuid references time_entries(id) on delete cascade,
  employee_id uuid references profiles(id),
  lat numeric(10,7) not null,
  lng numeric(10,7) not null,
  accuracy_meters int,
  pinged_at timestamptz default now()
);

-- ============================================================
-- WEEKLY TIMECARDS (aggregate view per employee per week)
-- ============================================================
create table timecards (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references profiles(id),
  week_start date not null, -- always Monday
  status timecard_status default 'in_progress',
  total_hours numeric(6,2),
  submitted_at timestamptz,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejected_reason text,
  unique(employee_id, week_start)
);

-- ============================================================
-- DAILY REPORTS
-- ============================================================
create table daily_reports (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid references jobs(id),
  report_date date not null,
  foreman_id uuid references profiles(id),
  crew_present uuid[], -- array of profile ids
  work_completed text,
  materials_on_site text,
  upcoming_needs text,
  change_orders text,
  notes text,
  created_at timestamptz default now(),
  unique(job_id, report_date)
);

-- ============================================================
-- TOOLBOX CHECKLISTS (per job loadout)
-- ============================================================
create table job_loadouts (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid references jobs(id),
  tool_id uuid references tools(id),
  qty_needed int default 0,
  qty_loaded int default 0,
  needs boolean default false,
  notes text,
  updated_at timestamptz default now(),
  unique(job_id, tool_id)
);

-- ============================================================
-- AUDIT LOG (automatic change tracking)
-- ============================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid,
  action text not null, -- INSERT, UPDATE, DELETE
  changed_by uuid references profiles(id),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz default now()
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Live inventory availability per tool
create or replace view tool_availability as
select
  t.id,
  t.name,
  t.size_type,
  t.item_key,
  t.total_owned,
  tc.name as category,
  coalesce(sum(tl.quantity) filter (where j.id != (select id from jobs where name='Shop / Warehouse' limit 1)), 0) as qty_deployed,
  t.total_owned - coalesce(sum(tl.quantity) filter (where j.id != (select id from jobs where name='Shop / Warehouse' limit 1)), 0) as qty_available,
  case when t.total_owned - coalesce(sum(tl.quantity) filter (where j.id != (select id from jobs where name='Shop / Warehouse' limit 1)), 0) < t.min_shop_stock then true else false end as is_shortage
from tools t
left join tool_categories tc on t.category_id = tc.id
left join tool_locations tl on t.id = tl.tool_id
left join jobs j on tl.job_id = j.id
group by t.id, tc.name;

-- Weekly hours summary per employee
create or replace view weekly_hours as
select
  p.id as employee_id,
  p.first_name || ' ' || p.last_name as employee_name,
  p.initials,
  date_trunc('week', te.clock_in_at)::date as week_start,
  sum(te.hours_worked) as total_hours,
  array_agg(distinct j.name) as jobs_worked
from time_entries te
join profiles p on te.employee_id = p.id
join jobs j on te.job_id = j.id
where te.clock_out_at is not null
group by p.id, p.first_name, p.last_name, p.initials, date_trunc('week', te.clock_in_at)::date;

-- Currently clocked in employees
create or replace view clocked_in_now as
select
  p.id,
  p.first_name || ' ' || p.last_name as name,
  p.initials,
  j.name as job_name,
  te.clock_in_at,
  te.clock_in_lat,
  te.clock_in_lng
from time_entries te
join profiles p on te.employee_id = p.id
join jobs j on te.job_id = j.id
where te.clock_out_at is null;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at on any table that has it
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_profiles_updated before update on profiles for each row execute function update_updated_at();
create trigger trg_jobs_updated before update on jobs for each row execute function update_updated_at();
create trigger trg_tools_updated before update on tools for each row execute function update_updated_at();

-- Auto-create timecard record when employee clocks in for first time in a week
create or replace function ensure_timecard()
returns trigger language plpgsql security definer as $$
declare wk date;
begin
  wk := date_trunc('week', new.clock_in_at)::date;
  insert into timecards (employee_id, week_start, status)
  values (new.employee_id, wk, 'in_progress')
  on conflict (employee_id, week_start) do nothing;
  return new;
end; $$;

create trigger trg_ensure_timecard after insert on time_entries
for each row execute function ensure_timecard();

-- Auto-update timecard total hours when time entry is completed
create or replace function update_timecard_hours()
returns trigger language plpgsql security definer as $$
declare wk date;
begin
  wk := date_trunc('week', new.clock_in_at)::date;
  update timecards set
    total_hours = (
      select sum(hours_worked) from time_entries
      where employee_id = new.employee_id
      and date_trunc('week', clock_in_at)::date = wk
      and clock_out_at is not null
    )
  where employee_id = new.employee_id and week_start = wk;
  return new;
end; $$;

create trigger trg_update_timecard_hours after update of clock_out_at on time_entries
for each row when (new.clock_out_at is not null) execute function update_timecard_hours();

-- Update tool_locations when transfer is logged
create or replace function apply_transfer()
returns trigger language plpgsql security definer as $$
begin
  -- Remove qty from source
  insert into tool_locations (tool_id, job_id, quantity)
  values (new.tool_id, new.from_job_id, 0)
  on conflict (tool_id, job_id) do nothing;

  update tool_locations
  set quantity = greatest(0, quantity - new.quantity), updated_at = now()
  where tool_id = new.tool_id and job_id = new.from_job_id;

  -- Add qty to destination
  insert into tool_locations (tool_id, job_id, quantity)
  values (new.tool_id, new.to_job_id, new.quantity)
  on conflict (tool_id, job_id)
  do update set quantity = tool_locations.quantity + new.quantity, updated_at = now();

  return new;
end; $$;

create trigger trg_apply_transfer after insert on tool_transfers
for each row execute function apply_transfer();

-- Audit log trigger (applies to time_entries and tool_transfers)
create or replace function write_audit_log()
returns trigger language plpgsql security definer as $$
begin
  insert into audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    TG_OP,
    auth.uid(),
    case when TG_OP != 'INSERT' then row_to_json(old)::jsonb else null end,
    case when TG_OP != 'DELETE' then row_to_json(new)::jsonb else null end
  );
  return coalesce(new, old);
end; $$;

create trigger trg_audit_time_entries after insert or update or delete on time_entries
for each row execute function write_audit_log();
create trigger trg_audit_transfers after insert on tool_transfers
for each row execute function write_audit_log();

-- Prevent double clock-in (employee can't clock in if already clocked in)
create or replace function check_no_double_clockin()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from time_entries
    where employee_id = new.employee_id and clock_out_at is null
  ) then
    raise exception 'Employee is already clocked in. Please clock out first.';
  end if;
  return new;
end; $$;

create trigger trg_no_double_clockin before insert on time_entries
for each row execute function check_no_double_clockin();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table jobs enable row level security;
alter table tools enable row level security;
alter table tool_locations enable row level security;
alter table tool_transfers enable row level security;
alter table time_entries enable row level security;
alter table location_pings enable row level security;
alter table timecards enable row level security;
alter table daily_reports enable row level security;
alter table job_loadouts enable row level security;
alter table audit_log enable row level security;

-- Helper: check if current user is admin/foreman/pm/office
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
    and role in ('admin','foreman','project_manager','office')
  );
$$;

-- Profiles: users see own profile, admins see all
create policy "profiles_select_own" on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());
create policy "profiles_admin_all" on profiles for all using (is_admin());

-- Jobs: all authenticated users can read, only admins can modify
create policy "jobs_read_all" on jobs for select using (auth.role() = 'authenticated');
create policy "jobs_admin_write" on jobs for all using (is_admin());

-- Tools: all read, admins write
create policy "tools_read_all" on tools for select using (auth.role() = 'authenticated');
create policy "tools_admin_write" on tools for all using (is_admin());

-- Tool locations: all read, admins write (transfers handled via trigger)
create policy "tool_locations_read" on tool_locations for select using (auth.role() = 'authenticated');
create policy "tool_locations_write" on tool_locations for all using (is_admin());

-- Transfers: all can insert (field workers transfer tools), admins can update/delete
create policy "transfers_read" on tool_transfers for select using (auth.role() = 'authenticated');
create policy "transfers_insert" on tool_transfers for insert with check (auth.role() = 'authenticated');
create policy "transfers_admin" on tool_transfers for all using (is_admin());

-- Time entries: users see own, admins see all; users insert own
create policy "time_own_select" on time_entries for select using (employee_id = auth.uid() or is_admin());
create policy "time_own_insert" on time_entries for insert with check (employee_id = auth.uid());
create policy "time_own_update" on time_entries for update using (employee_id = auth.uid() or is_admin());
create policy "time_admin_all" on time_entries for all using (is_admin());

-- Location pings: users insert own, admins see all
create policy "pings_own" on location_pings for select using (employee_id = auth.uid() or is_admin());
create policy "pings_insert" on location_pings for insert with check (employee_id = auth.uid());

-- Timecards: users see own, admins see all and can approve
create policy "timecards_own" on timecards for select using (employee_id = auth.uid() or is_admin());
create policy "timecards_admin" on timecards for all using (is_admin());

-- Daily reports: all read, foremen+ write
create policy "reports_read" on daily_reports for select using (auth.role() = 'authenticated');
create policy "reports_write" on daily_reports for all using (is_admin());

-- Audit log: admins only
create policy "audit_admin" on audit_log for select using (is_admin());

-- ============================================================
-- SEED TOOL INVENTORY (from your toolbox_loadout_inventory_v4)
-- ============================================================
-- Categories are already seeded above. Add tools per category:
do $$
declare air_id uuid; guns_id uuid; saws_id uuid; meas_id uuid; fast_id uuid; misc_id uuid;
begin
  select id into air_id from tool_categories where name='Air';
  select id into guns_id from tool_categories where name='Guns & Drills';
  select id into saws_id from tool_categories where name='Saws & Cutting';
  select id into meas_id from tool_categories where name='Measuring & Layout';
  select id into fast_id from tool_categories where name='Fastening';
  select id into misc_id from tool_categories where name='Misc';

  -- Air
  insert into tools (category_id, name, size_type) values
    (air_id,'Compressor','110V pancake/portable'),
    (air_id,'Compressor','Gas wheelbarrow'),
    (air_id,'Compressor','Twin-stack'),
    (air_id,'Compressor','Shop compressor'),
    (air_id,'Air Hose','1/4" x 25'''),
    (air_id,'Air Hose','1/4" x 50'''),
    (air_id,'Air Hose','3/8" x 25'''),
    (air_id,'Air Hose','3/8" x 50'''),
    (air_id,'Air Hose','1/2" x 50'''),
    (air_id,'Air Hose','1/2" x 100'''),
    (air_id,'Air Hose Whip','1/4" x 3'''),
    (air_id,'Air Hose Whip','3/8" x 3'''),
    (air_id,'Air Splitter/Manifold','2-way'),
    (air_id,'Air Splitter/Manifold','3-way'),
    (air_id,'Air Splitter/Manifold','4-way');

  -- Guns & Drills
  insert into tools (category_id, name, size_type) values
    (guns_id,'Framing Nailer','Clipped head'),
    (guns_id,'Framing Nailer','Round head'),
    (guns_id,'Finish Nailer','15ga'),
    (guns_id,'Finish Nailer','16ga'),
    (guns_id,'Brad Nailer','18ga'),
    (guns_id,'Stapler','1/4" - 9/16"'),
    (guns_id,'Roofing Nailer','Coil'),
    (guns_id,'Screw Gun','Collated screw gun'),
    (guns_id,'Impact Wrench','1/2" drive'),
    (guns_id,'Impact Wrench','3/8" drive'),
    (guns_id,'Impact Driver','1/4" hex'),
    (guns_id,'Right Angle Drill','Cordless'),
    (guns_id,'Right Angle Drill','Corded'),
    (guns_id,'Regular Drill','Cordless 18V'),
    (guns_id,'Regular Drill','Corded'),
    (guns_id,'Rotohammer','Compact SDS-Plus'),
    (guns_id,'Rotohammer','Full-size SDS-Plus'),
    (guns_id,'Rotohammer','SDS-Max'),
    (guns_id,'Hilti Powder Actuated Gun','DX style'),
    (guns_id,'Hilti Powder Actuated Gun','Single shot'),
    (guns_id,'Hilti Powder Actuated Gun','Semi-auto'),
    (guns_id,'Router','1/4 collet'),
    (guns_id,'Router','1/2 collet');

  -- Saws & Cutting
  insert into tools (category_id, name, size_type) values
    (saws_id,'Skill Saw','7-1/4"'),
    (saws_id,'Skill Saw','Cordless'),
    (saws_id,'Skill Saw','Corded'),
    (saws_id,'Big Foot Skill Saw','10-1/4"'),
    (saws_id,'Miter Saw','10"'),
    (saws_id,'Miter Saw','12"'),
    (saws_id,'Table Saw','Jobsite'),
    (saws_id,'Reciprocating Saw','Cordless'),
    (saws_id,'Reciprocating Saw','Corded'),
    (saws_id,'Jig Saw','Cordless'),
    (saws_id,'Jig Saw','Corded'),
    (saws_id,'Oscillating Tool','Cordless'),
    (saws_id,'Grinder','4-1/2"'),
    (saws_id,'Grinder','7"');
end $$;
