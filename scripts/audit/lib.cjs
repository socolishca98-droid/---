// Общая библиотека для сценарного аудита.
// Читает .env, умеет: CSRF, вход, cookie-банка, отчёт по шагам.
// Ничего не пишет в базу кроме того, что явно вызывается в сценарии.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

// --- .env ---
function loadEnv() {
  const env = {};
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = { ...process.env, ...loadEnv() };

const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";

// --- cookie-банка ---
class Jar {
  constructor() { this.map = new Map(); }
  absorb(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of set) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.map.delete(name);
      else this.map.set(name, `${name}=${value}`);
    }
  }
  header() { return [...this.map.values()].join("; "); }
  names() { return [...this.map.keys()]; }
}

async function absorb(res) {
  try { await res.arrayBuffer(); } catch { /* уже прочитано */ }
  return res;
}

// CSRF-токен: кладём cookie в банку и возвращаем токен.
async function csrf(jar) {
  const res = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.absorb(res);
  const json = await res.json().catch(() => ({}));
  return json.csrfToken || "";
}

async function login(email, password) {
  const jar = new Jar();
  const token = await csrf(jar);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": token, Cookie: jar.header() },
    body: JSON.stringify({ email, password }),
  });
  jar.absorb(res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, jar };
}

// Вызов API с полной сессией.
async function call(jar, method, url, body, opts = {}) {
  let token = null;
  if (body !== undefined && method !== "GET") token = await csrf(jar);
  const headers = { Cookie: jar.header(), ...(opts.headers || {}) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["x-csrf-token"] = token;
  }
  // Таймаут: оптимизатор и живой геокодер могут думать минутами, но аудит
  // не должен висеть вечно. По таймауту возвращаем status 0 — это отдельный
  // вердикт, а не молчаливый пропуск.
  const timeoutMs = opts.timeoutMs ?? 45000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      return { status: 0, json: { _timeout: true, error: `таймаут ${timeoutMs} мс` }, headers: new Map() };
    }
    throw e;
  }
  clearTimeout(timer);
  jar.absorb(res);
  let json = null;
  const text = await res.text().catch(() => "");
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, json, headers: res.headers };
}

// --- отчёт ---
class Report {
  constructor(title) {
    this.title = title;
    this.steps = [];
    this.summary = { VERIFIED: 0, PARTIAL: 0, BROKEN: 0, MISSING: 0, NOT_TESTED: 0 };
    this.issues = [];
  }
  step(scenario, name, status, note, extra = {}) {
    const rec = { scenario, name, status, note, ...extra };
    this.steps.push(rec);
    this.summary[status] = (this.summary[status] || 0) + 1;
    const sign = { VERIFIED: "[OK ]", PARTIAL: "[~~ ]", BROKEN: "[XX ]", MISSING: "[-  ]", NOT_TESTED: "[?  ]" }[status] || "[  ]";
    console.log(`${sign} ${scenario} ${name} — ${note}`);
    if (status === "BROKEN" || status === "MISSING") {
      this.issues.push({ scenario, name, status, note });
    }
    return rec;
  }
  print() {
    console.log("\n===== ИТОГ =====");
    console.log(JSON.stringify(this.summary));
    if (this.issues.length) {
      console.log("\nПРОБЛЕМЫ:");
      for (const i of this.issues) console.log(` ${i.status} [${i.scenario}] ${i.name}: ${i.note}`);
    }
  }
  toJSON() { return { title: this.title, summary: this.summary, steps: this.steps, issues: this.issues }; }
}

module.exports = { ENV, BASE, Jar, csrf, login, call, absorb, Report, ROOT };
