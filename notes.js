/* =========================================================
   Stash Pages — the note editor.
   A note is a clean writing page made of blocks (like Notion / Google Docs)
   with a free canvas on top of it (like Figma / FigJam): shapes, stickies,
   text boxes, images, videos and drawings you can drag anywhere.

   Data (saved on the item as it.doc; it.body keeps a plain-text copy for
   search, thumbnails and the AI):
     { v:2, meta:{icon, cover, font, wide}, blocks:[…], objs:[…] }
   Every change is an "op" so collaborators can replay it live:
     b  upsert block      bx  text edit inside a block   bd delete block   bo block order
     o  upsert object     od  delete object              m  page setting   ti title
   ========================================================= */
(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// the default pen/text colour follows the theme (light ink on dark, dark ink on light)
const INKDEF = new Set(['#f4f4f5', '#e4e4e7', '#fff', '#ffffff']);
const inkOf = c => INKDEF.has(String(c || '').toLowerCase()) ? 'var(--ink)' : c;
const TEXTY = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'code']);
const PAGEW = { normal: 720, wide: 980 };
const LABEL = { p: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'Bulleted list', ol: 'Numbered list', todo: 'To-do list', quote: 'Quote', callout: 'Callout', code: 'Code' };

/* ---------- icons ---------- */
const P = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  ul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
  ol: '<path d="M10 6h10M10 12h10M10 18h10M4 5h1.5v4.5M4 9.5h3M6.5 19H4c0-1.2 2.5-2 2.5-3.2 0-.8-.6-1.3-1.3-1.3-.6 0-1 .3-1.2.7"/>',
  todo: '<rect x="3" y="4.5" width="6.5" height="6.5" rx="1.5"/><path d="m3.5 17 2 2 3.5-4M13 7.5h8M13 17h8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  quote: '<path d="M4 6v12M9 8h11M9 12h11M9 16h7"/>',
  alL: '<path d="M3 6h18M3 12h12M3 18h16"/>', alC: '<path d="M3 6h18M6 12h12M4 18h16"/>', alR: '<path d="M3 6h18M9 12h12M5 18h16"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  cursor: '<path d="m5 3 6.5 17 2.4-7.1L21 10.5z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 6.5a1.5 1.5 0 0 1 3 0V13M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1.5c-2 0-3.4-.7-4.7-2L4 16.2a1.6 1.6 0 0 1 2.3-2.3L8 15.5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9.5 19h5"/>',
  sticky: '<path d="M15 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/><path d="M15 21v-6h6"/>',
  shapes: '<rect x="3" y="3" width="10" height="10" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z"/><path d="M22 21H7M5 11l9 9"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  video: '<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="m21.5 8-5 4 5 4z"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18M12 3v18"/>',
  divider: '<path d="M3 12h18"/><path d="M7 6h10M7 18h10" opacity=".35"/>',
  front: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  back: '<rect x="9" y="9" width="12" height="12" rx="2" fill="currentColor" stroke="none" opacity=".4"/><rect x="3" y="3" width="12" height="12" rx="2"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4 16a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  group: '<rect x="3" y="3" width="18" height="18" rx="2.5" stroke-dasharray="3 3"/><rect x="7" y="7" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  aL: '<path d="M4 3v18M8 7h12v4H8zM8 14h7v4H8z"/>', aC: '<path d="M12 3v18M6 7h12v4H6zM8.5 14h7v4h-7z"/>', aR: '<path d="M20 3v18M4 7h12v4H4zM9 14h7v4H9z"/>',
  aT: '<path d="M3 4h18M7 8v12h4V8zM14 8v7h4V8z"/>', aM: '<path d="M3 12h18M7 6v12h4V6zM14 8.5v7h4v-7z"/>', aB: '<path d="M3 20h18M7 4v12h4V4zM14 9v7h4V9z"/>',
  dH: '<path d="M4 3v18M20 3v18M9.5 8h5v8h-5z"/>', dV: '<path d="M3 4h18M3 20h18M8 9.5h8v5H8z"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/>',
  cover: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18"/>',
  callout: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  rect: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/>', round: '<rect x="3.5" y="5" width="17" height="14" rx="5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7.5"/>', tri: '<path d="M12 4 21 19.5H3z"/>', diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  line: '<path d="M5 19 19 5"/>', arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  fill: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="M5 2l5 5M20.5 15.5s-1.5 2-1.5 3a1.5 1.5 0 0 0 3 0c0-1-1.5-3-1.5-3z"/>',
  stroke: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  opacity: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  font: '<path d="M4 20 10 4h1l6 16M6.5 14h8"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4 16a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1"/>'
};
const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

/* ---------- colours ---------- */
const INK = ['#f4f4f5', '#a1a1aa', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const HILITE = ['transparent', 'rgba(161,161,170,.28)', 'rgba(239,68,68,.28)', 'rgba(249,115,22,.28)', 'rgba(234,179,8,.3)', 'rgba(34,197,94,.26)', 'rgba(6,182,212,.26)', 'rgba(59,130,246,.3)', 'rgba(139,92,246,.3)', 'rgba(236,72,153,.28)'];
const FILLS = ['transparent', '#ffffff', '#a1a1aa', '#27272a', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const STICKY = ['#fde68a', '#fecdd3', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa', '#e4e4e7'];
const COVERS = ['linear-gradient(120deg,#3b82f6,#8b5cf6 55%,#ec4899)', 'linear-gradient(120deg,#0ea5e9,#22c55e)', 'linear-gradient(120deg,#f97316,#ef4444 60%,#be185d)', 'linear-gradient(120deg,#18181b,#3f3f46)',
  'linear-gradient(120deg,#facc15,#f97316)', 'radial-gradient(circle at 20% 30%,#6366f1,transparent 55%),radial-gradient(circle at 80% 70%,#14b8a6,transparent 55%),#0f172a', 'linear-gradient(120deg,#e0e7ff,#fce7f3)', 'linear-gradient(120deg,#064e3b,#0f766e 50%,#22d3ee)'];
const EMOJI = '📝 📌 💡 ✅ 🔥 ⭐ 🚀 🎯 📚 🧠 💼 📅 🗂️ 🎨 🎬 📷 🎵 💬 ❤️ 🌱 🌙 ☀️ 🌊 🏔️ ⚡ 🧪 🛠️ 💰 📈 🏆 🎮 ✈️ 🍕 ☕ 🐶 🌸 🧩 🔒 📎 ✨'.split(' ');
const CALLOUT_EMOJI = ['💡', '⚠️', '✅', '📌', '❗', '🔥', 'ℹ️', '💬'];

/* ---------- safe HTML for rich text (what collaborators and paste can put in) ---------- */
const OK_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'A', 'SPAN', 'FONT', 'BR', 'MARK', 'SUB', 'SUP', 'DIV']);
const OK_CSS = /^(color|background-color|font-weight|font-style|text-decoration|text-decoration-line)$/;
function clean(html){
  if (!html) return '';
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  (function walk(n){
    for (const c of [...n.childNodes]){
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|IMG|SVG|VIDEO|AUDIO|FORM|INPUT|TEXTAREA|BUTTON)$/i.test(c.tagName)){ c.remove(); continue; }
      walk(c);
      if (!OK_TAGS.has(c.tagName)){ c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]){
        const k = a.name.toLowerCase();
        if (k === 'style'){
          const keep = [...c.style].filter(p => OK_CSS.test(p)).map(p => `${p}:${c.style.getPropertyValue(p)}`).filter(s => !/url\(|expression/i.test(s)).join(';');
          if (keep) c.setAttribute('style', keep); else c.removeAttribute('style');
        } else if (k === 'href' && c.tagName === 'A' && /^(https?:|mailto:)/i.test(a.value.trim())) {}
        else if (k === 'color' && c.tagName === 'FONT' && /^[#\w(),.\s%]+$/.test(a.value)) {}
        else c.removeAttribute(a.name);
      }
      if (c.tagName === 'A'){ c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
    }
  })(d);
  return d.innerHTML;
}
function htmlText(h){
  if (!h) return '';
  const d = new DOMParser().parseFromString(`<body>${String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>\s*<div>/gi, '\n')}</body>`, 'text/html').body;
  return d.textContent.replace(/ /g, ' ');
}
const inlineMd = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');

/* ---------- plain text ⇄ page ---------- */
function blockFromLine(line){
  const b = { id: uid(), t: 'p', h: '' };
  let m;
  if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { b.t = 'h' + m[1].length; b.h = inlineMd(m[2]); }
  else if ((m = /^\s*[-*•]\s+\[( |x|X)?\]\s*(.*)$/.exec(line)) || (m = /^\s*\[( |x|X)?\]\s+(.*)$/.exec(line))) { b.t = 'todo'; b.c = /x/i.test(m[1] || ''); b.h = inlineMd(m[2]); }
  else if ((m = /^(\s*)[-*•]\s+(.*)$/.exec(line))) { b.t = 'ul'; b.ind = Math.min(3, Math.floor(m[1].length / 2)); b.h = inlineMd(m[2]); }
  else if ((m = /^(\s*)\d+[.)]\s+(.*)$/.exec(line))) { b.t = 'ol'; b.ind = Math.min(3, Math.floor(m[1].length / 2)); b.h = inlineMd(m[2]); }
  else if ((m = /^>\s?(.*)$/.exec(line))) { b.t = 'quote'; b.h = inlineMd(m[1]); }
  else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { b.t = 'hr'; }
  else b.h = inlineMd(line);
  return b;
}
function fromText(text){
  const lines = String(text || '').replace(/\r/g, '').split('\n'), blocks = [];
  let code = null;
  for (const line of lines){
    if (/^```/.test(line)){ if (code){ blocks.push(code); code = null; } else code = { id: uid(), t: 'code', h: '' }; continue; }
    if (code){ code.h += (code.h ? '\n' : '') + esc(line); continue; }
    blocks.push(blockFromLine(line));
  }
  if (code) blocks.push(code);
  while (blocks.length > 1 && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].h) blocks.pop();
  if (!blocks.length) blocks.push({ id: uid(), t: 'p', h: '' });
  return { v: 2, meta: {}, blocks, objs: [] };
}
function toText(doc){
  if (!doc) return '';
  const out = []; let n = 0;
  for (const b of doc.blocks || []){
    const t = htmlText(b.h), pad = '  '.repeat(b.ind || 0);
    if (b.t !== 'ol') n = 0;
    if (b.t === 'h1') out.push('# ' + t); else if (b.t === 'h2') out.push('## ' + t); else if (b.t === 'h3') out.push('### ' + t);
    else if (b.t === 'ul') out.push(pad + '• ' + t); else if (b.t === 'ol') out.push(pad + (++n) + '. ' + t);
    else if (b.t === 'todo') out.push((b.c ? '[x] ' : '[ ] ') + t); else if (b.t === 'quote') out.push('> ' + t);
    else if (b.t === 'callout') out.push((b.e || '💡') + ' ' + t); else if (b.t === 'code') out.push('```\n' + t + '\n```');
    else if (b.t === 'hr') out.push('---'); else if (b.t === 'table') (b.rows || []).forEach(r => out.push(r.map(htmlText).join(' | ')));
    else if (b.t === 'img') out.push(b.cap ? `[image: ${b.cap}]` : '[image]');
    else out.push(t);
  }
  const extra = (doc.objs || []).filter(o => o.html).map(o => htmlText(o.html).trim()).filter(Boolean);
  if (extra.length) out.push('', ...extra);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function ensure(it){
  if (!it.doc || !Array.isArray(it.doc.blocks)) it.doc = fromText(it.body || '');
  const d = it.doc; d.v = 2; d.meta = d.meta || {}; d.objs = d.objs || [];
  if (!d.blocks.length) d.blocks.push({ id: uid(), t: 'p', h: '' });
  return d;
}
const isEmpty = it => { const d = it.doc; if (!d) return !it.body; return !d.objs.length && !d.meta?.icon && !d.meta?.cover && d.blocks.every(b => b.t === 'p' && !htmlText(b.h).trim()); };

/* ---------- applying an op to plain data (used for local, remote and undo) ---------- */
function dataApply(d, op){
  const bi = id => d.blocks.findIndex(b => b.id === id), oi = id => d.objs.findIndex(o => o.id === id);
  switch (op.t){
    case 'b': { const i = bi(op.b.id); if (i >= 0) d.blocks[i] = clone(op.b); else { const a = op.after == null ? -1 : bi(op.after); d.blocks.splice(op.after === undefined ? d.blocks.length : a + 1, 0, clone(op.b)); } break; }
    case 'bx': { const b = d.blocks[bi(op.id)]; if (!b) return false; const h = b.h || ''; if (op.pos > h.length) return false; b.h = h.slice(0, op.pos) + op.ins + h.slice(op.pos + op.del); break; }
    case 'bd': { const i = bi(op.id); if (i >= 0) d.blocks.splice(i, 1); if (!d.blocks.length) d.blocks.push({ id: uid(), t: 'p', h: '' }); break; }
    case 'bo': { const map = new Map(d.blocks.map(b => [b.id, b])), out = op.ids.map(id => map.get(id)).filter(Boolean); d.blocks.forEach(b => { if (!op.ids.includes(b.id)) out.push(b); }); d.blocks = out; break; }
    case 'o': { const i = oi(op.o.id); if (i >= 0) d.objs[i] = clone(op.o); else d.objs.push(clone(op.o)); break; }
    case 'objs': { for (const o of op.os){ const i = oi(o.id); if (i >= 0) d.objs[i] = clone(o); else d.objs.push(clone(o)); } break; }
    case 'od': { const i = oi(op.id); if (i >= 0) d.objs.splice(i, 1); break; }
    case 'm': { d.meta = d.meta || {}; if (op.v == null) delete d.meta[op.k]; else d.meta[op.k] = op.v; break; }
  }
  return true;
}

/* ---------- styles ---------- */
const CSS = `
.pvbody.padmode{overflow:hidden}
.pad{position:absolute;inset:0;display:flex;flex-direction:column;--acc:#4f86e8;--pt:var(--text);--pm:rgba(var(--w),.52);--pl:rgba(var(--w),.09);outline:0;user-select:none;-webkit-user-select:none}
.pad button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.ptop{display:flex;align-items:center;gap:2px;padding:6px 10px;border-bottom:1px solid rgba(var(--w),.06);overflow-x:auto;scrollbar-width:none;flex:none;background:none}
.ptop::-webkit-scrollbar{display:none}
.ptop button,.pdock button,.pobar button,.pzc button,.pbub button{height:28px;min-width:28px;padding:0 6px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:4px;color:rgba(var(--w),.78);font-size:12.5px;flex:none;transition:background .12s,color .12s}
.ptop button:hover,.pdock button:hover,.pobar button:hover,.pzc button:hover,.pbub button:hover{background:rgba(var(--w),.08);color:var(--hi)}
.ptop button.on,.pdock button.on,.pobar button.on,.pbub button.on{background:rgba(79,134,232,.22);color:var(--hi)}
.ptop .pdd{padding:0 8px;min-width:96px;justify-content:space-between;color:var(--hi)}
.ptop .pdd:after,.pobar .pdd:after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg) translate(-2px,-1px);opacity:.6}
.psep{width:1px;height:18px;background:rgba(var(--w),.1);margin:0 5px;flex:none}
.psp{flex:1;min-width:8px}
.pmetaslot{font-size:11.5px;color:var(--pm);white-space:nowrap;display:flex;gap:10px;align-items:center;flex:none}
.pmetaslot .cmeta{position:static;margin:0;padding:0}
.pcol{width:15px;height:3px;border-radius:2px;display:block;margin-top:1px}
.pscroll{flex:1;overflow:auto;position:relative;background:none;user-select:text;-webkit-user-select:text}
.pscroll.pan,.pscroll.pan *{cursor:grab!important}.pscroll.panning,.pscroll.panning *{cursor:grabbing!important}
.pstage{position:relative}
.pzoom{position:absolute;left:0;top:0;transform-origin:0 0}
.ppage{position:absolute;background:none;border:0;border-radius:0;box-shadow:none;padding:0 0 80px;min-height:600px;text-shadow:0 1px 12px rgba(0,0,0,.25);color:var(--pt);font-size:15.5px;line-height:1.7;cursor:text}
.ppage.serif{font-family:"Iowan Old Style","Charter",Georgia,serif;font-size:17px}
.ppage.mono{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:14px}
.pcover{height:0;border-radius:16px;background-size:cover;background-position:center;position:relative}
.pcover.has{height:190px}
.pcover .pcbtns{position:absolute;right:14px;bottom:12px;display:none;gap:6px}
.pcover:hover .pcbtns{display:flex}
.pcbtns button,.padd button{height:26px;padding:0 10px;border-radius:7px;font-size:12px;color:rgba(255,255,255,.85);background:rgba(0,0,0,.45);backdrop-filter:blur(8px);display:inline-flex;align-items:center;gap:6px}
.pinner{padding:0 84px}
.phead{position:relative;padding-top:56px}
.pcover.has+.pinner .phead{padding-top:22px}
.picon{font-size:58px;line-height:1;width:max-content;cursor:pointer;border-radius:10px;padding:4px;margin:0 0 6px -4px;user-select:none}
.picon:hover{background:rgba(var(--w),.06)}
.pcover.has+.pinner .picon{margin-top:-58px}
.padd{display:flex;gap:6px;opacity:0;transition:opacity .15s;margin-bottom:8px;height:26px}
.padd button{background:none;color:var(--pm)}.padd button:hover{background:rgba(var(--w),.07);color:var(--hi)}
.ppage:hover .padd{opacity:1}
.ptitle{font-size:38px;font-weight:700;letter-spacing:-.03em;line-height:1.2;outline:0;padding:2px 0 14px;word-break:break-word}
.ppage.serif .ptitle{font-weight:600}
.ptitle:empty:before{content:attr(data-ph);color:rgba(var(--w),.22)}
.pblocks{position:relative}
.pb{position:relative;margin:1px 0;padding-left:calc(var(--ind,0) * 26px)}
.pbh{position:absolute;left:calc(var(--ind,0) * 26px - 52px);top:3px;display:flex;opacity:0;transition:opacity .12s}
.pb:hover>.pbh,.pb.foc>.pbh{opacity:1}
.pbh button{width:22px;height:24px;border-radius:5px;color:rgba(var(--w),.35);display:grid;place-items:center}
.pbh button:hover{background:rgba(var(--w),.08);color:var(--hi)}
.pbh .pgrip{cursor:grab}
.pbc{outline:0;min-height:1.7em;padding:2px 2px;word-break:break-word;white-space:pre-wrap}
.pbc:empty:before{content:attr(data-ph);color:rgba(var(--w),.24);pointer-events:none}
.pb[data-t=p]:not(.foc) .pbc:empty:before,.pb[data-t=quote]:not(.foc) .pbc:empty:before,.pb[data-t=ul]:not(.foc) .pbc:empty:before,.pb[data-t=ol]:not(.foc) .pbc:empty:before,.pb[data-t=todo]:not(.foc) .pbc:empty:before{content:none}
.pblocks.solo .pb[data-t=p] .pbc:empty:before{content:attr(data-ph)}
.pb[data-al=center] .pbc,.pb[data-al=center] .ptw{text-align:center}.pb[data-al=right] .pbc{text-align:right}
.pb[data-t=h1] .pbc{font-size:1.85em;font-weight:700;letter-spacing:-.025em;line-height:1.3;margin-top:.8em}
.pb[data-t=h2] .pbc{font-size:1.45em;font-weight:650;letter-spacing:-.02em;line-height:1.35;margin-top:.6em}
.pb[data-t=h3] .pbc{font-size:1.18em;font-weight:620;line-height:1.4;margin-top:.4em}
.pb[data-t=h1] .pbh{top:calc(.8em + 10px)}.pb[data-t=h2] .pbh{top:calc(.6em + 6px)}
.pb[data-t=ul] .pbc,.pb[data-t=ol] .pbc,.pb[data-t=todo] .pbc{margin-left:26px}
.pb[data-t=ul]:before{content:"•";position:absolute;left:calc(var(--ind,0)*26px + 7px);top:2px;font-size:1.25em;line-height:1.45;color:rgba(var(--w),.75)}
.pb[data-t=ul][data-ind="1"]:before{content:"◦"}.pb[data-t=ul][data-ind="2"]:before{content:"▪";font-size:.8em;top:6px}
.pb[data-t=ol]:before{content:attr(data-n) ".";position:absolute;left:calc(var(--ind,0)*26px);top:2px;width:22px;text-align:right;color:rgba(var(--w),.7);font-variant-numeric:tabular-nums}
.pchk{position:absolute;left:calc(var(--ind,0)*26px + 3px);top:.42em;width:17px;height:17px;border-radius:5px;border:1.6px solid rgba(var(--w),.35);cursor:pointer;display:grid;place-items:center;transition:all .15s}
.pchk:hover{border-color:rgba(var(--w),.6)}
.pb.done .pchk{background:var(--acc);border-color:var(--acc)}
.pb.done .pchk:after{content:"";width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px)}
.pb.done .pbc{color:rgba(var(--w),.4);text-decoration:line-through}
.pb[data-t=quote] .pbc{border-left:3px solid rgba(var(--w),.55);padding-left:16px;margin:4px 0;color:rgba(var(--w),.86)}
.pb[data-t=callout]{display:flex;gap:10px;background:rgba(var(--w),.055);border:1px solid rgba(var(--w),.06);border-radius:10px;padding:12px 16px 12px 14px;margin:8px 0}
.pb[data-t=callout] .pbh{left:-52px;top:12px}
.pemo{font-size:1.2em;cursor:pointer;line-height:1.55;user-select:none}
.pb[data-t=callout] .pbc{flex:1}
.pb[data-t=code] .pbc{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:13px;line-height:1.65;background:rgba(0,0,0,.32);border:1px solid rgba(var(--w),.07);border-radius:10px;padding:14px 16px;margin:6px 0;color:#d4d4d8;tab-size:2}
.pb[data-t=code] .pbh{top:12px}
.pb[data-t=hr]{padding:12px 0;cursor:pointer}.pb[data-t=hr] hr{border:0;border-top:1px solid rgba(var(--w),.14)}.pb[data-t=hr].sel hr{border-color:var(--acc)}
.pbc code,.pot code{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:.86em;background:rgba(var(--w),.08);color:#f0abfc;padding:.12em .38em;border-radius:5px}
.pbc a,.pot a{color:#7cb0ff;text-decoration:underline;text-decoration-color:rgba(124,176,255,.4);text-underline-offset:2px;cursor:pointer}
.pb.drop-before:after,.pb.drop-after:after{content:"";position:absolute;left:0;right:0;height:3px;border-radius:2px;background:var(--acc)}
.pb.drop-before:after{top:-2px}.pb.drop-after:after{bottom:-2px}
.pb.dragging{opacity:.35}
.pfig{margin:10px auto;position:relative;max-width:100%}
.pb[data-fl=left]{float:left;margin:4px 28px 10px 0;z-index:2}
.pb[data-fl=right]{float:right;margin:4px 0 10px 28px;z-index:2}
.pb[data-fl=left] .pfig,.pb[data-fl=right] .pfig{margin:0;width:100%!important}
.pb[data-fl=left]>.pbh,.pb[data-fl=right]>.pbh{display:none}
.pb[data-t=ul],.pb[data-t=ol],.pb[data-t=todo],.pb[data-t=quote],.pb[data-t=code],.pb[data-t=table],.pb[data-t=hr]{display:flow-root}
.pb[data-t=img]:not([data-fl=left]):not([data-fl=right]){clear:both}
.pblocks:after{content:"";display:block;clear:both}
.pfig img{cursor:grab}
.pfig.lift{opacity:.25}
.pdi{position:absolute;background:var(--acc);border-radius:3px;pointer-events:none;z-index:5;box-shadow:0 0 0 3px rgba(79,134,232,.25)}
.pghost{position:absolute;z-index:70;pointer-events:none;opacity:.85;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.5);transform:rotate(-1.5deg)}
.pghost img{display:block;width:100%}
.pghost.free{opacity:.6;transform:none;outline:2px dashed var(--acc)}
.phint{position:absolute;z-index:71;pointer-events:none;background:var(--acc);color:#fff;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}
.pb[data-al=left] .pfig{margin-left:0}.pb[data-al=right] .pfig{margin-right:0}
.pfig img,.pfig video{display:block;width:100%;border-radius:10px}
.pfig.sel img{outline:2px solid var(--acc);outline-offset:2px}
.pfig figcaption{font-size:13px;color:var(--pm);text-align:center;outline:0;padding:6px 0 0;min-height:1.6em}
.pfig figcaption:empty:before{content:attr(data-ph);color:rgba(var(--w),.2)}
.pfig .prs{position:absolute;top:50%;width:6px;height:46px;margin-top:-30px;border-radius:4px;background:rgba(0,0,0,.6);border:1px solid rgba(var(--w),.55);opacity:0;cursor:ew-resize;transition:opacity .15s}
.pfig .prs.l{left:8px}.pfig .prs.r{right:8px}.pfig:hover .prs{opacity:1}
.ptw{position:relative;margin:8px 0;overflow-x:auto;padding:0 0 20px}
.ptw table{border-collapse:collapse;min-width:100%;font-size:.94em}
.ptw td{border:1px solid rgba(var(--w),.12);padding:7px 10px;min-width:90px;vertical-align:top;outline:0;white-space:pre-wrap}
.ptw tr:first-child td{background:rgba(var(--w),.045);font-weight:600}
.ptw td:focus{box-shadow:inset 0 0 0 2px var(--acc)}
.ptw .padc,.ptw .padr{position:absolute;opacity:0;background:rgba(var(--w),.06);border-radius:6px;color:rgba(var(--w),.6);display:grid;place-items:center;transition:opacity .15s}
.ptw:hover .padc,.ptw:hover .padr{opacity:1}
.ptw .padc{right:-26px;top:0;width:20px;bottom:20px}.ptw .padr{left:0;right:0;bottom:0;height:18px}
.ptail{height:120px;cursor:text}
/* free objects */
.pobjs{position:absolute;left:0;top:0;width:0;height:0}
.po{position:absolute;left:0;top:0;transform-origin:50% 50%}
.po>svg{position:absolute;inset:0;overflow:visible}
.po.k-line,.po.k-arrow,.po.k-draw{pointer-events:none}
.po .hit{pointer-events:stroke;cursor:move}
.pot{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:10px 14px;outline:0;word-break:break-word;white-space:pre-wrap;line-height:1.4;color:#fff;font-size:16px;text-align:center;overflow:hidden}
.po.k-text{height:auto!important}.po.k-text .pot{position:relative;inset:auto;min-height:1.5em;padding:2px 4px;justify-content:flex-start;text-align:left;overflow:visible;line-height:1.5}
.po.k-sticky .pot{justify-content:flex-start;text-align:left;padding:18px 18px;color:#1c1917;line-height:1.45}
.po.k-sticky{border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.25),0 12px 28px rgba(0,0,0,.28)}
.pot:empty:before{content:attr(data-ph);opacity:.4}
.pot[contenteditable=true]{cursor:text;user-select:text;-webkit-user-select:text}
.po{cursor:move}
.po.lockd{cursor:default}
.pimg{position:absolute;inset:0;overflow:hidden}
.pimg img,.pimg video{position:absolute;display:block;max-width:none;pointer-events:none;user-select:none;-webkit-user-drag:none}
.pimg video{pointer-events:auto}
.po.cropping{overflow:visible}.po.cropping .pimg{overflow:visible}.po.cropping .pimg img{opacity:.35}
.po.cropping .pimg:after{content:"";position:absolute;inset:0;outline:9999px solid rgba(0,0,0,.0)}
.pcropv{position:absolute;inset:0;overflow:hidden}
.pcropv img{position:absolute;max-width:none}
/* overlays */
.pink{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.psel{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.psb{position:absolute;border:1.5px solid var(--acc);pointer-events:none;transform-origin:50% 50%}
.psb.multi{border-style:solid}
.psb.ghost{border:1px solid rgba(79,134,232,.55)}
.ph{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;background:#fff;border:1.5px solid var(--acc);border-radius:3px;pointer-events:auto}
.ph.rot{border-radius:50%;width:12px;height:12px;margin:-6px 0 0 -6px;cursor:grab}
.ph.rot:before{content:"";position:absolute;left:50%;top:100%;width:1.5px;height:14px;background:var(--acc);transform:translateX(-50%)}
.psize{position:absolute;transform:translate(-50%,10px);background:var(--acc);color:#fff;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:5px;white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}
.pcatch{position:absolute;inset:0;z-index:5;cursor:crosshair;display:none}
.pcatch.on{display:block}
.pcatch.pen{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Ccircle cx='11' cy='11' r='3' fill='white' stroke='black'/%3E%3C/svg%3E") 11 11,crosshair}
.pcatch.eraser{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Ccircle cx='11' cy='11' r='8' fill='rgba(var(--w),.25)' stroke='white'/%3E%3C/svg%3E") 11 11,crosshair}
.ppeer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:6}
.ppc{position:absolute;width:2px;background:var(--c);border-radius:1px}
.ppc b,.ppp b,.pps b{position:absolute;left:0;bottom:100%;font-size:10.5px;font-weight:600;color:#fff;background:var(--c);padding:1px 6px;border-radius:4px 4px 4px 0;white-space:nowrap}
.ppp{position:absolute;left:0;top:0;transition:transform .08s linear}
.ppp b{left:14px;top:16px;bottom:auto;border-radius:0 6px 6px 6px}
.pps{position:absolute;border:2px solid var(--c);border-radius:3px}
.pps b{bottom:auto;top:-19px;left:-2px}
/* floating ui */
.pdock{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:5px;border-radius:14px;background:rgba(var(--p2),.92);border:1px solid rgba(var(--w),.1);box-shadow:0 14px 40px rgba(0,0,0,.45);backdrop-filter:blur(16px);z-index:20}
.pdock button{width:36px;height:36px;border-radius:10px}
.pdock button.on{background:var(--acc);color:#fff}
.pdock .pcaret{width:16px;min-width:16px;margin-left:-4px;padding:0}
.pdock .pcaret:after{content:"";width:5px;height:5px;border:solid currentColor;border-width:1.5px 0 0 1.5px;transform:rotate(45deg) translateY(2px);opacity:.6}
.pzc{position:absolute;right:14px;bottom:16px;display:flex;align-items:center;padding:3px;border-radius:10px;background:rgba(var(--p2),.9);border:1px solid rgba(var(--w),.1);z-index:20}
.pzc button{font-variant-numeric:tabular-nums;font-size:11.5px}
.pwc{position:absolute;left:14px;bottom:22px;font-size:11px;color:rgba(var(--w),.35);z-index:20;pointer-events:none}
.pbub,.pobar{position:absolute;z-index:30;display:none;align-items:center;gap:1px;padding:4px;border-radius:11px;background:rgba(var(--p2),.97);border:1px solid rgba(var(--w),.12);box-shadow:0 12px 34px rgba(0,0,0,.5);white-space:nowrap}
.pbub.show,.pobar.show{display:flex}
.pobar .pdd{padding:0 6px;font-size:12px}
.pobar input[type=range]{width:80px;accent-color:var(--acc)}
.psw{width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(var(--w),.35);display:block;background-clip:padding-box}
.psw.none{background:linear-gradient(135deg,transparent 45%,#ef4444 45%,#ef4444 55%,transparent 55%)!important}
.ppop{position:absolute;z-index:40;display:none;min-width:180px;max-height:340px;overflow:auto;padding:5px;border-radius:12px;background:rgba(var(--p2),.98);border:1px solid rgba(var(--w),.12);box-shadow:0 18px 44px rgba(0,0,0,.55);font-size:13px;color:var(--text)}
.ppop.show{display:block}
.ppop h6{font-size:10.5px;font-weight:600;color:rgba(var(--w),.4);text-transform:uppercase;letter-spacing:.06em;padding:8px 8px 4px}
.ppop .pi{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border-radius:7px;text-align:left;font-size:13px;color:var(--text)}
.ppop .pi:hover,.ppop .pi.act{background:rgba(var(--w),.08)}
.ppop .pi i{width:30px;height:30px;border-radius:7px;background:rgba(var(--w),.06);border:1px solid rgba(var(--w),.07);display:grid;place-items:center;font-style:normal;font-size:13px;font-weight:600;flex:none}
.ppop .pi span{display:flex;flex-direction:column}.ppop .pi small{color:rgba(var(--w),.42);font-size:11.5px}
.ppop .pi kbd{margin-left:auto;font:inherit;font-size:11px;color:rgba(var(--w),.35)}
.ppop .pgrid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:4px}
.ppop .pgrid button{height:32px;border-radius:7px;font-size:19px}
.ppop .pgrid button:hover{background:rgba(var(--w),.08)}
.ppop .psws{display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px 8px;max-width:232px}
.ppop .psws button{width:22px;height:22px;border-radius:6px;border:1px solid rgba(var(--w),.2)}
.ppop .psws button.on{outline:2px solid var(--acc);outline-offset:1px}
.ppop .psws .tx{display:grid;place-items:center;font-weight:700;font-size:12px;background:rgba(var(--w),.04)}
.ppop .pcov{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}
.ppop .pcov button{height:38px;border-radius:7px}
.ppop .prow{display:flex;gap:6px;padding:6px 8px}
.ppop input.plink{flex:1;height:30px;border-radius:7px;border:1px solid rgba(var(--w),.14);background:rgba(0,0,0,.25);padding:0 9px;color:var(--hi);outline:0;font-size:12.5px;min-width:220px}
.ppop .pbtn{height:30px;padding:0 12px;border-radius:7px;background:var(--acc);color:#fff;font-size:12.5px;font-weight:600}
.pdrop{position:absolute;inset:0;z-index:50;display:none;place-items:center;background:rgba(79,134,232,.12);border:2px dashed rgba(79,134,232,.7);border-radius:12px;font-size:14px;font-weight:600;color:var(--hi);pointer-events:none}
.pdrop.show{display:grid}
:root[data-theme=light] .ppage{text-shadow:none}
:root[data-theme=light] .pb[data-t=code] .pbc{background:rgba(17,17,24,.05);border-color:rgba(17,17,24,.08);color:#27272a}
:root[data-theme=light] .pbc code,:root[data-theme=light] .pot code{color:#a21caf}
:root[data-theme=light] .pbc a,:root[data-theme=light] .pot a{color:#1d5fd6;text-decoration-color:rgba(29,95,214,.4)}
:root[data-theme=light] .ppop input.plink{background:rgba(17,17,24,.05)}
:root[data-theme=light] .pdock,:root[data-theme=light] .ppop,:root[data-theme=light] .pbub,:root[data-theme=light] .pobar{box-shadow:0 12px 34px rgba(0,0,0,.16)}
:root[data-theme=light] .po.k-sticky{box-shadow:0 1px 2px rgba(0,0,0,.12),0 10px 24px rgba(0,0,0,.14)}
.ppage [style*="rgb(244, 244, 245)"],.po.k-text [style*="rgb(244, 244, 245)"],.ppage font[color="#f4f4f5"]{color:var(--ink)!important}
.pprint{display:none}
@media print{
  @page{margin:12mm}
  html,body{background:#fff!important;overflow:visible!important;height:auto!important}
  body>*:not(.pprint){display:none!important}
  .pprint{display:block!important;position:relative!important;color:#18181b;--ink:#18181b;--text:#18181b;--w:17,17,24}
  .pprint .ppage{background:#fff!important;border:0!important;box-shadow:none!important;color:#18181b!important;min-height:0!important}
  .pprint .ptitle,.pprint .pbc{color:#18181b!important}.pprint .ptw td{border-color:#d4d4d8!important}
  .pprint .pbh,.pprint .padd,.pprint .pcbtns,.pprint .ptail,.pprint .prs,.pprint .padc,.pprint .padr{display:none!important}
  .pprint .pb[data-t=ul]:before,.pprint .pb[data-t=ol]:before{color:#3f3f46!important}
  .pprint .pb[data-t=code] .pbc{background:#f4f4f5!important;color:#18181b!important}
  .pprint .pb[data-t=quote] .pbc{border-color:#a1a1aa!important;color:#27272a!important}
  .pprint .pb[data-t=callout]{background:#f4f4f5!important}
  .pprint .pb.done .pbc{color:#a1a1aa!important}
  .pprint .pfig figcaption{color:#71717a!important}
  .pprint .pchk{border-color:#a1a1aa!important}.pprint .pb.done .pchk{border-color:#4f86e8!important}
  .pprint .pbc code{background:#f4f4f5!important;color:#be185d!important}
}
`;
function injectCSS(){ if ($('#padcss')) return; const s = document.createElement('style'); s.id = 'padcss'; s.textContent = CSS; document.head.appendChild(s); }

/* =========================================================
   The editor
   ========================================================= */
const PH = { p: "Type '/' for commands", h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', ul: 'List', ol: 'List', todo: 'To-do', quote: 'Quote', callout: 'Write a callout…', code: 'Code' };
const SLASH = [
  { k: 'p', l: 'Text', d: 'Just start writing', i: 'Aa', w: 'paragraph plain' },
  { k: 'h1', l: 'Heading 1', d: 'Big section heading', i: 'H1', w: 'title big' },
  { k: 'h2', l: 'Heading 2', d: 'Medium heading', i: 'H2', w: 'subtitle' },
  { k: 'h3', l: 'Heading 3', d: 'Small heading', i: 'H3', w: 'subheading' },
  { k: 'ul', l: 'Bulleted list', d: 'A simple list', ic: 'ul', w: 'bullet unordered' },
  { k: 'ol', l: 'Numbered list', d: 'A list with numbers', ic: 'ol', w: 'ordered number' },
  { k: 'todo', l: 'To-do list', d: 'Track tasks', ic: 'todo', w: 'checkbox check task' },
  { k: 'quote', l: 'Quote', d: 'Capture a quote', ic: 'quote', w: 'blockquote' },
  { k: 'callout', l: 'Callout', d: 'Make it stand out', ic: 'callout', w: 'note info tip warning' },
  { k: 'code', l: 'Code', d: 'Code block', ic: 'code', w: 'snippet pre' },
  { k: 'hr', l: 'Divider', d: 'Separate sections', ic: 'divider', w: 'line separator rule' },
  { k: 'table', l: 'Table', d: 'Rows and columns', ic: 'table', w: 'grid spreadsheet' },
  { k: 'img', l: 'Image or video', d: 'Upload into the page', ic: 'image', w: 'photo picture media upload video' },
  { k: 'sticky', l: 'Sticky note', d: 'Free-floating note', ic: 'sticky', w: 'post-it canvas' },
  { k: 'shape', l: 'Shape', d: 'Rectangle you can move anywhere', ic: 'shapes', w: 'rectangle box canvas figma' },
  { k: 'tbox', l: 'Text box', d: 'Free-floating text', ic: 'text', w: 'canvas label' },
  { k: 'pen', l: 'Draw', d: 'Pen and highlighter', ic: 'pen', w: 'sketch drawing pencil marker' },
  { k: 'date', l: "Today's date", d: 'Insert the date', i: '📅', w: 'now time today' }
];
const SHAPES = [['rect', 'Rectangle'], ['round', 'Rounded'], ['ellipse', 'Ellipse'], ['tri', 'Triangle'], ['diamond', 'Diamond'], ['star', 'Star'], ['line', 'Line'], ['arrow', 'Arrow']];
const CLIPKEY = 'stash-objects:';
let current = null;

function mount(host, it, opts = {}){
  injectCSS();
  if (current) current.destroy();
  const doc = ensure(it);
  let base = clone(doc);
  const undoS = [], redoS = [], L = { op: [], cur: [] }, hooks = { upload: null, resolve: null };
  let z = 1, ox = 0, oy = 0, tool = 'select', shapeKind = 'rect', penKind = 'pen';
  let sel = new Set(), editing = null, cropping = null, selBlock = null, drag = null, slash = null, lastCell = null, spaceDown = false;
  const style = { fill: '#4f86e8', stroke: '#f4f4f5', sw: 2, line: '#e4e4e7', pen: '#f4f4f5', penW: 3, hl: '#facc15', sticky: STICKY[0] };
  const media = new Map();

  host.innerHTML = `<div class="pad">
  <div class="ptop">
    <button data-a="undo" title="Undo (⌘Z)">${ic('undo')}</button><button data-a="redo" title="Redo (⇧⌘Z)">${ic('redo')}</button><i class="psep"></i>
    <button class="pdd" data-a="style" title="Turn into"><span>Text</span></button><i class="psep"></i>
    <button data-a="bold" title="Bold (⌘B)"><b>B</b></button><button data-a="italic" title="Italic (⌘I)"><i style="font-family:Georgia,serif;font-size:14px">I</i></button>
    <button data-a="underline" title="Underline (⌘U)"><u>U</u></button><button data-a="strike" title="Strikethrough (⇧⌘X)"><s>S</s></button>
    <button data-a="color" title="Text colour & highlight"><span style="display:flex;flex-direction:column;align-items:center;line-height:1"><b style="font-size:13px">A</b><span class="pcol" style="background:#facc15"></span></span></button><i class="psep"></i>
    <button data-a="align" title="Align">${ic('alL')}</button><button data-a="ul" title="Bulleted list">${ic('ul')}</button><button data-a="ol" title="Numbered list">${ic('ol')}</button><button data-a="todo" title="Checklist">${ic('todo')}</button><i class="psep"></i>
    <button data-a="link" title="Link (⌘K)">${ic('link')}</button><button data-a="icode" title="Inline code (⌘E)">${ic('code')}</button><button data-a="quote" title="Quote">${ic('quote')}</button><button data-a="callout" title="Callout">${ic('callout')}</button>
    <span class="psp"></span><span class="pmetaslot"></span>
    <button data-a="more" title="Page options">${ic('more')}</button>
  </div>
  <div class="pscroll"><div class="pstage"><div class="pzoom">
    <div class="ppage"><div class="pcover"><div class="pcbtns"><button data-a="cover">Change cover</button><button data-a="nocover">Remove</button></div></div>
      <div class="pinner"><div class="phead"><div class="picon" data-a="icon" title="Change icon"></div><div class="padd"><button data-a="addicon">${ic('smile', 14)} Add icon</button><button data-a="addcover">${ic('cover', 14)} Add cover</button></div></div>
      <div class="ptitle" contenteditable="true" data-ph="Untitled"></div>
      <div class="pblocks"></div><div class="ptail"></div></div></div>
    <div class="pobjs"></div><svg class="pink"></svg><div class="psel"></div><div class="ppeer"></div><div class="pcatch"></div>
  </div></div></div>
  <div class="pdock">
    <button data-tool="select" title="Select (V)">${ic('cursor', 18)}</button><button data-tool="hand" title="Hand (H) — or hold Space">${ic('hand', 18)}</button><i class="psep"></i>
    <button data-tool="text" title="Text box (T) — or double-click any empty spot">${ic('text', 18)}</button><button data-tool="sticky" title="Sticky note (S)">${ic('sticky', 18)}</button>
    <button data-tool="shape" title="Shape (R)">${ic('rect', 18)}</button><button class="pcaret" data-a="shapes" title="Pick a shape"></button>
    <button data-tool="pen" title="Pen (P) · Highlighter (M) · Eraser (E)">${ic('pen', 18)}</button><button class="pcaret" data-a="pens" title="Pen, highlighter, eraser"></button><i class="psep"></i>
    <button data-a="addimg" title="Add image or video">${ic('image', 18)}</button><button data-a="addtable" title="Add table">${ic('table', 18)}</button>
  </div>
  <div class="pzc"><button data-a="zout" title="Zoom out (⌘−)">${ic('minus', 14)}</button><button data-a="z100" title="Reset to 100% (⌘0)">100%</button><button data-a="zin" title="Zoom in (⌘+)">${ic('plus', 14)}</button></div>
  <div class="pwc"></div><div class="pbub"></div><div class="pobar"></div><div class="ppop"></div><div class="pdrop">Drop to add it to this page</div>
  <input type="file" class="pfile" accept="image/*,video/*" multiple hidden>
</div>`;
  const root = host.firstElementChild, q = s => $(s, root);
  const scroll = q('.pscroll'), stage = q('.pstage'), zoomEl = q('.pzoom'), page = q('.ppage'), blocksEl = q('.pblocks'), titleEl = q('.ptitle'),
    objsEl = q('.pobjs'), ink = q('.pink'), selEl = q('.psel'), peerEl = q('.ppeer'), catchEl = q('.pcatch'), bub = q('.pbub'), obar = q('.pobar'),
    pop = q('.ppop'), dock = q('.pdock'), fileIn = q('.pfile'), coverEl = q('.pcover'), iconEl = q('.picon');

  /* ---------- lookups ---------- */
  const B = id => doc.blocks.find(b => b.id === id), O = id => doc.objs.find(o => o.id === id);
  const bEl = id => blocksEl.querySelector(`.pb[data-id="${id}"]`), oEl = id => objsEl.querySelector(`.po[data-id="${id}"]`);
  const bIndex = id => doc.blocks.findIndex(b => b.id === id);
  const topZ = () => doc.objs.reduce((m, o) => Math.max(m, o.z || 0), 0);
  const typing = () => { const a = document.activeElement; return !!(a && root.contains(a) && (a.isContentEditable || /INPUT|TEXTAREA/.test(a.tagName))); };

  /* ---------- ops: local changes, remote changes, undo ---------- */
  let commitT = null, wcT = null, opsT = new Map();
  function send(op){ L.op.forEach(f => f(op)); }
  function sendSoon(key, mk, ms = 60){ // throttle a stream of ops (drags, typing in tables), always sending the last one
    const s = opsT.get(key) || {}; s.mk = mk; opsT.set(key, s);
    if (s.t) return;
    s.t = setTimeout(() => { s.t = null; opsT.delete(key); send(s.mk()); }, ms);
  }
  function changed(noCommit){
    opts.onChange && opts.onChange();
    if (!noCommit){ clearTimeout(commitT); commitT = setTimeout(commit, 650); }
    clearTimeout(wcT); wcT = setTimeout(wordCount, 400);
  }
  function local(op, domDone){
    if (!dataApply(doc, op)) return;
    if (!domDone) refresh(op, false);
    send(op); changed();
  }
  function commit(){
    clearTimeout(commitT);
    const e = diffDocs(base, doc); if (!e) return;
    undoS.push(e); if (undoS.length > 150) undoS.shift(); redoS.length = 0; base = clone(doc);
  }
  function diffDocs(a, b){
    const e = { b: {}, o: {}, bo: null, m: null }; let any = false;
    const cmp = (A, Bs, key) => { const am = new Map(A.map(x => [x.id, x])), bm = new Map(Bs.map(x => [x.id, x]));
      for (const id of new Set([...am.keys(), ...bm.keys()])){ const x = am.get(id), y = bm.get(id); if (JSON.stringify(x) !== JSON.stringify(y)){ e[key][id] = [clone(x) || null, clone(y) || null]; any = true; } } };
    cmp(a.blocks, b.blocks, 'b'); cmp(a.objs, b.objs, 'o');
    const ao = a.blocks.map(x => x.id), bo = b.blocks.map(x => x.id);
    if (ao.join() !== bo.join()){ e.bo = [ao, bo]; any = true; }
    if (JSON.stringify(a.meta) !== JSON.stringify(b.meta)){ e.m = [clone(a.meta), clone(b.meta)]; any = true; }
    return any ? e : null;
  }
  function applyEntry(e, side){
    for (const [id, pr] of Object.entries(e.b)){
      const v = pr[side];
      if (v){ const ord = e.bo ? e.bo[side] : null, i = ord ? ord.indexOf(id) : -1; local({ t: 'b', b: v, after: i > 0 ? ord[i - 1] : i === 0 ? null : undefined }); }
      else local({ t: 'bd', id });
    }
    if (e.bo) local({ t: 'bo', ids: e.bo[side] });
    for (const [id, pr] of Object.entries(e.o)) pr[side] ? local({ t: 'o', o: pr[side] }) : local({ t: 'od', id });
    if (e.m){ const m = e.m[side] || {}; for (const k of new Set([...Object.keys(e.m[0] || {}), ...Object.keys(e.m[1] || {})])) local({ t: 'm', k, v: m[k] ?? null }); }
  }
  function undo(){ commit(); const e = undoS.pop(); if (!e){ flash('Nothing to undo'); return; } applyEntry(e, 0); clearTimeout(commitT); base = clone(doc); redoS.push(e); afterHistory(); }
  function redo(){ commit(); const e = redoS.pop(); if (!e){ flash('Nothing to redo'); return; } applyEntry(e, 1); clearTimeout(commitT); base = clone(doc); undoS.push(e); afterHistory(); }
  function afterHistory(){ sel = new Set([...sel].filter(O)); drawSel(); relayout(); }

  // a collaborator's change
  function applyRemote(op){
    if (op.t === 'ti'){ it.title = op.v; if (document.activeElement !== titleEl) titleEl.textContent = op.v; opts.onTitle && opts.onTitle(op.v, true); return; }
    const before = op.t === 'bx' ? (B(op.id) || {}).h : null;
    if (!dataApply(doc, op)){ L.cur.forEach(f => f({ needFull: true })); return; }
    if (!dataApply(base, op) && op.t === 'bx'){ const i = base.blocks.findIndex(b => b.id === op.id); if (i >= 0) base.blocks[i] = clone(B(op.id)); }
    refresh(op, true, before);
    opts.onChange && opts.onChange(true);
    clearTimeout(wcT); wcT = setTimeout(wordCount, 600);
  }
  function setDoc(nd, keepUndo){
    doc.blocks = clone(nd.blocks || []); doc.objs = clone(nd.objs || []); doc.meta = clone(nd.meta || {});
    if (!doc.blocks.length) doc.blocks.push({ id: uid(), t: 'p', h: '' });
    base = clone(doc); if (!keepUndo){ undoS.length = 0; redoS.length = 0; }
    const cs = saveCaret(); renderAll(); restoreCaret(cs);
    sel = new Set([...sel].filter(O)); drawSel();
  }

  /* ---------- DOM refresh for one op ---------- */
  function refresh(op, remote, beforeH){
    switch (op.t){
      case 'b': {
        const el = bEl(op.b.id);
        if (el) refillBlock(op.b.id);
        else { const ne = blockEl(B(op.b.id)), i = bIndex(op.b.id), nx = doc.blocks[i + 1] && bEl(doc.blocks[i + 1].id); blocksEl.insertBefore(ne, nx || null); }
        renumber(); break;
      }
      case 'bx': if (remote) patchText(op, beforeH); break;
      case 'bd': { const el = bEl(op.id); if (el){ const foc = el.contains(document.activeElement); el.remove(); if (foc) focusNear(op.id); } if (!blocksEl.children.length) renderBlocks(); renumber(); break; }
      case 'bo': { const cs = saveCaret(); doc.blocks.forEach(b => { const e = bEl(b.id); if (e) blocksEl.appendChild(e); }); restoreCaret(cs); renumber(); break; }
      case 'o': renderObj(O(op.o.id)); if (sel.has(op.o.id) || remote) drawSel(); break;
      case 'objs': op.os.forEach(o => renderObj(O(o.id))); drawSel(); break;
      case 'od': { oEl(op.id)?.remove(); if (sel.delete(op.id)) drawSel(); if (editing === op.id) editing = null; if (cropping === op.id) cropping = null; break; }
      case 'm': renderMeta(); break;
    }
    relayout();
  }
  function patchText(op, beforeH){
    const el = bEl(op.id), b = B(op.id); if (!el || !b) return;
    const pbc = el.querySelector('.pbc'); if (!pbc) return refillBlock(op.id);
    const foc = pbc.contains(document.activeElement) || document.activeElement === pbc;
    let off = foc ? caretOffset(pbc) : null; const oldLen = pbc.textContent.length;
    const at = htmlText((beforeH || '').slice(0, op.pos)).length;
    pbc.innerHTML = clean(b.h);
    if (off != null){ if (at < off) off += pbc.textContent.length - oldLen; setCaret(pbc, clamp(off, 0, pbc.textContent.length)); }
  }

  /* ---------- caret helpers ---------- */
  function caretOffset(el){
    const s = getSelection(); if (!s.rangeCount) return 0;
    const r = s.getRangeAt(0); if (!el.contains(r.endContainer)) return 0;
    const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString().length;
  }
  function rangeAt(el, a, b = a){
    const r = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, pos = 0, sa = null, sb = null;
    while ((n = w.nextNode())){
      const l = n.length;
      if (!sa && a <= pos + l){ r.setStart(n, a - pos); sa = 1; }
      if (!sb && b <= pos + l){ r.setEnd(n, b - pos); sb = 1; break; }
      pos += l;
    }
    if (!sa){ r.selectNodeContents(el); r.collapse(false); }
    else if (!sb) r.setEnd(el, el.childNodes.length);
    return r;
  }
  function setCaret(el, off, end){
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = rangeAt(el, off, end ?? off), s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function saveCaret(){
    const a = document.activeElement; if (!a || !root.contains(a) || !a.isContentEditable) return null;
    const pb = a.closest('.pb'), po = a.closest('.po');
    if (a === titleEl) return { title: 1, off: caretOffset(a) };
    if (a.classList.contains('pbc') && pb) return { id: pb.dataset.id, off: caretOffset(a) };
    if (a.tagName === 'TD' && pb) return { id: pb.dataset.id, r: a.dataset.r, c: a.dataset.c, off: caretOffset(a) };
    if (a.tagName === 'FIGCAPTION' && pb) return { id: pb.dataset.id, cap: 1, off: caretOffset(a) };
    if (po) return { obj: po.dataset.id, off: caretOffset(a) };
    return null;
  }
  function restoreCaret(c){
    if (!c) return;
    let el = null;
    if (c.title) el = titleEl;
    else if (c.obj){ const p = oEl(c.obj)?.querySelector('.pot'); if (p && editing === c.obj){ p.contentEditable = 'true'; el = p; } }
    else { const pb = bEl(c.id); if (pb) el = c.r != null ? pb.querySelector(`td[data-r="${c.r}"][data-c="${c.c}"]`) : c.cap ? pb.querySelector('figcaption') : pb.querySelector('.pbc'); }
    if (el) setCaret(el, Math.min(c.off, el.textContent.length));
  }
  const caretAtStart = el => { const s = getSelection(); return s.isCollapsed && caretOffset(el) === 0; };
  const caretAtEnd = el => { const s = getSelection(); return s.isCollapsed && caretOffset(el) >= el.textContent.length; };
  function focusBlock(id, off = 0){
    const el = bEl(id); if (!el) return;
    const t = el.querySelector('.pbc') || el.querySelector('td') || el.querySelector('figcaption');
    if (t) setCaret(t, off === 'end' ? t.textContent.length : off);
    if (t) scrollIntoViewIfNeeded(t);
  }
  function focusNear(id){
    const i = Math.max(0, Math.min(doc.blocks.length - 1, bIndex(id)));
    const b = doc.blocks[i - 1] || doc.blocks[i]; if (b) focusBlock(b.id, 'end');
  }
  function scrollIntoViewIfNeeded(el){
    const r = el.getBoundingClientRect(), s = scroll.getBoundingClientRect();
    if (r.bottom > s.bottom - 70) scroll.scrollTop += r.bottom - s.bottom + 90;
    else if (r.top < s.top + 20) scroll.scrollTop -= s.top - r.top + 40;
  }

  /* ---------- rendering: page ---------- */
  function blockEl(b){ const el = document.createElement('div'); el.className = 'pb'; el.dataset.id = b.id; fillBlock(el, b); return el; }
  function fillBlock(el, b){
    el.dataset.t = b.t; el.dataset.ind = b.ind || 0; el.style.setProperty('--ind', b.ind || 0); el.dataset.al = b.al || '';
    el.classList.toggle('done', b.t === 'todo' && !!b.c); el.classList.toggle('sel', selBlock === b.id);
    const fl = b.t === 'img' && (b.fl === 'left' || b.fl === 'right') ? b.fl : ''; el.dataset.fl = fl; el.style.width = fl ? (b.w || 45) + '%' : '';
    let h = `<div class="pbh" contenteditable="false"><button class="pplus" title="Click to add a block below">${ic('plus', 14)}</button><button class="pgrip" title="Drag to move · Click for options">${ic('grip', 14)}</button></div>`;
    if (TEXTY.has(b.t)){
      if (b.t === 'todo') h += '<span class="pchk" role="checkbox"></span>';
      if (b.t === 'callout') h += `<span class="pemo" title="Change emoji">${esc(b.e || '💡')}</span>`;
      h += `<div class="pbc" contenteditable="true" spellcheck="${b.t !== 'code'}" data-ph="${esc(PH[b.t] || '')}">${clean(b.h)}</div>`;
    } else if (b.t === 'hr') h += '<hr>';
    else if (b.t === 'img') h += `<figure class="pfig${selBlock === b.id ? ' sel' : ''}" style="width:${b.fl ? 100 : b.w || 100}%">${b.vid ? '<video controls playsinline preload="metadata"></video>' : '<img draggable="false" alt="">'}<span class="prs l"></span><span class="prs r"></span><figcaption contenteditable="true" data-ph="Write a caption…">${esc(b.cap || '')}</figcaption></figure>`;
    else if (b.t === 'table') h += `<div class="ptw"><table>${(b.rows || [['']]).map((r, ri) => `<tr>${r.map((c, ci) => `<td contenteditable="true" data-r="${ri}" data-c="${ci}">${clean(c)}</td>`).join('')}</tr>`).join('')}</table><button class="padc" title="Add column">${ic('plus', 12)}</button><button class="padr" title="Add row">${ic('plus', 12)}</button></div>`;
    el.innerHTML = h;
    if (b.t === 'img') setMedia(el.querySelector('img,video'), b);
  }
  function refillBlock(id){ const el = bEl(id), b = B(id); if (!el || !b) return; const cs = saveCaret(); fillBlock(el, b); if (cs && cs.id === id) restoreCaret(cs); }
  function renderBlocks(){ blocksEl.innerHTML = ''; doc.blocks.forEach(b => blocksEl.appendChild(blockEl(b))); renumber(); }
  function renumber(){
    let cnt = [];
    for (const el of blocksEl.children){
      const b = B(el.dataset.id); if (!b) continue;
      const lv = b.ind || 0;
      if (b.t === 'ol'){ cnt.length = lv + 1; cnt[lv] = (cnt[lv] || 0) + 1; const n = cnt[lv]; el.dataset.n = lv % 3 === 1 ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : lv % 3 === 2 ? roman(n) : n; }
      else if (!(b.t === 'ul' || b.t === 'todo') || !lv) cnt = [];
    }
    blocksEl.classList.toggle('solo', doc.blocks.length === 1);
  }
  const roman = n => { const m = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of m) while (n >= v){ s += r; n -= v; } return s; };
  function setMedia(el, m){
    if (!el || !m) return;
    const use = u => { if (u && el.getAttribute('src') !== u) el.src = u; };
    if (m.path && hooks.resolve){
      if (media.has(m.path)) return use(media.get(m.path));
      if (m.src && !/^(file|blob):/.test(m.src)) use(m.src);
      hooks.resolve(m.path).then(u => { if (u){ media.set(m.path, u); use(u); } else use(m.src); }).catch(() => use(m.src));
    } else use(m.src);
  }
  function renderMeta(){
    const m = doc.meta;
    page.classList.toggle('serif', m.font === 'serif'); page.classList.toggle('mono', m.font === 'mono');
    coverEl.classList.toggle('has', !!m.cover);
    if (!m.cover) coverEl.style.background = '';
    else if (typeof m.cover === 'string') coverEl.style.background = COVERS[+m.cover.slice(1)] || COVERS[0];
    else { coverEl.style.background = '#222'; const im = new Image(); setMedia({ set src(u){ coverEl.style.background = `center/cover no-repeat url("${String(u).replace(/"/g, '%22')}")`; }, getAttribute(){ return null; } }, m.cover); }
    iconEl.textContent = m.icon || ''; iconEl.style.display = m.icon ? '' : 'none';
    q('[data-a=addicon]').style.display = m.icon ? 'none' : ''; q('[data-a=addcover]').style.display = m.cover ? 'none' : '';
    page.style.width = (m.wide ? PAGEW.wide : PAGEW.normal) + 'px';
  }
  function renderAll(){
    titleEl.textContent = it.title || '';
    renderMeta(); renderBlocks();
    objsEl.innerHTML = ''; doc.objs.forEach(renderObj);
    relayout(); wordCount();
  }
  function wordCount(){
    const t = toText(doc), w = (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    q('.pwc').textContent = `${w.toLocaleString()} word${w === 1 ? '' : 's'}`;
  }

  /* ---------- layout + zoom ---------- */
  let rl = 0;
  function relayout(){ if (rl) return; rl = requestAnimationFrame(() => { rl = 0; layout(true); drawSel(); drawPeers(); if (selBlock) showImgBar(); }); }
  function aabb(o){
    if (o.k === 'line' || o.k === 'arrow') return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    if (!o.r) return { x: o.x, y: o.y, w: o.w, h: o.h };
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = o.r * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const W = o.w * c + o.h * s, H = o.w * s + o.h * c; return { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
  }
  function union(rs){ if (!rs.length) return null; let x = Infinity, y = Infinity, X = -Infinity, Y = -Infinity; rs.forEach(r => { x = Math.min(x, r.x); y = Math.min(y, r.y); X = Math.max(X, r.x + r.w); Y = Math.max(Y, r.y + r.h); }); return { x, y, w: X - x, h: Y - y }; }
  function layout(keep){
    const pw = doc.meta.wide ? PAGEW.wide : PAGEW.normal, ph = page.offsetHeight;
    const u = union([{ x: 0, y: 0, w: pw, h: ph }, ...doc.objs.map(aabb)]);
    const vw = scroll.clientWidth / z, vh = scroll.clientHeight / z;
    const nox = Math.max((vw - pw) / 2, u.x < 0 ? 120 - u.x : 60), noy = u.y < 0 ? 100 - u.y : 36;
    const dx = (nox - ox) * z, dy = (noy - oy) * z;
    let sw = Math.max(vw, nox + u.x + u.w + 160), sh = Math.max(vh, noy + u.y + u.h + 220);
    if (keep){ sw = Math.max(sw, (scroll.scrollLeft + dx) / z + vw); sh = Math.max(sh, (scroll.scrollTop + dy) / z + vh); }
    ox = nox; oy = noy;
    zoomEl.style.width = sw + 'px'; zoomEl.style.height = sh + 'px'; zoomEl.style.transform = `scale(${z})`;
    stage.style.width = sw * z + 'px'; stage.style.height = sh * z + 'px';
    for (const el of [page, objsEl, ink, selEl, peerEl]){ el.style.left = ox + 'px'; el.style.top = oy + 'px'; }
    if (keep){ if (dx) scroll.scrollLeft += dx; if (dy) scroll.scrollTop += dy; }
  }
  function W(e){ const r = zoomEl.getBoundingClientRect(); return { x: (e.clientX - r.left) / z - ox, y: (e.clientY - r.top) / z - oy }; }
  function toRoot(x, y){ const r = zoomEl.getBoundingClientRect(), R = root.getBoundingClientRect(); return { x: r.left - R.left + (x + ox) * z, y: r.top - R.top + (y + oy) * z }; }
  function viewCenter(){ const r = scroll.getBoundingClientRect(); return W({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); }
  function setZoom(nz, cx, cy){
    nz = clamp(Math.round(nz * 100) / 100, 0.25, 4); if (nz === z) return;
    const r = scroll.getBoundingClientRect(); cx = cx ?? r.left + r.width / 2; cy = cy ?? r.top + r.height / 2;
    const w = W({ clientX: cx, clientY: cy });
    z = nz; layout(false);
    const zr = zoomEl.getBoundingClientRect();
    scroll.scrollLeft += zr.left + (w.x + ox) * z - cx; scroll.scrollTop += zr.top + (w.y + oy) * z - cy;
    q('[data-a=z100]').textContent = Math.round(z * 100) + '%';
    drawSel(); drawPeers(); hideBubble();
  }

  /* ---------- rendering: free objects ---------- */
  function shapeInner(o){
    const w = o.w, h = o.h, hasS = o.stroke && o.stroke !== 'transparent' && (o.sw || 0) > 0, s = hasS ? o.sw : 0, hs = s / 2;
    const a = `fill="${esc(o.fill || 'transparent')}" style="stroke:${hasS ? esc(inkOf(o.stroke)) : 'none'}" stroke-width="${s}" stroke-linejoin="round"${o.dash ? ` stroke-dasharray="${s * 3} ${s * 2}"` : ''}`;
    const pts = p => `<polygon points="${p.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ')}" ${a}/>`;
    switch (o.s){
      case 'ellipse': return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - hs)}" ry="${Math.max(0, h / 2 - hs)}" ${a}/>`;
      case 'tri': return pts([[w / 2, hs], [w - hs, h - hs], [hs, h - hs]]);
      case 'diamond': return pts([[w / 2, hs], [w - hs, h / 2], [w / 2, h - hs], [hs, h / 2]]);
      case 'star': { const p = []; for (let i = 0; i < 10; i++){ const ang = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1; p.push([w / 2 + Math.cos(ang) * (w / 2 - hs) * rr, h / 2 + Math.sin(ang) * (h / 2 - hs) * rr + (h * 0.06)]); } return pts(p); }
      default: return `<rect x="${hs}" y="${hs}" width="${Math.max(0, w - s)}" height="${Math.max(0, h - s)}" rx="${Math.min(o.rad || 0, w / 2, h / 2)}" ${a}/>`;
    }
  }
  function smooth(pts){
    if (!pts.length) return '';
    if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} L${(pts[1] || pts[0]).join(' ')}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++){ const [x, y] = pts[i], [nx, ny] = pts[i + 1]; d += ` Q${x} ${y} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`; }
    const l = pts[pts.length - 1]; return d + ` L${l[0]} ${l[1]}`;
  }
  function renderObj(o){
    if (!o) return;
    let el = oEl(o.id);
    if (!el){ el = document.createElement('div'); el.dataset.id = o.id; objsEl.appendChild(el); }
    const kind = o.k + (o.k === 'image' && cropping === o.id ? ':crop' : '');
    el.className = `po k-${o.k}${o.lock ? ' lockd' : ''}${cropping === o.id ? ' cropping' : ''}`;
    el.style.zIndex = o.z || 1; el.style.opacity = o.op ?? 1;
    if (o.k === 'line' || o.k === 'arrow'){
      const pad = Math.max(14, (o.sw || 2) * 4), r = aabb(o);
      Object.assign(el.style, { left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + pad * 2 + 'px', height: r.h + pad * 2 + 'px', transform: '' });
      const x1 = o.x1 - r.x + pad, y1 = o.y1 - r.y + pad, x2 = o.x2 - r.x + pad, y2 = o.y2 - r.y + pad, sw = o.sw || 2;
      let head = '';
      if (o.k === 'arrow'){ const ang = Math.atan2(y2 - y1, x2 - x1), L = 8 + sw * 2.5, sp = 0.5; head = `<path d="M${x2 - L * Math.cos(ang - sp)} ${y2 - L * Math.sin(ang - sp)} L${x2} ${y2} L${x2 - L * Math.cos(ang + sp)} ${y2 - L * Math.sin(ang + sp)}" fill="none" style="stroke:${esc(inkOf(o.stroke))}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`; }
      el.innerHTML = `<svg width="100%" height="100%"><line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="${sw + 14}"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${esc(inkOf(o.stroke))}" stroke-width="${sw}" stroke-linecap="round"${o.dash ? ` stroke-dasharray="${sw * 3} ${sw * 2.2}"` : ''}/>${head}</svg>`;
      el._k = kind; return;
    }
    Object.assign(el.style, { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', transform: o.r ? `rotate(${o.r}deg)` : '' });
    if (el._k !== kind){
      el._k = kind; el._src = null;
      if (o.k === 'shape') el.innerHTML = '<svg></svg><div class="pot" data-ph=""></div>';
      else if (o.k === 'sticky') el.innerHTML = '<div class="pot" data-ph="Write something…"></div>';
      else if (o.k === 'text') el.innerHTML = '<div class="pot" data-ph="Type something"></div>';
      else if (o.k === 'image') el.innerHTML = '<div class="pimg"><img draggable="false" alt=""></div>' + (cropping === o.id ? '<div class="pcropv"><img draggable="false" alt=""></div>' : '');
      else if (o.k === 'video') el.innerHTML = '<div class="pimg"><video controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video></div>';
      else if (o.k === 'draw') el.innerHTML = '<svg preserveAspectRatio="none"><path class="hit" fill="none" stroke="transparent" vector-effect="non-scaling-stroke"/><path class="ln" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (o.k === 'shape'){ const s = el.firstChild; s.setAttribute('width', o.w); s.setAttribute('height', o.h); s.setAttribute('viewBox', `0 0 ${o.w} ${o.h}`); s.innerHTML = shapeInner(o); }
    if (o.k === 'sticky') el.style.background = o.fill || STICKY[0];
    const pot = el.querySelector('.pot');
    if (pot){
      Object.assign(pot.style, { color: o.k === 'text' ? inkOf(o.color || '#f4f4f5') : o.color || (o.k === 'sticky' ? '#1c1917' : '#fff'), fontSize: (o.fs || 16) + 'px', textAlign: o.al || (o.k === 'shape' ? 'center' : 'left'), fontWeight: o.bold ? '650' : '' });
      if (o.k === 'shape') pot.style.justifyContent = o.va === 'top' ? 'flex-start' : o.va === 'bottom' ? 'flex-end' : 'center';
      if (editing !== o.id){ const h = clean(o.html || ''); if (pot.innerHTML !== h) pot.innerHTML = h; }
    }
    if (o.k === 'image' || o.k === 'video'){
      const pi = el.querySelector('.pimg'); pi.style.borderRadius = (o.rad || 0) + 'px';
      const m = el.querySelector('.pimg img, .pimg video');
      if (o.k === 'image') Object.assign(m.style, { left: (o.ix || 0) + 'px', top: (o.iy || 0) + 'px', width: (o.iw || o.w) + 'px', height: (o.ih || o.h) + 'px' });
      const key = (o.path || '') + '|' + (o.src || '').slice(0, 200);
      if (el._src !== key){ el._src = key; setMedia(m, o); }
      const cv = el.querySelector('.pcropv img'); if (cv){ Object.assign(cv.style, { left: (o.ix || 0) + 'px', top: (o.iy || 0) + 'px', width: (o.iw || o.w) + 'px', height: (o.ih || o.h) + 'px' }); setMedia(cv, o); }
    }
    if (o.k === 'draw'){
      const s = el.firstChild; s.setAttribute('width', o.w); s.setAttribute('height', o.h); s.setAttribute('viewBox', `0 0 ${o.vw || o.w} ${o.vh || o.h}`);
      const d = smooth(o.pts || []); s.querySelector('.hit').setAttribute('d', d); s.querySelector('.hit').setAttribute('stroke-width', (o.sw || 3) + 14);
      const ln = s.querySelector('.ln'); ln.setAttribute('d', d); ln.removeAttribute('stroke'); ln.style.stroke = o.hl ? (o.stroke || '#facc15') : inkOf(o.stroke || '#f4f4f5'); ln.setAttribute('stroke-width', o.sw || 3);
      ln.setAttribute('stroke-linecap', o.hl ? 'butt' : 'round');
    }
    if (o.k === 'text'){ const h = el.offsetHeight; if (h && Math.abs(h - o.h) > 1) o.h = h; }
  }

  /* ---------- selection box + handles ---------- */
  const selObjs = () => [...sel].map(O).filter(Boolean);
  function groupOf(o){ return o.g ? doc.objs.filter(x => x.g === o.g).map(x => x.id) : [o.id]; }
  function drawSel(sizeLabel){
    selEl.innerHTML = '';
    const os = selObjs();
    if (!os.length){ hideObar(); emitSel(); return; }
    const hz = 1 / z, H = (x, y, h, cls = '') => `<div class="ph ${cls}" data-h="${h}" style="left:${x}px;top:${y}px;width:${10 * hz}px;height:${10 * hz}px;margin:${-5 * hz}px 0 0 ${-5 * hz}px;border-width:${1.5 * hz}px;cursor:${CURS[h] || 'pointer'}"></div>`;
    let html = '';
    if (os.length === 1){
      const o = os[0];
      if (o.k === 'line' || o.k === 'arrow'){
        html = o.lock ? '' : H(o.x1, o.y1, 'p1', 'pt') + H(o.x2, o.y2, 'p2', 'pt');
        html += `<svg style="position:absolute;left:0;top:0;overflow:visible;width:1px;height:1px"><line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="#4f86e8" stroke-width="${1.5 * hz}"/></svg>`;
      } else {
        const hs = o.lock ? '' : [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]]
          .filter(([h]) => !(o.k === 'text' && /^(n|s)$/.test(h)) && !(o.k === 'text' && /^(ne|nw|se|sw)$/.test(h) && false)).map(([h, fx, fy]) => H(fx * o.w, fy * o.h, h)).join('')
          + (o.k !== 'text' && cropping !== o.id ? `<div class="ph rot" data-h="rot" style="left:${o.w / 2}px;top:${-24 * hz}px;width:${12 * hz}px;height:${12 * hz}px;margin:${-6 * hz}px 0 0 ${-6 * hz}px;border-width:${1.5 * hz}px"></div>` : '');
        html = `<div class="psb" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;border-width:${1.5 * hz}px;transform:${o.r ? `rotate(${o.r}deg)` : 'none'};${o.lock ? 'border-style:dashed;' : ''}">${hs}</div>`;
        if (sizeLabel) html += `<div class="psize" style="left:${o.x + o.w / 2}px;top:${o.y + o.h}px;transform:translate(-50%,${10 * hz}px) scale(${hz});transform-origin:50% 0">${sizeLabel}</div>`;
      }
    } else {
      const u = union(os.map(aabb));
      html = os.map(o => { const r = aabb(o); return `<div class="psb ghost" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-width:${hz}px"></div>`; }).join('');
      const locked = os.some(o => o.lock);
      html += `<div class="psb multi" style="left:${u.x}px;top:${u.y}px;width:${u.w}px;height:${u.h}px;border-width:${1.5 * hz}px">${locked ? '' : [['nw', 0, 0], ['ne', 1, 0], ['se', 1, 1], ['sw', 0, 1]].map(([h, fx, fy]) => H(fx * u.w, fy * u.h, h)).join('')}</div>`;
      if (sizeLabel) html += `<div class="psize" style="left:${u.x + u.w / 2}px;top:${u.y + u.h}px;transform:translate(-50%,${10 * hz}px) scale(${hz});transform-origin:50% 0">${sizeLabel}</div>`;
    }
    selEl.innerHTML = html;
    if (!drag) showObar(); else hideObar();
    emitSel();
  }
  const CURS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move' };
  let lastSelSent = '';
  function emitSel(){ const s = [...sel].join(','); if (s === lastSelSent) return; lastSelSent = s; L.cur.forEach(f => f({ sel: [...sel] })); }
  function select(ids, add){ if (!add) sel = new Set(); ids.forEach(id => sel.add(id)); if (editing && !sel.has(editing)) stopEdit(); if (cropping && !sel.has(cropping)) stopCrop(); drawSel(); }
  function clearSel(){ if (!sel.size && !editing) return; stopEdit(); stopCrop(); sel = new Set(); drawSel(); }

  /* ---------- object toolbar ---------- */
  function hideObar(){ obar.classList.remove('show'); }
  function sw(c){ return `<span class="psw${!c || c === 'transparent' ? ' none' : ''}" style="background:${esc(c || 'transparent')}"></span>`; }
  function showObar(){
    const os = selObjs();
    if (!os.length){ hideObar(); return; }
    const o = os[0], one = os.length === 1; let h = '';
    if (one && o.lock){ h = `<button data-o="lock" title="Unlock">${ic('unlock', 15)} Unlock</button>`; }
    else if (one){
      if (o.k === 'shape') h += `<button data-o="fill" title="Fill">${sw(o.fill)}</button><button data-o="stroke" title="Border">${ic('stroke', 15)}</button><button class="pdd" data-o="shape" title="Shape">${SHAPES.find(s => s[0] === o.s)?.[1] || 'Shape'}</button>`;
      if (o.k === 'sticky') h += `<button data-o="sfill" title="Colour">${sw(o.fill)}</button>`;
      if (o.k === 'line' || o.k === 'arrow') h += `<button data-o="lcolor" title="Colour">${sw(o.stroke)}</button><button class="pdd" data-o="lw" title="Thickness">${o.sw || 2}px</button><button data-o="arrowhead" class="${o.k === 'arrow' ? 'on' : ''}" title="Arrowhead">${ic('arrow', 15)}</button><button data-o="dash" class="${o.dash ? 'on' : ''}" title="Dashed">┄</button>`;
      if (o.k === 'draw') h += `<button data-o="lcolor" title="Colour">${sw(o.stroke)}</button><button class="pdd" data-o="lw" title="Thickness">${o.sw || 3}px</button>`;
      if (['shape', 'sticky', 'text'].includes(o.k)) h += `<i class="psep"></i><button data-o="tcolor" title="Text colour"><span style="display:flex;flex-direction:column;align-items:center;line-height:1"><b style="font-size:13px">A</b><span class="pcol" style="background:${esc(o.color || (o.k === 'sticky' ? '#1c1917' : '#fff'))};box-shadow:0 0 0 1px rgba(var(--w),.3)"></span></span></button><button class="pdd" data-o="fs" title="Text size">${o.fs || 16}</button><button data-o="bold" class="${o.bold ? 'on' : ''}" title="Bold"><b>B</b></button><button data-o="talign" title="Align text">${ic(o.al === 'center' ? 'alC' : o.al === 'right' ? 'alR' : (o.k === 'shape' && !o.al) ? 'alC' : 'alL', 15)}</button>`;
      if (o.k === 'image') h += `<button data-o="crop" class="${cropping === o.id ? 'on' : ''}" title="Crop (double-click)">${ic('crop', 15)} ${cropping === o.id ? 'Done' : 'Crop'}</button><button class="pdd" data-o="rad" title="Corner radius">◜ ${o.rad || 0}</button><button data-o="inpage" title="Put it in the page text">Put in page</button>`;
      if (o.k === 'video') h += `<button class="pdd" data-o="rad" title="Corner radius">◜ ${o.rad || 0}</button>`;
      h += `<i class="psep"></i><button class="pdd" data-o="op" title="Opacity">${Math.round((o.op ?? 1) * 100)}%</button>`;
    } else {
      h += ['aL', 'aC', 'aR', 'aT', 'aM', 'aB'].map(a => `<button data-o="${a}" title="${{ aL: 'Align left', aC: 'Align centre', aR: 'Align right', aT: 'Align top', aM: 'Align middle', aB: 'Align bottom' }[a]}">${ic(a, 15)}</button>`).join('');
      if (os.length > 2) h += `<button data-o="dH" title="Space evenly across">${ic('dH', 15)}</button><button data-o="dV" title="Space evenly down">${ic('dV', 15)}</button>`;
      const grouped = os.every(x => x.g && x.g === o.g);
      h += `<i class="psep"></i><button data-o="${grouped ? 'ungroup' : 'group'}" title="${grouped ? 'Ungroup (⇧⌘G)' : 'Group (⌘G)'}">${ic('group', 15)} ${grouped ? 'Ungroup' : 'Group'}</button>`;
    }
    if (!(one && o.lock)) h += `<i class="psep"></i><button data-o="front" title="Bring to front (⌘])">${ic('front', 15)}</button><button data-o="back" title="Send to back (⌘[)">${ic('back', 15)}</button><button data-o="dup" title="Duplicate (⌘D)">${ic('dup', 15)}</button><button data-o="lock" title="Lock">${ic('lock', 15)}</button><button data-o="del" title="Delete">${ic('trash', 15)}</button>`;
    obar.innerHTML = h; obar.classList.add('show');
    const u = union(os.map(aabb)), a = toRoot(u.x + u.w / 2, u.y), b = toRoot(u.x, u.y + u.h), R = root.getBoundingClientRect();
    const bw = obar.offsetWidth, bh = obar.offsetHeight, top = q('.ptop').offsetHeight;
    let x = clamp(a.x - bw / 2, 8, R.width - bw - 8), y = a.y - bh - 34 / 1;
    if (y < top + 6) y = b.y + 14;
    if (y > R.height - bh - 70) y = top + 8;
    obar.style.left = x + 'px'; obar.style.top = y + 'px';
  }
  function setObjs(fn, ids = [...sel]){
    for (const id of ids){ const o = O(id); if (!o) continue; fn(o); local({ t: 'o', o }); }
    commit(); drawSel();
  }
  obar.addEventListener('pointerdown', e => e.preventDefault());
  obar.addEventListener('click', e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    const a = b.dataset.o, os = selObjs(), o = os[0];
    const palette = (list, cur, set, title) => openPop(b, `<h6>${title}</h6><div class="psws">${list.map(c => `<button data-c="${esc(c)}" class="${c === cur ? 'on' : ''} ${c === 'transparent' ? 'psw none' : ''}" style="background:${esc(c)}"></button>`).join('')}</div>`, t => { const c = t.closest('[data-c]'); if (c){ set(c.dataset.c); return true; } });
    const menu = (items, cur, set, title) => openPop(b, (title ? `<h6>${title}</h6>` : '') + items.map(([v, l]) => `<button class="pi${String(v) === String(cur) ? ' act' : ''}" data-v="${v}">${l}</button>`).join(''), t => { const c = t.closest('[data-v]'); if (c){ set(c.dataset.v); return true; } });
    switch (a){
      case 'fill': palette(FILLS, o.fill, c => { style.fill = c; setObjs(x => x.fill = c); }, 'Fill'); break;
      case 'sfill': palette(STICKY, o.fill, c => { style.sticky = c; setObjs(x => x.fill = c); }, 'Sticky colour'); break;
      case 'stroke': openPop(b, `<h6>Border</h6><div class="psws">${FILLS.map(c => `<button data-c="${c}" class="${c === o.stroke ? 'on' : ''} ${c === 'transparent' ? 'psw none' : ''}" style="background:${c}"></button>`).join('')}</div><h6>Thickness</h6>${[0, 1, 2, 4, 8].map(v => `<button class="pi${(o.sw || 0) === v ? ' act' : ''}" data-w="${v}">${v ? v + ' px' : 'None'}</button>`).join('')}<button class="pi${o.dash ? ' act' : ''}" data-dash="1">Dashed</button>`,
        t => { const c = t.closest('[data-c]'), w = t.closest('[data-w]'), d = t.closest('[data-dash]');
          if (c){ setObjs(x => { x.stroke = c.dataset.c; if (!x.sw) x.sw = 2; }); return true; }
          if (w){ setObjs(x => { x.sw = +w.dataset.w; if (x.sw && (!x.stroke || x.stroke === 'transparent')) x.stroke = '#f4f4f5'; }); return true; }
          if (d){ setObjs(x => x.dash = !x.dash); return true; } }); break;
      case 'shape': menu(SHAPES.filter(s => !['line', 'arrow'].includes(s[0])), o.s, v => setObjs(x => { x.s = v; x.rad = v === 'round' ? 18 : 0; }), 'Shape'); break;
      case 'lcolor': palette(INK.concat(['#18181b']), o.stroke, c => setObjs(x => x.stroke = c), 'Colour'); break;
      case 'lw': menu([1, 2, 3, 4, 6, 8, 12, 16].map(v => [v, v + ' px']), o.sw, v => setObjs(x => x.sw = +v), 'Thickness'); break;
      case 'arrowhead': setObjs(x => x.k = x.k === 'arrow' ? 'line' : 'arrow'); showObar(); break;
      case 'dash': setObjs(x => x.dash = !x.dash); break;
      case 'tcolor': palette(INK.concat(['#18181b']), o.color, c => setObjs(x => x.color = c), 'Text colour'); break;
      case 'fs': menu([12, 14, 16, 18, 20, 24, 32, 40, 56, 72].map(v => [v, v + ' px']), o.fs || 16, v => setObjs(x => x.fs = +v), 'Text size'); break;
      case 'bold': setObjs(x => x.bold = !x.bold); break;
      case 'talign': { const n = { left: 'center', center: 'right', right: 'left' }[o.al || (o.k === 'shape' ? 'center' : 'left')]; setObjs(x => x.al = n); break; }
      case 'crop': cropping === o.id ? stopCrop() : startCrop(o.id); break;
      case 'rad': menu([0, 4, 8, 12, 20, 32, 999].map(v => [v, v === 999 ? 'Round' : v + ' px']), o.rad || 0, v => setObjs(x => x.rad = +v), 'Corners'); break;
      case 'inpage': objToBlock(o); break;
      case 'op': menu([100, 90, 75, 50, 25].map(v => [v, v + '%']), Math.round((o.op ?? 1) * 100), v => setObjs(x => x.op = +v / 100), 'Opacity'); break;
      case 'front': layer(1); break; case 'back': layer(-1); break;
      case 'dup': duplicate(); break; case 'del': delSel(); break;
      case 'lock': { const v = !o.lock; setObjs(x => x.lock = v); showObar(); break; }
      case 'group': { const g = uid(); setObjs(x => x.g = g); showObar(); break; }
      case 'ungroup': setObjs(x => delete x.g); showObar(); break;
      case 'aL': case 'aC': case 'aR': case 'aT': case 'aM': case 'aB': align(a); break;
      case 'dH': case 'dV': distribute(a === 'dH'); break;
    }
  });
  function layer(dir){
    const os = selObjs().sort((a, b) => (a.z || 0) - (b.z || 0));
    if (dir > 0){ let t = topZ(); os.forEach(o => { o.z = ++t; local({ t: 'o', o }); }); }
    else { const others = doc.objs.filter(o => !sel.has(o.id)).sort((a, b) => (a.z || 0) - (b.z || 0)); let zz = 1; os.forEach(o => { o.z = zz++; local({ t: 'o', o }); }); others.forEach(o => { if ((o.z || 0) !== zz){ o.z = zz; local({ t: 'o', o }); } zz++; }); }
    commit(); flash(dir > 0 ? 'Brought to front' : 'Sent to back');
  }
  function align(a){
    const os = selObjs(), u = union(os.map(aabb));
    os.forEach(o => { const r = aabb(o); let dx = 0, dy = 0;
      if (a === 'aL') dx = u.x - r.x; if (a === 'aR') dx = u.x + u.w - r.x - r.w; if (a === 'aC') dx = u.x + u.w / 2 - r.x - r.w / 2;
      if (a === 'aT') dy = u.y - r.y; if (a === 'aB') dy = u.y + u.h - r.y - r.h; if (a === 'aM') dy = u.y + u.h / 2 - r.y - r.h / 2;
      moveObj(o, dx, dy); local({ t: 'o', o }); });
    commit(); drawSel();
  }
  function distribute(hz){
    const os = selObjs().map(o => ({ o, r: aabb(o) })).sort((a, b) => hz ? a.r.x - b.r.x : a.r.y - b.r.y);
    const first = os[0].r, last = os[os.length - 1].r, total = os.reduce((s, x) => s + (hz ? x.r.w : x.r.h), 0);
    const gap = ((hz ? last.x + last.w - first.x : last.y + last.h - first.y) - total) / (os.length - 1);
    let p = hz ? first.x : first.y;
    os.forEach(({ o, r }) => { const d = p - (hz ? r.x : r.y); moveObj(o, hz ? d : 0, hz ? 0 : d); local({ t: 'o', o }); p += (hz ? r.w : r.h) + gap; });
    commit(); drawSel();
  }
  function moveObj(o, dx, dy){ if (o.k === 'line' || o.k === 'arrow'){ o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; } else { o.x += dx; o.y += dy; } }
  function duplicate(off = 24){
    const os = selObjs(); if (!os.length) return; const gmap = {}; let t = topZ(); const ids = [];
    os.sort((a, b) => (a.z || 0) - (b.z || 0)).forEach(o => { const n = clone(o); n.id = uid(); n.z = ++t; if (n.g) n.g = gmap[n.g] = gmap[n.g] || uid(); delete n.lock; moveObj(n, off, off); local({ t: 'o', o: n }); ids.push(n.id); });
    commit(); select(ids); return ids;
  }
  function delSel(){ const ids = [...sel]; stopEdit(true); ids.forEach(id => local({ t: 'od', id })); sel = new Set(); commit(); drawSel(); }

  /* ---------- snapping guides ---------- */
  function snapLines(skip){
    const pw = doc.meta.wide ? PAGEW.wide : PAGEW.normal, xs = [0, pw / 2, pw, 84, pw - 84], ys = [0];
    doc.objs.forEach(o => { if (skip.has(o.id)) return; const r = aabb(o); xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h); });
    return { xs, ys };
  }
  function snap(r, lines, which = 'all'){
    const T = 6 / z; let dx = 0, dy = 0, gx = null, gy = null, bx = T + 1, by = T + 1;
    const cx = which === 'all' ? [r.x, r.x + r.w / 2, r.x + r.w] : which.x || [], cy = which === 'all' ? [r.y, r.y + r.h / 2, r.y + r.h] : which.y || [];
    for (const v of cx) for (const l of lines.xs){ const d = l - v; if (Math.abs(d) < bx){ bx = Math.abs(d); dx = d; gx = l; } }
    for (const v of cy) for (const l of lines.ys){ const d = l - v; if (Math.abs(d) < by){ by = Math.abs(d); dy = d; gy = l; } }
    return { dx: gx == null ? 0 : dx, dy: gy == null ? 0 : dy, gx, gy };
  }
  function guides(g, r){
    let s = '';
    const c = '#f43f5e', w = 1 / z;
    if (g && g.gx != null) s += `<line x1="${g.gx}" y1="${r.y - 4000}" x2="${g.gx}" y2="${r.y + r.h + 4000}" stroke="${c}" stroke-width="${w}"/>`;
    if (g && g.gy != null) s += `<line x1="${r.x - 4000}" y1="${g.gy}" x2="${r.x + r.w + 4000}" y2="${g.gy}" stroke="${c}" stroke-width="${w}"/>`;
    ink.innerHTML = s;
  }

  /* ---------- pointer: select / move / resize / rotate / marquee ---------- */
  scroll.addEventListener('pointerdown', onDown);
  catchEl.addEventListener('pointerdown', onCreateDown);
  let lastDown = {}, lastEmpty = null;
  function onDown(e){
    if (e.target === catchEl || catchEl.contains(e.target)) return;
    if (e.button === 1 || tool === 'hand' || spaceDown){ startPan(e); return; }
    if (e.button !== 0) return;
    if (!e.target.closest('.ppop')) closePop();
    const t = e.target;
    const h = t.closest('.ph'); if (h){ e.preventDefault(); e.stopPropagation(); startHandle(e, h.dataset.h); return; }
    const oel = t.closest('.po');
    if (oel && objsEl.contains(oel)){
      const o = O(oel.dataset.id); if (!o) return;
      if (editing === o.id && t.closest('.pot')) return;
      if (o.k === 'video' && t.tagName === 'VIDEO' && sel.has(o.id) && e.offsetY > (t.clientHeight - 44)) return; // let the video controls work
      e.preventDefault();
      if (typing()) document.activeElement.blur();
      hideBubble(); selBlockSet(null);
      const now = Date.now();
      if (lastDown.id === o.id && now - lastDown.t < 400 && !o.lock){ lastDown = {}; if (onDbl(o)) return; }
      lastDown = { id: o.id, t: now };
      if (cropping === o.id){ startCropPan(e, o); return; }
      if (cropping) stopCrop();
      if (editing) stopEdit();
      const ids = groupOf(o);
      if (e.shiftKey){ const has = sel.has(o.id); ids.forEach(id => has ? sel.delete(id) : sel.add(id)); drawSel(); return; }
      if (!sel.has(o.id)) select(ids);
      if (selObjs().some(x => x.lock)) return;
      startMove(e);
      return;
    }
    if (t.closest('.psel')) return;
    if (t.closest('.ppage')){ if (sel.size) clearSel(); return; }
    // empty canvas → box-select; double-click → type right there
    e.preventDefault(); if (typing()) document.activeElement.blur(); hideBubble(); selBlockSet(null);
    const now = Date.now(), pt = W(e);
    if (lastEmpty && now - lastEmpty.t < 420 && Math.hypot(pt.x - lastEmpty.x, pt.y - lastEmpty.y) * z < 8){
      lastEmpty = null; const o = addObj({ k: 'text', x: pt.x - 4, y: pt.y - 14, w: 260, h: 36, html: '', color: '#f4f4f5', fs: 18 }); commit(); select([o.id]); editText(o.id); return;
    }
    lastEmpty = { t: now, x: pt.x, y: pt.y };
    startMarquee(e);
  }
  function track(e, move, up){
    const id = e.pointerId; try { scroll.setPointerCapture(id); } catch (x) {}
    const mv = ev => { if (ev.pointerId === id) move(ev); };
    const fin = ev => { if (ev.pointerId !== id) return; removeEventListener('pointermove', mv); removeEventListener('pointerup', fin); removeEventListener('pointercancel', fin); try { scroll.releasePointerCapture(id); } catch (x) {} up(ev); };
    addEventListener('pointermove', mv); addEventListener('pointerup', fin); addEventListener('pointercancel', fin);
  }
  function startMove(e){
    let ids = [...sel], start = W(e), moved = false, dup = e.altKey;
    let orig = new Map(ids.map(id => [id, clone(O(id))]));
    const lines = snapLines(new Set(ids));
    drag = { kind: 'move' };
    track(e, ev => {
      const p = W(ev); let dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * z < 3) return;
      if (!moved){ moved = true; hideObar(); if (dup){ ids = duplicate(0); orig = new Map(ids.map(id => [id, clone(O(id))])); } }
      if (ev.shiftKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const u0 = union([...orig.values()].map(aabb)), g = ev.metaKey ? null : snap({ x: u0.x + dx, y: u0.y + dy, w: u0.w, h: u0.h }, lines);
      if (g){ dx += g.dx; dy += g.dy; }
      for (const id of ids){ const o = O(id), s = orig.get(id); if (!o) continue;
        if (o.k === 'line' || o.k === 'arrow'){ o.x1 = s.x1 + dx; o.y1 = s.y1 + dy; o.x2 = s.x2 + dx; o.y2 = s.y2 + dy; } else { o.x = s.x + dx; o.y = s.y + dy; }
        renderObj(o); }
      guides(g, { x: u0.x + dx, y: u0.y + dy, w: u0.w, h: u0.h });
      sendSoon('move', () => ({ t: 'objs', os: ids.map(O).filter(Boolean).map(clone) }));
      drawSel(); sendPointer(ev);
    }, () => {
      drag = null; ink.innerHTML = '';
      if (moved){ ids.forEach(id => { const o = O(id); if (o) send({ t: 'o', o }); }); changed(); commit(); relayout(); }
      drawSel();
    });
  }
  function startHandle(e, hd){
    const os = selObjs(); if (!os.length) return;
    const start = W(e), single = os.length === 1 ? os[0] : null, orig = new Map(os.map(o => [o.id, clone(o)]));
    const lines = snapLines(new Set(sel));
    drag = { kind: 'resize' }; hideObar();
    let label = '';
    track(e, ev => {
      const p = W(ev);
      if (single && (single.k === 'line' || single.k === 'arrow')){
        const o = single, s = orig.get(o.id); let x = p.x, y = p.y;
        const ax = hd === 'p1' ? s.x2 : s.x1, ay = hd === 'p1' ? s.y2 : s.y1;
        if (ev.shiftKey){ const a = Math.round(Math.atan2(y - ay, x - ax) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(x - ax, y - ay); x = ax + Math.cos(a) * d; y = ay + Math.sin(a) * d; }
        else { const g = snap({ x, y, w: 0, h: 0 }, lines, { x: [x], y: [y] }); x += g.dx; y += g.dy; guides(g, { x, y, w: 0, h: 0 }); }
        if (hd === 'p1'){ o.x1 = x; o.y1 = y; } else { o.x2 = x; o.y2 = y; }
        label = Math.round(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)) + ' px';
        renderObj(o); sendSoon('rs', () => ({ t: 'o', o: clone(o) })); drawSel(label); return;
      }
      if (hd === 'rot' && single){
        const s = orig.get(single.id), cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90; if (ev.shiftKey) a = Math.round(a / 15) * 15; else if (Math.abs(((a % 90) + 90) % 90) < 3 || Math.abs(((a % 90) + 90) % 90) > 87) a = Math.round(a / 90) * 90;
        a = ((a % 360) + 360) % 360; single.r = a > 180 ? a - 360 : a; if (Math.abs(single.r) < 0.01) single.r = 0;
        renderObj(single); label = Math.round(single.r) + '°'; sendSoon('rs', () => ({ t: 'o', o: clone(single) })); drawSel(label); return;
      }
      const dxs = /e/.test(hd) ? 1 : /w/.test(hd) ? -1 : 0, dys = /s/.test(hd) ? 1 : /n/.test(hd) ? -1 : 0;
      if (single){
        const s = orig.get(single.id), o = single, rad = (s.r || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        const ax = cx + (-dxs * s.w / 2) * cos - (-dys * s.h / 2) * sin, ay = cy + (-dxs * s.w / 2) * sin + (-dys * s.h / 2) * cos;
        let px = p.x, py = p.y;
        if (!s.r && !ev.metaKey){ const g = snap({ x: px, y: py, w: 0, h: 0 }, lines, { x: dxs ? [px] : [], y: dys ? [py] : [] }); px += g.dx; py += g.dy; guides(g, { x: px, y: py, w: 0, h: 0 }); }
        const lx = (px - ax) * cos + (py - ay) * sin, ly = -(px - ax) * sin + (py - ay) * cos;
        let w = dxs ? Math.max(8, dxs * lx) : s.w, h = dys ? Math.max(8, dys * ly) : s.h;
        const keep = (o.k === 'image' || o.k === 'video') ? !ev.shiftKey && cropping !== o.id : ev.shiftKey;
        if (keep && dxs && dys){ const k = Math.max(w / s.w, h / s.h); w = s.w * k; h = s.h * k; }
        else if (keep && dxs){ h = s.h * w / s.w; } else if (keep && dys){ w = s.w * h / s.h; }
        if (o.k === 'text') h = s.h;
        o.w = w; o.h = h;
        const ncx = ax + (dxs * w / 2) * cos - (dys * h / 2) * sin, ncy = ay + (dxs * w / 2) * sin + (dys * h / 2) * cos;
        o.x = ncx - w / 2; o.y = ncy - h / 2;
        if (o.k === 'image'){
          if (cropping === o.id){ // crop: the frame moves, the picture stays put
            const ix = s.ix + (s.x - o.x), iy = s.iy + (s.y - o.y);
            const L0 = s.x + s.ix, T0 = s.y + s.iy, R0 = L0 + s.iw, B0 = T0 + s.ih;
            const nx = clamp(o.x, L0, R0 - 8), ny = clamp(o.y, T0, B0 - 8);
            o.w = Math.min(o.x + o.w, R0) - nx; o.h = Math.min(o.y + o.h, B0) - ny; o.x = nx; o.y = ny;
            o.ix = L0 - o.x; o.iy = T0 - o.y; void ix; void iy;
          } else { const kx = o.w / s.w, ky = o.h / s.h; o.ix = s.ix * kx; o.iy = s.iy * ky; o.iw = s.iw * kx; o.ih = s.ih * ky; }
        }
        if (o.k === 'draw'){ /* points scale with the box via the viewBox */ }
        label = `${Math.round(o.w)} × ${Math.round(o.h)}`;
        renderObj(o); sendSoon('rs', () => ({ t: 'o', o: clone(o) })); drawSel(label); return;
      }
      // several objects: scale the group from the opposite corner
      const u = union([...orig.values()].map(aabb)), axx = dxs > 0 ? u.x : u.x + u.w, ayy = dys > 0 ? u.y : u.y + u.h;
      let kx = Math.max(0.05, dxs * (p.x - axx) / u.w), ky = Math.max(0.05, dys * (p.y - ayy) / u.h);
      if (!ev.shiftKey){ const k = Math.max(kx, ky); kx = ky = k; }
      for (const o of os){ const s = orig.get(o.id);
        if (o.k === 'line' || o.k === 'arrow'){ o.x1 = axx + (s.x1 - axx) * kx; o.x2 = axx + (s.x2 - axx) * kx; o.y1 = ayy + (s.y1 - ayy) * ky; o.y2 = ayy + (s.y2 - ayy) * ky; }
        else { o.x = axx + (s.x - axx) * kx; o.y = ayy + (s.y - ayy) * ky; o.w = s.w * kx; o.h = s.h * ky; if (o.k === 'image'){ o.ix = s.ix * kx; o.iy = s.iy * ky; o.iw = s.iw * kx; o.ih = s.ih * ky; } if (s.fs && o.k !== 'shape') o.fs = Math.max(8, Math.round(s.fs * Math.min(kx, ky))); }
        renderObj(o); }
      sendSoon('rs', () => ({ t: 'objs', os: os.map(clone) }));
      const nu = union(os.map(aabb)); label = `${Math.round(nu.w)} × ${Math.round(nu.h)}`; drawSel(label);
    }, () => { drag = null; ink.innerHTML = ''; os.forEach(o => send({ t: 'o', o })); changed(); commit(); relayout(); drawSel(); });
  }
  function startMarquee(e){
    const start = W(e), keep = e.shiftKey ? new Set(sel) : new Set(); let moved = false;
    drag = { kind: 'marquee' };
    track(e, ev => {
      const p = W(ev); if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * z < 4) return; moved = true;
      const r = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      ink.innerHTML = `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(79,134,232,.1)" stroke="#4f86e8" stroke-width="${1 / z}"/>`;
      const hit = new Set(keep);
      doc.objs.forEach(o => { const b = aabb(o); if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) groupOf(o).forEach(id => hit.add(id)); });
      sel = hit; drawSel();
    }, () => { drag = null; ink.innerHTML = ''; if (!moved) clearSel(); else drawSel(); });
  }
  function startPan(e){
    e.preventDefault(); const sx = e.clientX, sy = e.clientY, l = scroll.scrollLeft, t = scroll.scrollTop;
    scroll.classList.add('panning');
    track(e, ev => { scroll.scrollLeft = l - (ev.clientX - sx); scroll.scrollTop = t - (ev.clientY - sy); }, () => scroll.classList.remove('panning'));
  }
  function startCropPan(e, o){
    const start = W(e), s = clone(o);
    track(e, ev => { const p = W(ev); o.ix = clamp(s.ix + p.x - start.x, o.w - o.iw, 0); o.iy = clamp(s.iy + p.y - start.y, o.h - o.ih, 0); renderObj(o); },
      () => { local({ t: 'o', o }); commit(); });
  }
  function startCrop(id){ const o = O(id); if (!o || o.k !== 'image') return; stopEdit(); cropping = id; o.ix = o.ix || 0; o.iy = o.iy || 0; o.iw = o.iw || o.w; o.ih = o.ih || o.h; renderObj(o); select([id]); flash('Drag the picture to reposition · drag the handles to crop · Enter when done'); }
  function stopCrop(){ if (!cropping) return; const id = cropping; cropping = null; const o = O(id); if (o){ renderObj(o); local({ t: 'o', o }); commit(); } drawSel(); }

  /* ---------- creating things with the dock tools ---------- */
  function setTool(t, opt){
    if (opt && t === 'shape') shapeKind = opt; if (opt && t === 'pen') penKind = opt;
    tool = t; if (t !== 'select') { clearSel(); hideBubble(); }
    $$('[data-tool]', dock).forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    dock.querySelector('[data-tool=shape]').innerHTML = ic(shapeKind, 18);
    dock.querySelector('[data-tool=pen]').innerHTML = ic(penKind === 'hl' ? 'marker' : penKind === 'eraser' ? 'eraser' : 'pen', 18);
    const creating = !['select', 'hand'].includes(t);
    catchEl.classList.toggle('on', creating); catchEl.className = 'pcatch' + (creating ? ' on' : '') + (t === 'pen' ? ' ' + (penKind === 'eraser' ? 'eraser' : 'pen') : '');
    scroll.classList.toggle('pan', t === 'hand');
  }
  function addObj(o){ o.id = o.id || uid(); o.z = topZ() + 1; local({ t: 'o', o }); return o; }
  function onCreateDown(e){
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); closePop(); if (typing()) document.activeElement.blur();
    const p = W(e);
    if (tool === 'text'){ const o = addObj({ k: 'text', x: p.x, y: p.y - 14, w: 260, h: 36, html: '', color: '#f4f4f5', fs: 20 }); commit(); setTool('select'); select([o.id]); editText(o.id); return; }
    if (tool === 'sticky'){ const o = addObj({ k: 'sticky', x: p.x - 110, y: p.y - 110, w: 220, h: 220, html: '', fill: style.sticky, fs: 17 }); commit(); setTool('select'); select([o.id]); editText(o.id); return; }
    if (tool === 'pen'){ penKind === 'eraser' ? startErase(e) : startDraw(e, p); return; }
    if (tool === 'shape'){
      const ln = shapeKind === 'line' || shapeKind === 'arrow';
      const o = ln ? { k: shapeKind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: style.line, sw: 2 }
        : { k: 'shape', s: shapeKind, x: p.x, y: p.y, w: 1, h: 1, fill: style.fill, stroke: 'transparent', sw: 0, rad: shapeKind === 'round' ? 18 : 0, html: '', color: '#fff', fs: 16 };
      o.id = uid(); o.z = topZ() + 1; doc.objs.push(o); renderObj(o);
      let moved = false; drag = { kind: 'create' };
      track(e, ev => {
        const q2 = W(ev); moved = moved || Math.hypot(q2.x - p.x, q2.y - p.y) * z > 3; if (!moved) return;
        if (ln){ let x = q2.x, y = q2.y; if (ev.shiftKey){ const a = Math.round(Math.atan2(y - p.y, x - p.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(x - p.x, y - p.y); x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; } o.x2 = x; o.y2 = y; }
        else { let w = q2.x - p.x, h = q2.y - p.y; if (ev.shiftKey){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; } o.x = Math.min(p.x, p.x + w); o.y = Math.min(p.y, p.y + h); o.w = Math.max(2, Math.abs(w)); o.h = Math.max(2, Math.abs(h)); }
        renderObj(o); drawSel(ln ? '' : `${Math.round(o.w)} × ${Math.round(o.h)}`); sel = new Set([o.id]);
      }, () => {
        drag = null;
        if (!moved){ if (ln){ o.x1 = p.x - 80; o.x2 = p.x + 80; } else { o.w = shapeKind === 'ellipse' || shapeKind === 'star' || shapeKind === 'diamond' ? 140 : 180; o.h = shapeKind === 'tri' || shapeKind === 'star' || shapeKind === 'diamond' || shapeKind === 'ellipse' ? 140 : 110; o.x = p.x - o.w / 2; o.y = p.y - o.h / 2; } renderObj(o); }
        send({ t: 'o', o }); changed(); commit(); setTool('select'); select([o.id]); relayout();
      });
    }
  }
  function startDraw(e, p0){
    const hl = penKind === 'hl', pts = [[p0.x, p0.y]], sw0 = hl ? 16 : style.penW, col = hl ? style.hl : style.pen;
    drag = { kind: 'draw' };
    const path = () => { ink.innerHTML = `<path d="${smooth(pts)}" fill="none" style="stroke:${hl ? col : inkOf(col)}" stroke-width="${sw0}" stroke-linecap="${hl ? 'butt' : 'round'}" stroke-linejoin="round" opacity="${hl ? 0.45 : 1}"/>`; };
    path();
    track(e, ev => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const c of evs){ const q2 = W(c), l = pts[pts.length - 1]; if (Math.hypot(q2.x - l[0], q2.y - l[1]) * z > 1.5) pts.push([q2.x, q2.y]); }
      path();
    }, () => {
      drag = null; ink.innerHTML = '';
      // a click without dragging: the pen leaves a dot, but the highlighter leaves nothing
      // (its flat-ended stroke turned a click into a stray diagonal "slash")
      if (pts.length < 2 && hl) return;
      if (pts.length < 2) pts.push([p0.x + 0.5, p0.y + 0.5]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = sw0 / 2 + 1;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad, w = Math.max(...xs) - x + pad, h = Math.max(...ys) - y + pad;
      addObj({ k: 'draw', x, y, w, h, vw: w, vh: h, pts: pts.map(p => [+(p[0] - x).toFixed(1), +(p[1] - y).toFixed(1)]), stroke: col, sw: sw0, hl, op: hl ? 0.45 : 1 });
      commit(); relayout();
    });
  }
  function startErase(e){
    drag = { kind: 'erase' }; let any = false;
    const hitAt = p => {
      for (const o of [...doc.objs]){
        if (o.k !== 'draw' || o.lock) continue;
        const sx = o.w / (o.vw || o.w), sy = o.h / (o.vh || o.h), tol = (o.sw || 3) / 2 + 7 / z;
        if (p.x < o.x - tol || p.x > o.x + o.w + tol || p.y < o.y - tol || p.y > o.y + o.h + tol) continue;
        const P2 = o.pts.map(q2 => [o.x + q2[0] * sx, o.y + q2[1] * sy]);
        for (let i = 0; i < P2.length; i++){ const a = P2[i], b = P2[i + 1] || a; if (segDist(p, a, b) < tol){ local({ t: 'od', id: o.id }); any = true; break; } }
      }
    };
    hitAt(W(e));
    track(e, ev => hitAt(W(ev)), () => { drag = null; if (any) commit(); });
  }
  function segDist(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy); }

  /* ---------- wheel: pinch / ⌘-scroll zooms ---------- */
  scroll.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey){ e.preventDefault(); setZoom(z * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)), e.clientX, e.clientY); } }, { passive: false });
  scroll.addEventListener('scroll', () => { hideBubble(); if (sel.size && !drag) showObar(); drawPeers(); });

  /* ---------- pointer position for collaborators ---------- */
  let ptT = 0;
  function sendPointer(e){ const now = Date.now(); if (now - ptT < 45) return; ptT = now; const p = W(e); L.cur.forEach(f => f({ wx: Math.round(p.x), wy: Math.round(p.y) })); }
  scroll.addEventListener('pointermove', sendPointer);
  scroll.addEventListener('pointerleave', () => L.cur.forEach(f => f({ wx: null })));

  /* ---------- typing in the page ---------- */
  function syncBlock(pbc){
    const pb = pbc.closest('.pb'), b = pb && B(pb.dataset.id); if (!b) return;
    if (!pbc.textContent && pbc.innerHTML && !/<br[^>]*>.*<br/i.test(pbc.innerHTML)) pbc.innerHTML = '';
    const nw = pbc.innerHTML, old = b.h || ''; if (nw === old) return;
    let i = 0; while (i < old.length && i < nw.length && old[i] === nw[i]) i++;
    let j = 0; while (j < old.length - i && j < nw.length - i && old[old.length - 1 - j] === nw[nw.length - 1 - j]) j++;
    local({ t: 'bx', id: b.id, pos: i, del: old.length - i - j, ins: nw.slice(i, nw.length - j) }, true);
  }
  const SHORT = [['### ', 'h3'], ['## ', 'h2'], ['# ', 'h1'], ['- ', 'ul'], ['* ', 'ul'], ['• ', 'ul'], ['1. ', 'ol'], ['1) ', 'ol'], ['[] ', 'todo'], ['[ ] ', 'todo'], ['[x] ', 'todo'], ['> ', 'quote'], ['" ', 'quote'], ['```', 'code']];
  blocksEl.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('pbc')){
      syncBlock(t); relayout();
      const b = B(t.closest('.pb').dataset.id), text = t.textContent.replace(/ /g, ' '), off = caretOffset(t);
      if (b.t === 'p' && e.inputType === 'insertText'){
        for (const [pre, ty] of SHORT) if (text.startsWith(pre) && off === pre.length){
          const r = rangeAt(t, 0, pre.length); r.deleteContents(); syncBlock(t);
          setType(b, ty, { c: pre === '[x] ' }); return;
        }
        if (text === '---' && off === 3){ t.innerHTML = ''; syncBlock(t); const nb = { id: uid(), t: 'p', h: '' }; setType(b, 'hr'); local({ t: 'b', b: nb, after: b.id }); focusBlock(nb.id); return; }
      }
      if (e.inputType === 'insertText' && /[*_~]/.test(e.data || '') && b.t !== 'code'){
        const before = text.slice(0, off), m = /(\*\*|~~)([^*~\s][^*~]*?)\1$/.exec(before) || /(?:^|[^*\w])(\*|_)([^*_\s][^*_]*?)\1$/.exec(before);
        if (m){
          const mark = m[1], inner = m[2], start = off - inner.length - mark.length * 2;
          setCaret(t, start, off); document.execCommand('insertText', false, inner);
          setCaret(t, start, start + inner.length);
          const cmd = mark === '~~' ? 'strikeThrough' : mark === '**' ? 'bold' : 'italic';
          document.execCommand(cmd); setCaret(t, start + inner.length);
          try { if (document.queryCommandState(cmd)) document.execCommand(cmd); } catch (x) {}
          syncBlock(t); return;
        }
      }
      if (e.data === '/' && (off === 1 || /\s/.test(text[off - 2] || ''))) openSlash(b.id, off - 1);
      else if (slash && slash.id === b.id) updateSlash(t, text, off);
      return;
    }
    if (t.tagName === 'TD'){ const b = B(t.closest('.pb').dataset.id); b.rows[+t.dataset.r][+t.dataset.c] = t.innerHTML; changed(); sendSoon('tb' + b.id, () => ({ t: 'b', b: clone(B(b.id)) }), 120); relayout(); return; }
    if (t.tagName === 'FIGCAPTION'){ const b = B(t.closest('.pb').dataset.id); b.cap = t.textContent; changed(); sendSoon('tb' + b.id, () => ({ t: 'b', b: clone(B(b.id)) }), 150); }
  });
  function setType(b, t, extra = {}){
    const cs = saveCaret();
    const nb = { ...clone(b), t, ...extra };
    if (t === 'code') nb.h = esc(htmlText(b.h)).replace(/\n/g, '<br>');
    if (t === 'todo' && nb.c == null) nb.c = false;
    if (t !== 'todo') delete nb.c;
    if (!['ul', 'ol', 'todo'].includes(t)) delete nb.ind;
    if (t === 'callout' && !nb.e) nb.e = '💡';
    if (t === 'hr'){ nb.h = ''; }
    local({ t: 'b', b: nb });
    if (cs && cs.id === b.id && TEXTY.has(t)) restoreCaret(cs); else if (TEXTY.has(t)) focusBlock(b.id, 'end');
    updateTop();
  }
  function toggleType(t){ const b = curBlock(); if (!b || !TEXTY.has(b.t)) return insertAfterCurrent({ id: uid(), t, h: '' }); setType(b, b.t === t ? 'p' : t); }
  function insertAfterCurrent(nb, focus = true){
    const cb = curBlock() || doc.blocks[doc.blocks.length - 1];
    if (cb && cb.t === 'p' && !htmlText(cb.h).trim() && nb.t !== 'p'){ nb.id = cb.id; local({ t: 'b', b: nb }); }
    else local({ t: 'b', b: nb, after: cb ? cb.id : undefined });
    if (focus) focusBlock(nb.id);
    return nb;
  }
  blocksEl.addEventListener('keydown', e => {
    if (slash && slashKey(e)) return;
    const t = e.target, pb = t.closest('.pb'); if (!pb) return;
    const b = B(pb.dataset.id); if (!b) return;
    if (t.tagName === 'TD') return cellKey(e, t, b);
    if (t.tagName === 'FIGCAPTION'){ if (e.key === 'Enter'){ e.preventDefault(); const nb = { id: uid(), t: 'p', h: '' }; local({ t: 'b', b: nb, after: b.id }); focusBlock(nb.id); } return; }
    if (!t.classList.contains('pbc')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !e.isComposing){
      if (b.t === 'code' && !mod){ e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      if (e.shiftKey && b.t !== 'code'){ return; }
      e.preventDefault();
      if (mod && b.t === 'todo'){ local({ t: 'b', b: { ...clone(b), c: !b.c } }); return; }
      splitBlock(b, t); return;
    }
    if (e.key === 'Backspace' && !mod && caretAtStart(t)){
      if (b.ind){ e.preventDefault(); local({ t: 'b', b: { ...clone(b), ind: b.ind - 1 } }); restoreCaretAt(b.id, 0); return; }
      if (b.t !== 'p'){ e.preventDefault(); setType(b, 'p'); focusBlock(b.id, 0); return; }
      const i = bIndex(b.id), prev = doc.blocks[i - 1]; if (!prev) return;
      e.preventDefault();
      if (TEXTY.has(prev.t)){ const off = htmlText(prev.h).length; local({ t: 'b', b: { ...clone(prev), h: (prev.t === 'code' ? prev.h : (prev.h || '')) + (b.h || '') } }); local({ t: 'bd', id: b.id }); focusBlock(prev.id, off); }
      else { local({ t: 'bd', id: prev.id }); if (!htmlText(b.h)) {} focusBlock(b.id, 0); }
      commit(); return;
    }
    if (e.key === 'Delete' && caretAtEnd(t)){
      const nx = doc.blocks[bIndex(b.id) + 1]; if (nx && TEXTY.has(nx.t)){ e.preventDefault(); const off = t.textContent.length; local({ t: 'b', b: { ...clone(b), h: (b.h || '') + (nx.h || '') } }); local({ t: 'bd', id: nx.id }); focusBlock(b.id, off); }
      return;
    }
    if (e.key === 'Tab'){
      e.preventDefault();
      if (b.t === 'code'){ document.execCommand('insertText', false, '  '); return; }
      if (['ul', 'ol', 'todo', 'p'].includes(b.t)){
        const prev = doc.blocks[bIndex(b.id) - 1];
        if (b.t === 'p' && !e.shiftKey){ if (prev && ['ul', 'ol', 'todo'].includes(prev.t)) setType(b, prev.t, { ind: Math.min(3, (prev.ind || 0) + 1) }); return; }
        const max = prev && ['ul', 'ol', 'todo'].includes(prev.t) ? (prev.ind || 0) + 1 : 0;
        const ind = clamp((b.ind || 0) + (e.shiftKey ? -1 : 1), 0, Math.min(3, max)); if (ind !== (b.ind || 0)){ const off = caretOffset(t); local({ t: 'b', b: { ...clone(b), ind } }); restoreCaretAt(b.id, off); }
      }
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && !e.shiftKey && !mod){
      const atTop = e.key === 'ArrowLeft' ? caretAtStart(t) : onEdgeLine(t, -1);
      if (atTop){ const prev = prevTexty(b.id, -1); if (prev){ e.preventDefault(); focusBlock(prev, 'end'); } else if (e.key === 'ArrowUp'){ e.preventDefault(); setCaret(titleEl, titleEl.textContent.length); } }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && !e.shiftKey && !mod){
      const atBot = e.key === 'ArrowRight' ? caretAtEnd(t) : onEdgeLine(t, 1);
      if (atBot){ const nx = prevTexty(b.id, 1); if (nx){ e.preventDefault(); focusBlock(nx, 0); } }
    }
  });
  function restoreCaretAt(id, off){ const el = bEl(id)?.querySelector('.pbc'); if (el) setCaret(el, Math.min(off, el.textContent.length)); }
  function prevTexty(id, dir){ let i = bIndex(id) + dir; while (doc.blocks[i]){ const b = doc.blocks[i]; if (TEXTY.has(b.t) || b.t === 'table' || b.t === 'img') return b.id; i += dir; } return null; }
  function onEdgeLine(el, dir){
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return false;
    if (!el.textContent) return true;
    const r = s.getRangeAt(0).cloneRange(); let rect = r.getClientRects()[0];
    if (!rect){ const sp = document.createElement('span'); sp.textContent = '​'; r.insertNode(sp); rect = sp.getBoundingClientRect(); sp.remove(); el.normalize(); }
    const er = el.getBoundingClientRect(), lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    return dir < 0 ? rect.top - er.top < lh * 0.8 : er.bottom - rect.bottom < lh * 0.8;
  }
  function splitBlock(b, pbc){
    const off = caretOffset(pbc), txt = pbc.textContent;
    if (off === 0 && txt.length && getSelection().isCollapsed){
      const i = bIndex(b.id), nb = { id: uid(), t: ['ul', 'ol', 'todo'].includes(b.t) ? b.t : 'p', h: '', ind: b.ind };
      if (!nb.ind) delete nb.ind;
      local({ t: 'b', b: nb, after: i > 0 ? doc.blocks[i - 1].id : null }); focusBlock(b.id, 0); commit(); return;
    }
    if (!txt.trim() && ['ul', 'ol', 'todo', 'quote', 'callout'].includes(b.t)){ if (b.ind) { local({ t: 'b', b: { ...clone(b), ind: b.ind - 1 } }); restoreCaretAt(b.id, 0); } else setType(b, 'p'); return; }
    const s = getSelection(), r = s.getRangeAt(0); r.deleteContents();
    const tail = document.createRange(); tail.selectNodeContents(pbc); tail.setStart(r.endContainer, r.endOffset);
    const tmp = document.createElement('div'); tmp.appendChild(tail.extractContents());
    const th = tmp.textContent ? tmp.innerHTML : '';
    syncBlock(pbc);
    const keep = ['ul', 'ol', 'todo'].includes(b.t);
    const nb = { id: uid(), t: keep ? b.t : 'p', h: th }; if (keep && b.ind) nb.ind = b.ind; if (b.t === 'todo') nb.c = false;
    local({ t: 'b', b: nb, after: b.id }); focusBlock(nb.id, 0); commit();
  }
  function cellKey(e, td, b){
    const r = +td.dataset.r, c = +td.dataset.c, rows = b.rows.length, cols = b.rows[0].length;
    const go = (rr, cc) => { const el = bEl(b.id)?.querySelector(`td[data-r="${rr}"][data-c="${cc}"]`); if (el) setCaret(el, e.key === 'Tab' && !e.shiftKey ? 0 : el.textContent.length); };
    if (e.key === 'Tab'){ e.preventDefault(); let n = r * cols + c + (e.shiftKey ? -1 : 1); if (n >= rows * cols){ addRow(b); n = rows * cols; } if (n >= 0) go(Math.floor(n / cols), n % cols); }
    else if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); if (r + 1 >= rows) addRow(b); go(r + 1, c); }
    else if (e.key === 'ArrowUp' && onEdgeLine(td, -1) && r > 0){ e.preventDefault(); go(r - 1, c); }
    else if (e.key === 'ArrowDown' && onEdgeLine(td, 1) && r + 1 < rows){ e.preventDefault(); go(r + 1, c); }
  }
  function addRow(b){ const nb = clone(B(b.id)); nb.rows.push(nb.rows[0].map(() => '')); local({ t: 'b', b: nb }); commit(); }
  function addCol(b){ const nb = clone(B(b.id)); nb.rows.forEach(r => r.push('')); local({ t: 'b', b: nb }); commit(); }
  blocksEl.addEventListener('focusin', e => {
    const pb = e.target.closest('.pb'); $$('.pb.foc', blocksEl).forEach(x => x !== pb && x.classList.remove('foc')); if (pb) pb.classList.add('foc');
    if (e.target.tagName === 'TD') lastCell = { id: pb.dataset.id, r: +e.target.dataset.r, c: +e.target.dataset.c };
    if (sel.size) clearSel(); selBlockSet(null); updateTop();
  });
  blocksEl.addEventListener('focusout', e => { const pb = e.target.closest('.pb'); setTimeout(() => { if (pb && !pb.contains(document.activeElement)) pb.classList.remove('foc'); }, 0); if (slash) setTimeout(() => { if (!blocksEl.contains(document.activeElement)) closeSlash(); }, 120); });

  // clicks on bits of blocks
  blocksEl.addEventListener('click', e => {
    const t = e.target, pb = t.closest('.pb'); if (!pb) return; const b = B(pb.dataset.id); if (!b) return;
    if (t.closest('.pchk')){ local({ t: 'b', b: { ...clone(b), c: !b.c } }); commit(); return; }
    if (t.closest('.pemo')){ openPop(t.closest('.pemo'), `<div class="pgrid" style="grid-template-columns:repeat(4,1fr)">${CALLOUT_EMOJI.map(x => `<button data-e="${x}">${x}</button>`).join('')}</div>`, el => { const x = el.closest('[data-e]'); if (x){ local({ t: 'b', b: { ...clone(B(b.id)), e: x.dataset.e } }); commit(); return true; } }); return; }
    if (t.closest('.pplus')){ const nb = { id: uid(), t: 'p', h: '/' }; local({ t: 'b', b: nb, after: b.id }); focusBlock(nb.id, 1); openSlash(nb.id, 0); return; }
    if (t.closest('.padc')){ addCol(b); return; }
    if (t.closest('.padr')){ addRow(b); return; }
    if (t.closest('a') && (e.metaKey || e.ctrlKey || !t.closest('[contenteditable=true]'))){ e.preventDefault(); window.open(t.closest('a').href, '_blank'); return; }
    if (b.t === 'hr' || (b.t === 'img' && t.closest('img,video') && !t.closest('figcaption'))){ selBlockSet(b.id); if (typing()) document.activeElement.blur(); root.focus({ preventScroll: true }); }
  });
  function selBlockSet(id){ if (selBlock === id){ showImgBar(); return; } const old = selBlock; selBlock = id; [old, id].forEach(x => { const el = x && bEl(x); if (el){ el.classList.toggle('sel', x === id); el.querySelector('.pfig')?.classList.toggle('sel', x === id); } }); showImgBar(); }
  blocksEl.addEventListener('pointerdown', e => {
    const g = e.target.closest('.pgrip'), rs = e.target.closest('.prs'), fig = e.target.closest('.pfig');
    if (fig && !rs && !e.target.closest('figcaption') && e.button === 0 && e.target.tagName === 'IMG'){ e.preventDefault(); startImgDrag(e, fig.closest('.pb')); return; }
    if (g){ e.preventDefault(); startBlockDrag(e, g.closest('.pb')); }
    else if (rs){ e.preventDefault(); e.stopPropagation(); startFigResize(e, rs); }
  });
  function startBlockDrag(e, el){
    const id = el.dataset.id; let moved = false, target = null, after = false;
    track(e, ev => {
      if (!moved && Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true; el.classList.add('dragging');
      $$('.drop-before,.drop-after', blocksEl).forEach(x => x.classList.remove('drop-before', 'drop-after'));
      const els = [...blocksEl.children]; target = null;
      for (const x of els){ const r = x.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2){ target = x; after = false; break; } }
      if (!target){ target = els[els.length - 1]; after = true; }
      if (target && target !== el) target.classList.add(after ? 'drop-after' : 'drop-before');
    }, () => {
      el.classList.remove('dragging'); $$('.drop-before,.drop-after', blocksEl).forEach(x => x.classList.remove('drop-before', 'drop-after'));
      if (!moved){ blockMenu(el); return; }
      if (!target || target === el) return;
      const ids = doc.blocks.map(b => b.id).filter(x => x !== id), at = ids.indexOf(target.dataset.id) + (after ? 1 : 0);
      ids.splice(at, 0, id); local({ t: 'bo', ids }); commit();
    });
  }
  function startFigResize(e, h){
    const pb = h.closest('.pb'), b = B(pb.dataset.id), fig = pb.querySelector('.pfig'), inner = blocksEl.getBoundingClientRect().width / 1;
    const fr = fig.getBoundingClientRect(), cx = fr.left + fr.width / 2, left = h.classList.contains('l');
    const pr = pb.getBoundingClientRect();
    track(e, ev => {
      let d = Math.abs(ev.clientX - cx) * 2;
      if (b.fl === 'left') d = ev.clientX - pr.left; else if (b.fl === 'right') d = pr.right - ev.clientX;
      const w = clamp(Math.round(d / inner * 100), 15, b.fl ? 75 : 100); b.w = w;
      if (b.fl) pb.style.width = w + '%'; else fig.style.width = w + '%'; relayout(); showImgBar(); },
      () => { local({ t: 'b', b: clone(b) }); commit(); void left; });
  }
  function blockMenu(el){
    const b = B(el.dataset.id); if (!b) return;
    const turn = TEXTY.has(b.t) ? `<h6>Turn into</h6>${Object.entries(LABEL).map(([k, l]) => `<button class="pi${b.t === k ? ' act' : ''}" data-turn="${k}">${l}</button>`).join('')}` : '';
    const tbl = b.t === 'table' ? `<h6>Table</h6><button class="pi" data-x="row">Add row</button><button class="pi" data-x="col">Add column</button>${lastCell && lastCell.id === b.id ? '<button class="pi" data-x="delrow">Delete this row</button><button class="pi" data-x="delcol">Delete this column</button>' : ''}` : '';
    const img = b.t === 'img' ? '<button class="pi" data-x="float">Make it free-floating</button>' : '';
    openPop(el.querySelector('.pgrip'), `${turn}${tbl}<h6>Block</h6>${img}<button class="pi" data-x="al-left">Align left</button><button class="pi" data-x="al-center">Align centre</button><button class="pi" data-x="al-right">Align right</button><button class="pi" data-x="dup">Duplicate</button><button class="pi" data-x="del" style="color:#f87171">Delete</button>`, t => {
      const tr = t.closest('[data-turn]'), x = t.closest('[data-x]')?.dataset.x; const cur = B(b.id);
      if (tr){ setType(cur, tr.dataset.turn); commit(); return true; }
      if (!x) return;
      if (x === 'row') addRow(cur); else if (x === 'col') addCol(cur);
      else if (x === 'delrow' && cur.rows.length > 1){ const nb = clone(cur); nb.rows.splice(lastCell.r, 1); local({ t: 'b', b: nb }); }
      else if (x === 'delcol' && cur.rows[0].length > 1){ const nb = clone(cur); nb.rows.forEach(r => r.splice(lastCell.c, 1)); local({ t: 'b', b: nb }); }
      else if (x.startsWith('al-')){ const nb = clone(cur); nb.al = x.slice(3) === 'left' ? '' : x.slice(3); if (!nb.al) delete nb.al; local({ t: 'b', b: nb }); }
      else if (x === 'dup'){ const nb = clone(cur); nb.id = uid(); local({ t: 'b', b: nb, after: cur.id }); }
      else if (x === 'del') local({ t: 'bd', id: cur.id });
      else if (x === 'float') blockToObj(cur);
      commit(); return true;
    });
  }
  function blockToObj(b, at){
    const el = bEl(b.id), m = el?.querySelector('img,video'), r = m?.getBoundingClientRect(), zr = zoomEl.getBoundingClientRect();
    const w = r ? r.width / z : 400, h = r ? r.height / z : 260;
    let x = r ? (r.left - zr.left) / z - ox : 40, y = r ? (r.top - zr.top) / z - oy : 40;
    if (at){ x = at.x - w / 2; y = at.y - h / 2; }
    selBlockSet(null);
    const o = addObj(b.vid ? { k: 'video', x, y, w, h, src: b.src, path: b.path, rad: 10 } : { k: 'image', x, y, w, h, ix: 0, iy: 0, iw: w, ih: h, src: b.src, path: b.path, rad: 10 });
    local({ t: 'bd', id: b.id }); commit(); select([o.id]);
  }
  function objToBlock(o){
    const after = doc.blocks[doc.blocks.length - 1];
    local({ t: 'b', b: { id: uid(), t: 'img', src: o.src, path: o.path, w: 100, cap: '' }, after: after ? after.id : undefined });
    local({ t: 'od', id: o.id }); commit(); sel = new Set(); drawSel(); flash('Moved into the page');
  }

  /* ---------- drag pictures around the page; text wraps beside them ---------- */
  function startImgDrag(e, pbEl){
    const id = pbEl.dataset.id, fig = pbEl.querySelector('.pfig'), img = fig.querySelector('img');
    const R = root.getBoundingClientRect(), fr = img.getBoundingClientRect(), offX = e.clientX - fr.left, offY = e.clientY - fr.top;
    let moved = false, tgt = null, ghost = null, ind = null, hint = null, lastEv = e;
    if (typing()) document.activeElement.blur();
    track(e, ev => {
      lastEv = ev;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      if (!moved){
        moved = true; fig.classList.add('lift'); hideImgBar();
        ghost = document.createElement('div'); ghost.className = 'pghost'; ghost.innerHTML = `<img src="${esc(img.currentSrc || img.src)}">`;
        const gw = Math.min(fr.width, 260); ghost.style.width = gw + 'px'; ghost._k = gw / fr.width; root.appendChild(ghost);
        ind = document.createElement('div'); ind.className = 'pdi'; blocksEl.appendChild(ind);
        hint = document.createElement('div'); hint.className = 'phint'; root.appendChild(hint);
      }
      ghost.style.left = ev.clientX - R.left - offX * ghost._k + 'px'; ghost.style.top = ev.clientY - R.top - offY * ghost._k + 'px';
      hint.style.left = ev.clientX - R.left + 14 + 'px'; hint.style.top = ev.clientY - R.top + 16 + 'px';
      const br = blocksEl.getBoundingClientRect(), pr = page.getBoundingClientRect();
      if (ev.clientX < pr.left - 8 || ev.clientX > pr.right + 8 || ev.clientY > pr.bottom + 40){
        tgt = { free: true }; ind.style.display = 'none'; ghost.classList.add('free'); hint.textContent = 'Drop to place it freely'; return;
      }
      ghost.classList.remove('free'); ind.style.display = '';
      const els = [...blocksEl.children].filter(x => x.classList.contains('pb') && x !== pbEl);
      let ref = null, before = true;
      for (const x of els){ const r = x.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2){ ref = x; before = true; break; } }
      if (!ref){ ref = els[els.length - 1]; before = false; }
      const fx = (ev.clientX - br.left) / br.width, fl = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : '';
      tgt = { ref: ref ? ref.dataset.id : null, before, fl };
      const rr = ref ? ref.getBoundingClientRect() : br, y = ((before ? rr.top : rr.bottom) - br.top) / z, bw = br.width / z;
      if (fl){ const h = Math.max(60, Math.min(160, (rr.height / z) * 1.2)); Object.assign(ind.style, { left: (fl === 'left' ? -10 : bw + 6) + 'px', top: y + 'px', width: '4px', height: h + 'px' }); hint.textContent = fl === 'left' ? 'Wrap text — picture on the left' : 'Wrap text — picture on the right'; }
      else { Object.assign(ind.style, { left: '0px', top: y - 2 + 'px', width: bw + 'px', height: '4px' }); hint.textContent = 'Full width'; }
    }, () => {
      ind?.remove(); ghost?.remove(); hint?.remove(); fig.classList.remove('lift');
      if (!moved){ selBlockSet(id); root.focus({ preventScroll: true }); return; }
      const b = B(id); if (!b || !tgt) return;
      if (tgt.free){ blockToObj(b, W(lastEv)); return; }
      const nb = clone(b);
      if (tgt.fl){ nb.fl = tgt.fl; if (!b.fl || !nb.w || nb.w > 70) nb.w = 45; } else { if (b.fl) nb.w = 100; delete nb.fl; }
      local({ t: 'b', b: nb });
      if (tgt.ref){ const ids = doc.blocks.map(x => x.id).filter(x => x !== id), at = ids.indexOf(tgt.ref) + (tgt.before ? 0 : 1); ids.splice(at, 0, id); local({ t: 'bo', ids }); }
      commit(); selBlockSet(null); selBlockSet(id);
    });
  }
  const ibar = document.createElement('div'); ibar.className = 'pobar pibar'; root.appendChild(ibar);
  function hideImgBar(){ ibar.classList.remove('show'); }
  function showImgBar(){
    const b = selBlock && B(selBlock);
    if (!b || b.t !== 'img'){ hideImgBar(); return; }
    const fig = bEl(b.id)?.querySelector('.pfig'); if (!fig){ hideImgBar(); return; }
    const cur = b.fl || 'inline';
    ibar.innerHTML = [['inline', ic('alC', 15) + ' In line'], ['left', ic('alL', 15) + ' Wrap left'], ['right', ic('alR', 15) + ' Wrap right'], ['free', ic('cursor', 15) + ' Free-floating']]
      .map(([k, l]) => `<button data-iw="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('') + `<i class="psep"></i><button data-iw="del" title="Delete">${ic('trash', 15)}</button>`;
    ibar.classList.add('show');
    const r = fig.getBoundingClientRect(), R = root.getBoundingClientRect(), top = q('.ptop').offsetHeight;
    let y = r.top - R.top - ibar.offsetHeight - 10; if (y < top + 6) y = r.height > ibar.offsetHeight + 24 ? Math.max(top + 6, r.top - R.top) + 8 : r.bottom - R.top + 10;
    ibar.style.left = clamp(r.left - R.left + r.width / 2 - ibar.offsetWidth / 2, 8, R.width - ibar.offsetWidth - 8) + 'px'; ibar.style.top = y + 'px';
  }
  ibar.addEventListener('pointerdown', e => e.preventDefault());
  ibar.addEventListener('click', e => {
    const k = e.target.closest('[data-iw]')?.dataset.iw, b = selBlock && B(selBlock); if (!k || !b) return;
    if (k === 'del'){ const id = b.id; selBlockSet(null); local({ t: 'bd', id }); commit(); return; }
    if (k === 'free'){ blockToObj(b); return; }
    const nb = clone(b); if (k === 'inline'){ delete nb.fl; if (b.fl) nb.w = 100; } else { nb.fl = k; if (!b.fl) nb.w = 45; }
    local({ t: 'b', b: nb }); commit(); showImgBar();
  });
  scroll.addEventListener('scroll', () => { if (selBlock) showImgBar(); });

  /* ---------- title ---------- */
  titleEl.addEventListener('input', () => { if (!titleEl.textContent) titleEl.innerHTML = ''; it.title = titleEl.textContent; opts.onTitle && opts.onTitle(it.title); send({ t: 'ti', v: it.title }); changed(true); });
  titleEl.addEventListener('keydown', e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && onEdgeLine(titleEl, 1))){ e.preventDefault(); const f = doc.blocks.find(b => TEXTY.has(b.t)); if (e.key === 'Enter' && titleEl.textContent && caretAtEnd(titleEl) && f && htmlText(f.h)){ const nb = { id: uid(), t: 'p', h: '' }; local({ t: 'b', b: nb, after: null }); focusBlock(nb.id); } else if (f) focusBlock(f.id, 0); } });
  titleEl.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ')); });
  titleEl.addEventListener('focus', () => { if (sel.size) clearSel(); L.cur.forEach(f => f({ blk: 'title', off: 0 })); });
  q('.ptail').addEventListener('mousedown', e => {
    e.preventDefault(); const last = doc.blocks[doc.blocks.length - 1];
    if (last && last.t === 'p' && !htmlText(last.h)) focusBlock(last.id, 0);
    else { const nb = { id: uid(), t: 'p', h: '' }; local({ t: 'b', b: nb }); focusBlock(nb.id); }
  });

  /* ---------- the / menu ---------- */
  function openSlash(id, start){ slash = { id, start, q: '', i: 0 }; renderSlash(); }
  function closeSlash(){ if (!slash) return; slash = null; if (pop.dataset.kind === 'slash') closePop(); }
  function slashItems(){ const qq = (slash.q || '').toLowerCase().trim(); return qq ? SLASH.filter(s => (s.l + ' ' + s.w).toLowerCase().includes(qq)) : SLASH; }
  function updateSlash(el, text, off){
    if (off <= slash.start || text[slash.start] !== '/'){ closeSlash(); return; }
    const qq = text.slice(slash.start + 1, off); if (qq.length > 24 || /\s\s/.test(qq)){ closeSlash(); return; }
    slash.q = qq; slash.i = 0; renderSlash();
    if (!slashItems().length && qq.length > 3) closeSlash();
  }
  function renderSlash(){
    const its = slashItems(), el = bEl(slash.id)?.querySelector('.pbc'); if (!el) return closeSlash();
    const html = its.length ? its.map((s, k) => `<button class="pi${k === slash.i ? ' act' : ''}" data-k="${k}"><i>${s.ic ? ic(s.ic, 15) : esc(s.i)}</i><span>${s.l}<small>${s.d}</small></span></button>`).join('') : '<div class="pi" style="color:rgba(var(--w),.4)">No results</div>';
    const sr = getSelection().rangeCount ? getSelection().getRangeAt(0).getClientRects()[0] : null, R = root.getBoundingClientRect(), er = el.getBoundingClientRect();
    const x = (sr ? sr.left : er.left) - R.left, y = (sr ? sr.bottom : er.bottom) - R.top + 6;
    showPop(x, y, '<h6>Blocks</h6>' + html, t => { const b = t.closest('[data-k]'); if (b){ chooseSlash(its[+b.dataset.k]); return true; } }, 'slash', 290);
    pop.querySelector('.pi.act')?.scrollIntoView({ block: 'nearest' });
  }
  function slashKey(e){
    const its = slashItems();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); slash.i = (slash.i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % Math.max(1, its.length); renderSlash(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab'){ if (!its.length) { closeSlash(); return false; } e.preventDefault(); chooseSlash(its[slash.i]); return true; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeSlash(); return true; }
    return false;
  }
  function chooseSlash(item){
    const s = slash; closeSlash(); if (!item) return;
    const el = bEl(s.id)?.querySelector('.pbc'), b = B(s.id); if (!el || !b) return;
    const end = caretOffset(el); rangeAt(el, s.start, Math.max(end, s.start + 1)).deleteContents(); syncBlock(el); setCaret(el, s.start);
    const empty = !htmlText(B(s.id).h).trim();
    if (TEXTY.has(item.k)){ if (empty) setType(B(s.id), item.k); else { const nb = { id: uid(), t: item.k, h: '' }; if (item.k === 'callout') nb.e = '💡'; if (item.k === 'todo') nb.c = false; local({ t: 'b', b: nb, after: s.id }); focusBlock(nb.id); } commit(); return; }
    if (item.k === 'hr'){ if (empty) setType(B(s.id), 'hr'); else local({ t: 'b', b: { id: uid(), t: 'hr' }, after: s.id }); const nb = { id: uid(), t: 'p', h: '' }; const last = empty ? s.id : doc.blocks[bIndex(s.id) + 1].id; local({ t: 'b', b: nb, after: last }); focusBlock(nb.id); commit(); return; }
    if (item.k === 'table'){ const nb = { id: empty ? s.id : uid(), t: 'table', rows: [['', '', ''], ['', '', ''], ['', '', '']] }; empty ? local({ t: 'b', b: nb }) : local({ t: 'b', b: nb, after: s.id }); focusBlock(nb.id); commit(); return; }
    if (item.k === 'img'){ pickFiles({ block: s.id }); return; }
    if (item.k === 'date'){ document.execCommand('insertText', false, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })); return; }
    const c = viewCenter();
    if (item.k === 'sticky'){ const o = addObj({ k: 'sticky', x: c.x - 110, y: c.y - 110, w: 220, h: 220, html: '', fill: style.sticky, fs: 17 }); commit(); select([o.id]); editText(o.id); }
    if (item.k === 'shape'){ const o = addObj({ k: 'shape', s: 'round', x: c.x - 90, y: c.y - 55, w: 180, h: 110, fill: style.fill, stroke: 'transparent', sw: 0, rad: 18, html: '', color: '#fff', fs: 16 }); commit(); select([o.id]); }
    if (item.k === 'tbox'){ const o = addObj({ k: 'text', x: c.x - 130, y: c.y - 18, w: 260, h: 36, html: '', color: '#f4f4f5', fs: 20 }); commit(); select([o.id]); editText(o.id); }
    if (item.k === 'pen') setTool('pen', 'pen');
  }

  /* ---------- text inside shapes, stickies and text boxes ---------- */
  function editText(id, all){
    const o = O(id), el = oEl(id), t = el?.querySelector('.pot'); if (!t || o.lock) return;
    if (editing && editing !== id) stopEdit();
    editing = id; t.contentEditable = 'true'; sel = new Set([id]); drawSel();
    t.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(t); if (!all) r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function stopEdit(silent){
    if (!editing) return; const id = editing; editing = null;
    const el = oEl(id), t = el?.querySelector('.pot'), o = O(id);
    if (t){ t.contentEditable = 'false'; if (document.activeElement === t) t.blur(); }
    if (o && !silent){ if (o.k === 'text' && !htmlText(o.html).trim()){ local({ t: 'od', id }); sel.delete(id); } else { local({ t: 'o', o }); } commit(); }
    drawSel();
  }
  objsEl.addEventListener('input', e => {
    const t = e.target.closest('.pot'), el = t && t.closest('.po'), o = el && O(el.dataset.id); if (!o) return;
    if (!t.textContent && !t.querySelector('br + br')) t.innerHTML = '';
    o.html = t.innerHTML;
    if (o.k === 'text'){ const h = el.offsetHeight; if (h) o.h = h; }
    if (o.k === 'sticky' && t.scrollHeight > o.h + 1){ o.h = t.scrollHeight; el.style.height = o.h + 'px'; }
    changed(); sendSoon('ot' + o.id, () => ({ t: 'o', o: clone(O(o.id) || o) }), 90); drawSel(); relayout();
  });
  objsEl.addEventListener('keydown', e => { if (e.key === 'Escape' && editing){ e.preventDefault(); e.stopPropagation(); const id = editing; stopEdit(); select([id]); } });
  objsEl.addEventListener('focusout', e => { const t = e.target.closest('.pot'); if (t && editing && t.closest('.po')?.dataset.id === editing) setTimeout(() => { if (editing && !oEl(editing)?.contains(document.activeElement) && !pop.contains(document.activeElement)) stopEdit(); }, 0); });
  function onDbl(o){
    if (['shape', 'sticky', 'text'].includes(o.k)){ editText(o.id); return true; }
    if (o.k === 'image'){ cropping === o.id ? stopCrop() : startCrop(o.id); return true; }
    return false;
  }

  /* ---------- popovers ---------- */
  let popHandler = null;
  function showPop(x, y, html, onClick, kind = '', w){
    pop.innerHTML = html; pop.dataset.kind = kind; pop.style.minWidth = (w || 180) + 'px'; pop.classList.add('show'); popHandler = onClick;
    const R = root.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = clamp(x, 6, R.width - pw - 6) + 'px';
    pop.style.top = (y + ph > R.height - 6 ? Math.max(6, y - ph - 40) : y) + 'px';
  }
  function openPop(anchor, html, onClick, kind){ const r = anchor.getBoundingClientRect(), R = root.getBoundingClientRect(); showPop(r.left - R.left, r.bottom - R.top + 6, html, onClick, kind); }
  function closePop(){ pop.classList.remove('show'); pop.dataset.kind = ''; popHandler = null; }
  pop.addEventListener('pointerdown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  pop.addEventListener('click', e => { if (popHandler && popHandler(e.target) === true) closePop(); });
  root.addEventListener('pointerdown', e => { if (pop.classList.contains('show') && !pop.contains(e.target) && !e.target.closest('[data-a],[data-o]')) closePop(); }, true);

  /* ---------- formatting (top bar + bubble) ---------- */
  function curBlock(){
    const a = document.activeElement, pb = a && blocksEl.contains(a) ? a.closest('.pb') : null;
    if (pb) return B(pb.dataset.id);
    const f = blocksEl.querySelector('.pb.foc'); return f ? B(f.dataset.id) : null;
  }
  function fmt(cmd, val){ document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd === 'hiliteColor'); document.execCommand(cmd, false, val); updateTop(); }
  function inlineCode(){
    const s = getSelection(); if (!s.rangeCount) return;
    const c = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('code');
    if (c && root.contains(c)){ const t = document.createTextNode(c.textContent); c.replaceWith(t); const r = document.createRange(); r.selectNodeContents(t); s.removeAllRanges(); s.addRange(r); t.parentElement.closest('[contenteditable=true]')?.dispatchEvent(new Event('input', { bubbles: true })); return; }
    const txt = s.toString(); if (!txt) return; document.execCommand('insertHTML', false, `<code>${esc(txt)}</code>&#8203;`);
  }
  let savedRange = null;
  function linkPop(anchor){
    const s = getSelection(); if (!s.rangeCount) return; savedRange = s.getRangeAt(0).cloneRange();
    const a = (s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement))?.closest('a');
    openPop(anchor, `<div class="prow"><input class="plink" placeholder="Paste a link…" value="${esc(a ? a.getAttribute('href') : '')}"><button class="pbtn" data-go>Save</button></div>${a ? '<div class="prow"><button class="pi" data-open>Open link ↗</button><button class="pi" data-un>Remove link</button></div>' : ''}`, t => {
      if (t.closest('[data-go]')){ apply(); return true; }
      if (t.closest('[data-open]')){ window.open(a.href, '_blank'); return true; }
      if (t.closest('[data-un]')){ restore(); fmt('unlink'); return true; }
    });
    const inp = pop.querySelector('input'); setTimeout(() => inp.focus(), 0);
    inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); apply(); closePop(); } if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closePop(); restore(); } };
    function restore(){ const el = (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement).closest('[contenteditable=true]'); el?.focus({ preventScroll: true }); const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(savedRange); }
    function apply(){
      let u = inp.value.trim(); restore(); if (!u){ fmt('unlink'); return; }
      if (!/^(https?:|mailto:)/i.test(u)) u = (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u) ? 'mailto:' : 'https://') + u;
      if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`); else fmt('createLink', u);
      root.querySelectorAll('a:not([target])').forEach(x => { x.target = '_blank'; x.rel = 'noopener'; });
    }
  }
  function colorPop(anchor){
    openPop(anchor, `<h6>Text colour</h6><div class="psws">${INK.map((c, i) => `<button class="tx" data-fc="${c}" style="color:${inkOf(c)}" title="${i ? '' : 'Default'}">A</button>`).join('')}</div><h6>Highlight</h6><div class="psws">${HILITE.map(c => `<button data-hc="${c}" class="${c === 'transparent' ? 'psw none' : ''}" style="background:${c}"></button>`).join('')}</div>`, t => {
      const f = t.closest('[data-fc]'), h = t.closest('[data-hc]');
      if (f){ fmt('foreColor', f.dataset.fc); q('.pcol').style.background = f.dataset.fc; return true; }
      if (h){ fmt('hiliteColor', h.dataset.hc); return true; }
    });
  }
  function updateTop(){
    const b = curBlock(), st = q('[data-a=style] span'); if (st) st.textContent = b ? (LABEL[b.t] || { table: 'Table', img: 'Image', hr: 'Divider' }[b.t] || 'Text') : 'Text';
    const on = (a, v) => q(`[data-a=${a}]`)?.classList.toggle('on', !!v);
    let bold = false, ital = false, und = false, strk = false;
    try { bold = document.queryCommandState('bold'); ital = document.queryCommandState('italic'); und = document.queryCommandState('underline'); strk = document.queryCommandState('strikeThrough'); } catch (e) {}
    const inText = typing();
    on('bold', inText && bold); on('italic', inText && ital); on('underline', inText && und); on('strike', inText && strk);
    ['ul', 'ol', 'todo', 'quote', 'callout'].forEach(t => on(t, b && b.t === t));
    const al = q('[data-a=align]'); if (al) al.innerHTML = ic(b && b.al === 'center' ? 'alC' : b && b.al === 'right' ? 'alR' : 'alL');
  }
  function onTopAction(a, btn){
    switch (a){
      case 'undo': undo(); break; case 'redo': redo(); break;
      case 'bold': fmt('bold'); break; case 'italic': fmt('italic'); break; case 'underline': fmt('underline'); break; case 'strike': fmt('strikeThrough'); break;
      case 'color': colorPop(btn); break; case 'link': linkPop(btn); break; case 'icode': inlineCode(); break;
      case 'ul': case 'ol': case 'todo': case 'quote': case 'callout': toggleType(a); commit(); break;
      case 'style': { const b = curBlock(); openPop(btn, `<h6>Turn into</h6>${Object.entries(LABEL).map(([k, l]) => `<button class="pi${b && b.t === k ? ' act' : ''}" data-k="${k}">${l}</button>`).join('')}`, t => { const x = t.closest('[data-k]'); if (x){ const cb = curBlock(); if (cb && TEXTY.has(cb.t)) setType(cb, x.dataset.k); else insertAfterCurrent({ id: uid(), t: x.dataset.k, h: '' }); commit(); return true; } }); break; }
      case 'align': { const b = curBlock(); if (!b) break; const n = { '': 'center', center: 'right', right: '' }[b.al || '']; const nb = clone(b); if (n) nb.al = n; else delete nb.al; const cs = saveCaret(); local({ t: 'b', b: nb }); restoreCaret(cs); commit(); updateTop(); break; }
      case 'more': morePop(btn); break;
      case 'zin': setZoom(z * 1.25); break; case 'zout': setZoom(z / 1.25); break; case 'z100': setZoom(1); break;
      case 'addimg': pickFiles({}); break;
      case 'addtable': { const c = curBlock(); const nb = { id: uid(), t: 'table', rows: [['', '', ''], ['', '', ''], ['', '', '']] }; if (c) insertAfterCurrent(nb); else { local({ t: 'b', b: nb }); focusBlock(nb.id); } commit(); break; }
      case 'shapes': openPop(btn, '<h6>Shapes</h6>' + SHAPES.map(([k, l]) => `<button class="pi${shapeKind === k ? ' act' : ''}" data-s="${k}"><i>${ic(k, 15)}</i>${l}</button>`).join(''), t => { const s = t.closest('[data-s]'); if (s){ setTool('shape', s.dataset.s); return true; } }); break;
      case 'pens': openPop(btn, `<h6>Draw</h6><button class="pi${penKind === 'pen' ? ' act' : ''}" data-p="pen"><i>${ic('pen', 15)}</i>Pen<kbd>P</kbd></button><button class="pi${penKind === 'hl' ? ' act' : ''}" data-p="hl"><i>${ic('marker', 15)}</i>Highlighter<kbd>M</kbd></button><button class="pi${penKind === 'eraser' ? ' act' : ''}" data-p="eraser"><i>${ic('eraser', 15)}</i>Eraser<kbd>E</kbd></button><h6>Pen colour</h6><div class="psws">${INK.concat(['#18181b']).map(c => `<button data-c="${c}" class="${style.pen === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div><h6>Highlighter</h6><div class="psws">${['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'].map(c => `<button data-hc="${c}" class="${style.hl === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div><h6>Pen size</h6><div class="prow">${[2, 3, 5, 8].map(w => `<button class="pi${style.penW === w ? ' act' : ''}" data-w="${w}" style="justify-content:center"><span style="width:${w + 2}px;height:${w + 2}px;border-radius:50%;background:var(--hi);display:block"></span></button>`).join('')}</div>`, t => {
        const p = t.closest('[data-p]'), c = t.closest('[data-c]'), h = t.closest('[data-hc]'), w = t.closest('[data-w]');
        if (p){ setTool('pen', p.dataset.p); return true; } if (c){ style.pen = c.dataset.c; setTool('pen', 'pen'); return true; } if (h){ style.hl = h.dataset.hc; setTool('pen', 'hl'); return true; } if (w){ style.penW = +w.dataset.w; setTool('pen', 'pen'); return true; } }); break;
      case 'icon': case 'addicon': openPop(btn, `<h6>Icon</h6><div class="pgrid">${EMOJI.map(x => `<button data-e="${x}">${x}</button>`).join('')}</div>${doc.meta.icon ? '<button class="pi" data-e="">Remove icon</button>' : ''}`, t => { const x = t.closest('[data-e]'); if (x){ local({ t: 'm', k: 'icon', v: x.dataset.e || null }); commit(); return true; } }); break;
      case 'addcover': case 'cover': openPop(btn, `<h6>Cover</h6><div class="pcov">${COVERS.map((c, i) => `<button data-c="g${i}" style="background:${c}"></button>`).join('')}</div><button class="pi" data-up>Upload an image…</button>`, t => { const c = t.closest('[data-c]'); if (c){ local({ t: 'm', k: 'cover', v: c.dataset.c }); commit(); return true; } if (t.closest('[data-up]')){ pickFiles({ cover: true }); return true; } }); break;
      case 'nocover': local({ t: 'm', k: 'cover', v: null }); commit(); break;
    }
  }
  root.addEventListener('pointerdown', e => { const b = e.target.closest('.ptop [data-a], .pdock [data-a], .pzc [data-a], .pdock [data-tool]'); if (b) e.preventDefault(); });
  root.addEventListener('click', e => {
    const tb = e.target.closest('.pdock [data-tool]'); if (tb){ setTool(tb.dataset.tool); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.closest('.ppop')) return;
    if (pop.classList.contains('show') && pop.dataset.anchor === b.dataset.a){ closePop(); return; }
    onTopAction(b.dataset.a, b); if (pop.classList.contains('show')) pop.dataset.anchor = b.dataset.a;
  });
  function morePop(btn){
    const m = doc.meta;
    openPop(btn, `<h6>Font</h6>${[['', 'Default'], ['serif', 'Serif'], ['mono', 'Mono']].map(([k, l]) => `<button class="pi${(m.font || '') === k ? ' act' : ''}" data-f="${k}" style="font-family:${k === 'serif' ? 'Georgia,serif' : k === 'mono' ? 'Menlo,monospace' : 'inherit'}">${l}</button>`).join('')}
      <h6>Page</h6><button class="pi" data-wide>${m.wide ? '✓ ' : ''}Full width</button><button class="pi" data-zfit>Zoom to fit everything</button>
      <h6>Share & export</h6><button class="pi" data-pdf><i>${ic('export', 15)}</i>Export as PDF</button><button class="pi" data-copy><i>${ic('copy', 15)}</i>Copy as text</button>`, t => {
      const f = t.closest('[data-f]');
      if (f){ local({ t: 'm', k: 'font', v: f.dataset.f || null }); commit(); return true; }
      if (t.closest('[data-wide]')){ local({ t: 'm', k: 'wide', v: m.wide ? null : true }); commit(); return true; }
      if (t.closest('[data-zfit]')){ zoomFit(); return true; }
      if (t.closest('[data-pdf]')){ exportPDF(); return true; }
      if (t.closest('[data-copy]')){ navigator.clipboard?.writeText((it.title ? it.title + '\n\n' : '') + toText(doc)); flash('Copied the page as text'); return true; }
    });
  }
  function zoomFit(){
    const pw = doc.meta.wide ? PAGEW.wide : PAGEW.normal, u = union([{ x: 0, y: 0, w: pw, h: Math.min(page.offsetHeight, 1400) }, ...doc.objs.map(aabb)]);
    const nz = clamp(Math.min(scroll.clientWidth / (u.w + 120), scroll.clientHeight / (u.h + 160)), 0.25, 1.5); setZoom(nz);
    const a = toRoot(u.x, u.y), sr = scroll.getBoundingClientRect(), R = root.getBoundingClientRect();
    scroll.scrollLeft += a.x - (sr.left - R.left) - (scroll.clientWidth - u.w * z) / 2; scroll.scrollTop += a.y - (sr.top - R.top) - 60;
  }

  /* bubble menu for selected text */
  function hideBubble(){ bub.classList.remove('show'); }
  function showBubble(){
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || drag){ hideBubble(); return; }
    const n = s.anchorNode, host2 = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('[contenteditable=true]');
    if (!host2 || !root.contains(host2) || host2.closest('.pb[data-t=code]')){ hideBubble(); return; }
    const r = s.getRangeAt(0).getBoundingClientRect(), R = root.getBoundingClientRect(); if (!r.width) { hideBubble(); return; }
    let st = { b: 0, i: 0, u: 0, s: 0 }; try { st = { b: document.queryCommandState('bold'), i: document.queryCommandState('italic'), u: document.queryCommandState('underline'), s: document.queryCommandState('strikeThrough') }; } catch (e) {}
    bub.innerHTML = `${host2.classList.contains('pbc') ? `<button class="pdd" data-b="turn" style="padding:0 8px">${LABEL[curBlock()?.t] || 'Text'}</button><i class="psep"></i>` : ''}<button data-b="bold" class="${st.b ? 'on' : ''}"><b>B</b></button><button data-b="italic" class="${st.i ? 'on' : ''}"><i style="font-family:Georgia,serif;font-size:14px">I</i></button><button data-b="underline" class="${st.u ? 'on' : ''}"><u>U</u></button><button data-b="strike" class="${st.s ? 'on' : ''}"><s>S</s></button><button data-b="code">${ic('code', 15)}</button><button data-b="link">${ic('link', 15)}</button><button data-b="color"><b style="background:linear-gradient(90deg,#f97316,#ec4899,#8b5cf6);-webkit-background-clip:text;color:transparent">A</b></button>`;
    bub.classList.add('show');
    const bw = bub.offsetWidth, x = clamp(r.left - R.left + r.width / 2 - bw / 2, 6, R.width - bw - 6); let y = r.top - R.top - bub.offsetHeight - 8;
    if (y < q('.ptop').offsetHeight + 4) y = r.bottom - R.top + 8;
    bub.style.left = x + 'px'; bub.style.top = y + 'px';
  }
  bub.addEventListener('pointerdown', e => e.preventDefault());
  bub.addEventListener('click', e => {
    const b = e.target.closest('[data-b]'); if (!b) return; const a = b.dataset.b;
    if (a === 'bold') fmt('bold'); if (a === 'italic') fmt('italic'); if (a === 'underline') fmt('underline'); if (a === 'strike') fmt('strikeThrough');
    if (a === 'code') inlineCode(); if (a === 'link') linkPop(b); if (a === 'color') colorPop(b);
    if (a === 'turn') onTopAction('style', b);
    if (!['link', 'color', 'turn'].includes(a)) setTimeout(showBubble, 0);
  });
  let selT = 0;
  const onSelChange = () => {
    if (!root.isConnected) return;
    clearTimeout(selT); selT = setTimeout(() => { showBubble(); updateTop(); }, 120);
    const a = document.activeElement; if (!a || !root.contains(a)) return;
    const pb = a.closest?.('.pb');
    if (a.classList?.contains('pbc') && pb) sendCaret({ blk: pb.dataset.id, off: caretOffset(a) });
  };
  document.addEventListener('selectionchange', onSelChange);
  let caretT = 0, caretTrail = null, lastCaret = null;
  function sendCaret(c){ lastCaret = c; const now = Date.now(); clearTimeout(caretTrail); if (now - caretT < 50){ caretTrail = setTimeout(() => sendCaret(lastCaret), 60); return; } caretT = now; L.cur.forEach(f => f(c)); }
  root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) L.cur.forEach(f => f({ blk: null })); }, 0));

  /* ---------- images & videos ---------- */
  async function store(file){
    if (hooks.upload){ try { return await hooks.upload(file); } catch (e) { flash("Couldn't upload that file"); throw e; } }
    if (window.stashNative?.storeFile){ try { const src = await window.stashNative.storeFile(file); if (src) return { src }; } catch (e) {} }
    if (file.type.startsWith('image/')) return { src: await shrink(file, 1800) };
    return { src: URL.createObjectURL(file) };
  }
  function shrink(file, max){
    return new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88)); }; im.onerror = rej; im.src = u; });
  }
  const natural = file => new Promise(res => {
    const u = URL.createObjectURL(file);
    if (file.type.startsWith('video/')){ const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { res({ w: v.videoWidth || 640, h: v.videoHeight || 360 }); URL.revokeObjectURL(u); }; v.onerror = () => res({ w: 640, h: 360 }); v.src = u; }
    else { const im = new Image(); im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); }; im.onerror = () => res({ w: 400, h: 300 }); im.src = u; }
  });
  // some files (e.g. .heic or .mkv on Windows) arrive with no type, so fall back to the extension
  const isImgFile = f => /^image\//.test(f.type) || (!f.type && /\.(png|jpe?g|gif|webp|bmp|avif|svg|heic|heif)$/i.test(f.name));
  const isVidFile = f => /^video\//.test(f.type) || (!f.type && /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(f.name));
  function pickFiles(opt){ fileIn.accept = opt.cover ? 'image/*' : 'image/*,video/*'; fileIn.onchange = () => { const fs = [...fileIn.files]; fileIn.value = ''; addFiles(fs, opt); }; fileIn.click(); }
  async function addFiles(files, opt = {}){
    // only images and videos go in a page (a cover only takes an image); anything else is
    // skipped with a message instead of silently doing nothing
    const all = files;
    files = all.filter(f => isImgFile(f) || (!opt.cover && isVidFile(f)));
    const skipped = all.length - files.length;
    if (skipped) flash(opt.cover ? 'A cover has to be an image' : `Skipped ${skipped} file${skipped > 1 ? 's' : ''} — only images and videos can go here`);
    if (!files.length) return;
    if (opt.cover){ flash('Adding cover…'); const m = await store(files[0]); local({ t: 'm', k: 'cover', v: { src: m.src, path: m.path } }); commit(); return; }
    let at = opt.at || null, after = opt.block || null, n = 0;
    for (const f of files){
      const vid = isVidFile(f); flash(`Adding ${vid ? 'video' : 'image'}…`);
      const [m, nat] = await Promise.all([store(f), natural(f)]).catch(() => [null, null]); if (!m) continue;
      if (after){ const nb = { id: uid(), t: 'img', src: m.src, path: m.path, w: nat.w < 500 ? Math.round(nat.w / 6.4) : 100, cap: '' }; if (vid) nb.vid = true;
        const ab = B(after); if (ab && ab.t === 'p' && !htmlText(ab.h).trim()){ nb.id = ab.id; local({ t: 'b', b: nb }); } else local({ t: 'b', b: nb, after }); after = nb.id; continue; }
      const k = Math.min(1, 520 / nat.w, 420 / nat.h), w = Math.round(nat.w * k), h = Math.round(nat.h * k);
      const c = at || viewCenter();
      const o = addObj(vid ? { k: 'video', x: c.x - w / 2 + n * 28, y: c.y - h / 2 + n * 28, w, h, src: m.src, path: m.path, rad: 10 } : { k: 'image', x: c.x - w / 2 + n * 28, y: c.y - h / 2 + n * 28, w, h, ix: 0, iy: 0, iw: w, ih: h, src: m.src, path: m.path, rad: 8 });
      n++; select([o.id]);
    }
    commit(); relayout(); flash(files.length > 1 ? `Added ${files.length} files` : 'Added');
  }
  // drag files in from Finder
  let dragDepth = 0; const dropEl = q('.pdrop');
  const filesIn = e => [...(e.dataTransfer?.types || [])].includes('Files');
  root.addEventListener('dragenter', e => { if (!filesIn(e)) return; e.preventDefault(); e.stopPropagation(); dragDepth++; dropEl.classList.add('show'); });
  root.addEventListener('dragleave', e => { if (!filesIn(e)) return; e.stopPropagation(); if (--dragDepth <= 0){ dragDepth = 0; dropEl.classList.remove('show'); } });
  root.addEventListener('dragover', e => { if (!filesIn(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
  root.addEventListener('drop', e => {
    if (!filesIn(e)) return; e.preventDefault(); e.stopPropagation(); dragDepth = 0; dropEl.classList.remove('show');
    const files = [...e.dataTransfer.files], p = W(e), pb = e.target.closest?.('.pb');
    if (pb && blocksEl.contains(pb)) addFiles(files, { block: pb.dataset.id }); else addFiles(files, { at: p });
  });

  /* ---------- clipboard ---------- */
  function onCopy(e, cut){
    if (typing() || !sel.size || !root.isConnected) return;
    const a = document.activeElement; if (a && a !== document.body && !root.contains(a)) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', CLIPKEY + JSON.stringify(selObjs()));
    if (cut) delSel();
  }
  const onCopyEv = e => onCopy(e, false), onCutEv = e => onCopy(e, true);
  function onPaste(e){
    if (!root.isConnected) return;
    const a = document.activeElement; if (a && a !== document.body && !root.contains(a)) return;
    const dt = e.clipboardData, files = [...dt.files], txt = dt.getData('text/plain') || '';
    const inEdit = typing(), pb = a && a.closest?.('.pb');
    if (files.length){ e.preventDefault(); if (inEdit && pb && a.classList.contains('pbc')) addFiles(files, { block: pb.dataset.id }); else addFiles(files, {}); return; }
    if (txt.startsWith(CLIPKEY)){
      if (inEdit && !a.closest('.po')) {}
      e.preventDefault();
      try { const os = JSON.parse(txt.slice(CLIPKEY.length)); let t = topZ(); const gmap = {}, ids = [];
        os.forEach(o => { o.id = uid(); o.z = ++t; if (o.g) o.g = gmap[o.g] = gmap[o.g] || uid(); moveObj(o, 24, 24); local({ t: 'o', o }); ids.push(o.id); }); commit(); if (inEdit) a.blur(); select(ids); relayout(); } catch (x) {}
      return;
    }
    if (!inEdit){ if (txt.trim()){ e.preventDefault(); const c = viewCenter(); const o = addObj({ k: 'text', x: c.x - 160, y: c.y - 20, w: 320, h: 36, html: esc(txt).replace(/\n/g, '<br>'), color: '#f4f4f5', fs: 18 }); commit(); select([o.id]); relayout(); } return; }
    e.preventDefault();
    if (a.classList.contains('pbc') && pb && txt.includes('\n') && B(pb.dataset.id)?.t !== 'code'){
      const lines = txt.replace(/\r/g, '').split('\n'); document.execCommand('insertText', false, lines.shift());
      let after = pb.dataset.id, last = null;
      lines.forEach(l => { const nb = blockFromLine(l); local({ t: 'b', b: nb, after }); after = nb.id; last = nb.id; });
      if (last) focusBlock(last, 'end'); commit(); return;
    }
    document.execCommand('insertText', false, txt);
  }

  /* ---------- keyboard ---------- */
  function onKey(e){
    if (!root.isConnected || root.offsetParent === null) return;
    const a = document.activeElement; if (a && a !== document.body && !root.contains(a)) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), inEdit = typing();
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (mod && k === 'z'){ stop(); commit(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y'){ stop(); redo(); return; }
    if (mod && (k === '=' || k === '+')){ stop(); setZoom(z * 1.25); return; }
    if (mod && k === '-'){ stop(); setZoom(z / 1.25); return; }
    if (mod && k === '0'){ stop(); setZoom(1); return; }
    if (mod && k === '1' && e.shiftKey){ stop(); zoomFit(); return; }
    if (inEdit){
      if (mod && k === 'k'){ stop(); linkPop(q('[data-a=link]')); return; }
      if (mod && k === 'e'){ stop(); inlineCode(); return; }
      if (mod && e.shiftKey && k === 'x'){ stop(); fmt('strikeThrough'); return; }
      if (mod && e.altKey && /^[0-3]$/.test(e.code.slice(-1))){ const b = curBlock(); if (b && TEXTY.has(b.t)){ stop(); setType(b, ['p', 'h1', 'h2', 'h3'][+e.code.slice(-1)]); commit(); } return; }
      if (mod && e.shiftKey && /^Digit[789]$/.test(e.code)){ stop(); toggleType({ Digit7: 'ol', Digit8: 'ul', Digit9: 'todo' }[e.code]); commit(); return; }
      if (e.key === 'Escape'){ stop(); if (slash) { closeSlash(); return; } if (pop.classList.contains('show')) { closePop(); return; } if (editing){ const id = editing; stopEdit(); select([id]); return; } a.blur(); hideBubble(); return; }
      return;
    }
    if (e.key === ' ' && !spaceDown){ spaceDown = true; scroll.classList.add('pan'); e.preventDefault(); return; }
    if (e.key === 'Escape'){
      if (pop.classList.contains('show')){ stop(); closePop(); return; }
      if (cropping){ stop(); stopCrop(); return; }
      if (tool !== 'select'){ stop(); setTool('select'); return; }
      if (sel.size || selBlock){ stop(); clearSel(); selBlockSet(null); return; }
      return; // let Stash close the note
    }
    if (selBlock && (e.key === 'Backspace' || e.key === 'Delete')){ stop(); const id = selBlock; selBlockSet(null); const i = bIndex(id); local({ t: 'bd', id }); commit(); const nb = doc.blocks[Math.max(0, i - 1)]; if (nb) focusBlock(nb.id, 'end'); return; }
    if (sel.size){
      if (e.key === 'Backspace' || e.key === 'Delete'){ stop(); delSel(); return; }
      if (mod && k === 'd'){ stop(); duplicate(); return; }
      if (mod && k === 'g'){ stop(); const os = selObjs(); if (e.shiftKey) setObjs(x => delete x.g); else if (os.length > 1){ const g = uid(); setObjs(x => x.g = g); } return; }
      if (mod && (e.key === ']' || e.key === '[')){ stop(); layer(e.key === ']' ? 1 : -1); return; }
      if (mod && e.shiftKey && k === 'l'){ stop(); const v = !selObjs()[0].lock; setObjs(x => x.lock = v); return; }
      if (e.key.startsWith('Arrow')){ stop(); const d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0; selObjs().forEach(o => { if (o.lock) return; moveObj(o, dx, dy); local({ t: 'o', o }); }); drawSel(); clearTimeout(commitT); commitT = setTimeout(commit, 600); return; }
      if (e.key === 'Enter'){ const o = selObjs()[0]; if (sel.size === 1 && ['shape', 'sticky', 'text'].includes(o.k)){ stop(); editText(o.id, true); } else if (cropping){ stop(); stopCrop(); } return; }
    }
    if (mod && k === 'a'){ stop(); select(doc.objs.map(o => o.id)); return; }
    if (!mod && !e.altKey){
      const m = { v: 'select', h: 'hand', t: 'text', s: 'sticky', r: 'shape', o: 'shape', l: 'shape', p: 'pen', m: 'pen', e: 'pen' }[k];
      if (m){ stop(); setTool(m, { o: 'ellipse', r: 'rect', l: e.shiftKey ? 'arrow' : 'line', p: 'pen', m: 'hl', e: 'eraser' }[k]); return; }
    }
  }
  const onKeyUp = e => { if (e.key === ' ' && spaceDown){ spaceDown = false; if (tool !== 'hand') scroll.classList.remove('pan'); } };
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKeyUp, true);
  addEventListener('copy', onCopyEv); addEventListener('cut', onCutEv); addEventListener('paste', onPaste);

  /* ---------- export ---------- */
  async function exportPDF(){
    closePop(); hideBubble(); const keepSel = [...sel]; sel = new Set(); drawSel();
    const pw = doc.meta.wide ? PAGEW.wide : PAGEW.normal, u = union([{ x: 0, y: 0, w: pw, h: page.offsetHeight }, ...doc.objs.map(aabb)]);
    const box = document.createElement('div'); box.className = 'pprint';
    const fit = Math.min(1, 720 / (u.w + 20));
    box.style.cssText = `position:relative;width:${u.w + 20}px;height:${u.h + 20}px;zoom:${fit}`;
    const pc = page.cloneNode(true); pc.style.left = (-u.x + 10) + 'px'; pc.style.top = (-u.y + 10) + 'px'; pc.querySelectorAll('[contenteditable]').forEach(x => x.removeAttribute('contenteditable'));
    const oc = objsEl.cloneNode(true); oc.style.left = (-u.x + 10) + 'px'; oc.style.top = (-u.y + 10) + 'px';
    const light = c => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim()); if (m){ let h = m[1]; if (h.length === 3) h = h.replace(/./g, x => x + x); const n = parseInt(h, 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 200; } return /^(white|rgb\(2[3-5]\d, ?2[3-5]\d, ?2[3-5]\d\))$/i.test(String(c || '').trim()); };
    oc.querySelectorAll('[stroke]').forEach(x => { if (light(x.getAttribute('stroke'))) x.setAttribute('stroke', '#18181b'); });
    oc.querySelectorAll('.po:not(.k-shape) .pot, .po.k-shape .pot').forEach(x => { const po = x.closest('.po'), o = O(po.dataset.id); if (o && o.k !== 'sticky' && !(o.k === 'shape' && o.fill && o.fill !== 'transparent') && light(x.style.color)) x.style.color = '#18181b'; });
    box.append(pc, oc); document.body.appendChild(box);
    await new Promise(r => setTimeout(r, 120));
    try { if (window.stashNative?.savePDF){ const ok = await window.stashNative.savePDF(it.title || 'Untitled'); if (ok) flash('Saved PDF'); } else window.print(); }
    catch (e) { flash("Couldn't export the PDF"); }
    box.remove(); sel = new Set(keepSel.filter(O)); drawSel();
  }

  /* ---------- collaborators: carets, selections, pointers ---------- */
  let peers = [];
  function drawPeers(list){
    if (list) peers = list;
    let h = '';
    const zr = zoomEl.getBoundingClientRect();
    for (const p of peers){
      const col = esc(p.color || '#4f86e8'), nm = esc((p.name || '').split(' ')[0] || '@' + (p.username || ''));
      if (p.blk){
        const el = p.blk === 'title' ? titleEl : bEl(p.blk)?.querySelector('.pbc');
        if (el){ let r; try { const rg = rangeAt(el, Math.min(p.off || 0, el.textContent.length)); r = rg.getClientRects()[0] || rg.getBoundingClientRect(); } catch (e) {}
          if (!r || (!r.height && !r.left)){ const er = el.getBoundingClientRect(); r = { left: er.left, top: er.top, height: parseFloat(getComputedStyle(el).lineHeight) * z || 24 }; }
          const x = (r.left - zr.left) / z - ox, y = (r.top - zr.top) / z - oy, typingNow = p.typing && Date.now() - p.typing < 2500;
          h += `<div class="ppc" style="--c:${col};left:${x}px;top:${y}px;height:${(r.height || 22) / z}px;width:${2 / z}px"><b style="transform:scale(${1 / z});transform-origin:0 100%">${nm}${typingNow ? ' ✎' : ''}</b></div>`; }
      }
      (p.sel || []).forEach(id => { const o = O(id); if (!o) return; const r = aabb(o); h += `<div class="pps" style="--c:${col};left:${r.x - 3 / z}px;top:${r.y - 3 / z}px;width:${r.w + 6 / z}px;height:${r.h + 6 / z}px;border-width:${2 / z}px"><b style="transform:scale(${1 / z});transform-origin:0 100%">${nm}</b></div>`; });
      if (p.wx != null) h += `<div class="ppp" style="transform:translate(${p.wx}px,${p.wy}px) scale(${1 / z});transform-origin:0 0"><svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5l13 6.2-5.6 1.6-2.3 5.5z" fill="${col}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg><b style="--c:${col}">${nm}</b></div>`;
    }
    peerEl.innerHTML = h;
  }

  /* ---------- little toast ---------- */
  let flashT = null;
  function flash(msg){ let f = q('.pflash'); if (!f){ f = document.createElement('div'); f.className = 'pflash'; f.style.cssText = 'position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:60;background:rgba(var(--p2),.97);border:1px solid rgba(var(--w),.12);color:var(--hi);font-size:12.5px;padding:7px 12px;border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.4);pointer-events:none;transition:opacity .2s'; root.appendChild(f); } f.textContent = msg; f.style.opacity = 1; clearTimeout(flashT); flashT = setTimeout(() => f.style.opacity = 0, 2200); }

  /* ---------- start ---------- */
  renderAll(); setTool('select');
  // remove stray highlighter "slashes" saved by older versions (a single click made a tiny stroke)
  try {
    const span = (o, i) => Math.max(...o.pts.map(p => p[i])) - Math.min(...o.pts.map(p => p[i]));
    const strays = (doc.objs || []).filter(o => o.k === 'draw' && o.hl && Array.isArray(o.pts) && o.pts.length <= 2 && span(o, 0) < 2 && span(o, 1) < 2);
    if (strays.length){ strays.forEach(o => local({ t: 'od', id: o.id })); commit(); }
  } catch (e) {}
  layout(false);
  requestAnimationFrame(() => { layout(false); scroll.scrollLeft = Math.max(0, (ox - (scroll.clientWidth / z - (doc.meta.wide ? PAGEW.wide : PAGEW.normal)) / 2) * z); });
  const ro = new ResizeObserver(() => relayout()); ro.observe(scroll); ro.observe(page);
  if (opts.focus !== false) setTimeout(() => { if (!root.isConnected) return; if (!it.title) setCaret(titleEl, 0); else { const last = doc.blocks[doc.blocks.length - 1]; if (doc.blocks.length === 1 && !htmlText(last.h)) focusBlock(last.id, 0); } }, 380);

  const api = {
    it, root,
    doc: () => doc, text: () => toText(doc),
    onOp: f => L.op.push(f), onCursor: f => L.cur.push(f),
    apply: applyRemote, setDoc, drawPeers, hooks,
    metaSlot: () => q('.pmetaslot'),
    commit, flush(){ for (const [k, s] of opsT){ clearTimeout(s.t); send(s.mk()); } opsT.clear(); commit(); },
    destroy(){
      try { api.flush(); } catch (e) {}
      removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKeyUp, true);
      removeEventListener('copy', onCopyEv); removeEventListener('cut', onCutEv); removeEventListener('paste', onPaste);
      document.removeEventListener('selectionchange', onSelChange); ro.disconnect();
      L.op.length = 0; L.cur.length = 0; if (current === api) current = null;
    }
  };
  current = api;
  return api;
}

window.Pad = { mount, ensure, toText, fromText, isEmpty, htmlText, clean, get current(){ return current; } };
})();
