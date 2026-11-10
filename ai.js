// Stash AI — the brain behind the ⌘⌥ island and Ask Stash.
//
// FREE (default): Google's Gemma 4 running on the Mac itself through Ollama.
//   No account, no key, no cost, works offline, nothing leaves the computer. It can
//   read your screen (Gemma 4 understands images) and use Stash's tools.
//   One-time setup downloads the Ollama engine (~230 MB) and the model (~7–19 GB,
//   picked to fit how much memory the Mac has).
// OPTIONAL: connect an Anthropic key to use Claude instead (smartest, pay-per-use).
const { app, net, desktopCapturer, screen, systemPreferences, safeStorage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const file = () => path.join(app.getPath('userData'), 'ai.json');
const cfg = { key: '', model: '', localModel: '' };
const FALLBACK_MODEL = 'claude-sonnet-4-5';
const OLLAMA = 'http://127.0.0.1:11434';

function load(){
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cfg.model = j.model || ''; cfg.localModel = j.localModel || '';
    if (j.key) cfg.key = j.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(j.key, 'base64')) : j.key;
  } catch (e) {}
}
function save(){
  const enc = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(file(), JSON.stringify({ model: cfg.model, localModel: cfg.localModel, enc, key: cfg.key ? (enc ? safeStorage.encryptString(cfg.key).toString('base64') : cfg.key) : '' }));
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
  cfg.key = String(key || '').trim();
  if (!cfg.key){ cfg.model = ''; save(); return { ok: true, model: '' }; }
  try { cfg.model = model || await pickModel(); save(); return { ok: true, model: cfg.model }; }
  catch (e) { Object.assign(cfg, old); return { ok: false, error: e.message }; }
}

/* =====================  Free on-device AI (Ollama + Gemma 4)  ===================== */
const ramGB = () => os.totalmem() / 2 ** 30;
function pickLocalModel(){
  const gb = ramGB();
  if (gb >= 30) return { tag: 'gemma4:26b', size: '17 GB' };
  if (gb >= 15) return { tag: 'gemma4:12b', size: '8 GB' };
  return { tag: 'gemma4:e4b', size: '7 GB' };
}
const ollamaHome = () => path.join(app.getPath('userData'), 'ollama');
function ollamaBin(){
  const c = [path.join(ollamaHome(), 'Ollama.app/Contents/Resources/ollama'), '/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama'];
  return c.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}
let ollamaProc = null;
async function ollamaUp(){ try { const r = await net.fetch(OLLAMA + '/api/version'); return r.ok; } catch (e) { return false; } }
async function startOllama(){
  if (await ollamaUp()) return true;
  const bin = ollamaBin(); if (!bin) return false;
  if (!ollamaProc){
    ollamaProc = spawn(bin, ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_KEEP_ALIVE: '30m' }, stdio: 'ignore' });
    ollamaProc.on('exit', () => { ollamaProc = null; });
  }
  for (let i = 0; i < 60; i++){ if (await ollamaUp()) return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}
async function hasLocalModel(tag){
  try { const j = await (await net.fetch(OLLAMA + '/api/tags')).json(); return (j.models || []).some(m => m.name === tag || m.model === tag || m.name === tag + ':latest'); }
  catch (e) { return false; }
}
let localReady = false, setupRunning = null;
async function checkLocal(){
  if (!cfg.localModel){ localReady = false; return false; }
  localReady = (await startOllama()) && await hasLocalModel(cfg.localModel);
  return localReady;
}
async function download(url, dest, onPct){
  const r = await net.fetch(url); if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const total = +r.headers.get('content-length') || 0, out = fs.createWriteStream(dest), rd = r.body.getReader();
  let got = 0;
  for (;;){
    const { done, value } = await rd.read(); if (done) break;
    out.write(Buffer.from(value)); got += value.length; if (total) onPct(got / total);
  }
  await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
}
const unzip = (zip, dest) => new Promise((res, rej) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dest], err => err ? rej(err) : res()));

/** one-click setup of the free AI; progress({stage, pct, text}) */
function setupLocal(progress){
  if (setupRunning) return setupRunning;
  setupRunning = (async () => {
    const pick = pickLocalModel();
    try {
      if (!ollamaBin()){
        progress({ stage: 'engine', pct: 0, text: 'Downloading the AI engine…' });
        fs.mkdirSync(ollamaHome(), { recursive: true });
        const zip = path.join(ollamaHome(), 'ollama.zip');
        await download('https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip', zip, p => progress({ stage: 'engine', pct: p, text: `Downloading the AI engine… ${Math.round(p * 100)}%` }));
        progress({ stage: 'engine', pct: 1, text: 'Unpacking…' });
        fs.rmSync(path.join(ollamaHome(), 'Ollama.app'), { recursive: true, force: true });
        await unzip(zip, ollamaHome()); fs.rmSync(zip, { force: true });
      }
      progress({ stage: 'start', pct: 0, text: 'Starting the AI engine…' });
      if (!(await startOllama())) throw new Error("The AI engine didn't start.");
      if (!(await hasLocalModel(pick.tag))){
        const r = await net.fetch(OLLAMA + '/api/pull', { method: 'POST', body: JSON.stringify({ model: pick.tag, stream: true }) });
        if (!r.ok) throw new Error(`Couldn't download the model (${r.status})`);
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;){
          const { done, value } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n')) >= 0){
            const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
            const j = JSON.parse(line); if (j.error) throw new Error(j.error);
            const pct = j.total ? j.completed / j.total : 0;
            if (j.total) progress({ stage: 'model', pct, text: `Downloading the AI brain (${pick.size})… ${Math.round(pct * 100)}%` });
            else progress({ stage: 'model', pct: 1, text: j.status === 'success' ? 'Almost done…' : 'Getting the AI ready…' });
          }
        }
      }
      cfg.localModel = pick.tag; save();
      localReady = await hasLocalModel(pick.tag);
      if (!localReady) throw new Error('The model download didn’t finish — try again.');
      progress({ stage: 'done', pct: 1, text: 'Free AI is ready' });
      return { ok: true, model: pick.tag };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    } finally { setupRunning = null; }
  })();
  return setupRunning;
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
const NO_SCREEN_MSG = "I can't see your screen yet — Stash needs Screen Recording permission. I've opened the setting: switch on Stash under Privacy & Security › Screen & System Audio Recording, then quit and reopen Stash.";

/* =====================  tools (shared by both brains)  ===================== */
const TOOL_DEFS = [
  { name: 'look_at_screen', description: "Look at what is on the user's screen right now. Use it whenever they say 'this', 'on my screen', 'what am I looking at', 'what does this mean', or ask you to save/copy what's on screen.", params: { type: 'object', properties: {} } },
  { name: 'save_note', description: "Save a note into the user's Stash library. Use for 'write this down', 'save this', 'put this in a note'. When saving what's on screen, write the useful content into the body (transcribe text, summarise, keep links). Set include_screenshot true to attach the screenshot.", params: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, folder: { type: 'string', description: "Folder name, default 'Notes'. Created if missing." }, include_screenshot: { type: 'boolean' } }, required: ['title', 'body'] } },
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
const systemPrompt = lib => `You are Stash — Charlie's personal AI assistant on his Mac. You're a general assistant, not limited to his library: answer any question, explain things, write, plan, brainstorm, do maths, help with whatever is on his screen.
You appear as a small bar at the top of the screen, so be brief by default (1–4 short sentences, or a few bullets). Plain text, at most light **bold**; no headings or tables.
You can save and organise things in his Stash library with your tools. When you do, confirm in one short line what you saved and where. Only use a tool when it's actually needed.
Today is ${new Date().toDateString()}.
STASH LIBRARY (for context): ${lib || '(empty)'}`;

let history = [], localHistory = [];
const reset = () => { history = []; localHistory = []; };

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
    if (Array.isArray(m.content)) m.content.forEach(b => { if (b.type === 'tool_result' && Array.isArray(b.content)) b.content = b.content.map(c => c.type === 'image' ? { type: 'text', text: '[screenshot shown earlier]' } : c); });
    if (m.images) delete m.images;
  }
}
async function askClaude(q, ctx){
  const system = systemPrompt(ctx.lib) + '\nYou can see his screen with look_at_screen — use it whenever he refers to something on screen.';
  const tools = TOOL_DEFS.map(t => ({ name: t.name, description: t.description, input_schema: t.params }));
  history.push({ role: 'user', content: q }); slim(history);
  const sources = []; let open = null;
  for (let step = 0; step < 8; step++){
    ctx.status(step ? 'Working on it…' : 'Thinking…');
    const res = await callClaude({ model: cfg.model || FALLBACK_MODEL, max_tokens: 1500, system, tools, messages: history });
    history.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), sources, open, ai: 'claude' };
    const results = [];
    for (const u of uses){
      let content;
      try {
        if (u.name === 'look_at_screen'){
          ctx.status('Looking at your screen…');
          const shot = lastShot || await captureScreen();
          if (!shot){ shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); content = 'Screen capture is not permitted yet. ' + NO_SCREEN_MSG; }
          else { lastShot = shot; content = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot } }, { type: 'text', text: "This is the user's screen." }]; }
        } else content = await runTool(u.name, u.input, ctx, sources, id => open = id);
      } catch (e) { content = 'Tool failed: ' + (e.message || e); }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    history.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps — try asking in a simpler way.', sources, open, ai: 'claude' };
}

/* ---------- free on-device brain ---------- */
async function askLocal(q, ctx){
  if (!(await startOllama())) return { text: "The free AI engine isn't running — reopen Stash and try again.", ai: 'local' };
  // small models are better at "is the screen attached?" than at deciding to call a vision tool,
  // so when you mention the screen, the screenshot goes straight in with your question
  let images;
  if (SCREEN_RE.test(q) || (localHistory.length === 0 && /\bthis\b/i.test(q) && lastShot)){
    ctx.status('Looking at your screen…');
    const shot = lastShot || await captureScreen();
    if (!shot){ shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); return { text: NO_SCREEN_MSG, ai: 'local' }; }
    lastShot = shot; images = [shot];
  }
  const tools = TOOL_DEFS.filter(t => t.name !== 'look_at_screen').map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.params } }));
  localHistory.push(images ? { role: 'user', content: q + "\n\n(The attached image is a screenshot of the user's screen right now.)", images } : { role: 'user', content: q });
  slim(localHistory);
  const sources = []; let open = null;
  for (let step = 0; step < 5; step++){
    ctx.status(step ? 'Working on it…' : 'Thinking…');
    const r = await net.fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({
      model: cfg.localModel, stream: false, keep_alive: '30m', tools,
      options: { num_ctx: 8192, temperature: 0.4 },
      messages: [{ role: 'system', content: systemPrompt(ctx.lib) }, ...localHistory]
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `The free AI returned ${r.status}`);
    const msg = j.message || { role: 'assistant', content: '' };
    localHistory.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls || !msg.tool_calls.length){
      const text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return { text: text || "Sorry — I didn't get that. Try asking another way.", sources, open, ai: 'local' };
    }
    for (const tc of msg.tool_calls){
      let args = tc.function?.arguments || {};
      if (typeof args === 'string'){ try { args = JSON.parse(args); } catch (e) { args = {}; } }
      let out;
      try { out = await runTool(tc.function?.name, args, ctx, sources, id => open = id); } catch (e) { out = 'Tool failed: ' + (e.message || e); }
      localHistory.push({ role: 'tool', content: String(out), tool_name: tc.function?.name });
    }
  }
  return { text: 'That took too many steps — try asking in a simpler way.', sources, open, ai: 'local' };
}

/** ask(q, {exec, status}) → {text, sources, open, ai} or null if no AI is set up */
async function ask(q, { exec, status }){
  const lib = await exec('window.Stash && window.Stash.summary ? window.Stash.summary() : ""').catch(() => '');
  const ctx = { exec, status, lib };
  if (cfg.key) return askClaude(q, ctx);
  if (localReady || await checkLocal()) return askLocal(q, ctx);
  return null;
}

// safeStorage only works once the app is ready, so load lazily
let loaded = false; const ensure = () => { if (!loaded){ loaded = true; load(); } };
module.exports = {
  ask: (q, o) => { ensure(); return ask(q, o); }, reset, preCapture,
  setKey: (k, m) => { ensure(); return setKey(k, m); },
  setupLocal: p => { ensure(); return setupLocal(p); },
  status: async () => { ensure(); await checkLocal(); const pick = pickLocalModel(); return { claude: !!cfg.key, model: cfg.model, local: { ready: localReady, model: cfg.localModel || pick.tag, size: pick.size, installed: !!ollamaBin(), setting: !!setupRunning } }; },
  creds: () => { ensure(); return { key: cfg.key, model: cfg.model }; },
  hasAI: () => { ensure(); return !!cfg.key || localReady; },
  warm: async () => { ensure(); if (await checkLocal() && !cfg.key){ try { await net.fetch(OLLAMA + '/api/generate', { method: 'POST', body: JSON.stringify({ model: cfg.localModel, prompt: '', keep_alive: '30m' }) }); } catch (e) {} } },
  stop: () => { try { ollamaProc && ollamaProc.kill(); } catch (e) {} }
};
