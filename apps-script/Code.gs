/**
 * VMD Leads — Google Apps Script backend
 * 1) Gmail → CRM: every 5 minutes imports website form notifications and emails labelled "Lead" into Firestore (collection "leads").
 * 2) Claude proxy: the desktop app calls this web app to draft client replies with Claude. The Anthropic API key stays here, never in the app.
 *
 * Script properties (Project Settings → Script properties):
 *   FIREBASE_PROJECT_ID   e.g. vmd-leads
 *   FIREBASE_API_KEY      the apiKey from firebaseConfig
 *   ALLOWED_EMAILS        comma-separated app logins allowed to use Claude, e.g. max@gmail.com,volodymyr@gmail.com
 *   ANTHROPIC_API_KEY     sk-ant-...
 *   CLAUDE_MODEL          optional, default claude-sonnet-5-5
 */

var LEAD_LABEL = 'Lead';
var DONE_LABEL = 'CRM-imported';
var FORM_QUERY = 'from:(squarespace.info) subject:(form submission) newer_than:14d';

function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k, def) { var v = props_().getProperty(k); return v ? String(v).trim() : def; }

/* ======================= Setup ======================= */

/** Run once from the editor: creates labels and the 5-minute trigger. */
function setup() {
  [LEAD_LABEL, DONE_LABEL].forEach(function (n) { if (!GmailApp.getUserLabelByName(n)) GmailApp.createLabel(n); });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'importLeads') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importLeads').timeBased().everyMinutes(5).create();
  importLeads();
  Logger.log('Setup done. Labels "%s" and "%s" exist, trigger every 5 min.', LEAD_LABEL, DONE_LABEL);
}

/* ======================= Gmail → Firestore ======================= */

function importLeads() {
  var done = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var count = 0;
  // Website form notifications
  GmailApp.search(FORM_QUERY + ' -label:' + DONE_LABEL, 0, 30).forEach(function (th) {
    var msg = th.getMessages()[0];
    var lead = parseFormEmail_(msg);
    if (lead) { writeLead_('gm-' + msg.getId(), lead); count++; }
    th.addLabel(done);
  });
  // Any email you labelled "Lead" in Gmail
  GmailApp.search('label:' + LEAD_LABEL + ' -label:' + DONE_LABEL, 0, 30).forEach(function (th) {
    var msgs = th.getMessages();
    var msg = msgs[0];
    writeLead_('gm-' + msg.getId(), parsePlainEmail_(msg, msgs));
    th.addLabel(done);
    count++;
  });
  if (count) Logger.log('Imported %s lead(s)', count);
}

function parseFormEmail_(msg) {
  // Squarespace plain text looks like: "*Name:* John Smith \n\n*Email:* ...". Strip the * markers first.
  var raw = (msg.getPlainBody() || '').replace(/\r/g, '');
  var body = raw.replace(/\*([^*\n]{1,80}?:)\*/g, '$1');
  // The notification repeats the fields after the "Sent via form submission" line; keep only the first copy.
  body = body.split(/\n\s*Sent via form submission/i)[0];
  var get = function (labels) {
    for (var i = 0; i < labels.length; i++) {
      var re = new RegExp('(?:^|\\n)[ \\t]*' + labels[i] + '[ \\t]*:[ \\t]*([^\\n]*)', 'i');
      var m = body.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  };
  var name = get(['Full name', 'Name']);
  if (!name) { var fn = get(['First Name']), ln = get(['Last Name']); name = (fn + ' ' + ln).trim(); }
  name = name.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  var email = extractEmail_(get(['Email', 'Email Address']));
  var replyTo = msg.getReplyTo();
  if (!email && replyTo && replyTo.indexOf('squarespace') < 0) email = extractEmail_(replyTo);
  var phone = get(['Phone \\(optional\\)[^:\\n]*', 'Phone Number', 'Phone']);
  if (phone && !/\d{3}/.test(phone)) phone = '';
  var message = '';
  var mm = body.match(/(?:^|\n)[ \t]*Message[^:\n]*:[ \t]*([\s\S]*)/i);
  if (mm) message = mm[1].split(/\n\s*(?:File Upload|Manage Submissions|\(Sent via)/i)[0];
  message = message.replace(/[ \t]*\n(?!\n)[ \t]*/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (!name && !email && !phone) return null;
  return {
    name: name, email: email, phone: phone, source: 'Website form',
    message: message || body.slice(0, 1500).trim(), subject: msg.getSubject(), date: msg.getDate()
  };
}

/* ---------- short summary of what the client wants ---------- */
var TOPICS = [
  { k: 'framing', svc: 'Framing & insulation', ru: 'каркас', re: /\bfram(e|ing|ed)\b|\bstud(s)?\b|bulkhead|partition wall|build (a )?wall/i },
  { k: 'insulation', svc: 'Framing & insulation', ru: 'утепление', re: /insulat|vapou?r barrier|spray foam|batt/i },
  { k: 'drywall', svc: 'Drywall & taping', ru: 'гипсокартон', re: /drywall|sheetrock|gyproc|\bmud(ding)?\b|\btap(e|ing)\b|patch|hole in (the )?wall|ceiling crack/i },
  { k: 'painting', svc: 'Interior painting', ru: 'покраска', re: /paint/i },
  { k: 'plumbing', svc: 'Plumbing', ru: 'сантехника', re: /plumb|toilet|faucet|tap leak|sink|shower|\btub\b|bathtub|valve|water heater|softener|leak|drain|pipe/i },
  { k: 'flooring', svc: 'Renovation', ru: 'пол', re: /floor|laminate|vinyl plank|tile/i },
  { k: 'doors', svc: 'Repairs & handyman', ru: 'двери/фурнитура', re: /\bdoor|handle|lock|hinge|knob/i },
  { k: 'stairs', svc: 'Repairs & handyman', ru: 'лестница/перила', re: /stair|railing|handrail/i },
  { k: 'repairs', svc: 'Repairs & handyman', ru: 'мелкий ремонт', re: /repair|fix|handyman|install|mount|shelf|trim|baseboard/i },
  { k: 'renovation', svc: 'Renovation', ru: 'ремонт', re: /renovat|remodel|finish(ing)? (the )?basement|develop(ing|ment)? (the )?basement/i }
];
var PLACES = [
  { en: 'basement', ru: 'подвал', re: /basement/i }, { en: 'garage', ru: 'гараж', re: /garage/i },
  { en: 'bathroom', ru: 'ванная', re: /bath ?room|washroom/i }, { en: 'kitchen', ru: 'кухня', re: /kitchen/i },
  { en: 'bedroom', ru: 'спальня', re: /bedroom/i }, { en: 'living room', ru: 'гостиная', re: /living room/i },
  { en: 'laundry room', ru: 'прачечная', re: /laundry/i }, { en: 'mechanical room', ru: 'техкомната', re: /mechanical room|furnace room/i }
];

function analyzeRules_(text) {
  var t = String(text || '');
  var hits = TOPICS.filter(function (x) { return x.re.test(t); });
  if (hits.some(function (h) { return h.k !== 'repairs'; })) hits = hits.filter(function (h) { return h.k !== 'repairs'; });
  if (hits.some(function (h) { return h.k === 'framing' || h.k === 'drywall'; })) hits = hits.filter(function (h) { return h.k !== 'renovation'; });
  var place = PLACES.filter(function (p) { return p.re.test(t); })[0];
  var size = (t.match(/\b\d{1,3}\s*(?:x|\*|×|by)\s*\d{1,3}\b(?:\s*(?:ft|feet|'))?/i) || [''])[0];
  var area = (t.match(/\b(NW|NE|SW|SE)\b/i) || [''])[0].toUpperCase();
  var names = hits.slice(0, 3).map(function (h) { return h.k === 'repairs' ? 'repairs' : h.k === 'doors' ? 'door hardware' : h.k === 'stairs' ? 'stairs and railing' : h.k === 'plumbing' ? 'plumbing work' : h.k; });
  var job = names.length ? names.join(names.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1') : '';
  var dims = size ? size.replace(/\s*(?:ft|feet|')\s*$/i, '').split(/\s*(?:x|\*|×|by)\s*/i) : null;
  if (job && place) job += ' in the ' + (dims ? dims[0] + "' x " + dims[1] + "' " : '') + place.en;
  var ru = hits.slice(0, 3).map(function (h) { return h.ru; }).join(' + ');
  if (place) ru += (ru ? ' · ' : '') + place.ru;
  if (dims) ru += ' · ' + dims[0] + '×' + dims[1];
  return {
    service: hits.length ? hits[0].svc : 'Other',
    job: job,
    summary: ru ? ru.charAt(0).toUpperCase() + ru.slice(1) : '',
    area: area ? area + ' Calgary' : ''
  };
}

function analyzeLead_(text) {
  var base = analyzeRules_(text);
  var key = prop_('ANTHROPIC_API_KEY', '');
  if (!key || !text) return base;
  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: prop_('CLAUDE_MODEL', 'claude-sonnet-5-5'), max_tokens: 300,
        system: 'You classify home-renovation leads for a Calgary contractor. Reply with JSON only.',
        messages: [{ role: 'user', content: 'Client message:\n"""' + String(text).slice(0, 2500) + '"""\n\nReturn JSON with keys: ' +
          'service (one of: "Drywall & taping","Framing & insulation","Interior painting","Plumbing","Repairs & handyman","Renovation","Other"), ' +
          'job (short English noun phrase, max 8 words, lowercase, fits "regarding {job}", e.g. "basement framing and drywall"), ' +
          'summary_ru (max 8 words in Russian: what, where, size if given), ' +
          'area (Calgary quadrant or town if mentioned, e.g. "SW Calgary", else "").' }]
      })
    });
    if (res.getResponseCode() !== 200) return base;
    var txt = (JSON.parse(res.getContentText()).content || []).map(function (c) { return c.text || ''; }).join('');
    var j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return {
      service: j.service || base.service, job: j.job || base.job,
      summary: j.summary_ru || base.summary, area: j.area || base.area
    };
  } catch (e) { return base; }
}

function parsePlainEmail_(msg, msgs) {
  var from = msg.getFrom();
  var nameMatch = from.match(/^\s*"?([^"<]+?)"?\s*</);
  var body = (msg.getPlainBody() || '').replace(/\r/g, '');
  body = body.split(/\n\s*On .+wrote:\s*\n/)[0];
  return {
    name: nameMatch ? nameMatch[1].trim() : '', email: extractEmail_(from), phone: findPhone_(body),
    source: 'Email', message: body.trim().slice(0, 2000), subject: msg.getSubject(), date: msg.getDate()
  };
}

function extractEmail_(s) { var m = String(s || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0] : ''; }
function findPhone_(s) { var m = String(s || '').match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/); return m ? m[0].trim() : ''; }

function writeLead_(id, p) {
  var now = new Date().toISOString();
  var created = p.date ? new Date(p.date).toISOString() : now;
  var noteText = (p.source === 'Website form' ? 'Заявка с сайта' : 'Письмо: ' + (p.subject || '')) + '\n\n' + (p.message || '');
  var a = analyzeLead_(p.message || '');
  var lead = {
    name: p.name || '', phone: p.phone || '', email: p.email || '', area: a.area || '',
    source: p.source, service: a.service || 'Other', job: a.job || '', summary: a.summary || '', value: 0,
    status: 'new', statusAt: now, followUp: '', reviewAsked: false, reviewAskedAt: '', lostReason: '',
    clientMessage: p.message || '', notes: [{ t: created, text: noteText.slice(0, 3000) }], mailings: {},
    createdAt: created, updatedAt: now, importedFrom: 'gmail'
  };
  var url = 'https://firestore.googleapis.com/v1/projects/' + prop_('FIREBASE_PROJECT_ID') +
    '/databases/(default)/documents/leads/' + encodeURIComponent(id) + '?currentDocument.exists=false';
  var res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: toFields_(lead) })
  });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 400 && code !== 409) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  // 400/409 with exists=false means the lead was already imported — fine.
}

function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields_(v) } };
  return { stringValue: String(v) };
}
function toFields_(o) { var f = {}; Object.keys(o).forEach(function (k) { f[k] = toValue_(o[k]); }); return f; }

/* ======================= Claude proxy (web app) ======================= */

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var email = verifyUser_(req.idToken);
    if (!email) return json_({ error: 'not_allowed' });
    if (req.action === 'ping') return json_({ ok: true, email: email });
    var text = askClaude_(req);
    return json_({ text: text });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}
function doGet() { return json_({ ok: true, service: 'vmd-leads' }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Confirms the Firebase login token and that the user is on the allow-list. */
function verifyUser_(idToken) {
  if (!idToken) return null;
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + prop_('FIREBASE_API_KEY'), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: idToken })
  });
  if (res.getResponseCode() !== 200) return null;
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || !u.email) return null;
  var allowed = prop_('ALLOWED_EMAILS', '').toLowerCase().split(/[,\s]+/).filter(String);
  return allowed.indexOf(u.email.toLowerCase()) >= 0 ? u.email : null;
}

var COMPANY_BRIEF = [
  'You write on behalf of VM Diamond Construction Ltd., a renovation and finishing contractor in Calgary, Alberta (also Airdrie, Chestermere, Okotoks, Cochrane).',
  'Services: drywall & taping, framing & insulation, interior painting, plumbing as part of renovations, small repairs/handyman, renovations.',
  'Contact: phone 587-966-9489, email info@vmdiamondconstruction.ca. Google review link: https://g.page/r/Ca_B3XNYnMPwEBM/review',
  'Facts you may state: free estimates; price can often be given from photos; no deposit — payment after the work is completed; prices are + GST; invoices are sent from QuickBooks; 10% off the first job for new clients on requests made by December 31, 2026; 1-year craftsmanship warranty.',
  'For replies to NEW client inquiries, ask the client to send photos/details to info@vmdiamondconstruction.ca (or text 587-966-9489) and end with this block exactly:\nWarranty & Licensing:\n• 1-Year Craftsmanship Warranty\n• All materials covered by the manufacturer\'s warranty\n• Fully licensed and insured\n• All building permits & inspections handled by us',
  'Never promise a specific response time (e.g. "within 2 hours"), never invent prices, dates or facts that are not given — use [placeholders] like [price], [date], [time] instead.',
  'Never say who performs the work (no mention of subcontractors) and never claim to be licensed plumbers or electricians. Do not offer discounts in exchange for reviews.',
  'Style: formal, polite, business-like Canadian English; short paragraphs; plain text only (no markdown, no bold). Sign as "VM Diamond Construction".'
].join('\n');

function askClaude_(req) {
  var L = req.lead || {};
  var notes = (L.notes || []).slice(-8).map(function (n) { return '- ' + (n.t || '').slice(0, 10) + ': ' + n.text; }).join('\n');
  var ctx = [
    'Client name: ' + (L.name || 'unknown'),
    'Status in our pipeline: ' + (L.status || 'new'),
    'Source: ' + (L.source || ''),
    'Service: ' + (L.service || '') + (L.job ? ' — ' + L.job : ''),
    L.area ? 'Area: ' + L.area : '',
    L.value ? 'Our quoted/agreed amount: $' + L.value + ' + GST' : '',
    L.clientMessage ? 'Client\'s original message:\n"""' + String(L.clientMessage).slice(0, 3000) + '"""' : '',
    notes ? 'Our internal notes (may be in Russian):\n' + notes : ''
  ].filter(String).join('\n');

  var task;
  if (req.mode === 'summary') {
    task = 'Summarise in Russian, in 3–5 short bullet points, what this client wants, what is still unclear, and what we should ask or do next. Plain text, start each line with "• ".';
  } else {
    task = 'Write the message to send to the client now.' +
      (req.channel === 'sms' ? ' It will be sent by SMS: keep it under 600 characters, no subject line.' : ' It will be sent by email: start with "Subject: ..." on the first line, then a blank line, then the body.') +
      (req.instruction ? '\nWhat Max wants this message to say (may be written in Russian, the message itself must be in English):\n' + req.instruction : '\nIf nothing specific is requested, write the most useful next message for this stage.');
  }

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': prop_('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: prop_('CLAUDE_MODEL', 'claude-sonnet-5-5'),
      max_tokens: 1200,
      system: COMPANY_BRIEF,
      messages: [{ role: 'user', content: ctx + '\n\nTask: ' + task }]
    })
  });
  var body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error((body.error && body.error.message) || ('Anthropic ' + res.getResponseCode()));
  return (body.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n').trim();
}


/* ======================= One-off fix for leads imported before the parser fix ======================= */
/** Re-reads the original Gmail message of each imported lead and fills empty name/phone/email/job/summary. */
function reparseImported() {
  var base = 'https://firestore.googleapis.com/v1/projects/' + prop_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents/leads';
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var list = JSON.parse(UrlFetchApp.fetch(base + '?pageSize=300', { headers: auth }).getContentText()).documents || [];
  var fixed = 0;
  list.forEach(function (d) {
    var id = d.name.split('/').pop();
    if (id.indexOf('gm-') !== 0) return;
    var f = d.fields || {};
    var cur = function (k) { return f[k] && f[k].stringValue || ''; };
    var msg; try { msg = GmailApp.getMessageById(id.slice(3)); } catch (e) { return; }
    if (!msg) return;
    var p = /squarespace/i.test(msg.getFrom()) ? parseFormEmail_(msg) : parsePlainEmail_(msg, [msg]);
    if (!p) return;
    var a = analyzeLead_(p.message || '');
    var upd = {};
    if (!cur('name') && p.name) upd.name = p.name;
    if (!cur('phone') && p.phone) upd.phone = p.phone;
    if (!cur('email') && p.email) upd.email = p.email;
    if (!cur('job') && a.job) upd.job = a.job;
    if (!cur('summary') && a.summary) upd.summary = a.summary;
    if (!cur('area') && a.area) upd.area = a.area;
    if ((cur('service') === 'Other' || !cur('service')) && a.service) upd.service = a.service;
    if (p.message) upd.clientMessage = p.message;
    var keys = Object.keys(upd);
    if (!keys.length) return;
    var mask = keys.map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
    UrlFetchApp.fetch(base + '/' + encodeURIComponent(id) + '?' + mask, {
      method: 'patch', contentType: 'application/json', headers: auth, payload: JSON.stringify({ fields: toFields_(upd) })
    });
    fixed++;
  });
  Logger.log('Updated %s lead(s)', fixed);
}
