# LP HRM — Free starter setup

This repository is being upgraded from a local attendance tracker to a multi-user HRM web app.

## Planned modules
- Admin / HR / Supervisor / Employee roles
- Employee directory
- Shared attendance and punch in/out
- Leave requests and approvals
- Payroll periods (20th through 20th), salary components, OT estimates and salary slips
- Daily / weekly / monthly / custom reports
- Mobile-friendly installable PWA

## Free-tier architecture
- GitHub Pages: static frontend hosting
- Supabase Free: authentication + PostgreSQL database (free tier limits apply)
- Browser app: never include a Supabase service_role key

## Setup database
1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Create the first Auth user in Supabase Authentication.
5. After sign-in, use SQL Editor to link that user to an employee record and assign the initial role. For example, after creating an employee row and knowing the Auth user's UUID:

```sql
insert into public.profiles (user_id, employee_id, display_name, role)
values ('AUTH-USER-UUID', 'EMPLOYEE-UUID', 'HR Admin', 'admin');
```

Replace both UUID placeholders with real values. Do not publish personal employee data in this repository.

## Security notes
- Row Level Security is enabled for all HR tables.
- Admin/HR access is broad; employees are scoped to their own profile, attendance, leave, and payroll item; supervisors can see direct reports.
- Have a qualified reviewer check database policies and UAE employment/payroll rules before using this for real payroll.
- Never expose a Supabase service-role key in HTML/JavaScript. Use only the public anon/publishable key in the client, with RLS correctly configured.

## Current status
The existing `index.html` attendance app still uses browser local storage. This schema is the first backend foundation; it does not automatically connect the current frontend to Supabase. The next implementation step is the login screen and authenticated data layer.
