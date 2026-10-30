# LP HRM — Cloudflare API setup

This repository includes:
- `login.html`: responsive login page
- `dashboard.html`: dashboard for employee directory, attendance, leave requests and read-only payroll records
- `hrm.html`: routes users to the secure login or dashboard
- `worker.js`: Cloudflare Worker API for authentication and HRM endpoints

## 1. Configure the existing Worker
1. Open Cloudflare Dashboard → Workers & Pages → the existing Worker named `lp---attendance`.
2. Open its code editor and replace the Worker script with the contents of this repository's `worker.js`.
3. Open Settings → Bindings and confirm the D1 database binding is named exactly `DB` and points to `lp-hrm-db`.
4. Add a secret under Settings → Variables and Secrets:
   - Name: `ADMIN_SETUP_KEY`
   - Value: generate a long random secret (at least 32 random characters). Do not put it in GitHub or share it in chat.
5. Deploy the Worker and verify `/api/health` returns JSON with `ok: true` and `database: true`.

## 2. Confirm the database tables
The Worker expects these tables, which should already exist in `lp-hrm-db`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
```

## 3. Create the first administrator
Use a secure API client (for example, a local terminal) to send a POST request to:

`https://lp---attendance.androidlover002.workers.dev/api/auth/setup-admin`

Headers:
- `Content-Type: application/json`
- `X-Admin-Setup-Key: YOUR_ADMIN_SETUP_KEY`

JSON body:
```json
{
  "full_name": "HR Administrator",
  "email": "your-company-admin@example.com",
  "password": "use-a-unique-password-at-least-12-characters"
}
```

The setup endpoint is one-time: it refuses to create another administrator after an admin account exists. Never paste the setup key or real password into GitHub, a public issue, or chat. After setup, sign in at `https://yaseeninoor.github.io/LP---Attendance/login.html`.

## 4. Important status and limitations
- Committing `worker.js` to GitHub does not automatically deploy it to Cloudflare. The Worker must be updated and deployed separately; no deployment workflow has been confirmed.
- The dashboard now calls employee, attendance, leave and payroll endpoints. Employee creation and leave approval are limited to admin/HR/supervisor roles; payroll is currently read-only.
- Attendance punch and leave application require the user account to be linked to an employee record (`users.employee_id`). Admin setup creates an admin account without an employee link, so the admin can manage HR data but cannot punch in or submit a leave request until linked to an employee.
- The dashboard and API are still a starter implementation. Confirm the live Worker is deployed with the latest `worker.js`, verify the actual D1 schema and test each role before entering real payroll or sensitive employee data. Rate limiting, audit logging, account provisioning, password reset, payroll processing and a production security review remain outstanding.
