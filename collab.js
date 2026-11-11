/* =========================================================
   Stash Collab — accounts, shared folders/docs, live editing.
   • Sign in with an email code (Supabase Auth). Usernames are
     unique across everyone (enforced by the database).
   • Share a folder or a note by @username.
   • Shared notes: live text, Figma-style cursors with names,
     who's here, and version history you can restore.
   Loaded before the main Stash script; it uses Stash's globals
   (items, folders, render, openItem, toast, esc, svg…) at runtime.
   ========================================================= */
const Collab = (() => {
  const SB_URL = 'https://duyhgreevydsdrxmvfew.supabase.co';
  const SB_KEY = 'sb_publishable_1nLO5G7sFnsY2nl-gwfXew_vSbQORx9';   // publishable key: safe in the app (security is enforced by the database rules)
  const enabled = !!window.supabase && !SB_URL.startsWith('__') && !!window.stashNative;   // collaboration lives in the Mac app
  const sb = enabled ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stash-auth', flowType: 'implicit', detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 30 } } }) : null;

  let user = null, prof = null, ready = false;
  const spaces = new Map();      // spaceId -> {id, name, kind, owner, members:[profile+role]}
  const byRid = new Map();       // rowId -> local item
  const known = new Set();       // rowIds we've seen (to notice local deletes)
  const pending = new Set();     // local items being uploaded
  let dbChan = null;

  const sid = id => 's:' + id;
  const COLORS = ['#4f86e8', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#64748b'];
  const initials = n => (String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?');
  const avatarOf = (p, size = 24, ring = false) => `<span class="cav" title="${esc((p.display_name || '') + ' @' + (p.username || ''))}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px;${p.photo ? `background-image:url('${p.photo}')` : `background:${p.color || COLORS[0]}`};${ring ? `box-shadow:0 0 0 2px ${p.color || COLORS[0]}` : ''}">${p.photo ? '' : esc(initials(p.display_name))}</span>`;
  const ago = t => { const s = (Date.now() - new Date(t)) / 1000; return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : new Date(t).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}); };
  const nameOf = id => { for (const s of spaces.values()){ const m = s.members.find(m => m.id === id); if (m) return m; } return id === prof?.id ? prof : null; };

  /* =====================  sign in (email code)  ===================== */
  function gateHTML(inner){ const g = $('#gate'); g.innerHTML = `<div class="card"><div class="logo2"></div>${inner}</div>`; g.classList.add('show'); }
  function emailScreen(msg = ''){
    gateHTML(`<h2>Sign in to Stash</h2><div class="sub">Enter your email — we'll send you a 6-digit code. No password needed.</div>
      <div class="fld"><div class="in"><input id="cE" type="email" placeholder="you@email.com" autocomplete="email"></div><span class="err" id="cEe">${esc(msg)}</span></div>
      <button class="go" id="cGo">Send code</button>`);
    const e = $('#cE'), go = $('#cGo');
    const send = async () => {
      const email = e.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $('#cEe').textContent = 'Enter a valid email'; return; }
      go.disabled = true; go.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: 'http://127.0.0.1:51789/auth' } });
      if (error){ go.disabled = false; go.textContent = 'Send code'; $('#cEe').textContent = /rate|seconds|limit/i.test(error.message) ? 'Too many sign-in emails right now — try again in a little while.' : error.message; return; }
      codeScreen(email);
    };
    go.onclick = send; e.onkeydown = ev => { if (ev.key === 'Enter') send(); };
    setTimeout(() => e.focus(), 50);
  }
  function codeScreen(email){
    gateHTML(`<h2>Check your email</h2><div class="sub">We sent a 6-digit code to <b style="color:#fff">${esc(email)}</b>. Enter it below (check spam if it's not there in a minute).</div>
      <div class="fld"><div class="in"><input id="cC" inputmode="numeric" maxlength="8" placeholder="123456" autocomplete="one-time-code" style="letter-spacing:.3em;font-size:18px;text-align:center"></div><span class="err" id="cCe"></span></div>
      <button class="go" id="cGo">Sign in</button><div class="lnk" id="cBack">Use a different email</div>`);
    const c = $('#cC'), go = $('#cGo');
    const verify = async () => {
      const token = c.value.replace(/\D/g, ''); if (token.length < 6){ $('#cCe').textContent = 'Enter the code from the email'; return; }
      go.disabled = true; go.textContent = 'Checking…';
      const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error){ go.disabled = false; go.textContent = 'Sign in'; $('#cCe').textContent = /expired|invalid/i.test(error.message) ? "That code didn't work — check it, or go back and get a new one." : error.message; return; }
      user = data.user; await afterAuth();
    };
    go.onclick = verify; c.oninput = () => { if (c.value.replace(/\D/g, '').length === 6) verify(); };
    $('#cBack').onclick = () => emailScreen();
    setTimeout(() => c.focus(), 50);
  }
  const cleanU = u => String(u || '').toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._]/g, '').slice(0, 20);
  const checkU = u => !u ? 'Pick a username' : u.length < 3 ? 'At least 3 characters' : /^[._]|[._]$/.test(u) ? "Can't start or end with . or _" : /[._]{2}/.test(u) ? 'No double dots or underscores' : '';
  function profileScreen(){
    const local = Account.get() || {};
    const draft = { name: local.name || '', username: cleanU(local.username || ''), color: local.color || COLORS[0], photo: local.photo || null };
    gateHTML(`<h2>Claim your @username</h2><div class="sub">This is how people find and invite you. Once it's yours, nobody else can use it.</div>
      <div class="fld">Display name<div class="in"><input id="pN" maxlength="40" placeholder="Charlie Currin" value="${esc(draft.name)}"></div><span class="err" id="pNe"></span></div>
      <div class="fld">Username<div class="in"><span>@</span><input id="pU" maxlength="20" placeholder="charlie" value="${esc(draft.username)}" spellcheck="false"></div><span class="err" id="pUe"></span></div>
      <button class="go" id="pGo" disabled>Continue</button>`);
    const N = $('#pN'), U = $('#pU'), go = $('#pGo'); let seq = 0, okU = false;
    const check = async () => {
      draft.name = N.value.trim(); const u = cleanU(U.value); if (U.value !== u) U.value = u; draft.username = u;
      $('#pNe').textContent = N.value && !draft.name ? 'Add a display name' : '';
      const bad = checkU(u), el = $('#pUe'); okU = false;
      if (bad){ el.className = 'err'; el.textContent = U.value ? bad : ''; go.disabled = true; return; }
      el.className = 'err'; el.textContent = 'Checking…'; const my = ++seq;
      const { data } = await sb.from('profiles').select('id').eq('username', u).maybeSingle();
      if (my !== seq) return;
      okU = !data || data.id === user.id;
      el.className = okU ? 'err ok' : 'err'; el.textContent = okU ? `@${u} is available` : `@${u} is taken — try another`;
      go.disabled = !(okU && draft.name);
    };
    let t; [N, U].forEach(x => x.addEventListener('input', () => { clearTimeout(t); t = setTimeout(check, 250); }));
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Saving…';
      const row = { id: user.id, username: draft.username, display_name: draft.name, color: draft.color, photo: draft.photo };
      const { data, error } = await sb.from('profiles').insert(row).select().single();
      if (error){ go.textContent = 'Continue'; $('#pUe').className = 'err'; $('#pUe').textContent = error.code === '23505' ? `@${draft.username} was just taken — try another` : error.message; return; }
      prof = data; await enterApp(true);
    };
    if (draft.username) check();
    setTimeout(() => (draft.name ? U : N).focus(), 50);
  }
  async function afterAuth(){
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!data) return profileScreen();
    prof = data; await enterApp(false);
  }
  async function enterApp(isNew){
    // the online profile becomes Stash's account
    Account.set({ name: prof.display_name, username: prof.username, color: prof.color, photo: prof.photo, created: Date.parse(prof.created_at), uid: prof.id });
    Account._enter();
    if (isNew) toast(`Welcome to Stash, ${prof.display_name.split(' ')[0]}!`);
    await loadAll(); subscribe(); ready = true; render();
  }
  async function boot(){
    if (!enabled) return false;
    // clicking the link in the sign-in email hands us a session
    window.stashNative.authListen?.();
    window.stashNative.onAuthTokens?.(async t => {
      if (prof) return;
      const { data, error } = await sb.auth.setSession(t);
      if (error){ emailScreen("That sign-in link didn't work — send a new one."); return; }
      user = data.user; await afterAuth();
    });
    gateHTML('<h2>Opening Stash…</h2><div class="sub">Signing you in</div>');
    let data = {};
    try { ({ data } = await sb.auth.getSession()); } catch (e) {}
    if (data && data.session){ user = data.session.user; await afterAuth(); }
    else emailScreen();
    return true;
  }
  async function signOut(){
    detach(); try { dbChan && sb.removeChannel(dbChan); } catch (e) {} dbChan = null;
    await sb.auth.signOut().catch(() => {});
    dropShared(); user = prof = null; ready = false;
    if (open) closeItem(); view = 'home'; render(); emailScreen();
  }
  async function updateProfile(p){
    const { data, error } = await sb.from('profiles').update({ username: p.username, display_name: p.name, color: p.color, photo: p.photo }).eq('id', user.id).select().single();
    if (error) return error.code === '23505' ? `@${p.username} is taken — try another` : error.message;
    prof = data; return null;
  }

  /* =====================  shared data ⇄ local items  ===================== */
  function dropShared(){
    items = items.filter(i => !i.space); folders = folders.filter(f => !f.shared);
    spaces.clear(); byRid.clear(); known.clear();
  }
  function folderFor(s){ return { id: sid(s.id), name: s.name, icon: s.kind === 'doc' ? 'note' : 'users', shared: true, spaceId: s.id, kind: s.kind, owner: s.owner }; }
  async function signed(paths){
    if (!paths.length) return {};
    const { data } = await sb.storage.from('shared').createSignedUrls(paths, 60 * 60 * 6);
    const out = {}; (data || []).forEach(d => { if (d.signedUrl) out[d.path] = d.signedUrl; }); return out;
  }
  function toItem(row, urls = {}){
    const it = byRid.get(row.id) || { id: 'r:' + row.id };
    Object.assign(it, { rid: row.id, space: row.space_id, folder: sid(row.space_id), type: row.type, title: row.title, body: row.body, link: row.link || undefined,
      ext: row.ext || undefined, mime: row.mime || undefined, fname: row.fname || undefined, size: row.size || undefined, dur: row.dur || undefined,
      t: Date.parse(row.updated_at), updatedBy: row.updated_by, filePath: row.file_path || undefined, thumb: row.thumb || it.thumb });
    const u = row.file_path && urls[row.file_path];
    if (u){ if (row.type === 'image'){ it.src = u; it.url = u; } else if (row.type === 'video'){ it.vsrc = u; it.url = u; it.poster = row.thumb || it.poster; } else { it.url = u; it.data = undefined; } }
    else if (row.type === 'image' && !it.src) it.src = row.thumb;
    byRid.set(row.id, it); known.add(row.id);
    if (!items.includes(it)) items.unshift(it);
    return it;
  }
  async function loadSpace(spaceId){
    const [{ data: s }, { data: mem }, { data: rows }] = await Promise.all([
      sb.from('spaces').select('*').eq('id', spaceId).maybeSingle(),
      sb.from('space_members').select('role, profiles(*)').eq('space_id', spaceId),
      sb.from('space_items').select('*').eq('space_id', spaceId)
    ]);
    if (!s) return null;
    const sp = { ...s, members: (mem || []).map(m => ({ ...m.profiles, role: m.role })).sort((a, b) => (b.role === 'owner') - (a.role === 'owner')) };
    spaces.set(s.id, sp);
    const f = folders.find(x => x.id === sid(s.id)); if (f) Object.assign(f, folderFor(s)); else folders.push(folderFor(s));
    const urls = await signed((rows || []).filter(r => r.file_path).map(r => r.file_path));
    (rows || []).forEach(r => toItem(r, urls));
    return sp;
  }
  async function loadAll(){
    const { data } = await sb.from('space_members').select('space_id').eq('user_id', user.id);
    await Promise.all((data || []).map(m => loadSpace(m.space_id)));
  }
  function subscribe(){
    if (dbChan) sb.removeChannel(dbChan);
    dbChan = sb.channel('stash-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_items' }, async p => {
        if (p.eventType === 'DELETE'){
          const it = byRid.get(p.old.id); if (!it) return;
          byRid.delete(p.old.id); known.delete(p.old.id); items = items.filter(i => i !== it);
          if (open === it){ closeItem(); toast('That item was deleted by someone else'); } else render(); return;
        }
        const row = p.new; if (!spaces.has(row.space_id)) return;
        const mine = byRid.get(row.id); if (mine && pending.has(mine)) return;
        const editing = live && live.rid === row.id;
        const urls = row.file_path && !byRid.get(row.id)?.url ? await signed([row.file_path]) : {};
        const it = toItem(editing ? { ...row, body: byRid.get(row.id)?.body ?? row.body, title: byRid.get(row.id)?.title ?? row.title } : row, urls);
        if (!editing && open !== it) render();
        else if (!editing) renderSide();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'space_members', filter: `user_id=eq.${user.id}` }, async p => {
        const sp = await loadSpace(p.new.space_id); render();
        if (sp && p.new.added_by !== user.id){ const by = sp.members.find(m => m.id === p.new.added_by); toast(`${by ? '@' + by.username : 'Someone'} shared “${sp.name}” with you`); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_members' }, async p => {
        const s = (p.new && p.new.space_id) || (p.old && p.old.space_id);
        if (p.eventType === 'DELETE' && p.old.user_id === user.id){ removeSpaceLocal(s, 'You were removed from a shared folder'); return; }
        if (s && spaces.has(s)){ await loadSpace(s); renderSide(); refreshShareDialog(s); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, async p => {
        if (p.eventType === 'DELETE'){ removeSpaceLocal(p.old.id, 'A shared folder was deleted by its owner'); return; }
        const sp = spaces.get(p.new.id); if (sp){ sp.name = p.new.name; const f = folders.find(x => x.id === sid(sp.id)); if (f) f.name = p.new.name; render(); }
      })
      .subscribe();
  }
  function removeSpaceLocal(spaceId, msg){
    if (!spaces.has(spaceId)) return;
    spaces.delete(spaceId);
    items.filter(i => i.space === spaceId).forEach(i => { byRid.delete(i.rid); known.delete(i.rid); });
    items = items.filter(i => i.space !== spaceId); folders = folders.filter(f => f.id !== sid(spaceId));
    if (open && open.space === spaceId) closeItem();
    if (view === sid(spaceId)) view = 'home';
    render(); if (msg) toast(msg);
  }

  /* ---- keep Stash's normal actions working on shared folders ----
     Runs after every render: new things put in a shared folder get uploaded,
     things moved out become local again, and deletions are synced. */
  async function blobOf(it){
    const src = it.data || it.vsrc || it.url || it.src; if (!src) return null;
    try { return await (await fetch(src)).blob(); } catch (e) { return null; }
  }
  async function upload(it){
    pending.add(it);
    const spaceId = folders.find(f => f.id === it.folder)?.spaceId;
    // the id is made here so the live "new row" echo maps back onto this same item
    const rid = crypto.randomUUID(); it.rid = rid; it.space = spaceId; byRid.set(rid, it); known.add(rid);
    try {
      const row = { id: rid, space_id: spaceId, type: it.type === 'link' ? 'link' : it.type, title: it.title || '', body: it.body || '', link: it.link || null, ext: it.ext || null, mime: it.mime || null, fname: it.fname || null, size: it.size || null, dur: it.dur || null, created_by: user.id, updated_by: user.id };
      if (it.type === 'image') row.thumb = it.thumb && it.thumb.length < 400000 ? it.thumb : (it.src ? await imageThumb(it.src, 480).catch(() => null) : null);
      if (it.type === 'video') row.thumb = it.poster || null;
      if (['image', 'video', 'doc'].includes(it.type) && !it.sections){
        const b = await blobOf(it);
        if (b){
          const path = `${spaceId}/${crypto.randomUUID()}-${String(it.fname || it.title || 'file').replace(/[^\w.\- ]+/g, '_').slice(-80)}`;
          const { error } = await sb.storage.from('shared').upload(path, b, { contentType: b.type || it.mime || 'application/octet-stream' });
          if (error) throw error; row.file_path = path;
        } else if (it.sections) row.body = it.sections.map(([h, p]) => `${h}\n${p}`).join('\n\n');
      }
      if (it.sections && !row.body) row.body = it.sections.map(([h, p]) => `${h}\n${p}`).join('\n\n');
      const { data, error } = await sb.from('space_items').insert(row).select().single();
      if (error) throw error;
      it.updatedBy = user.id; it.filePath = data.file_path || undefined;
      if (open === it) attach(it);
    } catch (e) {
      byRid.delete(rid); known.delete(rid); delete it.rid; delete it.space;
      toast(`Couldn't share “${it.title}”: ${e.message || e}`);
      it.folder = folders.find(f => !f.shared)?.id || 'notes'; render();
    } finally { pending.delete(it); }
  }
  async function makeLocal(it){
    // moved out of a shared folder → keep a private copy, remove it from the shared one
    const rid = it.rid; byRid.delete(rid); known.delete(rid);
    try {
      if (it.filePath){
        const b = await blobOf(it);
        if (b){
          if (it.type === 'image'){ it.src = await fileToDataURL(b); it.url = URL.createObjectURL(b); }
          else if (window.stashNative?.storeFile){ const u = await window.stashNative.storeFile(new File([b], it.fname || it.title, { type: b.type })); it.url = u; if (it.type === 'video') it.vsrc = u; else it.data = u; }
          else { it.url = URL.createObjectURL(b); }
        }
      }
    } catch (e) {}
    delete it.rid; delete it.space; delete it.filePath; delete it.updatedBy;
    it.id = uid();
    await sb.from('space_items').delete().eq('id', rid);
    Persist.dirty();
  }
  let syncing = false;
  async function reconcile(){
    if (!ready || syncing) return; syncing = true;
    try {
      const sharedIds = new Set(folders.filter(f => f.shared).map(f => f.id));
      for (const it of items){
        if (pending.has(it)) continue;
        if (!it.rid && sharedIds.has(it.folder)) upload(it);
        else if (it.rid && it.folder !== sid(it.space)){
          if (sharedIds.has(it.folder) && !it.filePath){ const ns = folders.find(f => f.id === it.folder).spaceId; await sb.from('space_items').update({ space_id: ns, updated_by: user.id }).eq('id', it.rid); it.space = ns; }
          else if (sharedIds.has(it.folder)){ const old = it.rid; byRid.delete(old); known.delete(old); delete it.rid; await sb.from('space_items').delete().eq('id', old); upload(it); }
          else await makeLocal(it);
        }
      }
      for (const f of folders.filter(f => f.shared)){ const sp = spaces.get(f.spaceId); if (sp && f.name !== sp.name){ sp.name = f.name; sb.from('spaces').update({ name: f.name }).eq('id', sp.id).then(() => {}); } }
      const present = new Set(items.filter(i => i.rid).map(i => i.rid));
      for (const rid of [...known]) if (!present.has(rid)){ known.delete(rid); byRid.delete(rid); sb.from('space_items').delete().eq('id', rid).then(() => {}); }
    } finally { syncing = false; }
  }

  /* =====================  sharing  ===================== */
  async function ensureSpace(target){
    // target: a folder object or an item
    if (target.shared) return spaces.get(target.spaceId);
    if (target.space) return spaces.get(target.space);
    const isFolder = !!target.name && !target.type;
    const { data: s, error } = await sb.from('spaces').insert({ owner: user.id, kind: isFolder ? 'folder' : 'doc', name: isFolder ? target.name : (target.title || 'Untitled') }).select().single();
    if (error) throw error;
    const sp = { ...s, members: [{ ...prof, role: 'owner' }] }; spaces.set(s.id, sp);
    const f = folderFor(s); folders.push(f);
    if (isFolder){
      items.filter(i => i.folder === target.id).forEach(i => i.folder = f.id);
      folders = folders.filter(x => x !== target);
      if (view === target.id) view = f.id;
    } else target.folder = f.id;
    render(); await new Promise(r => setTimeout(r, 50)); await reconcile();
    return sp;
  }
  let shareFor = null;
  function share(target){
    if (!ready){ toast('Sign in to share'); return; }
    const sp = target.shared ? spaces.get(target.spaceId) : target.space ? spaces.get(target.space) : null;
    shareFor = { target, spaceId: sp?.id };
    const label = target.type ? (target.title || 'Untitled') : target.name;
    dialog(`<h3>Share “${esc(label)}”</h3>
      <p>Invite people by their @username. Everyone in it can see, add and edit${target.type ? ' this note' : ' everything in this folder'} — live.</p>
      <div class="fld"><div class="in"><span>@</span><input id="shU" placeholder="username" autocomplete="off" spellcheck="false"></div></div>
      <div id="shRes" class="shres"></div>
      <div id="shMem"></div>
      <div class="row"><button class="btn" id="shDone">Done</button></div>`, close => {
      const U = $('#shU'), res = $('#shRes'); let seq = 0, found = null;
      const look = async () => {
        const u = cleanU(U.value); if (U.value !== u) U.value = u; found = null;
        if (u.length < 3){ res.innerHTML = ''; return; }
        const my = ++seq; res.innerHTML = '<div class="shmuted">Looking…</div>';
        const { data } = await sb.from('profiles').select('*').eq('username', u).maybeSingle();
        if (my !== seq) return;
        if (!data){ res.innerHTML = `<div class="shmuted">No one has the username @${esc(u)}</div>`; return; }
        if (data.id === user.id){ res.innerHTML = `<div class="shmuted">That's you!</div>`; return; }
        const already = sp && spaces.get(sp.id)?.members.some(m => m.id === data.id);
        found = data;
        res.innerHTML = `<div class="shperson">${avatarOf(data, 34)}<span><b>${esc(data.display_name)}</b><small>@${esc(data.username)}</small></span><button class="btn w" id="shInv" ${already ? 'disabled' : ''}>${already ? 'Already in' : 'Invite'}</button></div>`;
        const inv = $('#shInv'); if (inv) inv.onclick = () => invite(found, inv);
      };
      let t; U.oninput = () => { clearTimeout(t); t = setTimeout(look, 220); };
      U.onkeydown = e => { if (e.key === 'Enter' && found) $('#shInv')?.click(); };
      $('#shDone').onclick = () => { shareFor = null; close(); };
      drawMembers(); setTimeout(() => U.focus(), 30);
    });
  }
  async function invite(p, btn){
    btn.disabled = true; btn.textContent = 'Inviting…';
    try {
      const sp = await ensureSpace(shareFor.target); shareFor.spaceId = sp.id;
      const { error } = await sb.from('space_members').insert({ space_id: sp.id, user_id: p.id, role: 'editor', added_by: user.id });
      if (error && error.code !== '23505') throw error;
      await loadSpace(sp.id); renderSide(); drawMembers();
      btn.textContent = 'Invited ✓'; toast(`Shared with @${p.username}`);
      $('#shU').value = ''; setTimeout(() => { if ($('#shRes')) $('#shRes').innerHTML = ''; }, 900);
    } catch (e) { btn.disabled = false; btn.textContent = 'Invite'; toast(e.message || 'Invite failed'); }
  }
  function drawMembers(){
    const el = $('#shMem'); if (!el || !shareFor) return;
    const sp = shareFor.spaceId && spaces.get(shareFor.spaceId);
    if (!sp){ el.innerHTML = `<div class="shmuted" style="margin-top:4px">Only you — not shared yet.</div>`; return; }
    const owner = sp.owner === user.id;
    el.innerHTML = `<div class="shlist">${sp.members.map(m => `<div class="shperson">${avatarOf(m, 30)}<span><b>${esc(m.display_name)}${m.id === user.id ? ' (you)' : ''}</b><small>@${esc(m.username)}</small></span>
      ${m.role === 'owner' ? '<em>Owner</em>' : owner ? `<button class="btn" data-rm="${m.id}">Remove</button>` : m.id === user.id ? `<button class="btn" data-rm="${m.id}">Leave</button>` : '<em>Editor</em>'}</div>`).join('')}</div>`;
    el.onclick = async e => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      b.disabled = true;
      await sb.from('space_members').delete().eq('space_id', sp.id).eq('user_id', b.dataset.rm);
      if (b.dataset.rm === user.id){ $('#dlg').classList.remove('show'); removeSpaceLocal(sp.id, `You left “${sp.name}”`); return; }
      await loadSpace(sp.id); drawMembers(); renderSide();
    };
  }
  const refreshShareDialog = s => { if (shareFor && shareFor.spaceId === s && $('#dlg').classList.contains('show')) drawMembers(); };

  /* =====================  live note editing  ===================== */
  let live = null;   // {rid, it, chan, peers: Map, ...}
  function attach(it){
    detach();
    if (!ready || !it.rid) return;
    const sp = spaces.get(it.space);
    const ta = $('#nB'), ti = $('#nT'), body = $('#pvbody');
    const isNote = it.type === 'note' && ta;
    // overlay for cursors + presence + history
    const ov = document.createElement('div'); ov.className = 'cov'; body.appendChild(ov);
    const meta = document.createElement('div'); meta.className = 'cmeta';
    const ed = body.querySelector('.editor'); if (ed){ ed.style.position = 'relative'; ed.insertBefore(meta, ed.firstChild.nextSibling); }
    const bar = $('#pvbar'), face = document.createElement('span'); face.className = 'cface'; bar.insertBefore(face, bar.querySelector('.sp').nextSibling);
    const hist = document.createElement('button'); hist.className = 'ib'; hist.textContent = 'History'; if (isNote) bar.insertBefore(hist, face.nextSibling);
    live = { rid: it.rid, it, peers: new Map(), last: isNote ? ta.value : '', lastSaved: it.body, lastSnap: 0, ov, meta, face, ta, ti, body, edited: false };
    const chan = sb.channel('item:' + it.rid, { config: { presence: { key: user.id }, broadcast: { self: false } } });
    live.chan = chan;
    const me = () => ({ id: user.id, name: prof.display_name, username: prof.username, color: prof.color || COLORS[0], photo: prof.photo });

    const alive = () => live && live.chan === chan;
    chan.on('presence', { event: 'sync' }, () => {
      if (!alive()) return;
      const st = chan.presenceState(), ids = new Set(Object.keys(st));
      for (const id of [...live.peers.keys()]) if (!ids.has(id)){ live.peers.get(id).els?.forEach(e => e.remove()); live.peers.delete(id); }
      for (const id of ids){ if (id === user.id) continue; const p = st[id][0]; if (!live.peers.has(id)) live.peers.set(id, { ...p }); else Object.assign(live.peers.get(id), p); }
      drawFace(); drawPeers();
    });
    chan.on('broadcast', { event: 'op' }, ({ payload: o }) => { if (!alive()) return; if (isNote) applyOp(o); bump(o.from, { typing: Date.now() }); });
    chan.on('broadcast', { event: 'full' }, ({ payload: o }) => { if (!alive()) return; if (isNote && o.text !== ta.value) setText(o.text); });
    chan.on('broadcast', { event: 'title' }, ({ payload: o }) => { if (ti && document.activeElement !== ti){ ti.value = o.text; it.title = o.text; } });
    chan.on('broadcast', { event: 'cur' }, ({ payload: o }) => { if (alive()) bump(o.from, o); });
    chan.on('broadcast', { event: 'hash' }, ({ payload: o }) => {
      if (!alive()) return;
      if (!isNote || Date.now() - lastLocal < 1200) return;
      if (o.h !== hash(ta.value) && user.id < o.from) chan.send({ type: 'broadcast', event: 'full', payload: { text: ta.value } });
    });
    chan.subscribe(async s => { if (s === 'SUBSCRIBED') await chan.track({ ...me(), at: Date.now() }); });

    function bump(id, data){ const p = live.peers.get(id) || {}; Object.assign(p, data); live.peers.set(id, p); drawPeers(); drawFace(); }
    // ---------- text ops ----------
    let lastLocal = 0;
    const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
    function setText(t){
      const a = ta.selectionStart, b = ta.selectionEnd, foc = document.activeElement === ta;
      ta.value = t; live.last = t; it.body = t; if (foc) ta.setSelectionRange(Math.min(a, t.length), Math.min(b, t.length));
      ta.dispatchEvent(new Event('collab-fit')); drawPeers();
    }
    function applyOp(o){
      const t = ta.value; if (o.pos > t.length) return setText(o.text ?? t);
      const nt = t.slice(0, o.pos) + o.ins + t.slice(o.pos + o.del);
      const map = c => c <= o.pos ? c : c >= o.pos + o.del ? c - o.del + o.ins.length : o.pos + o.ins.length;
      const a = map(ta.selectionStart), b = map(ta.selectionEnd), foc = document.activeElement === ta;
      ta.value = nt; live.last = nt; it.body = nt; if (foc) ta.setSelectionRange(a, b);
      live.peers.forEach(p => { if (p.caret != null && p.id !== o.from) p.caret = map(p.caret); });
      ta.dispatchEvent(new Event('collab-fit')); drawPeers();
    }
    if (isNote){
      ta.addEventListener('input', () => {
        const old = live.last, nw = ta.value; let i = 0; while (i < old.length && i < nw.length && old[i] === nw[i]) i++;
        let j = 0; while (j < old.length - i && j < nw.length - i && old[old.length - 1 - j] === nw[nw.length - 1 - j]) j++;
        const op = { pos: i, del: old.length - i - j, ins: nw.slice(i, nw.length - j), from: user.id };
        live.last = nw; lastLocal = Date.now(); live.edited = true;
        chan.send({ type: 'broadcast', event: 'op', payload: op });
        sendCur(); scheduleSave();
      });
      ['keyup', 'click', 'select', 'focus'].forEach(ev => ta.addEventListener(ev, sendCur));
      ta.addEventListener('blur', () => chan.send({ type: 'broadcast', event: 'cur', payload: { from: user.id, caret: null } }));
      ti.addEventListener('input', () => { chan.send({ type: 'broadcast', event: 'title', payload: { text: ti.value } }); live.edited = true; scheduleSave(); });
    }
    let curT = 0, curTrail = null;
    function sendCur(){
      const now = Date.now(); clearTimeout(curTrail);
      if (now - curT < 40){ curTrail = setTimeout(sendCur, 45); return; }   // always send the final position
      curT = now;
      chan.send({ type: 'broadcast', event: 'cur', payload: { from: user.id, caret: ta.selectionStart, selEnd: ta.selectionEnd } });
    }
    // mouse pointers (Figma-style), as a fraction of the content width so different window sizes line up
    let mT = 0;
    body.addEventListener('mousemove', live.onMove = e => {
      const now = Date.now(); if (now - mT < 40) return; mT = now;
      const r = body.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = e.clientY - r.top + body.scrollTop;
      chan.send({ type: 'broadcast', event: 'cur', payload: { from: user.id, mx: x, my: y } });
    });
    body.addEventListener('mouseleave', live.onLeave = () => chan.send({ type: 'broadcast', event: 'cur', payload: { from: user.id, mx: null } }));
    // ---------- saving + history ----------
    let saveT = null;
    function scheduleSave(){ clearTimeout(saveT); saveT = setTimeout(save, 700); }
    async function save(final){
      if (!live || live.rid !== it.rid) return;
      const title = ti ? ti.value : it.title, bodyTxt = isNote ? ta.value : it.body;
      it.title = title; it.body = bodyTxt;
      await sb.from('space_items').update({ title, body: bodyTxt, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', it.rid);
      it.updatedBy = user.id; it.t = Date.now(); drawMeta();
      if (live.edited && (final || Date.now() - live.lastSnap > 30000)){
        live.lastSnap = Date.now(); live.edited = false;
        await sb.from('item_history').insert({ item_id: it.rid, user_id: user.id, title, body: bodyTxt });
      }
      chan.send({ type: 'broadcast', event: 'hash', payload: { from: user.id, h: hash(bodyTxt) } });
    }
    live.save = save;
    // ---------- drawing ----------
    function drawFace(){
      if (!alive()) return;
      const ps = [...live.peers.values()];
      face.innerHTML = ps.length ? ps.slice(0, 5).map(p => avatarOf({ display_name: p.name, username: p.username, color: p.color, photo: p.photo }, 24, true)).join('') + `<small>${ps.length === 1 ? esc(p1(ps[0])) + ' is here' : ps.length + ' here'}</small>` : '';
      drawMeta();
    }
    const p1 = p => (p.name || '').split(' ')[0];
    function drawMeta(){
      if (!meta || !alive()) return;
      const typing = [...live.peers.values()].filter(p => p.typing && Date.now() - p.typing < 2500);
      const by = nameOf(it.updatedBy);
      meta.innerHTML = `<span class="cshare">${svg('users')} Shared${sp ? ` in ${esc(sp.kind === 'doc' ? 'this doc' : sp.name)} · ${sp.members.length} people` : ''}</span>` +
        (typing.length ? `<span class="ctyping" style="color:${typing[0].color}">${esc(p1(typing[0]))}${typing.length > 1 ? ` +${typing.length - 1}` : ''} is typing…</span>` : `<span>Last edited by ${by ? esc(by.id === user.id ? 'you' : by.display_name) : '—'} · ${ago(it.t)}</span>`);
    }
    const mirror = document.createElement('div'); mirror.className = 'cmirror';
    function caretXY(idx){
      const cs = getComputedStyle(ta);
      ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'boxSizing', 'borderLeftWidth', 'borderTopWidth'].forEach(k => mirror.style[k] = cs[k]);
      mirror.style.width = ta.clientWidth + 'px';
      mirror.textContent = ta.value.slice(0, idx); const mk = document.createElement('span'); mk.textContent = '​'; mirror.appendChild(mk);
      document.body.appendChild(mirror);
      const x = mk.offsetLeft, y = mk.offsetTop, h = parseFloat(cs.lineHeight) || 24; mirror.remove();
      const tr = ta.getBoundingClientRect(), br = body.getBoundingClientRect();
      return { x: tr.left - br.left + x, y: tr.top - br.top + body.scrollTop + y, h };
    }
    function drawPeers(){
      if (!live) return;
      for (const [id, p] of live.peers){
        p.els = p.els || [];
        let [caret, ptr] = p.els;
        if (!caret){ caret = document.createElement('div'); caret.className = 'ccaret'; ptr = document.createElement('div'); ptr.className = 'cptr'; ov.append(caret, ptr); p.els = [caret, ptr]; }
        const col = p.color || COLORS[0], nm = esc(p1(p) || '@' + (p.username || ''));
        // text caret
        if (isNote && p.caret != null && p.caret <= ta.value.length){
          const a = caretXY(p.caret), typing = p.typing && Date.now() - p.typing < 2500;
          caret.style.cssText = `display:block;left:${a.x}px;top:${a.y}px;height:${a.h}px;--c:${col}`;
          caret.innerHTML = `<i></i><b class="${typing ? 'on' : ''}">${nm}${typing ? ' ✎' : ''}</b>`;
        } else caret.style.display = 'none';
        // mouse pointer
        if (p.mx != null){
          const br = body.getBoundingClientRect();
          ptr.style.cssText = `display:block;transform:translate(${p.mx * br.width}px,${p.my}px);--c:${col}`;
          ptr.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5l13 6.2-5.6 1.6-2.3 5.5z" fill="${col}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg><b>${nm}</b>`;
        } else ptr.style.display = 'none';
      }
    }
    live.redraw = drawPeers;
    live.tick = setInterval(() => { drawMeta(); drawPeers(); }, 1000);
    body.addEventListener('scroll', live.onScroll = () => drawPeers());
    if (isNote) ta.addEventListener('collab-fit', () => ta.dispatchEvent(new Event('input-fit')));
    // history drawer
    hist.onclick = () => openHistory(it, v => { setText(v.body); if (ti){ ti.value = v.title || ti.value; } chan.send({ type: 'broadcast', event: 'full', payload: { text: v.body } }); live.edited = true; save(true); toast('Restored that version'); });
    drawFace(); drawMeta();
  }
  async function detach(){
    if (!live) return;
    const L = live; live = null;
    clearInterval(L.tick);
    try { if (L.edited) { live = L; await L.save(true); live = null; } } catch (e) {}
    try { L.body.removeEventListener('mousemove', L.onMove); L.body.removeEventListener('mouseleave', L.onLeave); L.body.removeEventListener('scroll', L.onScroll); } catch (e) {}
    try { await L.chan.untrack(); sb.removeChannel(L.chan); } catch (e) {}
    L.ov.remove(); $('.chist')?.remove();
  }
  async function openHistory(it, onRestore){
    $('.chist')?.remove();
    const d = document.createElement('aside'); d.className = 'chist';
    d.innerHTML = `<header><b>Version history</b><button class="ib" data-x>✕</button></header><div class="chl"><div class="shmuted">Loading…</div></div>`;
    $('#pv').appendChild(d);
    d.querySelector('[data-x]').onclick = () => d.remove();
    const { data } = await sb.from('item_history').select('*').eq('item_id', it.rid).order('created_at', { ascending: false }).limit(60);
    const list = d.querySelector('.chl');
    if (!data || !data.length){ list.innerHTML = '<div class="shmuted">No saved versions yet. A version is saved about every 30 seconds while people edit, and when they leave.</div>'; return; }
    list.innerHTML = data.map((v, k) => { const p = nameOf(v.user_id) || { display_name: 'Someone', username: '' };
      return `<button class="chv" data-k="${k}">${avatarOf(p, 26)}<span><b>${esc(p.display_name)}</b><small>${ago(v.created_at)} · ${new Date(v.created_at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</small><em>${esc((v.body || '').slice(0, 90))}</em></span></button>`; }).join('');
    list.onclick = e => {
      const b = e.target.closest('.chv'); if (!b) return; const v = data[+b.dataset.k];
      list.querySelectorAll('.chv').forEach(x => x.classList.toggle('on', x === b));
      let pv = d.querySelector('.chp'); if (!pv){ pv = document.createElement('div'); pv.className = 'chp'; d.appendChild(pv); }
      pv.innerHTML = `<div class="chpt">${esc(v.title || '')}</div><pre>${esc(v.body || '')}</pre><button class="btn w" data-r>Restore this version</button>`;
      pv.querySelector('[data-r]').onclick = () => { onRestore(v); d.remove(); };
    };
  }

  /* =====================  sidebar  ===================== */
  function sideHTML(row){
    const sh = folders.filter(f => f.shared); if (!sh.length) return '';
    return `<h6>Shared</h6>` + sh.map(f => {
      const sp = spaces.get(f.spaceId), others = sp ? sp.members.filter(m => m.id !== user?.id) : [];
      return row(f.id, f.name, f.icon, true).replace('<em>', `<span class="cstack">${others.slice(0, 3).map(m => avatarOf(m, 16)).join('')}</span><em>`);
    }).join('');
  }

  // styles
  const css = document.createElement('style');
  css.textContent = `
.cav{display:inline-grid;place-items:center;border-radius:50%;flex:none !important;color:#fff;font-weight:600;background-size:cover;background-position:center;text-transform:uppercase}
.nav .cstack{display:flex;flex:none;margin-right:4px;overflow:visible}.nav .cstack .cav{flex:none;margin-left:-5px;border:1.5px solid #18181b;overflow:hidden;white-space:nowrap}
.cface{display:flex;align-items:center;gap:0;margin-right:6px}.cface .cav{margin-left:-6px;border:2px solid #141418}.cface small{margin-left:8px;font-size:11.5px;color:var(--muted)}
.cmeta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11.5px;color:var(--muted);margin:-6px 0 14px}
.cmeta .cshare{display:inline-flex;align-items:center;gap:5px;color:#9ab8ff}.cmeta svg{width:12px;height:12px}
.ctyping{font-weight:600}
.cov{position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;z-index:5}
.cmirror{position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;top:0;left:-9999px}
.ccaret{position:absolute;width:2px;display:none;transition:left .08s,top .08s}
.ccaret i{position:absolute;inset:0;background:var(--c);border-radius:1px}
.ccaret b{position:absolute;left:0;top:-17px;font-size:10.5px;font-weight:600;line-height:1;padding:3px 6px;border-radius:5px 5px 5px 0;background:var(--c);color:#fff;white-space:nowrap;opacity:.85;transition:opacity .2s}
.ccaret b.on{opacity:1}
.cptr{position:absolute;left:0;top:0;display:none;transition:transform .09s linear}
.cptr b{position:absolute;left:14px;top:14px;font-size:11px;font-weight:600;padding:3px 7px;border-radius:999px;background:var(--c);color:#fff;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.shres{min-height:0}
.shmuted{font-size:12.5px;color:var(--muted);padding:4px 2px;line-height:1.5}
.shperson{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;background:rgba(255,255,255,.04)}
.shperson > span:not(.cav){flex:1;min-width:0}.shperson .cav{flex:none}.shperson b{display:block;font-size:13px}.shperson small{font-size:11.5px;color:var(--muted)}
.shperson em{font-style:normal;font-size:11.5px;color:var(--muted)}
.shlist{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;margin-top:4px}
.chist{position:absolute;top:49px;right:0;bottom:0;width:min(360px,100%);z-index:20;display:flex;flex-direction:column;background:rgba(16,16,20,.97);border-left:1px solid var(--line2);animation:fadein .2s}
.chist header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line)}
.chist header b{font-size:13px}
.chl{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px;flex:1}
.chv{display:flex;gap:10px;align-items:flex-start;padding:9px;border-radius:9px;text-align:left;width:100%}
.chv:hover,.chv.on{background:rgba(255,255,255,.06)}
.chv span{flex:1;min-width:0}.chv b{font-size:12.5px;display:block}.chv small{font-size:11px;color:var(--muted);display:block}
.chv em{font-style:normal;font-size:11.5px;color:rgba(255,255,255,.55);display:block;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chp{border-top:1px solid var(--line);padding:12px;max-height:45%;overflow:auto;display:flex;flex-direction:column;gap:8px}
.chpt{font-weight:600;font-size:14px}.chp pre{white-space:pre-wrap;font:12.5px/1.6 Inter,sans-serif;color:#ddd}
`;
  document.head.appendChild(css);

  return {
    async removeFolder(f){
      const sp = spaces.get(f.spaceId); if (!sp) return;
      if (sp.owner === user.id){ const paths = items.filter(i => i.space === sp.id && i.filePath).map(i => i.filePath); if (paths.length) await sb.storage.from('shared').remove(paths); await sb.from('spaces').delete().eq('id', sp.id); removeSpaceLocal(sp.id, `Deleted “${sp.name}” for everyone`); }
      else { await sb.from('space_members').delete().eq('space_id', sp.id).eq('user_id', user.id); removeSpaceLocal(sp.id, `You left “${sp.name}”`); }
    },
    isOwner: f => spaces.get(f.spaceId)?.owner === user?.id,
    enabled: () => enabled, ready: () => ready, boot, signOut, updateProfile, share, attach, detach, sideHTML, reconcile,
    me: () => prof, spaceOf: it => it && it.space ? spaces.get(it.space) : null
  };
})();
