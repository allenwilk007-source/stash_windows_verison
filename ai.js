// Stash AI — Claude inside Stash, running in the app itself (not just the library).
// • Answers anything, like Claude.
// • Can look at your screen (a screenshot taken the moment you open the island).
// • Can act on Stash: save notes (with the screenshot), make folders, search, open things.
// Your Anthropic key is stored encrypted with macOS Keychain-backed safeStorage.
const { app, net, desktopCapturer, screen, systemPreferences, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'ai.json');
const cfg = { key: '', model: '' };
const FALLBACK_MODEL = 'claude-sonnet-4-5';

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
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' });

// pick the newest Sonnet the key can use (so the model name never goes stale)
async function pickModel(){
  const r = await net.fetch('https://api.anthropic.com/v1/models?limit=100', { headers: headers() });
  if (r.status === 401 || r.status === 403) throw new Error("That API key didn't work — double-check it and try again.");
  if (!r.ok) return cfg.model || FALLBACK_MODEL;
  const ids = ((await r.json()).data || []).map(m => m.id);
  return ids.find(i => /sonnet/i.test(i)) || ids.find(i => /opus/i.test(i)) || ids[0] || FALLBACK_MODEL;
}
async function setKey(key, model){
  const old = { ...cfg };
  cfg.key = String(key || '').trim();
  if (!cfg.key){ cfg.model = ''; save(); return { ok: true, model: '' }; }
  try { cfg.model = model || await pickModel(); save(); return { ok: true, model: cfg.model }; }
  catch (e) { Object.assign(cfg, old); return { ok: false, error: e.message }; }
}

// ---------- the screen ----------
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
// called just before the island appears, so the island itself isn't in the picture
async function preCapture(){ lastShot = screenAllowed() ? await captureScreen() : null; }

// ---------- tools Claude can use ----------
const TOOLS = [
  { name: 'look_at_screen', description: "Look at what is on the user's screen right now (a screenshot taken when they opened Stash). Use it whenever they say things like 'this', 'on my screen', 'what am I looking at', 'what does this mean', or ask you to save/copy what's on screen.", input_schema: { type: 'object', properties: {} } },
  { name: 'save_note', description: "Save a note into the user's Stash library. Use for 'write this down', 'save this', 'put this in a note', etc. When saving what's on screen, first look_at_screen, then write the useful content into the body (transcribe text, summarise, keep links). Set include_screenshot true to attach the screenshot too.", input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, folder: { type: 'string', description: "Folder name. Defaults to 'Notes'. A new folder is created if it doesn't exist." }, include_screenshot: { type: 'boolean' } }, required: ['title', 'body'] } },
  { name: 'create_folder', description: 'Create a new folder in Stash.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'search_stash', description: "Search the user's Stash library (notes, docs, images, videos, links) and get matching items with snippets.", input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'open_in_stash', description: 'Open a folder or item in the Stash window.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
];

let history = [];
const reset = () => { history = []; };

async function call(body){
  const r = await net.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Claude returned ${r.status}`);
  return j;
}

// keep old screenshots out of the context after they've been used once
function slimHistory(){
  for (let i = 0; i < history.length - 2; i++){
    const m = history[i];
    if (Array.isArray(m.content)) m.content.forEach(b => { if (b.type === 'tool_result' && Array.isArray(b.content)) b.content = b.content.map(c => c.type === 'image' ? { type: 'text', text: '[screenshot shown earlier]' } : c); });
  }
}

/** ask(q, {exec, status}) — exec runs JS in the Stash window; status shows progress in the island */
async function ask(q, { exec, status }){
  if (!cfg.key) return null;
  const lib = await exec('window.Stash && window.Stash.summary ? window.Stash.summary() : ""').catch(() => '');
  const system = `You are Stash — Charlie's personal AI on his Mac, with the full intelligence of Claude. You are not limited to his library: answer any question, explain things, write, plan, brainstorm, do maths, give opinions when asked.
You appear as a small bar that drops down from the top of the screen, so be brief by default (1–4 short sentences, or a few bullets). Use plain text with at most light **bold**; no headings, no tables.
You can see his screen with look_at_screen — use it whenever he refers to something on screen. You can save and organise things in his Stash library with your tools; when you do, confirm in one short line what you saved and where.
Today is ${new Date().toDateString()}.
STASH LIBRARY (for context): ${lib || '(empty)'}`;
  history.push({ role: 'user', content: q });
  slimHistory();
  const sources = []; let open = null;
  for (let step = 0; step < 8; step++){
    status(step ? 'Working on it…' : 'Thinking…');
    const res = await call({ model: cfg.model || FALLBACK_MODEL, max_tokens: 1500, system, tools: TOOLS, messages: history });
    history.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length){
      return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), sources, open, ai: true };
    }
    const results = [];
    for (const u of uses){
      let content;
      try {
        if (u.name === 'look_at_screen'){
          status('Looking at your screen…');
          const shot = lastShot || await captureScreen();
          if (!shot){
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            content = "Couldn't capture the screen: Stash doesn't have Screen Recording permission yet. Tell the user to switch on Stash in System Settings › Privacy & Security › Screen & System Audio Recording (it was just opened for them), then quit and reopen Stash.";
          } else {
            lastShot = shot;
            content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot } }, { type: 'text', text: "This is the user's screen." }];
          }
        } else if (u.name === 'save_note'){
          status('Saving to Stash…');
          const arg = { ...u.input, screenshot: u.input.include_screenshot && lastShot ? 'data:image/jpeg;base64,' + lastShot : null };
          const r = await exec(`window.Stash.saveNote(${JSON.stringify(arg)})`);
          (r.sources || []).forEach(s => sources.push(s)); content = r.text;
        } else if (u.name === 'create_folder'){
          const r = await exec(`window.Stash.createFolder(${JSON.stringify(u.input.name)})`); content = r.text;
        } else if (u.name === 'search_stash'){
          status('Searching your Stash…');
          const r = await exec(`window.Stash.search(${JSON.stringify(u.input.query)})`);
          (r || []).slice(0, 3).forEach(s => sources.push(s)); content = JSON.stringify(r || []);
        } else if (u.name === 'open_in_stash'){
          const r = await exec(`window.Stash.find(${JSON.stringify(u.input.name)})`);
          if (r){ open = r.id; content = `Opening ${r.title}.`; } else content = 'Nothing by that name in Stash.';
        } else content = 'Unknown tool';
      } catch (e) { content = 'Tool failed: ' + (e.message || e); }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    history.push({ role: 'user', content: results });
  }
  return { text: "That took too many steps — try asking in a simpler way.", sources, open, ai: true };
}

// safeStorage only works once the app is ready, so load the key lazily
let loaded = false; const ensure = () => { if (!loaded){ loaded = true; load(); } };
module.exports = {
  ask: (q, o) => { ensure(); return ask(q, o); }, reset,
  setKey: (k, m) => { ensure(); return setKey(k, m); }, preCapture,
  creds: () => { ensure(); return { key: cfg.key, model: cfg.model }; },
  hasKey: () => { ensure(); return !!cfg.key; }
};
