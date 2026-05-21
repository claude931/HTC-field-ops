# HTC Field Ops — Setup Guide
## Supabase + Vercel Deployment

---

## STEP 1 — Create your Supabase project

1. Go to **https://supabase.com** and create a free account
2. Click **New project**
3. Name it `htc-field-ops`
4. Choose a strong database password (save it somewhere safe)
5. Region: **West US (Oregon)** — closest to Sandpoint
6. Click **Create new project** and wait ~2 minutes

---

## STEP 2 — Run the database schema

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase_schema.sql` from this folder
4. **Copy the entire contents** and paste into the SQL editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned"
7. Repeat with `supabase_rpc.sql`

---

## STEP 3 — Get your API keys

1. In Supabase dashboard, go to **Settings → API**
2. Copy your **Project URL** — looks like `https://abcdefgh.supabase.co`
3. Copy your **anon/public** key — long string starting with `eyJ...`
4. Open `app.js` in any text editor
5. Replace these two lines at the top:
   ```
   const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
   ```
   With your actual values.

---

## STEP 4 — Create your employee accounts

For each employee, you need to create an auth account AND set their PIN.

**Creating accounts:**
1. In Supabase dashboard → **Authentication → Users**
2. Click **Invite user**
3. Enter their email address
4. They'll get an email to set their password
5. Repeat for all employees

**After each employee logs in the first time**, go to:
- Supabase → **Table Editor → profiles**
- Find their row and set their `role` to the correct value:
  - `field` — regular crew
  - `foreman` — Seth Hill and other foremen
  - `project_manager` — Chris Dries and PMs
  - `office` — office staff
  - `admin` — full access

**Setting PINs** (run in SQL Editor):
```sql
-- Replace the UUID with the actual profile ID from the profiles table
select set_employee_pin('employee-uuid-here', '1234');
```
Do this for each employee. Use a unique 4-digit PIN per person.

---

## STEP 5 — Seed your current tool inventory

1. In Supabase → **Table Editor → tools**
2. The schema already seeded the tool categories and ~50 common tools from your spreadsheet
3. Add your actual owned quantities:
   - Click any tool row
   - Update the `total_owned` field
   - Click **Save**
4. Or bulk-update via SQL:
   ```sql
   update tools set total_owned = 3 where name = 'Rotohammer' and size_type = 'SDS-Max';
   update tools set total_owned = 5 where name = 'Skill Saw' and size_type = '7-1/4"';
   -- etc.
   ```

**Add tools to job sites** (assign current loadouts):
```sql
-- Find job ID first
select id, name from jobs;

-- Then assign tools
insert into tool_locations (tool_id, job_id, quantity)
values (
  (select id from tools where name='Rotohammer' and size_type='SDS-Max'),
  (select id from jobs where job_number='413/417'),
  2
);
```

---

## STEP 6 — Deploy to Vercel

1. Go to **https://vercel.com** and create a free account (sign in with GitHub recommended)
2. Click **Add New → Project**
3. Choose **Upload** (drag the entire `htc-field-ops` folder)
4. Click **Deploy**
5. After ~30 seconds, your app is live at a URL like `htc-field-ops.vercel.app`

**To use a custom domain** (optional):
- Vercel → your project → **Settings → Domains**
- Add `ops.hilltopcraftsmen.com` or similar
- Follow their DNS instructions

---

## STEP 7 — Install on phones (PWA)

**iPhone/iPad:**
1. Open Safari and go to your app URL
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**
5. The app icon will appear on the home screen

**Android:**
1. Open Chrome and go to your app URL
2. Tap the **three-dot menu**
3. Tap **Add to Home screen**
4. Tap **Add**

**For kiosk devices (company tablets):**
- Install using the steps above
- Sign in with the `kiosk@hilltopcraftsmen.com` account (create one in Supabase Auth)
- The kiosk tab will always be available for employees to tap their name + PIN

---

## STEP 8 — Ongoing admin

**Supabase Table Editor** is your back-office admin panel:
- **jobs** — add new jobs, change status (active → punch_list → completed)
- **tools** — add tools, update quantities, retire tools
- **profiles** — manage employees, change roles
- **timecards** — view and override any timecard
- **tool_transfers** — full transfer history
- **audit_log** — see every change ever made with who made it

**The app itself** handles:
- Daily clock-in/out with geo-tags
- Work descriptions at clock-out
- Tool transfers between sites
- Admin timecard approval
- Weekly exports to CSV

---

## TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| "Profile not found" on login | Run: `select * from profiles where id = auth.uid()` in SQL editor while logged in |
| PIN not working on kiosk | Run: `select set_employee_pin('their-id', 'their-pin')` in SQL editor |
| Tools not showing quantities | Update `total_owned` in the tools table |
| Clock-in fails | Check if employee already has an open time entry (no clock_out_at) |
| Geo-tag not recording | User must allow location permission when browser prompts |
| Offline data not syncing | Check internet connection; data queues locally and syncs on reconnect |
| Can't see Admin tab | Check that profile `role` is set to `foreman`, `project_manager`, `office`, or `admin` |

---

## CONTACTS / SUPPORT

- Supabase docs: https://supabase.com/docs
- Vercel docs: https://vercel.com/docs
- This app was designed for Hilltop Craftsmen, Sandpoint ID
