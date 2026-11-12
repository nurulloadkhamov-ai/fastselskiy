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
type Ctx = { S: any; LOGS: Record<string, { s: string; at: string }>; accounts: any[] };
async function loadCtx(): Promise<Ctx> {
  const st = await db("app_state?id=eq.1&select=data");
  const S = (st && st[0] && st[0].data) || null;
  const logs = await db(`duty_logs?select=day,duty_id,status,at&day=gte.${addDays(today(), -40)}`);
  const LOGS: Ctx["LOGS"] = {};
  for (const l of logs || []) LOGS[`${l.day}|${l.duty_id}`] = { s: l.status, at: l.at };
  const accounts = await db("accounts?select=username,role,person_id,tg_chat_id&tg_chat_id=not.is.null");
  if (S) {
    S.settings = Object.assign({ lateMin: 30, tw: { lesson: 40, manager: 30, tasks: 15, complaints: 15 }, bw: { teachers: 40, staff: 30, growth: 30 } }, S.settings || {});
    for (const k of ["branches", "teachers", "evals", "ratings", "complaints", "staff", "duties", "tasks"]) if (!Array.isArray(S[k])) S[k] = [];
  }
  return { S, LOGS, accounts: accounts || [] };
}
const byId = (a: any[], id: string) => a.find((x) => x.id === id) || null;
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
function dutiesOn(c: Ctx, staffId: string, date: string) {
  const d = dow(date);
  return c.S.duties.filter((x: any) => x.staffId === staffId && x.days.indexOf(d) >= 0).sort((a: any, b: any) => (a.time < b.time ? -1 : 1));
}
function effRange(c: Ctx, staffId: string, from: string, to: string) {
  let assigned = 0, pts = 0, d = from; const T = today(), now = nowMin();
  while (d <= to) {
    for (const x of dutiesOn(c, staffId, d)) {
      const l = c.LOGS[`${d}|${x.id}`];
      if (d === T && hm(x.time) + c.S.settings.lateMin > now && !l) continue;
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
  const lines = ds.map((d: any) => {
    const l = c.LOGS[`${T}|${d.id}`];
    const mark = l ? (l.s === "d" ? "✅" : "🟡") : hm(d.time) + c.S.settings.lateMin < now ? "❌" : "⬜";
    return `${mark} <b>${d.time}</b> — ${esc(d.title)}${l ? ` <i>(${l.s === "d" ? "" : "kechikib, "}${esc(l.at)})</i>` : ""}`;
  });
  const btns: Btn[][] = ds.filter((d: any) => !c.LOGS[`${T}|${d.id}`]).map((d: any) => [{ text: `✅ ${d.time} — ${d.title}`.slice(0, 60), callback_data: `t:${d.id}` }]);
  const text = `📋 <b>Bugungi vazifalaringiz</b> · ${fmt(T)}\n\n` + (lines.length ? lines.join("\n") : "Bugun vazifa yo‘q 🎉") +
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
function adminSummary(c: Ctx, title: string) {
  const T = today();
  const pending = c.S.complaints.filter((x: any) => x.status === "yangi");
  const overdue = c.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline < T);
  const sDay = c.S.staff.map((s: any) => staffStats(c, s).day).filter((v: any) => v != null);
  let txt = `📊 <b>${title}</b> · ${fmt(T)}\n\n` +
    `• Xodimlar bugungi samaradorligi: <b>${sDay.length ? r0(avg(sDay)) + "%" : "—"}</b>\n` +
    `• Ko‘rib chiqilmagan shikoyatlar: <b>${pending.length}</b>\n` +
    `• Muddati o‘tgan topshiriqlar: <b>${overdue.length}</b>\n\n` + branchRanking(c);
  if (pending.length) txt += "\n\n⚠️ <b>Ko‘rib chiqilishi kerak</b>\n" + pending.slice(0, 10).map((x: any) => { const t = byId(c.S.teachers, x.teacherId); return `• ${esc(t ? t.name : "—")}: ${esc(x.text)} (${fmt(x.date)})`; }).join("\n");
  if (overdue.length) txt += "\n\n⏰ <b>Muddati o‘tgan topshiriqlar</b>\n" + overdue.slice(0, 10).map((k: any) => `• ${esc(k.title)} — ${esc(assignee(c, k))} (${fmt(k.deadline)})`).join("\n");
  return txt;
}
function assignee(c: Ctx, k: any) { const p = k.type === "teacher" ? byId(c.S.teachers, k.assigneeId) : byId(c.S.staff, k.assigneeId); return p ? p.name : "—"; }
function personOf(c: Ctx, a: any) { return a.role === "teacher" ? byId(c.S.teachers, a.person_id) : a.role === "staff" ? byId(c.S.staff, a.person_id) : null; }
function helpText(role: string) {
  const common = "/reyting — ustozlar va filiallar reytingi\n/chiqish — Telegramni hisobdan uzish";
  if (role === "admin") return "Buyruqlar:\n/hisobot — bugungi umumiy hisobot\n/xodimlar — xodimlar samaradorligi\n/ustoz <i>ism</i> — ustoz haqida to‘liq ma’lumot\n/shikoyatlar — ko‘rib chiqilmagan shikoyatlar\n/topshiriqlar — muddati o‘tgan topshiriqlar\n" + common;
  if (role === "teacher") return "Buyruqlar:\n/men — ballim va o‘rnim\n/topshiriqlar — ochiq topshiriqlarim\n" + common;
  return "Buyruqlar:\n/bugun — bugungi vazifalarim (belgilash tugmalari bilan)\n/men — samaradorligim\n/topshiriqlar — ochiq topshiriqlarim\n" + common;
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
  const acc = (await db(`accounts?tg_chat_id=eq.${chat}&select=username,role,person_id`))[0];
  if (!acc) {
    return send(chat, "👋 Bu Fast Education baholash tizimining boti.\n\nUlanish uchun saytga kiring → <b>Profil</b> → <b>Telegramni ulash</b> tugmasini bosing.", siteBtn());
  }
  const c = await loadCtx();
  if (!c.S) return send(chat, "Tizim hali sozlanmagan.");
  const p = personOf(c, acc);
  if (cmd === "/chiqish") {
    await db(`accounts?tg_chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ tg_chat_id: null }) });
    return send(chat, "Telegram hisobingizdan uzildi. Qayta ulash uchun saytdagi Profil bo‘limidan foydalaning.");
  }
  if (cmd === "/reyting") { await send(chat, branchRanking(c)); return send(chat, teacherRanking(c)); }
  if (acc.role === "admin") {
    if (cmd === "/xodimlar") return send(chat, staffReport(c));
    if (cmd === "/shikoyatlar") {
      const pend = c.S.complaints.filter((x: any) => x.status === "yangi");
      return send(chat, pend.length ? "⚠️ <b>Ko‘rib chiqilmagan shikoyatlar</b>\n\n" + pend.map((x: any) => { const t = byId(c.S.teachers, x.teacherId); return `• <b>${esc(t ? t.name : "—")}</b> (${fmt(x.date)}, ${esc(x.source)}): ${esc(x.text)}`; }).join("\n") + "\n\nTasdiqlash yoki rad etish: sayt → Admin panel → Baholash va shikoyatlar." : "Ko‘rib chiqilmagan shikoyat yo‘q 👌", siteBtn());
    }
    if (cmd === "/topshiriqlar") {
      const T = today(); const od = c.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline < T);
      const open = c.S.tasks.filter((k: any) => k.status !== "bajarildi").length;
      return send(chat, `📌 Ochiq topshiriqlar: <b>${open}</b>, muddati o‘tgan: <b>${od.length}</b>\n\n` + od.map((k: any) => `🔴 ${esc(k.title)} — ${esc(assignee(c, k))} (${fmt(k.deadline)})`).join("\n"));
    }
    if (cmd === "/ustoz") {
      if (!arg) return send(chat, "Ismini yozing, masalan: <code>/ustoz Aziza</code>");
      const found = c.S.teachers.filter((t: any) => t.name.toLowerCase().includes(arg.toLowerCase()));
      if (!found.length) return send(chat, "Topilmadi.");
      if (found.length > 1 && found.length <= 10) return send(chat, "Bir nechta topildi, tanlang:", found.map((t: any) => [{ text: t.name, callback_data: `u:${t.id}` }]));
      if (found.length > 10) return send(chat, "Juda ko‘p topildi, aniqroq yozing.");
      return send(chat, teacherCard(c, found[0], true));
    }
    if (cmd === "/hisobot" || cmd === "/men" || cmd === "/start") return send(chat, adminSummary(c, "Umumiy hisobot") + "\n\n" + (cmd === "/start" ? helpText("admin") : ""));
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
  const acc = (await db(`accounts?tg_chat_id=eq.${chat}&select=username,role,person_id`))[0];
  if (!acc) return answer("Avval saytdan Telegramni ulang", true);
  try {
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
      if (p) { const m = myTasks(c, acc.role, p.id); await edit(chat, msgId, m.text, m.btns); }
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
    const map: Record<string, string> = { only_today: "Faqat bugungi vazifani belgilash mumkin", not_allowed: "Bu sizning vazifangiz emas", already_done: "Allaqachon bajarilgan", duty_not_found: "Vazifa o‘chirilgan", task_not_found: "Topshiriq o‘chirilgan" };
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
        if (dutiesOn(c, p.id, today()).length) await send(a.tg_chat_id, "☀️ Xayrli tong!\n\n" + m.text, m.btns);
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
      if (a.role === "admin") { await send(a.tg_chat_id, adminSummary(c, "Kunlik hisobot")); await send(a.tg_chat_id, staffReport(c)); }
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
      if (a.role === "admin") { await send(a.tg_chat_id, "📅 <b>Haftalik hisobot</b>\n\n" + branchRanking(c)); await send(a.tg_chat_id, teacherRanking(c)); }
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
  for (const { a, p } of await linkedPeople(c)) {
    if (a.role !== "staff") continue;
    for (const d of dutiesOn(c, p.id, T)) {
      const due = hm(d.time);
      if (due > now || now - due > 25 || c.LOGS[`${T}|${d.id}`]) continue;
      if (!(await once(`r|${T}|${d.id}`))) continue;
      try { await send(a.tg_chat_id, `⏰ <b>Vaqti bo‘ldi — ${d.time}</b>\n${esc(d.title)}\n\n<i>${c.S.settings.lateMin} daqiqa ichida belgilasangiz — vaqtida hisoblanadi.</i>`, [[{ text: "✅ Bajarildi", callback_data: `t:${d.id}` }]]); } catch (_) { /* davom */ }
    }
  }
  // Topshiriq muddati bugun tugaydi (soat 15:00 dan keyin bir marta)
  if (now >= 15 * 60) {
    for (const k of c.S.tasks.filter((k: any) => k.status !== "bajarildi" && k.deadline === T)) {
      const a = c.accounts.find((x) => x.role === k.type && x.person_id === k.assigneeId); if (!a) continue;
      if (!(await once(`k|${T}|${k.id}`))) continue;
      try { await send(a.tg_chat_id, `⏳ <b>Topshiriq muddati bugun tugaydi</b>\n${esc(k.title)}`, [[{ text: "✅ Bajarildi", callback_data: `k:${k.id}` }]]); } catch (_) { /* davom */ }
    }
  }
  await db(`tg_sent?at=lt.${new Date(Date.now() - 4 * 86400e3).toISOString()}`, { method: "DELETE" });
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
  const accOf = (type: string, pid: string) => c.accounts.find((a) => a.role === type && a.person_id === pid);
  const admins = c.accounts.filter((a) => a.role === "admin");
  for (const k of newTasks) {
    const a = accOf(k.type, k.assigneeId); if (!a) continue;
    await send(a.tg_chat_id, `📌 <b>Yangi topshiriq</b>\n${esc(k.title)}${k.desc ? `\n<i>${esc(k.desc)}</i>` : ""}\n\nMuddat: <b>${fmt(k.deadline)}</b> · muhimlik: ${esc(k.priority)}`, [[{ text: "✅ Bajarildi", callback_data: `k:${k.id}` }]]).catch(() => {});
  }
  for (const k of doneTasks) for (const a of admins) await send(a.tg_chat_id, `✅ <b>Topshiriq bajarildi</b>\n${esc(k.title)} — ${esc(assignee(c, k))}`).catch(() => {});
  for (const e of newEvals) {
    const a = accOf("teacher", e.teacherId); if (!a) continue;
    await send(a.tg_chat_id, `📝 <b>Darsingiz baholandi</b> · ${fmt(e.date)}\nO‘rtacha: <b>${r1(avg(e.c))}</b>/10\nTayyorgarlik ${e.c[0]} · Metodika ${e.c[1]} · Faollik ${e.c[2]} · Vaqt ${e.c[3]}${e.note ? `\n<i>${esc(e.note)}</i>` : ""}`).catch(() => {});
  }
  for (const r of newRatings) {
    const a = accOf("teacher", r.teacherId); if (!a) continue;
    await send(a.tg_chat_id, `⭐ <b>Menejer bahosi</b>\n${esc(r.work)}: <b>${r.score}/10</b>${r.comment ? `\n<i>${esc(r.comment)}</i>` : ""}`).catch(() => {});
  }
  for (const x of newComp) { const t = byId(S.teachers, x.teacherId); for (const a of admins) await send(a.tg_chat_id, `⚠️ <b>Yangi shikoyat</b> — ${esc(t ? t.name : "—")}\n${esc(x.text)} (${esc(x.source)})\n\nKo‘rib chiqing: sayt → Admin panel → Baholash va shikoyatlar.`).catch(() => {}); }
  for (const x of confComp) {
    const a = accOf("teacher", x.teacherId); if (!a) continue;
    await send(a.tg_chat_id, `⚠️ <b>Sizga kelgan shikoyat tasdiqlandi</b> · ${fmt(x.date)}\n${esc(x.text)}\n\nBu reytingingizga ta’sir qiladi. Savollar bo‘lsa, menejeringiz bilan gaplashing.`).catch(() => {});
  }
}
async function jobSetup() {
  const me = await tg("getMe", {});
  if (me.ok) await setCfg("bot_username", me.result.username);
  const wh = await tg("setWebhook", { url: CFG.function_url, secret_token: CFG.webhook_secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await tg("setMyCommands", { commands: [
    { command: "bugun", description: "Bugungi vazifalarim (xodimlar)" },
    { command: "men", description: "Mening natijam" },
    { command: "topshiriqlar", description: "Topshiriqlar" },
    { command: "reyting", description: "Ustozlar va filiallar reytingi" },
    { command: "hisobot", description: "Umumiy hisobot (menejer)" },
    { command: "xodimlar", description: "Xodimlar samaradorligi (menejer)" },
    { command: "shikoyatlar", description: "Shikoyatlar (menejer)" },
    { command: "chiqish", description: "Telegramni uzish" },
  ] });
  const res = JSON.stringify({ bot: me.ok ? "@" + me.result.username : me.description, webhook: wh.ok ? "ok" : wh.description, at: new Date().toISOString() });
  await setCfg("setup_result", res);
  return res;
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
      return new Response("ok");
    }
    return new Response("forbidden", { status: 403 });
  } catch (e) {
    console.error(e);
    // Telegram qayta-qayta yubormasligi uchun 200 qaytaramiz
    return new Response("error: " + (e as Error).message, { status: 200 });
  }
});
