// Fast Education — Telegram bot (Supabase Edge Function "telegram")
// Joylashda "Verify JWT" (JWT tekshiruvi) O'CHIQ bo'lishi kerak: so'rovlar maxfiy kalit bilan tekshiriladi.
// Bot tokeni va maxfiy kalitlar ma'lumotlar bazasidagi tg_config jadvalida saqlanadi (telegram.sql → tg_setup).

const SB_URL = Deno.env.get("SUPABASE_URL")!;
function secretKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const many = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (many) { try { const o = JSON.parse(many); const v = Object.values(o)[0]; if (typeof v === "string") return v; } catch { /* */ } }
  throw new Error("Server kaliti topilmadi");
}
const SB_KEY = secretKey();

// ---------------- Supabase REST ----------------
function sbHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json", ...extra };
  if (SB_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SB_KEY;
  return h;
}
async function db(path: string, init: RequestInit & { prefer?: string } = {}) {
  const headers = sbHeaders(init.prefer ? { Prefer: init.prefer } : {});
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers });
  const t = await r.text();
  let body: any = null;
  try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  if (!r.ok) throw new Error((body && body.message) || `db ${r.status}`);
  return body;
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

let CFG: Record<string, string> = {};
async function loadCfg() {
  CFG = {};
  for (const r of (await db("tg_config?select=key,value")) || []) CFG[r.key] = r.value;
}
async function setCfg(key: string, value: string) {
  await db("tg_config", { method: "POST", prefer: "resolution=merge-duplicates", body: JSON.stringify([{ key, value }]) });
}
// Bir xil xabarni ikki marta yubormaslik uchun
async function once(key: string) {
  const r = await db("tg_sent", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: JSON.stringify([{ key }]) });
  return Array.isArray(r) && r.length > 0;
}

// ---------------- Telegram ----------------
async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${CFG.bot_token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  return await r.json();
}
type Btn = { text: string; callback_data?: string; url?: string };
async function send(chat: number | string, text: string, buttons?: Btn[][]) {
  // Telegram cheklovi: 4096 belgi
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > 3900) { parts.push(cur); cur = line; } else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) parts.push(cur);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await tg("sendMessage", {
      chat_id: chat, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: last && buttons && buttons.length ? { inline_keyboard: buttons } : undefined,
    });
  }
}
async function edit(chat: number, msgId: number, text: string, buttons?: Btn[][]) {
  await tg("editMessageText", {
    chat_id: chat, message_id: msgId, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons || [] },
  });
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

// ---------------- Vaqt (Toshkent) ----------------
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const pad = (n: number) => (n < 10 ? "0" : "") + n;
function tz() { return new Date(Date.now() + 5 * 3600 * 1000); }
function today() { const d = tz(); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function nowMin() { const d = tz(); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function addDays(s: string, n: number) { const [y, m, d] = s.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; }
function dow(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function hm(t: string) { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; }
function fmt(s: string) { if (!s) return ""; const [, m, d] = s.split("-").map(Number); return `${d}-${MONTHS[m - 1]}`; }
const r0 = (v: number | null) => (v == null ? "—" : String(Math.round(v)));
const r1 = (v: number | null) => (v == null ? "—" : String(Math.round(v * 10) / 10));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ROLES: Record<string, string> = { reception: "Receptionist", cleaner: "Cleaner", academic: "Academic support" };

// ---------------- Ma'lumotlar va hisob-kitob (saytdagi bilan bir xil) ----------------
type Ctx = { S: any; LOGS: Record<string, { s: string; at: string }>; accounts: any[]; all: any[] };
async function loadCtx(): Promise<Ctx> {
  const st = await db("app_state?id=eq.1&select=data");
  const S = (st && st[0] && st[0].data) || null;
  const logs = await db(`duty_logs?select=day,duty_id,status,at&day=gte.${addDays(today(), -40)}`);
  const LOGS: Ctx["LOGS"] = {};
  for (const l of logs || []) LOGS[`${l.day}|${l.duty_id}`] = { s: l.status, at: l.at };
  const all = (await db("accounts?select=username,role,person_id,branch_id,tg_chat_id")) || [];
  const accounts = all.filter((a: any) => a.tg_chat_id);
  if (S) {
    S.settings = Object.assign({ lateMin: 30, tw: { lesson: 40, manager: 30, tasks: 15, complaints: 15 }, bw: { teachers: 40, staff: 30, growth: 30 } }, S.settings || {});
    for (const k of ["branches", "teachers", "evals", "ratings", "complaints", "staff", "duties", "tasks"]) if (!Array.isArray(S[k])) S[k] = [];
  }
  return { S, LOGS, accounts, all };
}
const byId = (a: any[], id: string) => a.find((x) => x.id === id) || null;
// Filial adminlari: branch_id bo'sh — bosh admin (hamma filial), aks holda faqat o'z filiali
function personBranch(c: Ctx, role: string, pid: string) { const p = role === "teacher" ? byId(c.S.teachers, pid) : role === "staff" ? byId(c.S.staff, pid) : null; return p ? p.branchId : null; }
function adminsFor(c: Ctx, branchId: string | null, everyone = false) { return (everyone ? c.all : c.accounts).filter((a) => a.role === "admin" && (!a.branch_id || a.branch_id === branchId)); }
function scoped(c: Ctx, b: string | null): Ctx {
  if (!b || !c.S) return c;
  const S = c.S, tset = new Set(S.teachers.filter((t: any) => t.branchId === b).map((t: any) => t.id)), sset = new Set(S.staff.filter((t: any) => t.branchId === b).map((t: any) => t.id));
  return { ...c, S: { ...S,
    teachers: S.teachers.filter((t: any) => tset.has(t.id)), staff: S.staff.filter((t: any) => sset.has(t.id)),
    evals: S.evals.filter((e: any) => tset.has(e.teacherId)), ratings: S.ratings.filter((e: any) => tset.has(e.teacherId)),
    complaints: S.complaints.filter((e: any) => tset.has(e.teacherId)), duties: S.duties.filter((d: any) => sset.has(d.staffId)),
    tasks: S.tasks.filter((k: any) => (k.type === "teacher" ? tset : sset).has(k.assigneeId)),
    branches: S.branches.filter((x: any) => x.id === b) } };
}
function weighted(parts: { v: number | null; w: number }[]) { let sw = 0, sv = 0; for (const p of parts) if (p.v != null && p.w > 0) { sw += p.w; sv += p.v * p.w; } return sw ? sv / sw : null; }
function branchName(c: Ctx, id: string) { const b = byId(c.S.branches, id); return b ? b.name : "—"; }
function teacherStats(c: Ctx, t: any) {
  const S = c.S, T = today(), from = addDays(T, -90);
  const ev = S.evals.filter((e: any) => e.teacherId === t.id && e.date >= from);
  const rt = S.ratings.filter((e: any) => e.teacherId === t.id && e.date >= from);
  const cp = S.complaints.filter((e: any) => e.teacherId === t.id);
  const cpConf = cp.filter((x: any) => x.status === "tasdiqlangan" && x.date >= from).length;
  const tk = S.tasks.filter((k: any) => k.type === "teacher" && k.assigneeId === t.id);
  const due = tk.filter((k: any) => k.status === "bajarildi" || k.deadline < T);
  const done = due.filter((k: any) => k.status === "bajarildi").length;
  const lesson = ev.length ? avg(ev.map((e: any) => avg(e.c)!)) : null;
  const mgr = rt.length ? avg(rt.map((r: any) => r.score)) : null;
  const tasksPct = due.length ? (done / due.length) * 100 : null;
  const comp = clamp(100 - cpConf * 20, 0, 100), w = S.settings.tw;
  const total = weighted([{ v: lesson == null ? null : lesson * 10, w: w.lesson }, { v: mgr == null ? null : mgr * 10, w: w.manager }, { v: tasksPct, w: w.tasks }, { v: comp, w: w.complaints }]);
  return { lesson, mgr, tasksPct, done, due: due.length, cpConf, cpNew: cp.filter((x: any) => x.status === "yangi").length, total, nEval: ev.length, nRate: rt.length };
}
// Smenali xodim: faqat «Ishga keldim» bosilgan kunlari vazifalar hisoblanadi
function isShift(c: Ctx, staffId: string) { const p = byId(c.S.staff, staffId); return !!(p && p.shift); }
function checkinOf(c: Ctx, date: string, staffId: string) { return c.LOGS[`${date}|@in:${staffId}`] || null; }
function dueMin(c: Ctx, x: any, date: string) {
  let t = hm(x.time);
  if (isShift(c, x.staffId)) { const ci = checkinOf(c, date, x.staffId); if (ci && /^\d{1,2}:\d{2}$/.test(ci.at || "")) t = Math.max(t, hm(ci.at)); }
  return t;
}
function rawDutiesOn(c: Ctx, staffId: string, date: string) {
  const d = dow(date);
  return c.S.duties.filter((x: any) => x.staffId === staffId && x.days.indexOf(d) >= 0);
}
function dutiesOn(c: Ctx, staffId: string, date: string) {
  if (isShift(c, staffId) && !checkinOf(c, date, staffId)) return [];
  const d = dow(date);
  return c.S.duties.filter((x: any) => x.staffId === staffId && x.days.indexOf(d) >= 0).sort((a: any, b: any) => (a.time < b.time ? -1 : 1));
}
function effRange(c: Ctx, staffId: string, from: string, to: string) {
  let assigned = 0, pts = 0, d = from; const T = today(), now = nowMin();
  while (d <= to) {
    for (const x of dutiesOn(c, staffId, d)) {
      const l = c.LOGS[`${d}|${x.id}`];
      if (d === T && dueMin(c, x, d) + c.S.settings.lateMin > now && !l) continue;
      assigned++; if (l) pts += l.s === "d" ? 1 : 0.5;
    }
    d = addDays(d, 1);
  }
  return assigned ? (pts / assigned) * 100 : null;
}
function staffStats(c: Ctx, s: any) { const T = today(); return { day: effRange(c, s.id, T, T), week: effRange(c, s.id, addDays(T, -6), T), month: effRange(c, s.id, addDays(T, -29), T) }; }
function branchStats(c: Ctx, b: any) {
  const ts = c.S.teachers.filter((t: any) => t.branchId === b.id).map((t: any) => teacherStats(c, t).total).filter((v: any) => v != null);
  const sf = c.S.staff.filter((s: any) => s.branchId === b.id).map((s: any) => staffStats(c, s).month).filter((v: any) => v != null);
  const st = (b.students || []).slice().sort((a: any, x: any) => (a.m < x.m ? -1 : 1));
  const last = st[st.length - 1], base = st.length > 3 ? st[st.length - 4] : st[0];
  const growth = last && base && base.c && base !== last ? ((last.c - base.c) / base.c) * 100 : null;
  const gs = growth == null ? null : clamp(50 + growth * 5, 0, 100), w = c.S.settings.bw;
  return { tAvg: avg(ts), sAvg: avg(sf), growth, students: last ? last.c : 0, total: weighted([{ v: avg(ts), w: w.teachers }, { v: avg(sf), w: w.staff }, { v: gs, w: w.growth }]) };
}
function ranked<T>(list: T[], fn: (x: T) => { total: number | null }) {
  return list.map((x) => ({ x, s: fn(x) as any })).sort((a, b) => (b.s.total ?? -1) - (a.s.total ?? -1));
}
const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
function lvl(v: number | null) { return v == null ? "⚪" : v >= 85 ? "🟢" : v >= 65 ? "🟡" : "🔴"; }

// ---------------- Xabar matnlari ----------------
function siteBtn(): Btn[][] { return [[{ text: "🌐 Saytni ochish", url: CFG.site_url }]]; }
function staffToday(c: Ctx, s: any) {
  const T = today(), now = nowMin(), ds = dutiesOn(c, s.id, T), st = staffStats(c, s);
  if (s.shift && !checkinOf(c, T, s.id)) {
    const n = rawDutiesOn(c, s.id, T).length;
    return { text: `👋 <b>Bugun ishdamisiz?</b> · ${fmt(T)}\n\nSiz smenali xodimsiz. Ishga kelgan bo‘lsangiz, pastdagi tugmani bosing — bugungi ${n} ta vazifangiz yoqiladi. Kelmagan kuningiz hisobga olinmaydi.`,
      btns: n ? [[{ text: "✅ Ishga keldim", callback_data: "in" }]] as Btn[][] : [] };
  }
  const lines = ds.map((d: any) => {
    const l = c.LOGS[`${T}|${d.id}`];
    const mark = l ? (l.s === "d" ? "✅" : "🟡") : dueMin(c, d, T) + c.S.settings.lateMin < now ? "❌" : "⬜";
    return `${mark} <b>${d.time}</b> — ${esc(d.title)}${l ? ` <i>(${l.s === "d" ? "" : "kechikib, "}${esc(l.at)})</i>` : ""}`;
  });
  const btns: Btn[][] = ds.filter((d: any) => !c.LOGS[`${T}|${d.id}`]).map((d: any) => [{ text: `✅ ${d.time} — ${d.title}`.slice(0, 60), callback_data: `t:${d.id}` }]);
  const ci = s.shift ? checkinOf(c, T, s.id) : null;
  const text = `📋 <b>Bugungi vazifalaringiz</b> · ${fmt(T)}${ci ? ` · ishga keldingiz ${esc(ci.at)}` : ""}\n\n` + (lines.length ? lines.join("\n") : "Bugun vazifa yo‘q 🎉") +
    `\n\n📊 Samaradorlik: bugun <b>${st.day == null ? "—" : r0(st.day) + "%"}</b> · hafta <b>${st.week == null ? "—" : r0(st.week) + "%"}</b> · oy <b>${st.month == null ? "—" : r0(st.month) + "%"}</b>` +
    (btns.length ? `\n\nBajarganingizda tugmani bosing (vaqti server soati bo‘yicha yoziladi, ${c.S.settings.lateMin} daqiqadan kech — «kechikdi»):` : "");
  return { text, btns };
}
function myTasks(c: Ctx, type: string, pid: string) {
  const T = today();
  const tk = c.S.tasks.filter((k: any) => k.type === type && k.assigneeId === pid && k.status !== "bajarildi").sort((a: any, b: any) => (a.deadline < b.deadline ? -1 : 1));
  if (!tk.length) return { text: "📌 <b>Ochiq topshiriqlar yo‘q</b> 👌", btns: [] as Btn[][] };
  const lines = tk.map((k: any) => `${k.deadline < T ? "🔴 <b>Muddati o‘tgan</b>" : k.deadline === T ? "🟠 <b>Bugun</b>" : "🔵 " + fmt(k.deadline)} — ${esc(k.title)}${k.desc ? `\n    <i>${esc(k.desc)}</i>` : ""}`);
  return { text: `📌 <b>Ochiq topshiriqlaringiz (${tk.length})</b>\n\n` + lines.join("\n"), btns: tk.slice(0, 8).map((k: any) => [{ text: `✅ Bajarildi: ${k.title}`.slice(0, 60), callback_data: `k:${k.id}` }]) };
}
function teacherCard(c: Ctx, t: any, full: boolean) {
  const s = teacherStats(c, t), w = c.S.settings.tw;
  const rk = ranked(c.S.teachers, (x: any) => teacherStats(c, x)).findIndex((r: any) => r.x.id === t.id) + 1;
  let txt = `👩‍🏫 <b>${esc(t.name)}</b>\n${esc(branchName(c, t.branchId))} · ${esc(t.subject)}\n\n` +
    `${lvl(s.total)} Umumiy ball: <b>${r0(s.total)}</b> / 100 · <b>${rk}-o‘rin</b> (${c.S.teachers.length} tadan)\n\n` +
    `• Dars sifati (${w.lesson}%): <b>${r1(s.lesson)}</b>/10 · ${s.nEval} kuzatuv\n` +
    `• Menejer bahosi (${w.manager}%): <b>${r1(s.mgr)}</b>/10 · ${s.nRate} baho\n` +
    `• Topshiriqlar (${w.tasks}%): <b>${s.tasksPct == null ? "—" : r0(s.tasksPct) + "%"}</b> (${s.done}/${s.due})\n` +
    `• Tasdiqlangan shikoyatlar (${w.complaints}%): <b>${s.cpConf}</b>${s.cpNew ? ` · ${s.cpNew} ta ko‘rib chiqilmoqda` : ""}\n<i>Oxirgi 90 kun bo‘yicha</i>`;
  if (full) {
    const ev = c.S.evals.filter((e: any) => e.teacherId === t.id).sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const rt = c.S.ratings.filter((e: any) => e.teacherId === t.id).sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const cp = c.S.complaints.filter((e: any) => e.teacherId === t.id).sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    if (ev.length) txt += "\n\n📝 <b>Dars kuzatuvlari</b>\n" + ev.map((e: any) => `${fmt(e.date)} — <b>${r1(avg(e.c))}</b> (tayyorg. ${e.c[0]}, metod. ${e.c[1]}, faollik ${e.c[2]}, vaqt ${e.c[3]})${e.note ? ` · <i>${esc(e.note)}</i>` : ""}`).join("\n");
    if (rt.length) txt += "\n\n⭐ <b>Menejer baholari</b>\n" + rt.map((r: any) => `${fmt(r.date)} — ${esc(r.work)}: <b>${r.score}/10</b>`).join("\n");
    if (cp.length) txt += "\n\n⚠️ <b>Shikoyatlar</b>\n" + cp.map((x: any) => `${fmt(x.date)} — ${esc(x.text)} (${esc(x.source)}) · <b>${x.status === "tasdiqlangan" ? "tasdiqlangan" : x.status === "rad" ? "rad etilgan" : "ko‘rib chiqilmoqda"}</b>`).join("\n");
  }
  return txt;
}
function teacherRanking(c: Ctx, limit = 100) {
  const rk = ranked(c.S.teachers, (x: any) => teacherStats(c, x));
  const lines = rk.slice(0, limit).map((r: any, i: number) => `${medal(i)} ${esc(r.x.name)} — <b>${r0(r.s.total)}</b> <i>(${esc(branchName(c, r.x.branchId))})</i>`);
  return `🏆 <b>Ustozlar reytingi</b>\n\n` + (lines.join("\n") || "Ustozlar yo‘q");
}
function branchRanking(c: Ctx) {
  const rk = ranked(c.S.branches, (b: any) => branchStats(c, b));
  return `🏢 <b>Filiallar reytingi</b>\n\n` + (rk.map((r: any, i: number) => `${medal(i)} <b>${esc(r.x.name)}</b> — <b>${r0(r.s.total)}</b>\n    ustozlar ${r0(r.s.tAvg)} · xodimlar ${r.s.sAvg == null ? "—" : r0(r.s.sAvg) + "%"} · o‘sish ${r.s.growth == null ? "—" : (r.s.growth >= 0 ? "+" : "") + r1(r.s.growth) + "%"} · ${r.s.students} o‘quvchi`).join("\n") || "Filiallar yo‘q");
}
function staffReport(c: Ctx) {
  const T = today();
  const rows = c.S.staff.map((s: any) => ({ s, st: staffStats(c, s), miss: dutiesOn(c, s.id, T).filter((d: any) => !c.LOGS[`${T}|${d.id}`] && hm(d.time) + c.S.settings.lateMin < nowMin()).length }))
    .sort((a: any, b: any) => (a.st.day ?? 101) - (b.st.day ?? 101));
  const byBranch: Record<string, any[]> = {};
  for (const r of rows) (byBranch[r.s.branchId] ||= []).push(r);
  let txt = `👥 <b>Xodimlar samaradorligi</b> · ${fmt(T)}\n<i>bugun / hafta / oy</i>\n`;
  for (const b of c.S.branches) {
    const arr = byBranch[b.id] || []; if (!arr.length) continue;
    txt += `\n<b>${esc(b.name)}</b>\n` + arr.map((r: any) => `${lvl(r.st.day)} ${esc(r.s.name)} (${ROLES[r.s.role]}) — <b>${r.st.day == null ? "—" : r0(r.st.day) + "%"}</b> / ${r.st.week == null ? "—" : r0(r.st.week) + "%"} / ${r.st.month == null ? "—" : r0(r.st.month) + "%"}${r.miss ? ` · ❌ ${r.miss} bajarilmagan` : ""}`).join("\n") + "\n";
  }
  return txt;
}
function adminSummary(c: Ctx, title: string, full?: Ctx) {
  const T = today();
  const pending = c.S.complaints.filter((x: any) => x.status === "yangi");
  const overdue = c.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline < T);
  const sDay = c.S.staff.map((s: any) => staffStats(c, s).day).filter((v: any) => v != null);
  let txt = `📊 <b>${title}</b> · ${fmt(T)}\n\n` +
    `• Xodimlar bugungi samaradorligi: <b>${sDay.length ? r0(avg(sDay)) + "%" : "—"}</b>\n` +
    `• Ko‘rib chiqilmagan shikoyatlar: <b>${pending.length}</b>\n` +
    `• Muddati o‘tgan topshiriqlar: <b>${overdue.length}</b>\n\n` + branchRanking(full || c);
  if (pending.length) txt += "\n\n⚠️ <b>Ko‘rib chiqilishi kerak</b>\n" + pending.slice(0, 10).map((x: any) => { const t = byId(c.S.teachers, x.teacherId); return `• ${esc(t ? t.name : "—")}: ${esc(x.text)} (${fmt(x.date)})`; }).join("\n");
  if (overdue.length) txt += "\n\n⏰ <b>Muddati o‘tgan topshiriqlar</b>\n" + overdue.slice(0, 10).map((k: any) => `• ${esc(k.title)} — ${esc(assignee(c, k))} (${fmt(k.deadline)})`).join("\n");
  return txt;
}
function assignee(c: Ctx, k: any) { if (k.type === "admin") { const a = c.all.find((x) => x.username === k.assigneeId); const b = a && a.branch_id ? byId(c.S.branches, a.branch_id) : null; return `${k.assigneeId} (filial admini${b ? ", " + b.name : ""})`; } const p = k.type === "teacher" ? byId(c.S.teachers, k.assigneeId) : byId(c.S.staff, k.assigneeId); return p ? p.name : "—"; }
function personOf(c: Ctx, a: any) { return a.role === "teacher" ? byId(c.S.teachers, a.person_id) : a.role === "staff" ? byId(c.S.staff, a.person_id) : null; }
function helpText(role: string) {
  const common = "/reyting — ustozlar va filiallar reytingi\n/chiqish — Telegramni hisobdan uzish\n/bekor — boshlangan amalni bekor qilish";
  const write = "\n/murojaat — menejerga muammo yoki taklif yozish (yoki shunchaki xabar yozing)\n";
  if (role === "admin") return "Buyruqlar:\n/hisobot — bugungi umumiy hisobot\n/xodimlar — xodimlar samaradorligi\n/ustoz <i>ism</i> — ustoz haqida to‘liq ma’lumot\n/shikoyatlar — ko‘rib chiqilmagan shikoyatlar\n/topshiriqlar — muddati o‘tgan topshiriqlar\n/murojaatlar — ochiq murojaatlar\n/xabar — xodim va ustozlarga xabar yuborish\n" + common;
  if (role === "teacher") return "Buyruqlar:\n/men — ballim va o‘rnim\n/topshiriqlar — ochiq topshiriqlarim" + write + common;
  return "Buyruqlar:\n/bugun — bugungi vazifalarim (belgilash tugmalari bilan)\n/men — samaradorligim\n/topshiriqlar — ochiq topshiriqlarim" + write + common;
}


// ---------------- Murojaatlar va xabarlar ----------------
async function getState(chat: number) {
  const r = await db(`tg_chat_state?chat_id=eq.${chat}&select=state,data,at`);
  if (!r || !r.length) return null;
  if (Date.now() - new Date(r[0].at).getTime() > 30 * 60 * 1000) { await clearState(chat); return null; }
  return r[0];
}
async function setState(chat: number, state: string, data: unknown = {}) {
  await db("tg_chat_state", { method: "POST", prefer: "resolution=merge-duplicates", body: JSON.stringify([{ chat_id: chat, state, data, at: new Date().toISOString() }]) });
}
async function clearState(chat: number) { await db(`tg_chat_state?chat_id=eq.${chat}`, { method: "DELETE" }); }
async function asUser(chat: number, fn: string, args: Record<string, unknown>) {
  const token = await rpc("tg_session", { p_chat: chat });
  return rpc(fn, { p_token: token, ...args });
}
function authorLabel(c: Ctx, t: any, acc: any) {
  if (t.anon) return "Anonim";
  const p = acc ? personOf(c, acc) : null;
  if (!p) return t.author;
  return acc.role === "teacher" ? `${p.name} (Ustoz, ${branchName(c, p.branchId)})` : `${p.name} (${ROLES[p.role]}, ${branchName(c, p.branchId)})`;
}
const KIND: Record<string, string> = { muammo: "⚠️ Muammo", taklif: "💡 Taklif" };
const TSTAT: Record<string, string> = { yangi: "Yangi", jarayonda: "Ko‘rib chiqilmoqda", hal: "Hal qilindi ✅" };
function ticketText(c: Ctx, t: any, acc: any, replies: any[] = []) {
  let s = `${KIND[t.kind]} <b>#${t.id}</b> · ${TSTAT[t.status]}\n👤 ${esc(authorLabel(c, t, acc))}\n\n${esc(t.text)}`;
  if (replies.length) s += "\n\n" + replies.slice(-5).map((r: any) => `${r.from_admin ? "🧑‍💼 Menejer" : "👤 " + (t.anon ? "Anonim" : "Muallif")}: ${esc(r.text)}`).join("\n");
  return s;
}
const adminTicketBtns = (id: number): Btn[][] => [[{ text: "✍️ Javob yozish", callback_data: `r:${id}` }, { text: "✅ Hal qilindi", callback_data: `h:${id}` }]];
async function loadTicket(id: number) {
  const t = (await db(`tickets?id=eq.${id}&select=*`))[0];
  if (!t) return null;
  const replies = await db(`ticket_replies?ticket_id=eq.${id}&select=*&order=id`);
  const acc = (await db(`accounts?username=eq.${encodeURIComponent(t.author)}&select=username,role,person_id,tg_chat_id`))[0];
  return { t, replies: replies || [], acc };
}
async function jobNotify(b: any) {
  const c = await loadCtx(); if (!c.S) return;
  if (b.event === "ticket_new" || b.event === "ticket_reply" || b.event === "ticket_status") {
    const x = await loadTicket(Number(b.id)); if (!x) return;
    const { t, replies, acc } = x;
    const admins = adminsFor(c, acc ? personBranch(c, acc.role, acc.person_id) : null, true);
    const kindName = t.kind === "muammo" ? "muammo" : "taklif";
    if (b.event === "ticket_new") {
      await deliver(c, admins, { kind: "ticket", title: `🆕 Yangi ${kindName} #${t.id}`, body: `${authorLabel(c, t, acc)}: ${t.text}`, link: "xabarlar" },
        { text: "🆕 <b>Yangi murojaat</b>\n\n" + ticketText(c, t, acc), btns: adminTicketBtns(t.id) });
    } else if (b.event === "ticket_reply") {
      const r = replies.find((y: any) => y.id === Number(b.reply_id)); if (!r) return;
      if (r.from_admin) {
        await deliver(c, [acc], { kind: "reply", title: `💬 Menejer javobi · #${t.id}`, body: r.text, link: "xabarlar" },
          { text: `💬 <b>Menejer javobi</b> · murojaat #${t.id}\n\n<i>${esc(t.text.slice(0, 200))}</i>\n\n${esc(r.text)}`, btns: [[{ text: "✍️ Javob yozish", callback_data: `r:${t.id}` }]] });
      } else {
        await deliver(c, admins, { kind: "reply", title: `💬 Murojaat #${t.id}: yangi xabar`, body: `${authorLabel(c, t, acc)}: ${r.text}`, link: "xabarlar" },
          { text: `💬 <b>Murojaat #${t.id} ga yangi xabar</b>\n👤 ${esc(authorLabel(c, t, acc))}\n\n${esc(r.text)}`, btns: adminTicketBtns(t.id) });
      }
    } else {
      await deliver(c, [acc], { kind: "ticket", title: `📋 Murojaat #${t.id}: ${TSTAT[t.status]}`, body: t.text, link: "xabarlar" },
        { text: `📋 Murojaatingiz <b>#${t.id}</b> holati: <b>${TSTAT[t.status]}</b>\n\n<i>${esc(t.text.slice(0, 300))}</i>` });
    }
    return;
  }
  if (b.event === "ann") {
    const an = (await db(`announcements?id=eq.${Number(b.id)}&select=*`))[0]; if (!an) return;
    await deliver(c, c.all.filter((x) => (an.recipients || []).includes(x.username)), { kind: "ann", title: "📢 Menejerdan xabar", body: an.text, link: "xabarlar" },
      { text: `📢 <b>Menejerdan xabar</b>\n\n${esc(an.text)}`, btns: [[{ text: "👍 O‘qidim", callback_data: `a:${an.id}` }]] });
  }
}
function kindButtons(prefix: string): Btn[][] {
  return [[{ text: "⚠️ Muammo", callback_data: `${prefix}:muammo` }, { text: "💡 Taklif", callback_data: `${prefix}:taklif` }], [{ text: "🕶 Anonim taklif", callback_data: `${prefix}:anon` }, { text: "❌ Bekor", callback_data: `${prefix}:cancel` }]];
}
function annTargets(c: Ctx, own?: string | null): Btn[][] {
  const rows: Btn[][] = [[{ text: own ? "👥 Filialimdagi hammaga" : "👥 Hammaga", callback_data: "x:all" }], [{ text: "👩‍🏫 Ustozlarga", callback_data: "x:teachers" }, { text: "🧹 Xodimlarga", callback_data: "x:staff" }]];
  if (!own && c.all.some((a) => a.role === "admin" && a.branch_id)) rows.push([{ text: "🧑‍💼 Filial adminlariga", callback_data: "x:admins" }]);
  if (!own) for (const b of c.S.branches) rows.push([{ text: `🏢 ${b.name}`.slice(0, 40), callback_data: `x:branch:${b.id}`.slice(0, 64) }]);
  rows.push([{ text: "❌ Bekor", callback_data: "x:cancel" }]);
  return rows;
}
function targetLabel(c: Ctx, target: string) {
  if (target === "all") return "Hammaga (ustoz va xodimlar)";
  if (target === "admins") return "Barcha filial adminlariga";
  if (target === "teachers") return "Barcha ustozlarga";
  if (target === "staff") return "Barcha xodimlarga";
  if (target.startsWith("branch:")) { const b = byId(c.S.branches, target.slice(7)); return (b ? b.name : "Filial") + " filialiga"; }
  return target;
}
// Holatga qarab kelgan oddiy matnni qayta ishlash. true = qayta ishlandi
async function handleStatefulText(chat: number, acc: any, text: string, c: Ctx): Promise<boolean> {
  const st = await getState(chat);
  if (!st) return false;
  const d = st.data || {};
  try {
    if (st.state === "ticket") {
      const r = await asUser(chat, "ticket_create", { p_kind: d.kind, p_text: text, p_anon: !!d.anon });
      await clearState(chat);
      await send(chat, `✅ Menejerga yuborildi (murojaat <b>#${r.id}</b>${d.anon ? ", anonim" : ""}). Javob shu yerga keladi.`);
      return true;
    }
    if (st.state === "reply") {
      await asUser(chat, "ticket_reply", { p_ticket: Number(d.id), p_text: text });
      await clearState(chat);
      await send(chat, `✅ Javob yuborildi (murojaat #${d.id}).`);
      return true;
    }
    if (st.state === "ann" && acc.role === "admin") {
      const r = await asUser(chat, "ann_send", { p_target: d.target, p_label: (acc.branch_id ? branchName(c, acc.branch_id) + ": " : "") + targetLabel(c, d.target), p_text: text });
      await clearState(chat);
      await send(chat, `✅ Xabar yuborildi: <b>${r.count}</b> kishiga (${esc((acc.branch_id ? branchName(c, acc.branch_id) + ": " : "") + targetLabel(c, d.target))}).`);
      return true;
    }
  } catch (e) {
    const m = String((e as Error).message);
    await clearState(chat);
    await send(chat, m === "no_recipients" ? "Bu guruhda login berilgan odam yo‘q." : "Xatolik: " + esc(m));
    return true;
  }
  return false;
}

// ---------------- Kiruvchi xabarlar ----------------
async function onMessage(msg: any) {
  const chat = msg.chat.id as number;
  if (msg.chat.type !== "private") return;
  const text = String(msg.text || "").trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();

  if (cmd === "/start" && arg) {
    const codes = await db(`tg_codes?code=eq.${encodeURIComponent(arg)}&select=username,expires_at`);
    if (!codes || !codes.length || new Date(codes[0].expires_at) < new Date()) {
      return send(chat, "❗ Havola eskirgan. Saytda <b>Profil → Telegramni ulash</b> tugmasini qayta bosing.", siteBtn());
    }
    await db(`accounts?tg_chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ tg_chat_id: null }) });
    await db(`accounts?username=eq.${encodeURIComponent(codes[0].username)}`, { method: "PATCH", body: JSON.stringify({ tg_chat_id: chat }) });
    await db(`tg_codes?code=eq.${encodeURIComponent(arg)}`, { method: "DELETE" });
    const c = await loadCtx();
    const a = (await db(`accounts?username=eq.${encodeURIComponent(codes[0].username)}&select=username,role,person_id`))[0];
    const p = c.S ? personOf(c, a) : null;
    await send(chat, `✅ <b>Ulandi!</b> Salom, ${esc(p ? p.name : a.username)}.\n\n` +
      (a.role === "staff" ? "Har kuni ertalab vazifalaringiz ro‘yxati keladi, har bir vazifa vaqtida eslatma beriladi. Vazifani shu yerning o‘zida belgilashingiz mumkin.\n\n"
        : a.role === "teacher" ? "Yangi topshiriqlar, darsingizga berilgan baholar va har dushanba reytingingiz shu yerga keladi.\n\n"
        : "Har kuni kechqurun umumiy hisobot, har dushanba haftalik reyting, yangi shikoyatlar va bajarilgan topshiriqlar shu yerga keladi.\n\n") + helpText(a.role));
    return;
  }
  const acc = (await db(`accounts?tg_chat_id=eq.${chat}&select=username,role,person_id,branch_id`))[0];
  if (!acc) {
    return send(chat, "👋 Bu Fast Education baholash tizimining boti.\n\nUlanish uchun saytga kiring → <b>Profil</b> → <b>Telegramni ulash</b> tugmasini bosing.", siteBtn());
  }
  const c = await loadCtx();
  if (!c.S) return send(chat, "Tizim hali sozlanmagan.");
  const p = personOf(c, acc);
  const cs = acc.role === "admin" ? scoped(c, acc.branch_id) : c;
  await ensureCommands();
  if (cmd === "/bekor") { await clearState(chat); return send(chat, "Bekor qilindi."); }
  if (!text.startsWith("/")) {
    if (await handleStatefulText(chat, acc, text, c)) return;
    if (acc.role !== "admin" && text) {
      await setState(chat, "pending", { text: text.slice(0, 4000) });
      return send(chat, "Bu xabarni menejerga yuboraymi? Turini tanlang:", kindButtons("p"));
    }
    return send(chat, helpText(acc.role));
  }
  await clearState(chat);
  if (cmd === "/murojaat" && acc.role !== "admin") {
    if (arg) { await setState(chat, "pending", { text: arg }); return send(chat, "Turini tanlang:", kindButtons("p")); }
    return send(chat, "Menejerga nima yozmoqchisiz?", kindButtons("m"));
  }
  if (acc.role === "admin" && cmd === "/xabar") return send(chat, "Kimga xabar yuboramiz?", annTargets(c, acc.branch_id));
  if (acc.role === "admin" && cmd === "/murojaatlar") {
    const open = await db("tickets?status=neq.hal&select=*&order=updated_at.desc&limit=10");
    if (!open || !open.length) return send(chat, "Ochiq murojaat yo‘q 👌");
    for (const t of open) {
      const acc2 = (await db(`accounts?username=eq.${encodeURIComponent(t.author)}&select=username,role,person_id`))[0];
      if (acc.branch_id && (!acc2 || personBranch(c, acc2.role, acc2.person_id) !== acc.branch_id)) continue;
      await send(chat, ticketText(c, t, acc2), adminTicketBtns(t.id));
    }
    return;
  }
  if (cmd === "/chiqish") {
    await db(`accounts?tg_chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ tg_chat_id: null }) });
    return send(chat, "Telegram hisobingizdan uzildi. Qayta ulash uchun saytdagi Profil bo‘limidan foydalaning.");
  }
  if (cmd === "/reyting") { await send(chat, branchRanking(c)); return send(chat, teacherRanking(acc.role === "admin" ? cs : c)); }
  if (acc.role === "admin") {
    if (cmd === "/xodimlar") return send(chat, staffReport(cs));
    if (cmd === "/shikoyatlar") {
      const pend = cs.S.complaints.filter((x: any) => x.status === "yangi");
      return send(chat, pend.length ? "⚠️ <b>Ko‘rib chiqilmagan shikoyatlar</b>\n\n" + pend.map((x: any) => { const t = byId(c.S.teachers, x.teacherId); return `• <b>${esc(t ? t.name : "—")}</b> (${fmt(x.date)}, ${esc(x.source)}): ${esc(x.text)}`; }).join("\n") + "\n\nTasdiqlash yoki rad etish: sayt → Admin panel → Baholash va shikoyatlar." : "Ko‘rib chiqilmagan shikoyat yo‘q 👌", siteBtn());
    }
    if (cmd === "/topshiriqlar") {
      const T = today(); const od = cs.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline < T);
      const open = cs.S.tasks.filter((k: any) => k.status !== "bajarildi").length;
      if (acc.branch_id) { const my = myTasks(c, "admin", acc.username); if (my.btns.length) await send(chat, "🧑‍💼 <b>Bosh admindan</b>\n" + my.text, my.btns); }
      return send(chat, `📌 Ochiq topshiriqlar: <b>${open}</b>, muddati o‘tgan: <b>${od.length}</b>\n\n` + od.map((k: any) => `🔴 ${esc(k.title)} — ${esc(assignee(c, k))} (${fmt(k.deadline)})`).join("\n"));
    }
    if (cmd === "/ustoz") {
      if (!arg) return send(chat, "Ismini yozing, masalan: <code>/ustoz Aziza</code>");
      const found = cs.S.teachers.filter((t: any) => t.name.toLowerCase().includes(arg.toLowerCase()));
      if (!found.length) return send(chat, "Topilmadi.");
      if (found.length > 1 && found.length <= 10) return send(chat, "Bir nechta topildi, tanlang:", found.map((t: any) => [{ text: t.name, callback_data: `u:${t.id}` }]));
      if (found.length > 10) return send(chat, "Juda ko‘p topildi, aniqroq yozing.");
      return send(chat, teacherCard(c, found[0], true));
    }
    if (cmd === "/hisobot" || cmd === "/men" || cmd === "/start") return send(chat, adminSummary(cs, "Umumiy hisobot", c) + "\n\n" + (cmd === "/start" ? helpText("admin") : ""));
    return send(chat, helpText("admin"));
  }
  if (!p) return send(chat, "Hisobingiz hech qaysi ustoz yoki xodimga bog‘lanmagan. Menejerga murojaat qiling.");
  if (acc.role === "teacher") {
    if (cmd === "/men" || cmd === "/start") return send(chat, teacherCard(c, p, true) + (cmd === "/start" ? "\n\n" + helpText("teacher") : ""));
    if (cmd === "/topshiriqlar") { const m = myTasks(c, "teacher", p.id); return send(chat, m.text, m.btns); }
    return send(chat, helpText("teacher"));
  }
  if (cmd === "/bugun" || cmd === "/start") { const m = staffToday(c, p); return send(chat, m.text, m.btns); }
  if (cmd === "/men") {
    const st = staffStats(c, p);
    return send(chat, `👤 <b>${esc(p.name)}</b>\n${ROLES[p.role]} · ${esc(branchName(c, p.branchId))}\n\n📊 Samaradorlik\n• Bugun: <b>${st.day == null ? "—" : r0(st.day) + "%"}</b>\n• Shu hafta: <b>${st.week == null ? "—" : r0(st.week) + "%"}</b>\n• Shu oy: <b>${st.month == null ? "—" : r0(st.month) + "%"}</b>\n\n<i>Vaqtida bajarilgan vazifa — 1 ball, kechikkan — 0,5, bajarilmagan — 0.</i>`);
  }
  if (cmd === "/topshiriqlar") { const m = myTasks(c, "staff", p.id); return send(chat, m.text, m.btns); }
  return send(chat, helpText("staff"));
}

async function onCallback(q: any) {
  const chat = q.message?.chat?.id as number, msgId = q.message?.message_id as number;
  const data = String(q.data || "");
  const answer = (text: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert });
  const acc = (await db(`accounts?tg_chat_id=eq.${chat}&select=username,role,person_id,branch_id`))[0];
  if (!acc) return answer("Avval saytdan Telegramni ulang", true);
  try {
    if (data === "in") {
      if (acc.role !== "staff" || !acc.person_id) { await answer(""); return; }
      const r = await asUser(chat, "checkin", { p_day: today(), p_staff_id: acc.person_id });
      await answer(`Xush kelibsiz! ${r.log ? r.log.at : ""}`);
      const c = await loadCtx(); const p = personOf(c, acc);
      if (p) { const m = staffToday(c, p); await edit(chat, msgId, m.text, m.btns); }
      return;
    }
    if (data.startsWith("t:")) {
      const dutyId = data.slice(2), T = today();
      let c = await loadCtx();
      if (c.LOGS[`${T}|${dutyId}`]) { await answer("Bu vazifa allaqachon belgilangan"); }
      else {
        const token = await rpc("tg_session", { p_chat: chat });
        const r = await rpc("tick", { p_token: token, p_day: T, p_duty_id: dutyId });
        await answer(r.log && r.log.s === "l" ? `Belgilandi — kechikish bilan (${r.log.at}) · 0,5 ball` : `Belgilandi ✅ ${r.log ? r.log.at : ""}`);
        c = await loadCtx();
      }
      const p = personOf(c, acc);
      if (p && acc.role === "staff") { const m = staffToday(c, p); await edit(chat, msgId, m.text, m.btns); }
      return;
    }
    if (data.startsWith("k:")) {
      const token = await rpc("tg_session", { p_chat: chat });
      await rpc("set_task_status", { p_token: token, p_task_id: data.slice(2), p_status: "bajarildi" });
      await answer("Topshiriq bajarildi deb belgilandi ✅");
      const c = await loadCtx(); const p = personOf(c, acc);
      if (acc.role === "admin") { const m = myTasks(c, "admin", acc.username); await edit(chat, msgId, m.text, m.btns); }
      else if (p) { const m = myTasks(c, acc.role, p.id); await edit(chat, msgId, m.text, m.btns); }
      return;
    }
    if (data.startsWith("m:") || data.startsWith("p:")) {
      const v = data.slice(2);
      if (v === "cancel") { await clearState(chat); await answer("Bekor qilindi"); await edit(chat, msgId, "Bekor qilindi."); return; }
      const kind = v === "anon" ? "taklif" : v, anon = v === "anon";
      if (data.startsWith("m:")) {
        await setState(chat, "ticket", { kind, anon });
        await answer("");
        await edit(chat, msgId, `${KIND[kind]}${anon ? " (anonim)" : ""} — matnini bitta xabarda yozing:`);
        return;
      }
      const st = await getState(chat);
      if (!st || st.state !== "pending") { await answer("Xabar eskirgan, qaytadan yozing", true); return; }
      const r = await asUser(chat, "ticket_create", { p_kind: kind, p_text: st.data.text, p_anon: anon });
      await clearState(chat);
      await answer("Yuborildi ✅");
      await edit(chat, msgId, `✅ Menejerga yuborildi: ${KIND[kind]}${anon ? " (anonim)" : ""}, murojaat <b>#${r.id}</b>. Javob shu yerga keladi.`);
      return;
    }
    if (data.startsWith("r:")) {
      await setState(chat, "reply", { id: Number(data.slice(2)) });
      await answer("");
      await send(chat, `✍️ Murojaat #${data.slice(2)} uchun javobingizni yozing (bekor qilish: /bekor):`);
      return;
    }
    if (data.startsWith("h:") && acc.role === "admin") {
      await asUser(chat, "ticket_status", { p_ticket: Number(data.slice(2)), p_status: "hal" });
      await answer("Hal qilindi ✅");
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: { inline_keyboard: [] } });
      return;
    }
    if (data.startsWith("a:")) {
      await asUser(chat, "ann_read", { p_ids: [Number(data.slice(2))] });
      await answer("Rahmat!");
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: { inline_keyboard: [] } });
      return;
    }
    if (data.startsWith("x:") && acc.role === "admin") {
      const target = data.slice(2);
      if (target === "cancel") { await answer("Bekor qilindi"); await edit(chat, msgId, "Bekor qilindi."); return; }
      const c = await loadCtx();
      await setState(chat, "ann", { target });
      await answer("");
      await edit(chat, msgId, `📢 ${esc((acc.branch_id ? branchName(c, acc.branch_id) + ": " : "") + targetLabel(c, target))} — xabar matnini yozing (bekor qilish: /bekor):`);
      return;
    }
    if (data.startsWith("u:") && acc.role === "admin") {
      const c = await loadCtx(); const t = byId(c.S.teachers, data.slice(2));
      await answer(""); if (t) await send(chat, teacherCard(c, t, true));
      return;
    }
    await answer("");
  } catch (e) {
    const m = String((e as Error).message);
    const map: Record<string, string> = { only_today: "Faqat bugungi vazifani belgilash mumkin", not_checked_in: "Avval «Ishga keldim» tugmasini bosing", not_allowed: "Bu sizning vazifangiz emas", already_done: "Allaqachon bajarilgan", duty_not_found: "Vazifa o‘chirilgan", task_not_found: "Topshiriq o‘chirilgan" };
    await answer(map[m] || "Xatolik: " + m, true);
  }
}

// ---------------- Jadval bo'yicha ishlar ----------------
async function linkedPeople(c: Ctx) {
  return c.accounts.map((a) => ({ a, p: personOf(c, a) })).filter((x) => x.a.role === "admin" || x.p);
}
async function jobMorning() {
  const c = await loadCtx(); if (!c.S) return;
  for (const { a, p } of await linkedPeople(c)) {
    try {
      if (a.role === "staff") {
        const m = staffToday(c, p);
        if (rawDutiesOn(c, p.id, today()).length) await send(a.tg_chat_id, "☀️ Xayrli tong!\n\n" + m.text, m.btns);
        const t = myTasks(c, "staff", p.id); if (t.btns.length) await send(a.tg_chat_id, t.text, t.btns);
      } else if (a.role === "teacher") {
        const t = myTasks(c, "teacher", p.id); if (t.btns.length) await send(a.tg_chat_id, "☀️ Xayrli tong!\n\n" + t.text, t.btns);
      }
    } catch (_) { /* bitta xato boshqalarni to'xtatmasin */ }
  }
}
async function jobEvening() {
  const c = await loadCtx(); if (!c.S) return;
  const T = today();
  for (const { a, p } of await linkedPeople(c)) {
    try {
      if (a.role === "admin") { const cs = scoped(c, a.branch_id); await send(a.tg_chat_id, adminSummary(cs, "Kunlik hisobot", c)); await send(a.tg_chat_id, staffReport(cs)); }
      else if (a.role === "staff") {
        const ds = dutiesOn(c, p.id, T); if (!ds.length) continue;
        const st = staffStats(c, p);
        const miss = ds.filter((d: any) => !c.LOGS[`${T}|${d.id}`]);
        await send(a.tg_chat_id, `🌙 <b>Kun yakuni</b> · ${fmt(T)}\n\nBugun: <b>${st.day == null ? "—" : r0(st.day) + "%"}</b> · hafta: <b>${st.week == null ? "—" : r0(st.week) + "%"}</b> · oy: <b>${st.month == null ? "—" : r0(st.month) + "%"}</b>` +
          (miss.length ? `\n\nBelgilanmagan vazifalar:\n` + miss.map((d: any) => `❌ ${d.time} — ${esc(d.title)}`).join("\n") : "\n\nBarcha vazifalar bajarildi — rahmat! 👏"));
      }
    } catch (_) { /* davom */ }
  }
}
async function jobWeekly() {
  const c = await loadCtx(); if (!c.S) return;
  for (const { a, p } of await linkedPeople(c)) {
    try {
      if (a.role === "admin") { await send(a.tg_chat_id, "📅 <b>Haftalik hisobot</b>\n\n" + branchRanking(c)); await send(a.tg_chat_id, teacherRanking(scoped(c, a.branch_id))); }
      else if (a.role === "teacher") await send(a.tg_chat_id, "📅 <b>Haftalik natijangiz</b>\n\n" + teacherCard(c, p, false));
      else if (a.role === "staff") {
        const st = staffStats(c, p);
        await send(a.tg_chat_id, `📅 <b>Haftalik natijangiz</b>\n\nO‘tgan 7 kun: <b>${st.week == null ? "—" : r0(st.week) + "%"}</b>\nOxirgi 30 kun: <b>${st.month == null ? "—" : r0(st.month) + "%"}</b>`);
      }
    } catch (_) { /* davom */ }
  }
}
async function jobReminders() {
  const c = await loadCtx(); if (!c.S) return;
  const T = today(), now = nowMin();
  for (const a of c.all.filter((x) => x.role === "staff")) {
    const p = byId(c.S.staff, a.person_id); if (!p) continue;
    for (const d of dutiesOn(c, p.id, T)) {
      const due = hm(d.time);
      if (due > now || now - due > 25 || c.LOGS[`${T}|${d.id}`]) continue;
      if (!(await once(`r|${T}|${d.id}`))) continue;
      await deliver(c, [a], { kind: "duty", title: `⏰ ${d.time} — vaqti bo‘ldi`, body: `${d.title}. ${c.S.settings.lateMin} daqiqa ichida belgilang.`, link: "xodimlar" },
        { text: `⏰ <b>Vaqti bo‘ldi — ${d.time}</b>\n${esc(d.title)}\n\n<i>${c.S.settings.lateMin} daqiqa ichida belgilasangiz — vaqtida hisoblanadi.</i>`, btns: [[{ text: "✅ Bajarildi", callback_data: `t:${d.id}` }]] });
    }
  }
  // Topshiriq muddati bugun tugaydi (soat 15:00 dan keyin bir marta)
  if (now >= 15 * 60) {
    for (const k of c.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline === T)) {
      const a = k.type === "admin" ? c.all.find((x) => x.username === k.assigneeId) : c.all.find((x) => x.role === k.type && x.person_id === k.assigneeId); if (!a) continue;
      if (!(await once(`k|${T}|${k.id}`))) continue;
      await deliver(c, [a], { kind: "task", title: "⏳ Topshiriq muddati bugun tugaydi", body: k.title, link: "topshiriqlar" },
        { text: `⏳ <b>Topshiriq muddati bugun tugaydi</b>\n${esc(k.title)}`, btns: [[{ text: "✅ Bajarildi", callback_data: `k:${k.id}` }]] });
    }
  }
  await db(`tg_sent?at=lt.${new Date(Date.now() - 4 * 86400e3).toISOString()}`, { method: "DELETE" });
  if (now < 10) await db(`notifications?created_at=lt.${new Date(Date.now() - 60 * 86400e3).toISOString()}`, { method: "DELETE" }).catch(() => {});
}
async function jobDiff(old: any) {
  const c = await loadCtx(); if (!c.S || !old) return;
  const S = c.S;
  const newTasks = S.tasks.filter((k: any) => !(k.id in (old.tasks || {})));
  const doneTasks = S.tasks.filter((k: any) => k.status === "bajarildi" && old.tasks && old.tasks[k.id] && old.tasks[k.id] !== "bajarildi");
  const newEvals = S.evals.filter((e: any) => !(old.evals || []).includes(e.id));
  const newRatings = S.ratings.filter((e: any) => !(old.ratings || []).includes(e.id));
  const newComp = S.complaints.filter((x: any) => !(x.id in (old.complaints || {})));
  const confComp = S.complaints.filter((x: any) => x.status === "tasdiqlangan" && old.complaints && old.complaints[x.id] && old.complaints[x.id] !== "tasdiqlangan");
  // Demo yuklash kabi ommaviy o'zgarishlarda xabar yubormaymiz
  if (newTasks.length + newEvals.length + newRatings.length + newComp.length > 15) return;
  const accOf = (type: string, pid: string) => type === "admin" ? c.all.find((a) => a.username === pid) : c.all.find((a) => a.role === type && a.person_id === pid);
  for (const k of newTasks) {
    await deliver(c, [accOf(k.type, k.assigneeId)], { kind: "task", title: "📌 Yangi topshiriq", body: `${k.title} · muddat: ${fmt(k.deadline)}`, link: "topshiriqlar" },
      { text: `📌 <b>Yangi topshiriq</b>\n${esc(k.title)}${k.desc ? `\n<i>${esc(k.desc)}</i>` : ""}\n\nMuddat: <b>${fmt(k.deadline)}</b> · muhimlik: ${esc(k.priority)}`, btns: [[{ text: "✅ Bajarildi", callback_data: `k:${k.id}` }]] });
  }
  for (const k of doneTasks) {
    await deliver(c, adminsFor(c, personBranch(c, k.type, k.assigneeId), true), { kind: "task", title: "✅ Topshiriq bajarildi", body: `${k.title} — ${assignee(c, k)}`, link: "topshiriqlar" },
      { text: `✅ <b>Topshiriq bajarildi</b>\n${esc(k.title)} — ${esc(assignee(c, k))}` });
  }
  for (const e of newEvals) {
    await deliver(c, [accOf("teacher", e.teacherId)], { kind: "eval", title: `📝 Darsingiz baholandi: ${r1(avg(e.c))}/10`, body: `Tayyorgarlik ${e.c[0]} · Metodika ${e.c[1]} · Faollik ${e.c[2]} · Vaqt ${e.c[3]}${e.note ? " — " + e.note : ""}`, link: "ustozlar" },
      { text: `📝 <b>Darsingiz baholandi</b> · ${fmt(e.date)}\nO‘rtacha: <b>${r1(avg(e.c))}</b>/10\nTayyorgarlik ${e.c[0]} · Metodika ${e.c[1]} · Faollik ${e.c[2]} · Vaqt ${e.c[3]}${e.note ? `\n<i>${esc(e.note)}</i>` : ""}` });
  }
  for (const r of newRatings) {
    await deliver(c, [accOf("teacher", r.teacherId)], { kind: "rating", title: `⭐ Menejer bahosi: ${r.score}/10`, body: r.work + (r.comment ? " — " + r.comment : ""), link: "ustozlar" },
      { text: `⭐ <b>Menejer bahosi</b>\n${esc(r.work)}: <b>${r.score}/10</b>${r.comment ? `\n<i>${esc(r.comment)}</i>` : ""}` });
  }
  for (const x of newComp) {
    const t = byId(S.teachers, x.teacherId);
    await deliver(c, adminsFor(c, t ? t.branchId : null, true), { kind: "complaint", title: `⚠️ Yangi shikoyat — ${t ? t.name : "—"}`, body: `${x.text} (${x.source})`, link: "admin" },
      { text: `⚠️ <b>Yangi shikoyat</b> — ${esc(t ? t.name : "—")}\n${esc(x.text)} (${esc(x.source)})\n\nKo‘rib chiqing: sayt → Admin panel → Baholash va shikoyatlar.` });
  }
  for (const x of confComp) {
    await deliver(c, [accOf("teacher", x.teacherId)], { kind: "complaint", title: "⚠️ Sizga kelgan shikoyat tasdiqlandi", body: x.text, link: "ustozlar" },
      { text: `⚠️ <b>Sizga kelgan shikoyat tasdiqlandi</b> · ${fmt(x.date)}\n${esc(x.text)}\n\nBu reytingingizga ta’sir qiladi. Savollar bo‘lsa, menejeringiz bilan gaplashing.` });
  }
}
const CMD_VERSION = "2";
async function setCommands() {
  await tg("setMyCommands", { commands: [
    { command: "bugun", description: "Bugungi vazifalarim (xodimlar)" },
    { command: "men", description: "Mening natijam" },
    { command: "topshiriqlar", description: "Topshiriqlar" },
    { command: "murojaat", description: "Menejerga muammo yoki taklif yozish" },
    { command: "reyting", description: "Ustozlar va filiallar reytingi" },
    { command: "hisobot", description: "Umumiy hisobot (menejer)" },
    { command: "murojaatlar", description: "Ochiq murojaatlar (menejer)" },
    { command: "xabar", description: "Xabar yuborish (menejer)" },
    { command: "xodimlar", description: "Xodimlar samaradorligi (menejer)" },
    { command: "shikoyatlar", description: "Shikoyatlar (menejer)" },
    { command: "bekor", description: "Amalni bekor qilish" },
    { command: "chiqish", description: "Telegramni uzish" },
  ] });
  await setCfg("cmd_version", CMD_VERSION);
}
async function ensureCommands() { if (CFG.cmd_version !== CMD_VERSION) { await setCommands(); CFG.cmd_version = CMD_VERSION; } }
async function jobSetup() {
  const me = await tg("getMe", {});
  if (me.ok) await setCfg("bot_username", me.result.username);
  const wh = await tg("setWebhook", { url: CFG.function_url, secret_token: CFG.webhook_secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await setCommands();
  const res = JSON.stringify({ bot: me.ok ? "@" + me.result.username : me.description, webhook: wh.ok ? "ok" : wh.description, at: new Date().toISOString() });
  await setCfg("setup_result", res);
  return res;
}


// ---------------- Web Push (RFC 8291 shifrlash + RFC 8292 VAPID) ----------------
const enc = new TextEncoder();
function b64u(b: Uint8Array) { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s: string) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)); }
function concat(...a: Uint8Array[]) { const r = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { r.set(x, o); o += x.length; } return r; }
async function hkdf(salt: any, ikm: any, info: any, len: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function ensureVapid() {
  if (CFG.vapid_public && CFG.vapid_private_jwk) return;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
  await setCfg("vapid_public", pub); await setCfg("vapid_private_jwk", jwk);
  CFG.vapid_public = pub; CFG.vapid_private_jwk = jwk;
}
async function vapidAuth(endpoint: string) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CFG.site_url || "mailto:noreply@example.com" })));
  const jwk = JSON.parse(CFG.vapid_private_jwk); delete jwk.key_ops;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims) as any));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${CFG.vapid_public}`;
}
async function encryptPush(p256dh: string, auth: string, data: any) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua as any, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, secret, concat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as any, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as any }, key, concat(data, new Uint8Array([2])) as any));
  return concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(sub: any, payload: unknown) {
  const body = await encryptPush(sub.p256dh, sub.auth, enc.encode(JSON.stringify(payload)));
  const r = await fetch(sub.endpoint, { method: "POST", body: body as any, headers: {
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high", Authorization: await vapidAuth(sub.endpoint) } });
  if (r.status === 404 || r.status === 410) await db(`push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
  return r.status;
}

// ---------------- Bitta hodisani hamma joyga yetkazish: sayt 🔔 + telefon push + Telegram ----------------
type Note = { kind: string; title: string; body: string; link: string };
async function deliver(c: Ctx, users: any[], n: Note, tgMsg?: { text: string; btns?: Btn[][] }) {
  const uniq = [...new Map(users.filter(Boolean).map((u) => [u.username, u])).values()];
  if (!uniq.length) return;
  try { await db("notifications", { method: "POST", body: JSON.stringify(uniq.map((u) => ({ username: u.username, kind: n.kind, title: n.title.slice(0, 200), body: n.body.slice(0, 600), link: n.link }))) }); } catch (_) { /* jadval hali yo'q bo'lishi mumkin */ }
  try {
    await ensureVapid();
    const list = encodeURIComponent("(" + uniq.map((u) => `"${u.username}"`).join(",") + ")");
    const subs = await db(`push_subs?select=endpoint,p256dh,auth,username&username=in.${list}`);
    for (const s of subs || []) { try { await sendPush(s, { title: n.title, body: n.body.slice(0, 240), url: (CFG.site_url || "") + "#" + n.link, tag: n.kind + "-" + Date.now() }); } catch (_) { /* davom */ } }
  } catch (_) { /* push sozlanmagan */ }
  if (tgMsg) for (const u of uniq) if (u.tg_chat_id) await send(u.tg_chat_id, tgMsg.text, tgMsg.btns).catch(() => {});
}

// ---------------- Kirish nuqtasi ----------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Fast Education bot", { status: 200 });
  try {
    await loadCfg();
    const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
    const jobSecret = req.headers.get("x-fe-secret");
    const body = await req.json().catch(() => ({}));
    if (tgSecret && tgSecret === CFG.webhook_secret) {
      if (body.message) await onMessage(body.message);
      else if (body.callback_query) await onCallback(body.callback_query);
      return new Response("ok");
    }
    if (jobSecret && jobSecret === CFG.cron_secret) {
      const job = body.job;
      if (job === "setup") return new Response(await jobSetup());
      if (job === "morning") await jobMorning();
      else if (job === "evening") await jobEvening();
      else if (job === "weekly") await jobWeekly();
      else if (job === "reminders") await jobReminders();
      else if (job === "diff") await jobDiff(body.old);
      else if (job === "notify") await jobNotify(body);
      else if (job === "vapid") { await ensureVapid(); return new Response("ok " + CFG.vapid_public); }
      else if (job === "push_test") {
        const c = await loadCtx();
        await deliver(c, c.all.filter((a) => a.username === body.username), { kind: "test", title: "🔔 Sinov bildirishnomasi", body: "Bildirishnomalar ishlayapti! Fast Education.", link: "profil" });
      }
      return new Response("ok");
    }
    return new Response("forbidden", { status: 403 });
  } catch (e) {
    console.error(e);
    // Telegram qayta-qayta yubormasligi uchun 200 qaytaramiz
    return new Response("error: " + (e as Error).message, { status: 200 });
  }
});
