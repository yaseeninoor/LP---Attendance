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
   return json({error:"Not found"},404,headers);
  } catch (error) {
   console.error("HRM API error",error);
   return json({error:"Server error. Check Worker logs."},500,headers);
  }
 }
};