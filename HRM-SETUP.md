# LP HRM — Free starter setup

This repository now contains the original local attendance page (`index.html`) and a cloud-ready HRM starter page (`hrm.html`). The HRM page requires a Supabase project before login and shared data will work.

## Included in this starter
- Admin / HR / Supervisor / Employee role structure
- Employee directory
- Shared attendance and punch in/out
- Leave requests and approvals
- Payroll period records (configure the dates for 20th-to-20th periods)
- Responsive mobile-first web UI
- Database row-level security policies

## Free-tier architecture
- GitHub Pages: static frontend hosting
- Supabase Free: authentication + PostgreSQL database (free-tier limits apply)
- Optional later: make the page installable as a PWA

## Setup steps
1. Create a project at Supabase.
2. Open the project's SQL Editor and run the entire file `supabase/schema.sql`.
3. In Supabase Authentication, create the first administrator user with email and password.
4. In SQL Editor, create an employee record for that admin, then link the Auth user to that employee and assign the admin role. Replace the placeholders below with real UUIDs and values:

```sql
insert into public.employees (employee_code, full_name, email, department, designation, basic_salary, allowances)
values ('ADMIN001', 'HR Administrator', 'admin@example.com', 'HR', 'HR Admin', 0, 0)
returning id;

-- Copy the returned employee UUID and the Auth user UUID from Supabase Authentication:
insert into public.profiles (user_id, employee_id, display_name, role)
values ('AUTH-USER-UUID', 'EMPLOYEE-UUID', 'HR Administrator', 'admin');
```

5. Open `hrm.html` in GitHub and edit the two constants near the bottom:
   - `SUPABASE_URL`: your Supabase Project URL
   - `SUPABASE_ANON_KEY`: your project's publishable/anon key
6. Commit the change, then open the deployed HRM page at `https://yaseeninoor.github.io/LP---Attendance/hrm.html` (if GitHub Pages is enabled for this repository).
7. Sign in with the admin account created in step 3.

## Important security notes
- Never put a Supabase `service_role` key in browser JavaScript or a public repository.
- Create user accounts through Supabase Authentication; then link each account to an employee row using `public.profiles`.
- Assign the first admin role manually in SQL Editor. Do not let public users choose their own role.
- Review row-level security policies with a qualified reviewer before entering real employee or salary data.
- The HRM starter is a foundation, not yet a fully audited production payroll system. Payroll item creation, salary slip generation, comprehensive approval audit trails, leave balance calculations, and manager-specific permissions need further implementation/testing.
- The existing `index.html` attendance page continues to use browser local storage and is separate from the new shared HRM starter.
- Validate overtime and payroll calculations against your company policy and applicable UAE rules before using them for salary payment.
