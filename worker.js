const CORS_ORIGINS = new Set([
  "https://yaseeninoor.github.io",
  "https://yaseenis.com",
  "https://noor.yaseenis.com"
]);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...headers }
});
function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Vary": "Origin" };
  if (CORS_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
async function sha256(value) { return b64url(await crypto.subtle.digest("SHA-256", enc.encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt:enc.encode(salt), iterations:210000, hash:"SHA-256" }, key, 256);
  return b64url(bits);
}
function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return b64url(bytes); }
function datePlusHours(hours) { return new Date(Date.now() + hours * 3600000).toISOString(); }
async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  return await env.DB.prepare(
    "SELECT u.id,u.employee_id,u.full_name,u.email,u.role,u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'"
  ).bind(tokenHash, new Date().toISOString()).first();
}
export default {
 async fetch(request, env) {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response(null, {status:204, headers});
  const url = new URL(request.url);
  try {
   if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
    return json({ ok:true, service:"LP HRM API", database:!!env.DB, time:new Date().toISOString() },200,headers);
   }
   if (!CORS_ORIGINS.has(request.headers.get("Origin") || "")) return json({error:"Origin not allowed"},403,headers);
   if (request.method === "POST" && url.pathname === "/api/auth/setup-admin") {
    if (!env.ADMIN_SETUP_KEY || request.headers.get("X-Admin-Setup-Key") !== env.ADMIN_SETUP_KEY) return json({error:"Not authorized"},401,headers);
    const existing = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
    if (existing) return json({error:"Admin already exists. Setup endpoint is disabled."},409,headers);
    const body = await request.json();
    const email = String(body.email||"").trim().toLowerCase();
    const fullName = String(body.full_name||"").trim();
    const password = String(body.password||"");
    if (!email || !fullName || password.length < 12) return json({error:"Provide email, full name and a password of at least 12 characters."},400,headers);
    const salt = randomToken();
    const hash = await passwordHash(password,salt);
    const passwordHashStored = salt + "." + hash;
    const result = await env.DB.prepare("INSERT INTO users (employee_id,full_name,email,password_hash,role,status) VALUES (NULL,?,?,?,?, 'active')")
      .bind(fullName,email,passwordHashStored,"admin").run();
    return json({ok:true,message:"Admin account created. Sign in now.",id:result.meta.last_row_id},201,headers);
   }
   if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await request.json();
    const email = String(body.email||"").trim().toLowerCase();
    const password = String(body.password||"");
    if (!email || !password) return json({error:"Enter email and password."},400,headers);
    const user = await env.DB.prepare("SELECT id,employee_id,full_name,email,password_hash,role,status FROM users WHERE email=?").bind(email).first();
    if (!user || user.status !== "active" || !user.password_hash || !user.password_hash.includes(".")) return json({error:"Invalid email or password."},401,headers);
    const [salt, stored] = user.password_hash.split(".",2);
    const actual = await passwordHash(password,salt);
    if (actual !== stored) return json({error:"Invalid email or password."},401,headers);
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES (?,?,?)").bind(user.id,await sha256(token),datePlusHours(12)).run();
    return json({ok:true,token,expires_in:43200,user:{id:user.id,employee_id:user.employee_id,full_name:user.full_name,email:user.email,role:user.role}},200,headers);
   }
   if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await getUser(request,env);
    return user ? json({ok:true,user},200,headers) : json({error:"Session expired or invalid."},401,headers);
   }
   if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ok:true},200,headers);
   }
   const authUser = await getUser(request,env);
   if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/") && !authUser) return json({error:"Sign in required"},401,headers);
   const isHR = authUser && ["admin","hr","supervisor"].includes(authUser.role);
   if (request.method === "GET" && url.pathname === "/api/employees") {
    const rows = isHR
      ? await env.DB.prepare("SELECT id,employee_code,full_name,email,department,designation,basic_salary,status,created_at FROM employees ORDER BY employee_code").all()
      : await env.DB.prepare("SELECT id,employee_code,full_name,email,department,designation,status FROM employees WHERE id=?").bind(authUser.employee_id || -1).all();
    return json({ok:true,data:rows.results||[]},200,headers);
   }
   if (request.method === "POST" && url.pathname === "/api/employees") {
    if (!isHR) return json({error:"HR/Admin access required"},403,headers);
    const b=await request.json();
    const code=String(b.employee_code||"").trim(), name=String(b.full_name||"").trim();
    if(!code||!name) return json({error:"Employee code and full name are required"},400,headers);
    const r=await env.DB.prepare("INSERT INTO employees (employee_code,full_name,email,department,designation,basic_salary,status) VALUES (?,?,?,?,?,?,?)")
      .bind(code,name,String(b.email||"").trim()||null,String(b.department||"").trim()||null,String(b.designation||"").trim()||null,Math.max(0,Number(b.basic_salary)||0,0),["active","inactive"].includes(String(b.status))?String(b.status):"active").run();
    return json({ok:true,id:r.meta.last_row_id},201,headers);
   }
   if (request.method === "GET" && url.pathname === "/api/attendance") {
    const rows = isHR
      ? await env.DB.prepare("SELECT a.id,a.employee_id,e.employee_code,e.full_name,a.attendance_date,a.punch_in,a.punch_out,a.status FROM attendance a LEFT JOIN employees e ON e.id=a.employee_id ORDER BY a.attendance_date DESC LIMIT 500").all()
      : await env.DB.prepare("SELECT id,employee_id,attendance_date,punch_in,punch_out,status FROM attendance WHERE employee_id=? ORDER BY attendance_date DESC LIMIT 180").bind(authUser.employee_id||-1).all();
    return json({ok:true,data:rows.results||[]},200,headers);
   }
   if (request.method === "POST" && url.pathname === "/api/attendance/punch") {
    if(!authUser.employee_id) return json({error:"Your account is not linked to an employee profile"},400,headers);
    const b=await request.json(),kind=String(b.kind||"");
    if(!["in","out"].includes(kind)) return json({error:"kind must be in or out"},400,headers);
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());\n    const dateParts=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));\n    const today=dateParts.year+"-"+dateParts.month+"-"+dateParts.day;
    const now=new Date().toISOString();
    let row=await env.DB.prepare("SELECT id,punch_in,punch_out FROM attendance WHERE employee_id=? AND attendance_date=?").bind(authUser.employee_id,today).first();
    if(kind==="in"){
      if(row&&row.punch_in) return json({error:"Punch In already recorded for today"},409,headers);
      if(row) await env.DB.prepare("UPDATE attendance SET punch_in=?,status='present' WHERE id=?").bind(now,row.id).run();
      else await env.DB.prepare("INSERT INTO attendance (employee_id,attendance_date,punch_in,status) VALUES (?,?,?,'present')").bind(authUser.employee_id,today,now).run();
    } else {
      if(!row||!row.punch_in) return json({error:"Punch In must be recorded first"},409,headers);
      if(row.punch_out) return json({error:"Punch Out already recorded for today"},409,headers);
      await env.DB.prepare("UPDATE attendance SET punch_out=? WHERE id=?").bind(now,row.id).run();
    }
    return json({ok:true,message:kind==="in"?"Punch In saved":"Punch Out saved",date:today,time:now},200,headers);
   }
   if (request.method === "GET" && url.pathname === "/api/leaves") {
    const rows = isHR
      ? await env.DB.prepare("SELECT l.id,l.employee_id,e.full_name,l.leave_type,l.start_date,l.end_date,l.reason,l.status FROM leave_requests l LEFT JOIN employees e ON e.id=l.employee_id ORDER BY l.start_date DESC LIMIT 500").all()
      : await env.DB.prepare("SELECT id,employee_id,leave_type,start_date,end_date,reason,status FROM leave_requests WHERE employee_id=? ORDER BY start_date DESC LIMIT 100").bind(authUser.employee_id||-1).all();
    return json({ok:true,data:rows.results||[]},200,headers);
   }
   if (request.method === "POST" && url.pathname === "/api/leaves") {
    if(!authUser.employee_id) return json({error:"Your account is not linked to an employee profile"},400,headers);
    const b=await request.json(),start=String(b.start_date||""),end=String(b.end_date||"");
    if(!start||!end||end<start) return json({error:"Valid leave dates are required"},400,headers);
    const r=await env.DB.prepare("INSERT INTO leave_requests (employee_id,leave_type,start_date,end_date,reason,status) VALUES (?,?,?,?,?,'pending')")
      .bind(authUser.employee_id,String(b.leave_type||"annual"),start,end,String(b.reason||"").trim()||null).run();
    return json({ok:true,id:r.meta.last_row_id},201,headers);
   }
   if (request.method === "POST" && url.pathname.startsWith("/api/leaves/") && url.pathname.endsWith("/review")) {
    if(!isHR) return json({error:"HR/Admin access required"},403,headers);
    const id=Number(url.pathname.split("/")[3]),b=await request.json(),status=String(b.status||"");
    if(!Number.isInteger(id)||!["approved","rejected"].includes(status)) return json({error:"Invalid leave review"},400,headers);
    const r=await env.DB.prepare("UPDATE leave_requests SET status=? WHERE id=? AND status='pending'").bind(status,id).run();
    if(!r.meta.changes) return json({error:"Pending leave request not found"},404,headers);
    return json({ok:true},200,headers);
   }
   if (request.method === "GET" && url.pathname === "/api/payroll") {
    if(!isHR) return json({error:"HR/Admin access required"},403,headers);
    const rows=await env.DB.prepare("SELECT id,employee_id,pay_month,basic_salary,allowances,deductions,net_salary,created_at FROM payroll ORDER BY pay_month DESC LIMIT 500").all();
    return json({ok:true,data:rows.results||[]},200,headers);
   }
   return json({error:"Not found"},404,headers);
  } catch (error) {
   console.error("HRM API error",error);
   return json({error:"Server error. Check Worker logs."},500,headers);
  }
 }
};