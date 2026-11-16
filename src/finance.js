// «Финансы»: simple bookkeeping — income, expenses, GST collected / paid (ITCs), profit.
// Amounts are stored as numbers in dollars with cents: net (before GST), gst, total.

export const GST_RATE = 0.05; // Alberta: GST only, no PST

export const EXPENSE_CATS = [
  "Материалы", "Субподряд", "Инструменты и оборудование", "Топливо и авто", "Реклама и маркетинг",
  "Страховка и лицензии", "Софт и подписки", "Телефон и интернет", "Вывоз мусора", "Банк и комиссии",
  "Зарплата", "Прочее",
];
export const INCOME_CATS = ["Оплата за работу", "Прочий доход"];
export const PAY_METHODS = ["E-transfer", "Карта", "Наличные", "Чек", "QuickBooks Payments", "Другое"];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** amount entered by the user → {net, gst, total} */
export function splitGst(amount, includesGst, noGst) {
  const a = r2(amount);
  if (noGst) return { net: a, gst: 0, total: a };
  if (includesGst) { const gst = r2(a * GST_RATE / (1 + GST_RATE)); return { net: r2(a - gst), gst, total: a }; }
  const gst = r2(a * GST_RATE); return { net: a, gst, total: r2(a + gst) };
}

export const money2 = (v) => {
  const n = Number(v) || 0;
  return (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** period: {kind: month|quarter|year|all, offset: 0 = current, -1 = previous …} → {from, to, label} as YYYY-MM-DD */
export function periodRange(kind, offset) {
  const now = new Date();
  const ymd = (d) => d.toLocaleDateString("en-CA");
  const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (kind === "all") return { from: "0000-01-01", to: "9999-12-31", label: "Всё время" };
  if (kind === "year") {
    const y = now.getFullYear() + offset;
    return { from: y + "-01-01", to: y + "-12-31", label: String(y) };
  }
  if (kind === "quarter") {
    const q0 = Math.floor(now.getMonth() / 3) + offset;
    const y = now.getFullYear() + Math.floor(q0 / 4);
    const q = ((q0 % 4) + 4) % 4;
    const from = new Date(y, q * 3, 1), to = new Date(y, q * 3 + 3, 0);
    return { from: ymd(from), to: ymd(to), label: `Q${q + 1} ${y} (${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]})` };
  }
  const m0 = now.getMonth() + offset;
  const from = new Date(now.getFullYear(), m0, 1), to = new Date(now.getFullYear(), m0 + 1, 0);
  const label = from.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return { from: ymd(from), to: ymd(to), label: label.charAt(0).toUpperCase() + label.slice(1) };
}

export function totals(list) {
  const t = { income: 0, expense: 0, gstIn: 0, gstOut: 0, incomeTotal: 0, expenseTotal: 0 };
  list.forEach((x) => {
    if (x.type === "income") { t.income += x.net || 0; t.gstIn += x.gst || 0; t.incomeTotal += x.total || 0; }
    else { t.expense += x.net || 0; t.gstOut += x.gst || 0; t.expenseTotal += x.total || 0; }
  });
  Object.keys(t).forEach((k) => (t[k] = r2(t[k])));
  t.profit = r2(t.income - t.expense);
  t.gstOwing = r2(t.gstIn - t.gstOut);
  return t;
}

/** Tab-separated text for pasting into Excel / Google Sheets / sending to the accountant. */
export function toTsv(list, leadName) {
  const head = ["Date", "Type", "Category", "Description", "Client", "Payment", "Net", "GST", "Total"];
  const rows = list.map((x) => [
    x.date, x.type === "income" ? "Income" : "Expense", x.category || "", (x.description || "").replace(/[\t\n]/g, " "),
    leadName(x.leadId) || "", x.method || "", (x.net || 0).toFixed(2), (x.gst || 0).toFixed(2), (x.total || 0).toFixed(2),
  ]);
  return [head, ...rows].map((r) => r.join("\t")).join("\n");
}
