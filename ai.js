// Stash AI — the brain behind the ⌘⌥ island and Ask Stash.
// Runs on Claude with the user's own Anthropic key. The key is kept here in the main
// process (encrypted with safeStorage) and is never handed to the app's pages: they send
// their request bodies through claudeRequest / claudeStream instead.
// (An earlier free on-device engine, Ollama + Gemma, was switched off and has been removed.)
const { app, net, desktopCapturer, screen, systemPreferences, safeStorage, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'ai.json');
const cfg = { key: '', model: '' };
const FALLBACK_MODEL = 'claude-sonnet-5-5';   // only used if the model list can't be fetched
const SAVED_KEY = 'saved-in-stash';   // what the pages see instead of the real key

function load(){
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cfg.model = j.model || '';
    if (j.key) cfg.key = j.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(j.key, 'base64')) : j.key;
  } catch (e) {}
}
function save(){
  const enc = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(file(), JSON.stringify({ model: cfg.model, enc, key: cfg.key ? (enc ? safeStorage.encryptString(cfg.key).toString('base64') : cfg.key) : '' }));
}

/* =====================  Claude (optional)  ===================== */
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' });
async function pickModel(){
  const r = await net.fetch('https://api.anthropic.com/v1/models?limit=100', { headers: headers() });
  if (r.status === 401 || r.status === 403) throw new Error("That API key didn't work — double-check it and try again.");
  if (!r.ok) return cfg.model || FALLBACK_MODEL;
  const ids = ((await r.json()).data || []).map(m => m.id);
  return ids.find(i => /sonnet/i.test(i)) || ids.find(i => /opus/i.test(i)) || ids[0] || FALLBACK_MODEL;
}
async function setKey(key, model){
  const old = { ...cfg };
  cfg.key = key === null ? cfg.key : String(key || '').trim();   // null = keep the saved key, just change the model
  if (!cfg.key){ cfg.model = ''; save(); return { ok: true, model: '' }; }
  try { cfg.model = model || await pickModel(); save(); return { ok: true, model: cfg.model }; }
  catch (e) { Object.assign(cfg, old); return { ok: false, error: e.message }; }
}

/* ---------- the pages' Claude requests go through here, so they never hold the key ---------- */
async function claudeRequest(body){
  if (!cfg.key) return { ok: false, status: 401, error: 'Claude is not connected' };
  try {
    const r = await net.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers(), body: JSON.stringify({ ...body, stream: false }) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, status: r.status, json: j } : { ok: false, status: r.status, error: j.error?.message || `Claude returned ${r.status}` };
  } catch (e) { return { ok: false, status: 0, error: e.message || String(e) }; }
}
async function claudeStream(body, onText){
  if (!cfg.key) throw new Error('Claude is not connected');
  const r = await net.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers(), body: JSON.stringify({ ...body, stream: true }) });
  if (!r.ok){ let m = `Claude returned ${r.status}`; try { m = (await r.json()).error?.message || m; } catch (e) {} throw new Error(m); }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
  for (;;){
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const ev = buf.split('\n'); buf = ev.pop();
    for (const line of ev){
      if (!line.startsWith('data:')) continue;
      try { const j = JSON.parse(line.slice(5)); if (j.type === 'content_block_delta' && j.delta?.text){ full += j.delta.text; onText(full); } } catch (e) {}
    }
  }
  return full;
}

/* =====================  the screen  ===================== */
let lastShot = null;
const screenAllowed = () => { try { return systemPreferences.getMediaAccessStatus('screen') === 'granted'; } catch (e) { return false; } };
async function captureScreen(){
  try {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const k = Math.min(1, 1600 / Math.max(d.size.width, d.size.height));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * k), height: Math.round(d.size.height * k) } });
    const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    return src.thumbnail.toJPEG(82).toString('base64');
  } catch (e) { return null; }
}
async function preCapture(){ lastShot = screenAllowed() ? await captureScreen() : null; }
const SCREEN_RE = /\b(on|of|from|in) (my |the )?screen\b|\bscreenshot\b|what i'?m (looking at|seeing|reading)|\b(this|that) (page|tab|window|error|message|tweet|post|email|image|picture|chart|graph|code|text|website|site|doc|document|video)\b|\bwhat does this\b|\bread this\b|\bexplain this\b|\bsummari[sz]e this\b|\bsave this\b|\bwhat is this\b/i;
const SAVE_RE = /\b(make|save|add|put|write|jot|take|create|copy|keep|store)\b[\s\S]{0,40}\b(note|notes|stash|down|folder)\b/i;
const openScreenSettings = () => { if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); };
const NO_SCREEN_MSG = process.platform !== 'darwin' ? "I couldn't capture your screen just now — try again in a moment." : "I can't see your screen yet — Stash needs Screen Recording permission. I've opened the setting: switch on Stash under Privacy & Security › Screen & System Audio Recording, then quit and reopen Stash.";

/* =====================  tools (shared by both brains)  ===================== */
const TOOL_DEFS = [
  { name: 'copy_to_clipboard', description: "Copy text to the user's clipboard so they can paste it anywhere (⌘V). Use when they say 'copy', 'copy that', 'copy the text on my screen', 'give me something I can paste'. Put exactly the text they want in it (e.g. transcribe it faithfully from the screen).", params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'read_clipboard', description: "Read what the user currently has copied. Use when they say 'what I copied', 'my clipboard', 'this I just copied', 'paste'.", params: { type: 'object', properties: {} } },
  { name: 'look_at_screen', description: "Look at what is on the user's screen right now. Use it whenever they say 'this', 'on my screen', 'what am I looking at', 'what does this mean', or ask you to save/copy what's on screen.", params: { type: 'object', properties: {} } },
  { name: 'save_note', description: "Save a note into the user's Stash library. Use for 'make a note', 'write this down', 'save this', 'put this in a note'. When saving what's on the screen, put the actual text from the screen into the body (transcribe it faithfully, keep links and numbers), and give it a short descriptive title. Only set folder if the user named one or an existing folder clearly fits; otherwise leave it out and Stash's Smart Sort will file it in the best folder automatically. Set include_screenshot true when the note is about something on screen.", params: { type: 'object', properties: { title: { type: 'string', description: 'Short descriptive title, e.g. "Hiring principles — Jake Paul post"' }, body: { type: 'string', description: 'The note text' }, folder: { type: 'string', description: 'Optional. Name of an existing folder, or a new one if the user asked for it.' }, include_screenshot: { type: 'boolean' } }, required: ['title', 'body'] } },
  { name: 'create_folder', description: 'Create a new folder in Stash.', params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'search_stash', description: "Search the user's Stash library and get matching items with snippets.", params: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'open_in_stash', description: 'Open a folder or item in the Stash window.', params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
];
async function runTool(name, input, { exec, status }, sources, setOpen){
  if (name === 'save_note'){
    status('Saving to Stash…');
    const arg = { ...input, screenshot: input.include_screenshot && lastShot ? 'data:image/jpeg;base64,' + lastShot : null };
    const r = await exec(`window.Stash.saveNote(${JSON.stringify(arg)})`);
    (r.sources || []).forEach(s => sources.push(s)); return r.text;
  }
  if (name === 'copy_to_clipboard'){ clipboard.writeText(String(input.text || '')); status('Copied'); return `Copied ${String(input.text || '').length} characters to the clipboard.`; }
  if (name === 'read_clipboard'){ const t = clipboard.readText(); return t ? 'Clipboard contents:\n' + t.slice(0, 8000) : 'The clipboard is empty (or holds an image/file, not text).'; }
  if (name === 'create_folder') return (await exec(`window.Stash.createFolder(${JSON.stringify(input.name)})`)).text;
  if (name === 'search_stash'){
    status('Searching your Stash…');
    const r = await exec(`window.Stash.search(${JSON.stringify(input.query || '')})`);
    (r || []).slice(0, 3).forEach(s => sources.push(s)); return JSON.stringify(r || []);
  }
  if (name === 'open_in_stash'){
    const r = await exec(`window.Stash.find(${JSON.stringify(input.name || '')})`);
    if (r){ setOpen(r.id); return `Opening ${r.title}.`; } return 'Nothing by that name in Stash.';
  }
  return 'Unknown tool';
}
const systemPrompt = lib => `You are Stash — ${ME ? ME.name + ' (@' + ME.username + ')' : 'the user'}'s personal AI assistant on their ${process.platform === 'darwin' ? 'Mac' : 'computer'}. You're a general assistant, not limited to their library: answer any question, explain things, write, plan, brainstorm, do maths, help with whatever is on their screen.
You appear as a small bar at the top of the screen, so be brief by default (1–4 short sentences, or a few bullets). Plain text, at most light **bold**; no headings or tables.
You can save and organise things in their Stash library with your tools. When they ask you to note/save something, call save_note (don't just reply with the text). Afterwards confirm in one short line what you saved and which folder it went in. Only use a tool when it's actually needed.
Today is ${new Date().toDateString()}.
STASH LIBRARY (for context): ${lib || '(empty)'}`;

let history = [], webOK = true, ME = null;
const reset = () => { history = []; };

/* ---------- Claude brain ---------- */
async function callClaude(body){
  const r = await net.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Claude returned ${r.status}`);
  return j;
}
function slim(h){
  for (let i = 0; i < h.length - 2; i++){
    const m = h[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'image')) m.content = m.content.map(b => b.type === 'image' ? { type: 'text', text: '[screenshot shown earlier]' } : b);
    if (Array.isArray(m.content)) m.content.forEach(b => { if (b.type === 'tool_result' && Array.isArray(b.content)) b.content = b.content.map(c => c.type === 'image' ? { type: 'text', text: '[screenshot shown earlier]' } : c); });
    if (m.images) delete m.images;
  }
}
async function askClaude(q, ctx){
  const system = systemPrompt(ctx.lib) + `
You can see their screen with look_at_screen — use it whenever they refer to something on screen, or whenever the question only makes sense with what they're looking at ("this", "here", "it", "what should I reply"). When a screenshot is attached, read it carefully: transcribe text exactly, read numbers, code, errors, charts and UI precisely.
You can copy text to their clipboard (copy_to_clipboard) and read what they copied (read_clipboard). When they ask you to copy something, put it on the clipboard and say "Copied — ⌘V to paste."
You can search the web for anything current (news, prices, scores, people, docs) — do it rather than guessing.
Answer any question at all, the way Claude would. Be accurate; if unsure, say so.`;
  const tools = TOOL_DEFS.map(t => ({ name: t.name, description: t.description, input_schema: t.params }));
  if (webOK) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 4 });
  // if the question is clearly about the screen, attach the screenshot right away (one round trip faster)
  let content = q;
  if (SCREEN_RE.test(q) || (history.length === 0 && /\b(this|here|it)\b/i.test(q) && q.length < 80)){
    const shot = lastShot || await captureScreen();
    if (shot){ lastShot = shot; ctx.status('Looking at your screen…'); content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot } }, { type: 'text', text: q + "\n\n(Attached: a screenshot of my screen right now.)" }]; }
  }
  history.push({ role: 'user', content }); slim(history);
  const sources = []; let open = null;
  for (let step = 0; step < 8; step++){
    ctx.status(step ? 'Working on it…' : 'Thinking…');
    let res;
    try { res = await callClaude({ model: cfg.model || FALLBACK_MODEL, max_tokens: 2500, system, tools, messages: history }); }
    catch (e) {
      // web search not enabled on this account → turn it off and try again
      if (webOK && /web_search|server tool|not (enabled|supported)/i.test(e.message)){ webOK = false; tools.pop(); res = await callClaude({ model: cfg.model || FALLBACK_MODEL, max_tokens: 2500, system, tools, messages: history }); }
      else throw e;
    }
    history.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.content.some(b => b.type === 'server_tool_use')) ctx.status('Searching the web…');
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason !== 'tool_use' || !uses.length) return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim(), sources, open, ai: 'claude' };
    const results = [];
    for (const u of uses){
      let content;
      try {
        if (u.name === 'look_at_screen'){
          ctx.status('Looking at your screen…');
          const shot = lastShot || await captureScreen();
          if (!shot){ openScreenSettings(); content = 'Screen capture is not permitted yet. ' + NO_SCREEN_MSG; }
          else { lastShot = shot; content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot } }, { type: 'text', text: "This is the user's screen." }]; }
        } else content = await runTool(u.name, u.input, ctx, sources, id => open = id);
      } catch (e) { content = 'Tool failed: ' + (e.message || e); }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    history.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps — try asking in a simpler way.', sources, open, ai: 'claude' };
}

/** ask(q, {exec, status}) → {text, sources, open, ai} or null if no AI is set up */
async function ask(q, { exec, status }){
  const lib = await exec('window.Stash && window.Stash.summary ? window.Stash.summary() : ""').catch(() => '');
  ME = await exec('window.Stash && window.Stash.me ? window.Stash.me() : null').catch(() => null);
  const ctx = { exec, status, lib };
  if (cfg.key) return askClaude(q, ctx);
  return null;
}

// safeStorage only works once the app is ready, so load lazily
let loaded = false; const ensure = () => { if (!loaded){ loaded = true; load(); } };
module.exports = {
  ask: (q, o) => { ensure(); return ask(q, o); }, reset, preCapture,
  setKey: (k, m) => { ensure(); return setKey(k, m); },
  status: async () => { ensure(); return { claude: !!cfg.key, model: cfg.model, local: { ready: false, model: '', size: '', installed: false, setting: false } }; },
  creds: () => { ensure(); return { key: cfg.key ? SAVED_KEY : '', model: cfg.model }; },
  claudeRequest: b => { ensure(); return claudeRequest(b); },
  claudeStream: (b, cb) => { ensure(); return claudeStream(b, cb); },
  hasAI: () => { ensure(); return !!cfg.key; },
  stop: () => {}
};
