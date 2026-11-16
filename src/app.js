import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch,
} from "firebase/firestore";
import { firebaseConfig, claudeUrl as CLAUDE_URL_DEFAULT } from "./config.js";
import { BUILTIN, CATEGORIES, REVIEW_URL, OUR_PHONE } from "./templates.js";
import { EXPENSE_CATS, INCOME_CATS, PAY_METHODS, splitGst, money2, periodRange, totals, toTsv } from "./finance.js";

/* ---------- constants ---------- */
const STATUSES = [
  { k: "new", l: "Новые", c: "#2F5D9A" },
  { k: "contacted", l: "Связались", c: "#7A5AA6" },
  { k: "quoted", l: "Цена", c: "#C9A45C" },
  { k: "won", l: "Выиграли", c: "#1E7A4C" },
  { k: "lost", l: "Отказ", c: "#8A94A6" },
];
const SOURCES = ["Website form", "Email", "Google Ads call", "Google Maps", "Yelp", "Referral", "Repeat client", "Other"];
const SRC_RU = { "Website form": "Форма на сайте", Email: "Email", "Google Ads call": "Звонок с рекламы", "Google Maps": "Google Maps", Yelp: "Yelp", Referral: "Рекомендация", "Repeat client": "Повторный клиент", Other: "Другое" };
const SERVICES = ["Drywall & taping", "Framing & insulation", "Interior painting", "Plumbing", "Repairs & handyman", "Renovation", "Other"];
const SVC_RU = { "Drywall & taping": "Гипсокартон", "Framing & insulation": "Каркас и утепление", "Interior painting": "Покраска", Plumbing: "Сантехника", "Repairs & handyman": "Мелкий ремонт", Renovation: "Ремонт под ключ", Other: "Другое" };
const LOST = ["", "No reply", "Price too high", "Chose someone else", "Outside our services", "Not ready / postponed", "Other"];
const LOST_RU = { "": "—", "No reply": "Не ответил", "Price too high": "Дорого", "Chose someone else": "Выбрал другого", "Outside our services": "Не наш профиль", "Not ready / postponed": "Отложил", Other: "Другое" };
const ru = (m, k) => m[k] || k || "—";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayStr = (d) => (d || new Date()).toLocaleDateString("en-CA");
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayStr(d); };
const nowIso = () => new Date().toISOString();
const money = (v) => "$" + Number(v).toLocaleString("en-CA", { maximumFractionDigits: 0 });
const digits = (p) => String(p || "").replace(/[^\d+]/g, "");
const stat = (k) => STATUSES.find((s) => s.k === k) || STATUSES[0];
function ago(iso) { if (!iso) return ""; const h = (Date.now() - new Date(iso).getTime()) / 36e5; if (h < 1) return "сейчас"; if (h < 24) return Math.floor(h) + " ч"; const d = Math.floor(h / 24); return d < 60 ? d + " дн" : Math.floor(d / 30) + " мес"; }
function fmtDate(s) { if (!s) return ""; const d = new Date(s.length === 10 ? s + "T12:00:00" : s); return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" }); }
function fmtDT(s) { const d = new Date(s); return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function firstName(L) { const n = (L && L.name || "").trim().split(/\s+/)[0]; return n || "there"; }
function jobText(L) { if (L && L.job) return L.job; const s = L && L.service && L.service !== "Other" ? L.service.toLowerCase() : ""; return s || "your project"; }
function fill(text, L) {
  return String(text || "")
    .replace(/\{name\}/g, firstName(L))
    .replace(/\{job\}/g, jobText(L))
    .replace(/\{amount\}/g, L && L.value ? money(L.value) : "$[amount]")
    .replace(/\{area\}/g, (L && L.area) || "[area]")
    .replace(/\{review\}/g, REVIEW_URL)
    .replace(/\{phone\}/g, OUR_PHONE);
}
let tt; function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 1900); }
async function copy(text) { try { if (window.vmd) await window.vmd.copy(text); else await navigator.clipboard.writeText(text); toast("Скопировано"); } catch (e) { toast("Не удалось скопировать"); } }
function openUrl(u) { if (window.vmd) window.vmd.open(u); else window.open(u, "_blank"); }
function mailto(email, subject, body) { return "mailto:" + encodeURIComponent(email || "").replace(/%2C/g, ",") + "?subject=" + encodeURIComponent(subject || "") + "&body=" + encodeURIComponent(body || ""); }
function smsUrl(phone, body) { const n = digits(phone); const sep = window.vmd && window.vmd.platform === "darwin" ? "&" : "?"; return "sms:" + n + (body ? sep + "body=" + encodeURIComponent(body) : ""); }

/* ---------- Claude ---------- */
async function callClaude(payload) {
  const url = claudeUrl();
  if (!url) throw new Error("Claude ещё не подключён: меню ⋯ → «Подключение Claude»");
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ idToken }, payload)), redirect: "follow" });
  let j; try { j = await res.json(); } catch (e) { throw new Error("Сервер Claude ответил не тем (" + res.status + "). Проверь ссылку."); }
  if (j.error === "not_allowed") throw new Error("Твой email не в списке ALLOWED_EMAILS скрипта.");
  if (j.error) throw new Error(j.error);
  return j;
}
function leadForAi(L) { const o = {}; ["name", "status", "source", "service", "job", "area", "value", "clientMessage"].forEach((k) => (o[k] = L[k])); o.notes = (L.notes || []).slice(-8); return o; }
function splitSubject(t) { const m = String(t).match(/^\s*Subject:\s*(.+)\n+/i); return m ? { subject: m[1].trim(), body: t.slice(m[0].length).trim() } : { subject: "", body: String(t).trim() }; }

/* ---------- firebase ---------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !/REPLACE_ME/.test(firebaseConfig.apiKey);
let fbApp, auth, db;
if (configured) {
  fbApp = initializeApp(firebaseConfig);
  auth = getAuth(fbApp);
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
}

/* ---------- state ---------- */
let leads = [], tplOverrides = {}, loaded = false;
let view = "board", query = "", openId = null, statsRange = "month";
let replyCat = "start", sheetTpl = "first_photos", delArm = false;
let mail = { tpl: "mail_review", filter: "won_noreview", picked: null };
let ai = { forId: null, busy: false, text: "", err: "", channel: "email", instr: "", summary: "" };
function claudeUrl() { try { return localStorage.getItem("vmd-claude-url") || CLAUDE_URL_DEFAULT || ""; } catch (e) { return CLAUDE_URL_DEFAULT || ""; } }
let unsubs = [];
let txs = [], fin = { kind: "quarter", offset: 0, type: "all" };
try { view = localStorage.getItem("vmd-view") || "board"; } catch (e) {}

function templates() {
  const out = [];
  BUILTIN.forEach((t) => { const o = tplOverrides[t.id]; if (o && o.hidden) return; out.push(Object.assign({}, t, o || {}, { builtin: true, edited: !!o })); });
  Object.values(tplOverrides).forEach((o) => { if (!BUILTIN.find((b) => b.id === o.id) && !o.hidden) out.push(Object.assign({ builtin: false }, o)); });
  return out;
}
const tplById = (id) => templates().find((t) => t.id === id) || templates()[0];

/* ---------- writes (one at a time per doc) ---------- */
const queues = {};
function enqueue(key, fn) {
  queues[key] = (queues[key] || Promise.resolve()).then(fn).catch((e) => { console.error(e); toast(e && e.code === "permission-denied" ? "Нет доступа — проверь правила Firebase" : "Не сохранилось — проверь интернет"); });
  return queues[key];
}
function saveLead(L) { const body = Object.assign({}, L); delete body.id; return enqueue("l:" + L.id, () => setDoc(doc(db, "leads", L.id), body)); }
function patch(id, data) {
  const L = leads.find((x) => x.id === id); if (!L) return;
  Object.assign(L, data, { updatedAt: nowIso() });
  render(); if (openId === id) markSaved();
  return saveLead(L);
}
function addNote(L, text) { return (L.notes || []).concat({ t: nowIso(), text }); }
function setStatus(L, s) {
  if (L.status === s) return;
  const extra = { status: s, statusAt: nowIso(), notes: addNote(L, "Статус → " + stat(s).l) };
  if (s === "quoted" && !L.followUp) extra.followUp = addDays(3);
  if (s === "won" || s === "lost") extra.followUp = "";
  patch(L.id, extra);
  toast("Статус: " + stat(s).l + (s === "quoted" && !L.followUp ? " · напомню через 3 дня" : ""));
}
function markSaved() { const s = $("savedLbl"); s.textContent = "Сохранено"; clearTimeout(markSaved.t); markSaved.t = setTimeout(() => (s.textContent = ""), 1500); }

/* ---------- derived ---------- */
function filtered() { if (!query) return leads; const q = query.toLowerCase(); return leads.filter((L) => [L.name, L.phone, L.email, L.service, L.job, L.summary, L.area, L.source, L.clientMessage].join(" ").toLowerCase().includes(q)); }
function dueState(L) { if (!L.followUp || L.status === "won" || L.status === "lost") return ""; const t = todayStr(); return L.followUp < t ? "overdue" : L.followUp === t ? "due" : ""; }
function todayBuckets() {
  const t = todayStr(), now = Date.now();
  const fu = leads.filter((L) => L.followUp && L.followUp <= t && L.status !== "won" && L.status !== "lost").sort((a, b) => a.followUp.localeCompare(b.followUp));
  const stale = leads.filter((L) => L.status === "new" && now - new Date(L.createdAt).getTime() > 864e5);
  const quoted = leads.filter((L) => L.status === "quoted" && !L.followUp && now - new Date(L.statusAt || L.updatedAt).getTime() > 3 * 864e5);
  const review = leads.filter((L) => L.status === "won" && !L.reviewAsked);
  return { fu, stale, quoted, review, total: new Set([...fu, ...stale, ...quoted, ...review].map((x) => x.id)).size };
}

/* ---------- views ---------- */
const main = () => $("main");
function cardHTML(L) {
  const ds = dueState(L);
  return `<button class="card ${ds}" draggable="true" data-id="${esc(L.id)}">
    <div class="top"><span class="nm">${esc(L.name || "Без имени")}</span><span class="age">${ago(L.createdAt)}</span></div>
    <div class="svc">${esc(L.summary || L.job || ru(SVC_RU, L.service))}${L.area ? " · " + esc(L.area) : ""}</div>
    <div class="meta"><span class="tag">${esc(ru(SRC_RU, L.source))}</span>
      ${ds === "overdue" ? `<span class="tag bad">Просрочено: ${fmtDate(L.followUp)}</span>` : ds === "due" ? `<span class="tag warn">Связаться сегодня</span>` : L.followUp && L.status !== "won" && L.status !== "lost" ? `<span class="tag gold">${fmtDate(L.followUp)}</span>` : ""}
      ${L.status === "won" ? (L.reviewAsked ? `<span class="tag ok">Отзыв попросили</span>` : `<span class="tag warn">Попросить отзыв</span>`) : ""}
      ${L.value ? `<span class="money">${money(L.value)}</span>` : ""}</div>
  </button>`;
}
function renderBoard() {
  const F = filtered();
  const w = (x) => (x === "overdue" ? 0 : x === "due" ? 1 : 2);
  main().innerHTML = `<div class="board">${STATUSES.map((s) => {
    const items = F.filter((L) => (L.status || "new") === s.k).sort((a, b) => w(dueState(a)) - w(dueState(b)) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const sum = items.reduce((a, L) => a + (+L.value || 0), 0);
    return `<section class="col">
      <div class="col-h"><span class="dot" style="background:${s.c}"></span>${s.l}${sum && (s.k === "quoted" || s.k === "won") ? ` <span class="sum">${money(sum)}</span>` : ""}<span class="n">${items.length}</span></div>
      <div class="drop" data-status="${s.k}">${items.map(cardHTML).join("") || `<div class="empty-col">${s.k === "new" ? "Сюда попадают новые заявки. Нажми «+ Заявка»." : "Перетащи карточку сюда"}</div>`}</div>
    </section>`;
  }).join("")}</div>`;
}
function renderToday() {
  const B = todayBuckets();
  const sec = (title, hint, arr) => (arr.length ? `<div class="sec"><h2>${title} <span class="tag">${arr.length}</span></h2><p class="hint">${hint}</p><div class="list">${arr.map(cardHTML).join("")}</div></div>` : "");
  const html = sec("Связаться сейчас", "Дата напоминания сегодня или уже прошла.", B.fu) +
    sec("Новые больше суток", "Ещё не ответили — ответь и переведи в «Связались».", B.stale) +
    sec("Цена отправлена, нет напоминания", "Цену отправили больше 3 дней назад, дата напоминания не стоит.", B.quoted) +
    sec("Попросить отзыв в Google", "Выигранные работы, где ещё не просили отзыв. Можно отправить всем сразу во вкладке «Рассылка».", B.review);
  main().innerHTML = html || `<div class="allclear"><b>Всё сделано</b>Нет просроченных напоминаний и ждущих заявок, по всем выигранным работам отзыв попросили.</div>`;
}
function renderReplies() {
  const list = templates().filter((t) => t.cat === replyCat);
  const sample = { name: "", job: "", value: 0 };
  main().innerHTML = `<div class="pagehead"><h2>Быстрые ответы</h2><button class="btn gold" data-act="newTpl">+ Свой шаблон</button></div>
    <p class="hint">Тексты клиентам на английском. <b>{name}</b>, <b>{job}</b>, <b>{amount}</b> подставляются из карточки заявки. Здесь без заявки — копируется с «there» вместо имени и с [скобками] на месте суммы.</p>
    <div class="chips" style="margin-bottom:14px">${CATEGORIES.map((c) => `<button class="chip" data-cat="${c.k}" aria-pressed="${replyCat === c.k}">${c.l} · ${templates().filter((t) => t.cat === c.k).length}</button>`).join("")}</div>
    <div class="replies">${list.map((t) => `<div class="rcard">
      <h3>${esc(t.title)} ${t.builtin ? (t.edited ? `<span class="tag gold">изменён</span>` : "") : `<span class="tag">свой</span>`}</h3>
      <div class="subj">Тема письма: ${esc(t.subject || "—")}</div>
      <pre>${esc(fill(t.body, sample))}</pre>
      <div class="row"><button class="btn gold sm" data-copy-tpl="${esc(t.id)}">Скопировать</button><button class="btn sm" data-edit-tpl="${esc(t.id)}">Изменить</button></div>
    </div>`).join("") || `<div class="allclear"><b>Пусто</b>В этой категории нет шаблонов.</div>`}</div>`;
}
const MAIL_FILTERS = [
  ["won_noreview", "Выиграли — отзыв не просили", (L) => L.status === "won" && !L.reviewAsked],
  ["won_all", "Все бывшие клиенты (выиграли)", (L) => L.status === "won"],
  ["quoted", "Цена отправлена — ждём ответа", (L) => L.status === "quoted"],
  ["contacted", "Связались — молчат", (L) => L.status === "contacted"],
  ["all", "Все, у кого есть телефон или email", () => true],
];
function mailRecipients() { const f = MAIL_FILTERS.find((x) => x[0] === mail.filter) || MAIL_FILTERS[0]; return leads.filter((L) => (L.phone || L.email) && f[2](L)); }
function renderMail() {
  const T = tplById(mail.tpl);
  const R = mailRecipients();
  if (!mail.picked) mail.picked = new Set(R.map((L) => L.id));
  const picked = R.filter((L) => mail.picked.has(L.id));
  const withEmail = picked.filter((L) => L.email);
  const sentKey = T.id;
  main().innerHTML = `<div class="pagehead"><h2>Рассылка</h2></div>
  <div class="mail-grid">
    <div class="panel">
      <h4>1. Сообщение</h4>
      <div class="field"><label for="m-tpl">Шаблон</label><select id="m-tpl">${CATEGORIES.map((c) => `<optgroup label="${esc(c.l)}">${templates().filter((t) => t.cat === c.k).map((t) => `<option value="${esc(t.id)}" ${t.id === T.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</optgroup>`).join("")}</select></div>
      <div class="field"><label>Пример для первого получателя</label><div class="preview">${esc(fill(T.body, picked[0] || {}))}</div></div>
      <h4 style="margin-top:14px">2. Кому</h4>
      <div class="field"><label for="m-filter">Группа</label><select id="m-filter">${MAIL_FILTERS.map(([k, l]) => `<option value="${k}" ${k === mail.filter ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <p class="hint">Каждое сообщение открывается в твоей почте или в «Сообщениях» с уже вставленным текстом и именем — остаётся нажать «Отправить». После отправки нажми ✓, чтобы отметить в карточке.</p>
      <button class="btn" data-act="bccAll" ${withEmail.length ? "" : "disabled"}>Одно письмо всем с email (скрытая копия) · ${withEmail.length}</button>
      <p class="hint" style="margin-top:6px">В общем письме имя не подставляется («Hello there»).</p>
    </div>
    <div>
      <div class="rcp-top"><b>${picked.length} из ${R.length} выбрано</b><button class="btn sm" data-act="pickAll">Выбрать всех</button><button class="btn sm" data-act="pickNone">Снять все</button></div>
      <div class="rcp-list">${R.map((L) => {
        const sent = L.mailings && L.mailings[sentKey];
        return `<div class="rcp"><input type="checkbox" data-pick="${esc(L.id)}" ${mail.picked.has(L.id) ? "checked" : ""} aria-label="Выбрать ${esc(L.name)}">
          <div class="who"><b>${esc(L.name || "Без имени")}</b><span>${esc([L.phone, L.email].filter(Boolean).join(" · "))}${sent ? ` · <span class="tag ok">отправлено ${fmtDate(sent)}</span>` : ""}</span></div>
          <div class="acts">${L.email ? `<button class="btn sm" data-m-email="${esc(L.id)}">Email</button>` : ""}${L.phone ? `<button class="btn sm" data-m-sms="${esc(L.id)}">SMS</button>` : ""}<button class="btn sm" data-m-copy="${esc(L.id)}">Копировать</button><button class="btn sm ${sent ? "" : "gold"}" data-m-done="${esc(L.id)}">${sent ? "✓ ещё раз" : "✓ Отправлено"}</button></div></div>`;
      }).join("") || `<div class="allclear" style="border:0"><b>Никого нет в этой группе</b>У получателей должен быть телефон или email.</div>`}</div>
    </div>
  </div>`;
}
function inRange(L) {
  if (statsRange === "all") return true;
  const d = new Date(L.createdAt || 0), n = new Date();
  if (statsRange === "month") return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  if (statsRange === "last") { const p = new Date(n.getFullYear(), n.getMonth() - 1, 1); return d.getFullYear() === p.getFullYear() && d.getMonth() === p.getMonth(); }
  if (statsRange === "90") return n - d < 90 * 864e5;
  return true;
}
function renderStats() {
  const R = leads.filter(inRange);
  const won = R.filter((L) => L.status === "won");
  const closed = R.filter((L) => L.status === "won" || L.status === "lost").length;
  const rev = won.reduce((a, L) => a + (+L.value || 0), 0);
  const group = (key, list, MAP) => {
    const m = {};
    R.forEach((L) => { const k = L[key] || "—"; const r = (m[k] = m[k] || { n: 0, won: 0, rev: 0, lost: 0 }); r.n++; if (L.status === "won") { r.won++; r.rev += +L.value || 0; } if (L.status === "lost") r.lost++; });
    const keys = [...new Set([...list, ...Object.keys(m)])].filter((k) => m[k]);
    const max = Math.max(1, ...keys.map((k) => m[k].n));
    return keys.sort((a, b) => m[b].n - m[a].n).map((k) => { const r = m[k]; const wr = r.won + r.lost ? Math.round((100 * r.won) / (r.won + r.lost)) + "%" : "—"; return `<tr><td>${esc(ru(MAP, k))}</td><td class="barcell"><div class="hbar"><i style="width:${(100 * r.n) / max}%"></i></div></td><td class="num">${r.n}</td><td class="num">${r.won}</td><td class="num">${wr}</td><td class="num">${r.rev ? money(r.rev) : "—"}</td></tr>`; }).join("");
  };
  const head = (t) => `<thead><tr><th>${t}</th><th></th><th class="num">Заявки</th><th class="num">Выиграли</th><th class="num">Конверсия</th><th class="num">Выручка</th></tr></thead>`;
  const sel = [["month", "Этот месяц"], ["last", "Прошлый месяц"], ["90", "90 дней"], ["all", "Всё время"]];
  main().innerHTML = `<div class="pagehead"><h2>Откуда приходят заказы</h2>${sel.map(([k, l]) => `<button class="chip" data-range="${k}" aria-pressed="${statsRange === k}">${l}</button>`).join("")}</div>
  <div class="kpis"><div class="kpi"><small>Заявки</small><b>${R.length}</b></div><div class="kpi"><small>Выиграли</small><b>${won.length}</b></div><div class="kpi"><small>Конверсия (закрытые)</small><b>${closed ? Math.round((100 * won.length) / closed) + "%" : "—"}</b></div><div class="kpi"><small>Выручка</small><b>${rev ? money(rev) : "$0"}</b></div></div>
  ${R.length ? `<h3 class="tbl-title">По источнику</h3><div class="tbl-wrap"><table>${head("Источник")}<tbody>${group("source", SOURCES, SRC_RU)}</tbody></table></div>
  <h3 class="tbl-title">По услуге</h3><div class="tbl-wrap"><table>${head("Услуга")}<tbody>${group("service", SERVICES, SVC_RU)}</tbody></table></div>
  <p class="hint">Заявки считаются по дате добавления. Выручка — сумма на карточках «Выиграли». Просьб об отзыве за период: ${R.filter((L) => L.reviewAsked).length}.</p>` : `<div class="allclear"><b>За этот период заявок нет</b>Выбери период шире или добавь заявки на доске.</div>`}`;
}
/* ---------- finance ---------- */
const leadName = (id) => { const L = id && leads.find((x) => x.id === id); return L ? L.name || "" : ""; };
function finList() {
  const P = periodRange(fin.kind, fin.offset);
  return txs.filter((x) => x.date >= P.from && x.date <= P.to && (fin.type === "all" || x.type === fin.type))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
function renderMoney() {
  const P = periodRange(fin.kind, fin.offset);
  const inPeriod = txs.filter((x) => x.date >= P.from && x.date <= P.to);
  const T = totals(inPeriod);
  const list = finList();
  const byCat = {};
  inPeriod.filter((x) => x.type === "expense").forEach((x) => (byCat[x.category || "Прочее"] = (byCat[x.category || "Прочее"] || 0) + (x.net || 0)));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));
  const kinds = [["month", "Месяц"], ["quarter", "Квартал"], ["year", "Год"], ["all", "Всё"]];
  main().innerHTML = `<div class="pagehead"><h2>Финансы</h2>
      <button class="btn" data-fin="add-expense">+ Расход</button><button class="btn gold" data-fin="add-income">+ Доход</button></div>
    <div class="pagehead" style="margin-top:-6px">
      <div class="chips">${kinds.map(([k, l]) => `<button class="chip" data-fin-kind="${k}" aria-pressed="${fin.kind === k}">${l}</button>`).join("")}</div>
      ${fin.kind !== "all" ? `<div class="crow"><button class="btn sm" data-fin-step="-1" aria-label="Назад">‹</button><b style="min-width:150px;text-align:center">${esc(P.label)}</b><button class="btn sm" data-fin-step="1" aria-label="Вперёд" ${fin.offset >= 0 ? "disabled" : ""}>›</button></div>` : ""}
      <button class="btn sm" data-fin="copy" style="margin-left:auto">Скопировать для Excel</button>
    </div>
    <div class="kpis six">
      <div class="kpi"><small>Выручка (без GST)</small><b>${money2(T.income)}</b></div>
      <div class="kpi"><small>Расходы (без GST)</small><b>${money2(T.expense)}</b></div>
      <div class="kpi"><small>Прибыль</small><b style="color:${T.profit < 0 ? "var(--bad)" : "var(--ok)"}">${money2(T.profit)}</b></div>
      <div class="kpi"><small>GST получено с клиентов</small><b>${money2(T.gstIn)}</b></div>
      <div class="kpi"><small>GST уплачено в расходах (ITC)</small><b>${money2(T.gstOut)}</b></div>
      <div class="kpi"><small>${T.gstOwing >= 0 ? "GST к оплате в CRA" : "GST к возврату от CRA"}</small><b style="color:${T.gstOwing > 0 ? "var(--warn)" : "var(--ok)"}">${money2(Math.abs(T.gstOwing))}</b></div>
    </div>
    ${cats.length ? `<h3 class="tbl-title">Расходы по категориям</h3><div class="tbl-wrap"><table style="min-width:420px"><tbody>${cats.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="barcell"><div class="hbar"><i style="width:${(100 * v) / maxCat}%"></i></div></td><td class="num">${money2(v)}</td><td class="num" style="color:var(--muted)">${T.expense ? Math.round((100 * v) / T.expense) : 0}%</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="pagehead" style="margin-bottom:8px"><h3 class="tbl-title" style="margin:0 auto 0 0">Операции · ${list.length}</h3>
      <div class="chips">${[["all", "Все"], ["income", "Доходы"], ["expense", "Расходы"]].map(([k, l]) => `<button class="chip" data-fin-type="${k}" aria-pressed="${fin.type === k}">${l}</button>`).join("")}</div></div>
    ${list.length ? `<div class="tbl-wrap"><table class="txt"><thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th class="num">Без GST</th><th class="num">GST</th><th class="num">Итого</th></tr></thead><tbody>${list.map((x) => `<tr class="txrow" data-tx="${esc(x.id)}">
        <td>${fmtDate(x.date)}</td>
        <td><span class="tag ${x.type === "income" ? "ok" : "gold"}">${x.type === "income" ? "Доход" : "Расход"}</span> ${esc(x.category || "")}</td>
        <td>${esc(x.description || "")}${x.leadId && leadName(x.leadId) ? ` <span class="saved">· ${esc(leadName(x.leadId))}</span>` : ""}</td>
        <td class="num">${x.type === "expense" ? "−" : ""}${money2(x.net)}</td><td class="num">${money2(x.gst)}</td><td class="num"><b>${money2(x.total)}</b></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="allclear"><b>Операций за этот период нет</b>Добавь расход (материалы, бензин, реклама…) или доход — GST посчитается сам.</div>`}
    <p class="hint" style="margin-top:12px">GST 5% (Альберта). Для расходов вводи сумму из чека с GST — приложение само выделит налог (ITC). Это рабочий учёт для вас; официальную отчётность и подачу GST в CRA сверяй с QuickBooks или бухгалтером.</p>`;
}
function saveTx(t) { const body = Object.assign({}, t); delete body.id; return enqueue("t2:" + t.id, () => setDoc(doc(db, "transactions", t.id), body)); }
function editTx(id, preset) {
  const x = id ? txs.find((t) => t.id === id) : Object.assign({ id: "", type: "expense", date: todayStr(), category: "", description: "", method: "Карта", leadId: "", includesGst: true, noGst: false, amount: "" }, preset || {});
  if (!x) return;
  const st = { type: x.type, includesGst: x.includesGst !== false, noGst: !!x.noGst };
  const leadOpts = leads.filter((L) => L.status === "won" || L.status === "quoted" || L.id === x.leadId);
  const draw = () => {
    const cats = st.type === "income" ? INCOME_CATS : EXPENSE_CATS;
    const amt = $("x-amt") ? $("x-amt").value : (x.amount !== undefined && x.amount !== "" ? x.amount : (x.includesGst === false ? x.net : x.total) || "");
    const cat = $("x-cat") ? $("x-cat").value : x.category;
    const vals = { date: $("x-date") ? $("x-date").value : x.date, desc: $("x-desc") ? $("x-desc").value : x.description, method: $("x-method") ? $("x-method").value : x.method, lead: $("x-lead") ? $("x-lead").value : x.leadId };
    const sp = splitGst(String(amt).replace(/[^\d.]/g, ""), st.includesGst, st.noGst);
    openModal(`<h3>${id ? "Изменить операцию" : st.type === "income" ? "Новый доход" : "Новый расход"}</h3>
      <div class="chips" style="margin-bottom:12px"><button class="chip" data-xt="expense" aria-pressed="${st.type === "expense"}">Расход</button><button class="chip" data-xt="income" aria-pressed="${st.type === "income"}">Доход</button></div>
      <div class="grid2">
        <div class="field"><label for="x-date">Дата</label><input id="x-date" type="date" value="${esc(vals.date)}"></div>
        <div class="field"><label for="x-cat">Категория</label><select id="x-cat">${cats.map((c) => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="field full"><label for="x-desc">Описание</label><input id="x-desc" value="${esc(vals.desc)}" placeholder="${st.type === "income" ? "напр. оплата за гипсокартон, Tuscany" : "напр. Home Depot — гипсокартон и шпаклёвка"}"></div>
        <div class="field"><label for="x-amt">Сумма ($)</label><input id="x-amt" inputmode="decimal" value="${esc(amt)}" placeholder="0.00"></div>
        <div class="field"><label for="x-method">Оплата</label><select id="x-method">${PAY_METHODS.map((m) => `<option ${m === vals.method ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
        <div class="field full"><label class="chk"><input type="checkbox" id="x-incl" ${st.includesGst ? "checked" : ""} ${st.noGst ? "disabled" : ""}> Сумма уже включает GST</label>
          <label class="chk"><input type="checkbox" id="x-nogst" ${st.noGst ? "checked" : ""}> Без GST (страховка, зарплата, банковские комиссии, покупки без GST)</label></div>
        <div class="field full"><label for="x-lead">Заявка / клиент (необязательно)</label><select id="x-lead"><option value="">—</option>${leadOpts.map((L) => `<option value="${esc(L.id)}" ${L.id === vals.lead ? "selected" : ""}>${esc(L.name || "Без имени")}${L.summary ? " · " + esc(L.summary) : ""}</option>`).join("")}</select></div>
      </div>
      <div class="preview" id="x-sum">Без GST <b>${money2(sp.net)}</b> · GST <b>${money2(sp.gst)}</b> · Итого <b>${money2(sp.total)}</b></div>
      <div class="row">${id ? `<button class="btn danger" data-xm="del">Удалить</button>` : ""}<button class="btn" data-xm="cancel">Отмена</button><button class="btn gold" data-xm="save">Сохранить</button></div>`);
    $("x-amt").oninput = () => { const s2 = splitGst($("x-amt").value.replace(/[^\d.]/g, ""), st.includesGst, st.noGst); $("x-sum").innerHTML = `Без GST <b>${money2(s2.net)}</b> · GST <b>${money2(s2.gst)}</b> · Итого <b>${money2(s2.total)}</b>`; };
    $("x-incl").onchange = (e) => { st.includesGst = e.target.checked; draw(); };
    $("x-nogst").onchange = (e) => { st.noGst = e.target.checked; draw(); };
  };
  draw();
  $("modal").onclick = (e) => {
    const t = e.target.closest("[data-xt],[data-xm]"); if (!t) return;
    if (t.dataset.xt) { if (st.type !== t.dataset.xt) { st.type = t.dataset.xt; st.includesGst = t.dataset.xt === "expense"; draw(); } return; }
    const a = t.dataset.xm;
    if (a === "cancel") return closeModal();
    if (a === "del") {
      if (t.dataset.armed) { txs = txs.filter((q) => q.id !== id); closeModal(); render(); enqueue("t2:" + id, () => deleteDoc(doc(db, "transactions", id))).then(() => toast("Операция удалена")); }
      else { t.dataset.armed = "1"; t.textContent = "Точно удалить?"; }
      return;
    }
    if (a === "save") {
      const amount = $("x-amt").value.replace(/[^\d.]/g, "");
      if (!(Number(amount) > 0)) { $("x-amt").focus(); toast("Введи сумму"); return; }
      const sp = splitGst(amount, st.includesGst, st.noGst);
      const tid = id || doc(collection(db, "transactions")).id;
      const t2 = { id: tid, type: st.type, date: $("x-date").value || todayStr(), category: $("x-cat").value, description: $("x-desc").value.trim(), method: $("x-method").value,
        leadId: $("x-lead").value, includesGst: st.includesGst, noGst: st.noGst, amount: Number(amount), net: sp.net, gst: sp.gst, total: sp.total,
        createdAt: (id && x.createdAt) || nowIso(), updatedAt: nowIso(), by: (auth.currentUser && auth.currentUser.email) || "" };
      const i = txs.findIndex((q) => q.id === tid); if (i >= 0) txs[i] = t2; else txs.push(t2);
      closeModal(); render(); if (openId) renderSheet();
      saveTx(t2).then(() => toast(st.type === "income" ? "Доход записан" : "Расход записан"));
    }
  };
}

function render() {
  if (!loaded) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === view));
  $("todayCnt").textContent = todayBuckets().total;
  if (!leads.length && (view === "board" || view === "today")) {
    main().innerHTML = `<div class="onboard"><b>Заявок пока нет</b><p>Добавляй сюда каждую заявку: с сайта, звонки, Google Maps, Yelp, рекомендации. Потом двигай её по доске. Если есть резервная копия — меню ⋯ → «Импорт из файла».</p><button class="btn gold" data-act="add">+ Добавить первую заявку</button></div>`;
    return;
  }
  ({ board: renderBoard, today: renderToday, replies: renderReplies, mail: renderMail, stats: renderStats, money: renderMoney }[view] || renderBoard)();
}

/* ---------- lead sheet ---------- */
function openSheet(id) { if (ai.forId !== id) ai = Object.assign(ai, { forId: id, text: "", summary: "", err: "", instr: "" }); openId = id; delArm = false; $("sheet").classList.add("on"); $("sheet").setAttribute("aria-hidden", "false"); $("scrim").classList.add("on"); renderSheet(); }
function closeSheet() { openId = null; $("sheet").classList.remove("on"); $("sheet").setAttribute("aria-hidden", "true"); $("scrim").classList.remove("on"); }
function renderSheet() {
  const L = leads.find((x) => x.id === openId); if (!L) { closeSheet(); return; }
  $("sh-title").textContent = L.name || "Новая заявка";
  const opt = (arr, v, map) => arr.map((a) => `<option value="${esc(a)}" ${a === v ? "selected" : ""}>${esc(map ? ru(map, a) : a)}</option>`).join("");
  const T = tplById(sheetTpl);
  const body = fill(T.body, L);
  $("sh-body").innerHTML = `
  <div class="panel"><h4>Статус</h4><div class="statusbar">${STATUSES.map((s) => `<button data-setstatus="${s.k}" aria-pressed="${L.status === s.k}" style="${L.status === s.k ? `background:${s.c}` : ""}">${s.l}</button>`).join("")}</div>
    <div class="quick"><span class="saved" style="align-self:center">Напомнить:</span>
      <button class="btn sm" data-fu="0">Сегодня</button><button class="btn sm" data-fu="1">Завтра</button><button class="btn sm" data-fu="3">+3 дня</button><button class="btn sm" data-fu="7">+1 неделя</button>${L.followUp ? `<button class="btn sm ghost" data-fu="clear">Убрать (${fmtDate(L.followUp)})</button>` : ""}
    </div></div>
  ${L.status === "won" ? (() => { const paid = txs.filter((t) => t.leadId === L.id && t.type === "income"); const sum = paid.reduce((a, t) => a + (t.total || 0), 0);
      return `<div class="panel"><h4>Оплата</h4><div class="crow">${paid.length ? `<span>Записано: <b>${money2(sum)}</b> (${paid.length})</span>` : `<span class="saved">Оплата ещё не записана в «Финансы».</span>`}<button class="btn sm ${paid.length ? "" : "gold"}" data-act="addPayment">${paid.length ? "+ Ещё оплата" : L.value ? `Записать ${money(L.value)} + GST` : "Записать оплату"}</button></div></div>`; })() : ""}
  ${L.status === "won" ? `<div class="panel review"><h4>Отзыв в Google</h4><p>${L.reviewAsked ? `Просьбу об отзыве отправили ${L.reviewAskedAt ? fmtDate(L.reviewAskedAt) : ""}.` : "Работа выиграна — отправь просьбу об отзыве, пока клиент доволен."}</p>
    <div class="crow"><button class="btn gold sm" data-pick-tpl="review">Открыть шаблон</button><button class="btn sm" data-act="reviewToggle">${L.reviewAsked ? "Отметить: не отправлено" : "Отметить: отправлено"}</button></div></div>` : ""}
  <div class="panel"><h4>Контакты</h4><div style="display:flex;flex-direction:column;gap:8px">
    ${L.phone ? `<div class="crow"><code>${esc(L.phone)}</code><button class="btn sm" data-open="${esc("tel:" + digits(L.phone))}">Позвонить</button><button class="btn sm" data-open="${esc(smsUrl(L.phone))}">SMS</button><button class="btn sm" data-copy="${esc(L.phone)}">Копировать</button></div>` : ""}
    ${L.email ? `<div class="crow"><code>${esc(L.email)}</code><button class="btn sm" data-open="${esc("mailto:" + L.email)}">Написать</button><button class="btn sm" data-copy="${esc(L.email)}">Копировать</button></div>` : ""}
    ${!L.phone && !L.email ? `<span class="saved">Добавь телефон или email ниже.</span>` : ""}
  </div></div>
  ${L.clientMessage || L.summary ? `<div class="panel"><h4>Сообщение клиента</h4>${L.summary ? `<p style="margin:0 0 8px;font-weight:600">${esc(L.summary)}</p>` : ""}${L.clientMessage ? `<div class="preview">${esc(L.clientMessage)}</div>` : ""}</div>` : ""}
  <div class="panel ai"><h4>✦ Claude</h4>
    <div class="field"><label for="aiInstr">Что написать клиенту? (можно по-русски, можно оставить пустым)</label><textarea id="aiInstr" rows="2" placeholder="напр. скажи что цена $450, можем в среду или четверг утром">${esc(ai.forId === L.id ? ai.instr : "")}</textarea></div>
    <div class="crow"><div class="chips"><button class="chip" data-aich="email" aria-pressed="${ai.channel === "email"}">Email</button><button class="chip" data-aich="sms" aria-pressed="${ai.channel === "sms"}">SMS</button></div>
      <button class="btn gold sm" data-act="aiDraft" ${ai.busy ? "disabled" : ""}>${ai.busy ? "Claude пишет…" : "Составить ответ"}</button>
      <button class="btn sm" data-act="aiSummary" ${ai.busy ? "disabled" : ""}>Кратко по-русски</button></div>
    ${ai.forId === L.id && ai.err ? `<div class="err" style="margin-top:10px">${esc(ai.err)}</div>` : ""}
    ${ai.forId === L.id && ai.summary ? `<div class="preview" style="margin-top:10px">${esc(ai.summary)}</div>` : ""}
    ${ai.forId === L.id && ai.text ? `<div class="preview" id="aiOut" style="margin-top:10px">${esc(ai.text)}</div>
      <div class="crow" style="margin-top:10px"><button class="btn gold sm" data-act="aiCopy">Скопировать</button>${L.email ? `<button class="btn sm" data-act="aiEmail">Открыть в почте</button>` : ""}${L.phone ? `<button class="btn sm" data-act="aiSms">Открыть SMS</button>` : ""}<span class="saved">Проверь [скобки] и факты перед отправкой.</span></div>` : ""}
  </div>
  <div class="panel"><h4>Ответ клиенту</h4>
    <div class="tplsel"><select id="sheetTpl" aria-label="Шаблон">${CATEGORIES.map((c) => `<optgroup label="${esc(c.l)}">${templates().filter((t) => t.cat === c.k).map((t) => `<option value="${esc(t.id)}" ${t.id === T.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</optgroup>`).join("")}</select></div>
    <div class="preview" id="tplOut">${esc(body)}</div>
    <div class="crow" style="margin-top:10px"><button class="btn gold sm" data-act="tplCopy">Скопировать</button>${L.email ? `<button class="btn sm" data-act="tplEmail">Открыть в почте</button>` : ""}${L.phone ? `<button class="btn sm" data-act="tplSms">Открыть SMS</button>` : ""}</div>
    <p class="hint" style="margin:8px 0 0">Имя, работа и сумма подставляются из карточки. Проверь [скобки] перед отправкой.</p>
  </div>
  <div class="panel"><h4>Детали</h4><div class="grid2">
    <div class="field"><label for="f-name">Имя</label><input id="f-name" data-f="name" value="${esc(L.name)}" autocomplete="off"></div>
    <div class="field"><label for="f-phone">Телефон</label><input id="f-phone" data-f="phone" value="${esc(L.phone)}"></div>
    <div class="field"><label for="f-email">Email</label><input id="f-email" data-f="email" value="${esc(L.email)}"></div>
    <div class="field"><label for="f-area">Район</label><input id="f-area" data-f="area" value="${esc(L.area)}" placeholder="напр. Tuscany NW"></div>
    <div class="field"><label for="f-source">Откуда</label><select id="f-source" data-f="source">${opt(SOURCES, L.source, SRC_RU)}</select></div>
    <div class="field"><label for="f-service">Услуга</label><select id="f-service" data-f="service">${opt(SERVICES, L.service, SVC_RU)}</select></div>
    <div class="field full"><label for="f-job">Работа — коротко по-английски (вставляется в сообщения)</label><input id="f-job" data-f="job" value="${esc(L.job)}" placeholder="e.g. a drywall patch in the basement"></div>
    <div class="field"><label for="f-value">${L.status === "won" ? "Сумма работы ($)" : "Сумма цены ($)"}</label><input id="f-value" data-f="value" value="${L.value || ""}" placeholder="0"></div>
    <div class="field"><label for="f-fu">Дата напоминания</label><input id="f-fu" type="date" data-f="followUp" value="${esc(L.followUp)}"></div>
    ${L.status === "lost" ? `<div class="field full"><label for="f-lost">Причина отказа</label><select id="f-lost" data-f="lostReason">${opt(LOST, L.lostReason || "", LOST_RU)}</select></div>` : ""}
  </div></div>
  <div class="panel"><h4>Заметки</h4>
    <div class="addnote"><textarea id="noteIn" rows="2" placeholder="Позвонил, не ответил… / Отправил цену $450…  (Ctrl+Enter — добавить)"></textarea><button class="btn sm" data-act="addNote">Добавить</button></div>
    <div class="notes">${(L.notes || []).slice().reverse().map((n) => `<div class="note"><small>${fmtDT(n.t)}</small><div>${esc(n.text)}</div></div>`).join("") || `<span class="saved">Заметок пока нет.</span>`}</div>
  </div>
  <div class="danger-zone"><span class="saved">Добавлена ${L.createdAt ? fmtDT(L.createdAt) : ""}</span>${delArm ? `<span class="crow"><span class="saved">Удалить навсегда?</span><button class="btn sm danger" data-act="delYes">Удалить</button><button class="btn sm" data-act="delNo">Оставить</button></span>` : `<button class="btn sm danger" data-act="del">Удалить заявку</button>`}</div>`;
}
const pend = {};
function fieldCommit(el) {
  const L = leads.find((x) => x.id === openId); if (!L) return;
  let v = el.value; const f = el.dataset.f;
  if (f === "value") { v = v.replace(/[^\d.]/g, ""); v = v ? Number(v) : 0; }
  if ((L[f] ?? "") === v) return;
  patch(L.id, { [f]: v });
  if (f === "name") $("sh-title").textContent = v || "Новая заявка";
  const out = $("tplOut"); if (out) out.textContent = fill(tplById(sheetTpl).body, L);
}
function wireSheet() {
  const b = $("sh-body");
  b.addEventListener("input", (e) => { const el = e.target; if (!el.dataset || !el.dataset.f) return; clearTimeout(pend[el.id]); pend[el.id] = setTimeout(() => fieldCommit(el), 700); });
  b.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "sheetTpl") { sheetTpl = el.value; renderSheet(); return; }
    if (!el.dataset || !el.dataset.f) return;
    clearTimeout(pend[el.id]); fieldCommit(el);
    if (["source", "service", "followUp", "value"].includes(el.dataset.f)) renderSheet();
  });
  b.addEventListener("keydown", (e) => { if (e.target.id === "noteIn" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); b.querySelector('[data-act="addNote"]').click(); } });
  b.addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const L = leads.find((x) => x.id === openId); if (!L) return;
    if (btn.dataset.setstatus) { setStatus(L, btn.dataset.setstatus); if (btn.dataset.setstatus === "won") sheetTpl = "review"; renderSheet(); return; }
    if (btn.dataset.fu) { patch(L.id, { followUp: btn.dataset.fu === "clear" ? "" : addDays(+btn.dataset.fu) }); renderSheet(); return; }
    if (btn.dataset.pickTpl) { sheetTpl = btn.dataset.pickTpl; renderSheet(); $("tplOut").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (btn.dataset.open) { openUrl(btn.dataset.open); return; }
    if (btn.dataset.copy) { copy(btn.dataset.copy); return; }
    if (btn.dataset.aich) { ai.channel = btn.dataset.aich; renderSheet(); return; }
    if (btn.dataset.act === "aiDraft" || btn.dataset.act === "aiSummary") {
      const summary = btn.dataset.act === "aiSummary";
      const instr = ($("aiInstr") && $("aiInstr").value) || "";
      ai = Object.assign(ai, { forId: L.id, busy: true, err: "", instr });
      if (!summary) ai.text = ""; else ai.summary = "";
      renderSheet();
      callClaude({ action: "draft", mode: summary ? "summary" : "reply", channel: ai.channel, instruction: instr, lead: leadForAi(L) })
        .then((j) => { if (summary) ai.summary = j.text; else ai.text = j.text; })
        .catch((e) => { ai.err = e.message; })
        .finally(() => { ai.busy = false; if (openId === L.id) renderSheet(); });
      return;
    }
    if (btn.dataset.act === "aiCopy") { copy(splitSubject(ai.text).body); return; }
    if (btn.dataset.act === "aiEmail") { const p = splitSubject(ai.text); openUrl(mailto(L.email, p.subject, p.body)); return; }
    if (btn.dataset.act === "aiSms") { const p = splitSubject(ai.text); copy(p.body); openUrl(smsUrl(L.phone, p.body)); return; }
    const T = tplById(sheetTpl), text = fill(T.body, L);
    switch (btn.dataset.act) {
      case "tplCopy": copy(text); break;
      case "tplEmail": openUrl(mailto(L.email, T.subject, text)); break;
      case "tplSms": copy(text); openUrl(smsUrl(L.phone, text)); break;
      case "addPayment": editTx(null, { type: "income", category: "Оплата за работу", includesGst: false, amount: L.value || "", leadId: L.id, description: (L.summary || L.job || "") + (L.area ? ", " + L.area : ""), method: "E-transfer" }); break;
      case "reviewToggle": { const on = !L.reviewAsked; patch(L.id, { reviewAsked: on, reviewAskedAt: on ? nowIso() : "", notes: addNote(L, on ? "Просьба об отзыве отправлена" : "Отметка об отзыве снята") }); renderSheet(); break; }
      case "addNote": { const ta = $("noteIn"); const t = ta.value.trim(); if (!t) return; patch(L.id, { notes: addNote(L, t) }); renderSheet(); break; }
      case "del": delArm = true; renderSheet(); break;
      case "delNo": delArm = false; renderSheet(); break;
      case "delYes": { const id = L.id; leads = leads.filter((x) => x.id !== id); closeSheet(); render(); enqueue("l:" + id, () => deleteDoc(doc(db, "leads", id))).then(() => toast("Заявка удалена")); break; }
    }
  });
  $("sh-close").onclick = closeSheet; $("scrim").onclick = closeSheet;
}

/* ---------- template editor ---------- */
function openModal(html) { $("modal").innerHTML = html; $("modalBg").hidden = false; }
function closeModal() { $("modalBg").hidden = true; $("modal").innerHTML = ""; }
function editTemplate(id) {
  const t = id ? tplById(id) : { id: "", cat: replyCat, title: "", subject: "", body: "Hello {name},\n\n\n\nBest regards,\nVM Diamond Construction\n" + OUR_PHONE, builtin: false };
  openModal(`<h3>${id ? "Изменить шаблон" : "Новый шаблон"}</h3>
    <div class="field"><label for="t-title">Название (для тебя)</label><input id="t-title" value="${esc(t.title)}"></div>
    <div class="field"><label for="t-cat">Категория</label><select id="t-cat">${CATEGORIES.map((c) => `<option value="${c.k}" ${c.k === t.cat ? "selected" : ""}>${c.l}</option>`).join("")}</select></div>
    <div class="field"><label for="t-subj">Тема письма</label><input id="t-subj" value="${esc(t.subject)}"></div>
    <div class="field"><label for="t-body">Текст</label><textarea id="t-body">${esc(t.body)}</textarea></div>
    <p class="ph">Подстановки: <code>{name}</code> имя, <code>{job}</code> работа, <code>{amount}</code> сумма, <code>{area}</code> район, <code>{review}</code> ссылка на отзыв, <code>{phone}</code> наш телефон.</p>
    <div class="row">
      ${t.builtin && t.edited ? `<button class="btn" data-m="reset">Вернуть стандартный</button>` : ""}
      ${t.builtin ? `<button class="btn danger" data-m="hide">Скрыть</button>` : id ? `<button class="btn danger" data-m="delete">Удалить</button>` : ""}
      <button class="btn" data-m="cancel">Отмена</button><button class="btn gold" data-m="save">Сохранить</button>
    </div>`);
  $("modal").onclick = async (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const act = b.dataset.m;
    if (act === "cancel") return closeModal();
    const tid = id || doc(collection(db, "templates")).id;
    if (act === "save") {
      const data = { id: tid, cat: $("t-cat").value, title: $("t-title").value.trim() || "Без названия", subject: $("t-subj").value.trim(), body: $("t-body").value, updatedAt: nowIso() };
      tplOverrides[tid] = data; closeModal(); replyCat = data.cat; render();
      enqueue("t:" + tid, () => setDoc(doc(db, "templates", tid), data)).then(() => toast("Шаблон сохранён"));
    } else if (act === "reset" || act === "delete") {
      delete tplOverrides[tid]; closeModal(); render();
      enqueue("t:" + tid, () => deleteDoc(doc(db, "templates", tid))).then(() => toast(act === "reset" ? "Вернул стандартный" : "Шаблон удалён"));
    } else if (act === "hide") {
      const data = { id: tid, hidden: true, updatedAt: nowIso() };
      tplOverrides[tid] = data; closeModal(); render();
      enqueue("t:" + tid, () => setDoc(doc(db, "templates", tid), data)).then(() => toast("Шаблон скрыт"));
    }
  };
}

function claudeSettings() {
  openModal(`<h3>Подключение Claude</h3>
    <p class="hint">Вставь ссылку веб-приложения Google Apps Script (заканчивается на <code>/exec</code>). Ключ Anthropic хранится в скрипте, не в приложении.</p>
    <div class="field"><label for="c-url">Ссылка</label><input id="c-url" value="${esc(claudeUrl())}" placeholder="https://script.google.com/macros/s/…/exec"></div>
    <div id="c-res" class="hint"></div>
    <div class="row"><button class="btn" data-m="test">Проверить</button><button class="btn" data-m="cancel">Закрыть</button><button class="btn gold" data-m="save">Сохранить</button></div>`);
  $("modal").onclick = async (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const v = $("c-url").value.trim();
    if (b.dataset.m === "cancel") return closeModal();
    if (b.dataset.m === "save") { try { localStorage.setItem("vmd-claude-url", v); } catch (er) {} toast("Сохранено"); return closeModal(); }
    if (b.dataset.m === "test") {
      try { localStorage.setItem("vmd-claude-url", v); } catch (er) {}
      $("c-res").textContent = "Проверяю…";
      try { const j = await callClaude({ action: "ping" }); $("c-res").textContent = "Работает. Вход подтверждён для " + j.email + "."; }
      catch (er) { $("c-res").textContent = "Ошибка: " + er.message; }
    }
  };
}

/* ---------- new lead ---------- */
function addLead() {
  const ref = doc(collection(db, "leads"));
  const now = nowIso();
  const L = { id: ref.id, name: "", phone: "", email: "", area: "", source: "Website form", service: "Repairs & handyman", job: "", value: 0, status: "new", statusAt: now, followUp: "", reviewAsked: false, reviewAskedAt: "", lostReason: "", notes: [], mailings: {}, createdAt: now, updatedAt: now };
  leads.unshift(L);
  if (view !== "board") setView("board"); else render();
  sheetTpl = "first_photos"; openSheet(L.id);
  setTimeout(() => { const n = $("f-name"); n && n.focus(); }, 260);
  saveLead(L);
}
function setView(v) { view = v; try { localStorage.setItem("vmd-view", v); } catch (e) {} render(); }

/* ---------- backup ---------- */
async function exportBackup() {
  const data = JSON.stringify({ exportedAt: nowIso(), leads: leads.map((L) => Object.assign({}, L)), templates: Object.values(tplOverrides), transactions: txs.map((t) => Object.assign({}, t)) }, null, 2);
  const name = "vmd-leads-backup-" + todayStr() + ".json";
  if (window.vmd) { const p = await window.vmd.saveJson(name, data); if (p) toast("Копия сохранена"); }
}
async function importBackup() {
  if (!window.vmd) return;
  const txt = await window.vmd.openJson(); if (!txt) return;
  let j; try { j = JSON.parse(txt); } catch (e) { toast("Файл не похож на резервную копию"); return; }
  const arr = Array.isArray(j) ? j : j.leads || [];
  const tpls = (!Array.isArray(j) && j.templates) || [];
  if (!arr.length && !tpls.length) { toast("В файле нет заявок"); return; }
  const chunks = [];
  for (let i = 0; i < arr.length; i += 400) chunks.push(arr.slice(i, i + 400));
  try {
    for (const ch of chunks) { const b = writeBatch(db); ch.forEach((L) => { const id = L.id || doc(collection(db, "leads")).id; const body = Object.assign({}, L); delete body.id; b.set(doc(db, "leads", id), body); }); await b.commit(); }
    if (tpls.length) { const b = writeBatch(db); tpls.forEach((t) => t.id && b.set(doc(db, "templates", t.id), t)); await b.commit(); }
    const trs = (!Array.isArray(j) && j.transactions) || [];
    for (let i = 0; i < trs.length; i += 400) { const b = writeBatch(db); trs.slice(i, i + 400).forEach((t) => { if (!t.id) return; const body = Object.assign({}, t); delete body.id; b.set(doc(db, "transactions", t.id), body); }); await b.commit(); }
    toast("Импортировано: " + arr.length + " заявок");
  } catch (e) { console.error(e); toast("Импорт не удался — проверь доступ"); }
}

/* ---------- wiring ---------- */
function wireApp() {
  document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) setView(b.dataset.view); });
  $("q").addEventListener("input", (e) => { query = e.target.value.trim(); if (view !== "board" && view !== "today") setView("board"); else render(); });
  $("addBtn").onclick = addLead;
  $("menuBtn").onclick = (e) => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) $("menu").hidden = true; });
  $("menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]"); if (!b) return; $("menu").hidden = true;
    if (b.dataset.menu === "export") exportBackup();
    if (b.dataset.menu === "import") importBackup();
    if (b.dataset.menu === "logout") signOut(auth);
    if (b.dataset.menu === "claude") claudeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("modalBg").hidden) closeModal(); else if (openId) closeSheet(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !$("app").hidden) { e.preventDefault(); addLead(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !$("app").hidden) { e.preventDefault(); $("q").focus(); }
  });
  $("modalBg").addEventListener("click", (e) => { if (e.target === $("modalBg")) closeModal(); });

  const m = main();
  m.addEventListener("click", (e) => {
    const c = e.target.closest(".card"); if (c) { openSheet(c.dataset.id); return; }
    const tr = e.target.closest(".txrow"); if (tr) { editTx(tr.dataset.tx); return; }
    const t = e.target.closest("[data-range]"); if (t) { statsRange = t.dataset.range; render(); return; }
    const cat = e.target.closest("[data-cat]"); if (cat) { replyCat = cat.dataset.cat; render(); return; }
    const ct = e.target.closest("[data-copy-tpl]"); if (ct) { copy(fill(tplById(ct.dataset.copyTpl).body, {})); return; }
    const et = e.target.closest("[data-edit-tpl]"); if (et) { editTemplate(et.dataset.editTpl); return; }
    const b = e.target.closest("button"); if (!b) return;
    const act = b.dataset.act;
    if (act === "add") return addLead();
    if (act === "newTpl") return editTemplate(null);
    if (b.dataset.fin === "add-expense") return editTx(null, { type: "expense", includesGst: true });
    if (b.dataset.fin === "add-income") return editTx(null, { type: "income", includesGst: false, category: "Оплата за работу", method: "E-transfer" });
    if (b.dataset.fin === "copy") { copy(toTsv(finList(), leadName)); return; }
    if (b.dataset.finKind) { fin.kind = b.dataset.finKind; fin.offset = 0; render(); return; }
    if (b.dataset.finStep) { fin.offset = Math.min(0, fin.offset + Number(b.dataset.finStep)); render(); return; }
    if (b.dataset.finType) { fin.type = b.dataset.finType; render(); return; }
    // mailing
    const T = tplById(mail.tpl);
    const lead = (id) => leads.find((x) => x.id === id);
    if (b.dataset.mEmail) { const L = lead(b.dataset.mEmail); openUrl(mailto(L.email, T.subject, fill(T.body, L))); return; }
    if (b.dataset.mSms) { const L = lead(b.dataset.mSms); const txt = fill(T.body, L); copy(txt); openUrl(smsUrl(L.phone, txt)); return; }
    if (b.dataset.mCopy) { copy(fill(T.body, lead(b.dataset.mCopy))); return; }
    if (b.dataset.mDone) {
      const L = lead(b.dataset.mDone);
      const extra = { mailings: Object.assign({}, L.mailings || {}, { [T.id]: nowIso() }), notes: addNote(L, "Рассылка: " + T.title) };
      if (/review/.test(T.id) && !L.reviewAsked) { extra.reviewAsked = true; extra.reviewAskedAt = nowIso(); }
      patch(L.id, extra); toast("Отмечено: " + (L.name || "клиент")); return;
    }
    if (act === "pickAll") { mail.picked = new Set(mailRecipients().map((L) => L.id)); render(); return; }
    if (act === "pickNone") { mail.picked = new Set(); render(); return; }
    if (act === "bccAll") {
      const emails = mailRecipients().filter((L) => mail.picked.has(L.id) && L.email).map((L) => L.email);
      if (!emails.length) return;
      openUrl("mailto:?bcc=" + encodeURIComponent(emails.join(",")) + "&subject=" + encodeURIComponent(T.subject || "") + "&body=" + encodeURIComponent(fill(T.body, {})));
      toast("Открыл письмо для " + emails.length + " получателей");
    }
  });
  m.addEventListener("change", (e) => {
    if (e.target.id === "m-tpl") { mail.tpl = e.target.value; render(); }
    if (e.target.id === "m-filter") { mail.filter = e.target.value; mail.picked = null; render(); }
    if (e.target.dataset && e.target.dataset.pick) { const id = e.target.dataset.pick; if (e.target.checked) mail.picked.add(id); else mail.picked.delete(id); render(); }
  });
  let dragId = null;
  m.addEventListener("dragstart", (e) => { const c = e.target.closest(".card"); if (!c) return; dragId = c.dataset.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
  m.addEventListener("dragover", (e) => { const d = e.target.closest(".drop"); if (!d || !dragId) return; e.preventDefault(); document.querySelectorAll(".drop.over").forEach((x) => x !== d && x.classList.remove("over")); d.classList.add("over"); });
  m.addEventListener("dragleave", (e) => { const d = e.target.closest(".drop"); if (d && !d.contains(e.relatedTarget)) d.classList.remove("over"); });
  m.addEventListener("drop", (e) => { const d = e.target.closest(".drop"); if (!d || !dragId) return; e.preventDefault(); d.classList.remove("over"); const L = leads.find((x) => x.id === dragId); dragId = null; if (L) setStatus(L, d.dataset.status); });
  m.addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".drop.over").forEach((x) => x.classList.remove("over")); });
  wireSheet();
}

/* ---------- auth + data ---------- */
function banner(msg) { const b = $("banner"); if (!msg) { b.hidden = true; return; } b.textContent = msg; b.hidden = false; }
function startData(user) {
  $("who").textContent = user.email || "";
  unsubs.push(onSnapshot(collection(db, "leads"), { includeMetadataChanges: false }, (snap) => {
    const local = new Map(leads.map((L) => [L.id, L]));
    leads = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    local.forEach((L, id) => { if (!leads.find((x) => x.id === id) && queues["l:" + id] && Date.now() - new Date(L.createdAt).getTime() < 15000) leads.unshift(L); });
    leads.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    loaded = true; banner(snap.metadata.fromCache ? "Нет связи с облаком — показываю сохранённые данные. Изменения отправятся, когда интернет появится." : "");
    const active = document.activeElement;
    const editing = openId && active && $("sh-body").contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (!editing || view !== "board") render();
    if (openId && !editing) renderSheet();
  }, (err) => { console.error(err); loaded = true; banner(err.code === "permission-denied" ? "Нет доступа к заявкам. Проверь, что твой email есть в правилах Firestore." : "Заявки не загрузились: " + err.message); render(); }));
  unsubs.push(onSnapshot(collection(db, "transactions"), (snap) => { txs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())); if (view === "money" && $("modalBg").hidden) render(); if (openId) renderSheet(); }, (err) => console.error(err)));
  unsubs.push(onSnapshot(collection(db, "templates"), (snap) => { tplOverrides = {}; snap.docs.forEach((d) => (tplOverrides[d.id] = Object.assign({ id: d.id }, d.data()))); if (view === "replies" || view === "mail") render(); if (openId) renderSheet(); }, (err) => console.error(err)));
}
function stopData() { unsubs.forEach((u) => u()); unsubs = []; leads = []; txs = []; tplOverrides = {}; loaded = false; }

function wireUpdates() {
  if (!window.vmd || !window.vmd.onUpdateReady) return;
  window.vmd.onUpdateReady((v) => {
    const b = $("updBar"); b.hidden = false;
    $("updText").textContent = "Доступно обновление приложения (версия " + v + ").";
  });
  $("updBtn").onclick = () => { if (openId) closeSheet(); window.vmd.applyUpdate(); };
  window.vmd.uiVersion().then((v) => { const el = $("ver"); if (el) el.textContent = "Версия " + (v || __UI_VERSION__); });
}
function boot() {
  wireApp();
  wireUpdates();
  if (!configured) { $("login").hidden = false; $("cfgWarn").hidden = false; $("lBtn").disabled = true; return; }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("lErr").hidden = true; $("lBtn").disabled = true;
    try { await signInWithEmailAndPassword(auth, $("lEmail").value.trim(), $("lPass").value); }
    catch (err) {
      const c = err.code || "";
      $("lErr").textContent = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? "Неверный email или пароль." : /too-many-requests/.test(c) ? "Слишком много попыток. Подожди пару минут." : /network/.test(c) ? "Нет интернета." : "Не удалось войти: " + c;
      $("lErr").hidden = false;
    } finally { $("lBtn").disabled = false; }
  });
  onAuthStateChanged(auth, (user) => {
    if (user) { $("login").hidden = true; $("app").hidden = false; render(); startData(user); }
    else { stopData(); closeSheet(); $("app").hidden = true; $("login").hidden = false; $("lPass").value = ""; }
  });
}
boot();
