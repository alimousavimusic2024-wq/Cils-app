// Cloudflare Worker: API + Telegram webhook + question-bank replenisher (cron).
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const TOPICS = {
  A1: ['articoli', 'genere e numero', 'essere', 'avere', 'presente indicativo', 'preposizioni semplici', 'pronomi personali', 'aggettivi possessivi'],
  A2: ['passato prossimo', 'imperfetto', 'futuro semplice', 'pronomi diretti/indiretti', 'preposizioni articolate', 'comparativi', 'verbi modali'],
  B1: ['passato prossimo vs imperfetto', 'trapassato prossimo', 'condizionale', 'congiuntivo base', 'pronomi relativi', 'periodo ipotetico I tipo', 'discorso indiretto', 'ci e ne'],
  B2: ['congiuntivo avanzato', 'periodo ipotetico', 'forma passiva', 'discorso indiretto', 'pronomi combinati', 'connettivi', 'gerundio e participio'],
  C1: ['sintassi avanzata', 'congiuntivo sfumato', 'periodo ipotetico misto', 'registro formale', 'subordinate complesse', 'concordanza dei tempi', 'si impersonale e passivante'],
  C2: ['costrutti idiomatici', 'registro', 'sintassi sfumata', 'italiano accademico', 'costrutti rari ma corretti', 'anacoluto e dislocazioni', 'congiuntivo letterario'],
};
const enc = new TextEncoder();
const today = () => new Date().toISOString().slice(0, 10); // UTC day
const json = (o, s = 200, env) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors(env) } });
const cors = (env) => ({ 'Access-Control-Allow-Origin': env?.ALLOWED_ORIGIN || '', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' });

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function verifyInitData(initData, token) {
  const p = new URLSearchParams(initData);
  const h = p.get('hash'); if (!h) return null; p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const sig = hex(await hmac(await hmac('WebAppData', token), check));
  if (!safeEq(sig, h)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

async function authUser(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^tma (.+)$/);
  if (!m) return null;
  const tu = await verifyInitData(m[1], env.BOT_TOKEN);
  if (!tu || !tu.id) return null;
  await env.DB.prepare('INSERT INTO users(telegram_id, first_name) VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name').bind(tu.id, tu.first_name || '').run();
  return env.DB.prepare('SELECT * FROM users WHERE telegram_id=?').bind(tu.id).first();
}

const pub = (r) => ({ id: r.question_id ?? r.id, question: r.question, options: { A: r.option_a, B: r.option_b, C: r.option_c, D: r.option_d } });

async function pickQuestions(env, u) {
  const seen = 'SELECT eq.question_id FROM exam_questions eq JOIN exam_sessions s ON s.id=eq.exam_id WHERE s.user_id=?';
  let { results } = await env.DB.prepare(`SELECT id FROM questions WHERE level=? AND id NOT IN (${seen}) ORDER BY RANDOM() LIMIT 20`).bind(u.level, u.id).all();
  let ids = results.map((r) => r.id);
  if (ids.length < 20) { // pool exhausted for this user: allow repeats
    const have = ids.length ? ids.join(',') : '0';
    const more = await env.DB.prepare(`SELECT id FROM questions WHERE level=? AND id NOT IN (${have}) ORDER BY RANDOM() LIMIT ?`).bind(u.level, 20 - ids.length).all();
    ids = ids.concat(more.results.map((r) => r.id));
  }
  return ids;
}

async function examState(env, ex) {
  const { results } = await env.DB.prepare('SELECT q.id, q.question, q.option_a, q.option_b, q.option_c, q.option_d FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position').bind(ex.id).all();
  const a = await env.DB.prepare('SELECT question_id, selected FROM answers WHERE exam_id=?').bind(ex.id).all();
  const answers = {}; a.results.forEach((r) => (answers[r.question_id] = r.selected));
  return { level: ex.level, completed: !!ex.completed, current_index: ex.current_index, questions: results.map(pub), answers };
}

async function startExam(env, u) {
  if (!u.level) return ['level_required', 400];
  const d = today();
  let ex = await env.DB.prepare('SELECT * FROM exam_sessions WHERE user_id=? AND exam_date=?').bind(u.id, d).first();
  if (!ex) {
    const ids = await pickQuestions(env, u);
    if (ids.length < 20) return ['bank_not_ready', 503];
    await env.DB.prepare('INSERT OR IGNORE INTO exam_sessions(user_id, exam_date, level) VALUES(?,?,?)').bind(u.id, d, u.level).run();
    ex = await env.DB.prepare('SELECT * FROM exam_sessions WHERE user_id=? AND exam_date=?').bind(u.id, d).first();
    await env.DB.batch(ids.map((q, i) => env.DB.prepare('INSERT OR IGNORE INTO exam_questions(exam_id, question_id, position) VALUES(?,?,?)').bind(ex.id, q, i)));
    await env.DB.prepare('UPDATE users SET questions_used_today=20, last_question_date=? WHERE id=?').bind(d, u.id).run();
  }
  return [await examState(env, ex), 200];
}

async function finalize(env, ex) {
  const r = await env.DB.prepare('SELECT COUNT(*) c FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.exam_id=? AND a.selected=q.correct_answer').bind(ex.id).first();
  await env.DB.prepare('UPDATE exam_sessions SET completed=1, score=? WHERE id=?').bind(r.c, ex.id).run();
  return r.c;
}
const todaysExam = (env, u) => env.DB.prepare('SELECT * FROM exam_sessions WHERE user_id=? AND exam_date=?').bind(u.id, today()).first();
const resultOf = (ex) => ({ correct: ex.score, incorrect: 20 - ex.score, percent: ex.score * 5, level: ex.level, date: ex.exam_date, passed: ex.score * 5 >= 60 });

async function api(req, env, path) {
  const u = await authUser(req, env);
  if (!u) return json({ error: 'unauthorized' }, 401, env);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (path === '/api/me') {
    const ex = await todaysExam(env, u);
    return json({ name: u.first_name, level: u.level, exam_today: ex ? { completed: !!ex.completed } : null }, 200, env);
  }
  if (path === '/api/level') {
    if (!LEVELS.includes(body.level)) return json({ error: 'bad_level' }, 400, env);
    if (await todaysExam(env, u)) return json({ error: 'level_locked_today' }, 409, env);
    await env.DB.prepare('UPDATE users SET level=? WHERE id=?').bind(body.level, u.id).run();
    return json({ ok: true }, 200, env);
  }
  if (path === '/api/exam/start') { const [o, s] = await startExam(env, u); return json(typeof o === 'string' ? { error: o } : o, s, env); }
  const ex = await todaysExam(env, u);
  if (!ex) return json({ error: 'no_exam' }, 404, env);
  if (path === '/api/exam/answer') {
    if (ex.completed) return json({ error: 'completed' }, 409, env);
    if (!['A', 'B', 'C', 'D'].includes(body.selected)) return json({ error: 'bad_answer' }, 400, env);
    const belongs = await env.DB.prepare('SELECT 1 x FROM exam_questions WHERE exam_id=? AND question_id=?').bind(ex.id, body.question_id).first();
    if (!belongs) return json({ error: 'bad_question' }, 400, env);
    await env.DB.prepare('INSERT INTO answers(exam_id, question_id, selected) VALUES(?,?,?) ON CONFLICT(exam_id, question_id) DO UPDATE SET selected=excluded.selected').bind(ex.id, body.question_id, body.selected).run();
    if (Number.isInteger(body.index)) await env.DB.prepare('UPDATE exam_sessions SET current_index=? WHERE id=?').bind(Math.min(19, Math.max(0, body.index)), ex.id).run();
    const n = await env.DB.prepare('SELECT COUNT(*) c FROM answers WHERE exam_id=?').bind(ex.id).first();
    if (n.c >= 20) { ex.score = await finalize(env, ex); ex.completed = 1; return json({ done: true, result: resultOf(ex) }, 200, env); }
    return json({ done: false, answered: n.c }, 200, env);
  }
  if (!ex.completed) return json({ error: 'not_completed' }, 409, env);
  if (path === '/api/exam/result') return json(resultOf(ex), 200, env);
  if (path === '/api/exam/review') {
    const { results } = await env.DB.prepare('SELECT q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation, q.grammar_topic, a.selected FROM exam_questions eq JOIN questions q ON q.id=eq.question_id LEFT JOIN answers a ON a.exam_id=eq.exam_id AND a.question_id=q.id WHERE eq.exam_id=? ORDER BY eq.position').bind(ex.id).all();
    return json({ name: u.first_name, ...resultOf(ex), items: results.map((r) => ({ question: r.question, options: { A: r.option_a, B: r.option_b, C: r.option_c, D: r.option_d }, correct: r.correct_answer, selected: r.selected, explanation: r.explanation, topic: r.grammar_topic })) }, 200, env);
  }
  return json({ error: 'not_found' }, 404, env);
}

// ---- Question bank replenishment (Gemini free tier, server-side only) ----
export function validate(q, level) {
  if (!q || q.level !== level || !q.options || !q.grammar_topic) return null;
  const o = q.options, vals = ['A', 'B', 'C', 'D'].map((k) => (typeof o[k] === 'string' ? o[k].trim() : ''));
  if (vals.some((v) => !v || v.length > 120) || new Set(vals.map((v) => v.toLowerCase())).size !== 4) return null;
  if (!['A', 'B', 'C', 'D'].includes(q.correct_answer)) return null;
  if (typeof q.question !== 'string' || !q.question.includes('______') || q.question.length > 300) return null;
  if (typeof q.explanation !== 'string' || q.explanation.length < 20) return null;
  const d = Number(q.difficulty); if (!(d >= 1 && d <= 5)) return null;
  return { ...q, options: { A: vals[0], B: vals[1], C: vals[2], D: vals[3] }, difficulty: d };
}
async function sha(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

async function replenish(env, level, n = 8) {
  const topics = [...TOPICS[level]].sort(() => Math.random() - 0.5).slice(0, 6).join('; ');
  const prompt = `You are a senior CILS examiner and Italian linguist. Write ${n} multiple-choice grammar questions. CEFR level: ${level}. Use DIFFERENT topics from: ${topics}.
Rules: natural correct Italian; one sentence with one blank written exactly "______"; exactly 4 options, exactly ONE correct in context, 3 plausible but wrong distractors (never two defensible); difficulty fits ${level} only; explanation 1-3 sentences IN ITALIAN naming the rule.
Return ONLY a JSON array of {"level":"${level}","grammar_topic":"","difficulty":1-5,"question":"","options":{"A":"","B":"","C":"","D":""},"correct_answer":"A|B|C|D","explanation":""}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }),
  });
  if (!res.ok) return { level, error: res.status };
  let arr; try { arr = JSON.parse((await res.json()).candidates[0].content.parts[0].text); } catch { return { level, error: 'bad_json' }; }
  let saved = 0;
  for (const raw of Array.isArray(arr) ? arr : []) {
    const q = validate(raw, level); if (!q) continue;
    const h = await sha(q.question.toLowerCase().replace(/\W+/g, ' '));
    const r = await env.DB.prepare('INSERT OR IGNORE INTO questions(level, grammar_topic, difficulty, question, option_a, option_b, option_c, option_d, correct_answer, explanation, hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(level, q.grammar_topic, q.difficulty, q.question, q.options.A, q.options.B, q.options.C, q.options.D, q.correct_answer, q.explanation, h).run();
    saved += r.meta.changes || 0;
  }
  return { level, saved };
}
async function replenishAll(env, force) {
  const out = [], target = Number(env.TARGET_PER_LEVEL || 300);
  for (const l of LEVELS) {
    const c = await env.DB.prepare('SELECT COUNT(*) c FROM questions WHERE level=?').bind(l).first();
    if (force || c.c < target) out.push(await replenish(env, l));
  }
  return out;
}

async function webhook(req, env) {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const up = await req.json();
  const m = up.message;
  if (m && m.chat) {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: m.chat.id, text: 'برای شروع آزمون روزانه گرامر ایتالیایی دکمهٔ زیر را بزنید 🇮🇹', reply_markup: { inline_keyboard: [[{ text: 'شروع آزمون', web_app: { url: env.WEBAPP_URL } }]] } }),
    });
  }
  return new Response('ok');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    try {
      if (url.pathname === '/webhook' && req.method === 'POST') return webhook(req, env);
      if (url.pathname === '/admin/replenish' && req.method === 'POST') {
        const t = req.headers.get('X-Admin-Token') || '';
        if (!env.ADMIN_TOKEN || !safeEq(t, env.ADMIN_TOKEN)) return json({ error: 'forbidden' }, 403, env);
        return json(await replenishAll(env, true), 200, env);
      }
      if (url.pathname.startsWith('/api/')) return await api(req, env, url.pathname);
      return json({ ok: true }, 200, env);
    } catch (e) { return json({ error: 'server_error' }, 500, env); }
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(replenishAll(env, false)); },
};
