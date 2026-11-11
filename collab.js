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
  const pushT = new Map();   // when we last saved a section's folder list (so our own echo doesn't undo newer edits)
  const COLORS = ['#4f86e8', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#64748b'];
  const initials = n => (String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?');
  // other people's profile data is untrusted: only allow real image data and plain hex colours into styles
  const safePhoto = v => typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null;
  const safeColor = v => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : COLORS[0];
  const avatarOf = (p, size = 24, ring = false) => { const ph = safePhoto(p.photo), col = safeColor(p.color);
    return `<span class="cav" title="${esc((p.display_name || '') + ' @' + (p.username || ''))}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px;${ph ? `background-image:url('${ph}')` : `background:${col}`};${ring ? `box-shadow:0 0 0 2px ${col}` : ''}">${ph ? '' : esc(initials(p.display_name))}</span>`; };
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
    Account.set({ name: prof.display_name, username: prof.username, color: prof.color, photo: prof.photo, bio: prof.bio || '', created: Date.parse(prof.created_at), uid: prof.id });
    Account._enter();
    if (isNew) toast(`Welcome to Stash, ${prof.display_name.split(' ')[0]}!`);
    await loadAll(); subscribe(); ready = true; render(); Notif.mount(); Notif.load();
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
    dropShared(); People.reset(); Notif.reset(); user = prof = null; ready = false;
    if (open) closeItem(); view = 'home'; render(); emailScreen();
  }
  async function updateProfile(p){
    const { data, error } = await sb.from('profiles').update({ username: p.username, display_name: p.name, color: p.color, photo: p.photo, bio: (p.bio || '').slice(0, 160) || null }).eq('id', user.id).select().single();
    if (error) return error.code === '23505' ? `@${p.username} is taken — try another` : error.message;
    prof = data; return null;
  }

  /* =====================  shared data ⇄ local items  ===================== */
  function dropShared(){
    items = items.filter(i => !i.space); folders = folders.filter(f => !f.shared);
    spaces.clear(); byRid.clear(); known.clear();
  }
  // a shared section can hold its own folders (stored on the space as [{id, name}])
  function subsFor(s){ return (Array.isArray(s.folders) ? s.folders : []).map(x => { const id = sid(s.id) + '/' + x.id, f = folders.find(y => y.id === id); if (f){ f.name = x.name; return f; } return { id, name: x.name, icon: 'folder', shared: true, spaceId: s.id, sub: x.id, parent: sid(s.id) }; }); }
  function syncSubs(s){
    const keep = folders.filter(f => !(f.spaceId === s.id && f.sub)), subs = subsFor(s);
    const at = keep.findIndex(f => f.id === sid(s.id));
    keep.splice(at < 0 ? keep.length : at + 1, 0, ...subs); folders = keep;
    const okIds = new Set(subs.map(f => f.id));
    items.forEach(i => { if (i.space === s.id && i._wantSub && okIds.has(sid(s.id) + '/' + i._wantSub)){ i.folder = sid(s.id) + '/' + i._wantSub; i.sub = i._wantSub; delete i._wantSub; } });
    items.forEach(i => { if (i.space === s.id && i.folder !== sid(s.id) && !okIds.has(i.folder) && String(i.folder).startsWith(sid(s.id) + '/')) i.folder = sid(s.id); });
    if (String(view).startsWith(sid(s.id) + '/') && !okIds.has(view)) view = sid(s.id);
  }
  function folderFor(s){ return { id: sid(s.id), name: s.name, icon: s.kind === 'doc' ? 'note' : 'users', shared: true, spaceId: s.id, kind: s.kind, owner: s.owner }; }
  async function signed(paths){
    if (!paths.length) return {};
    const { data } = await sb.storage.from('shared').createSignedUrls(paths, 60 * 60 * 6);
    const out = {}; (data || []).forEach(d => { if (d.signedUrl) out[d.path] = d.signedUrl; }); return out;
  }
  function toItem(row, urls = {}){
    const it = byRid.get(row.id) || { id: 'r:' + row.id };
    const subOk = row.sub && (spaces.get(row.space_id)?.folders || []).some(x => x.id === row.sub);
    Object.assign(it, { rid: row.id, space: row.space_id, folder: subOk ? sid(row.space_id) + '/' + row.sub : sid(row.space_id), sub: subOk ? row.sub : undefined, _wantSub: !subOk && row.sub ? row.sub : undefined, type: row.type, title: row.title, body: row.body, link: row.link || undefined,
      ext: row.ext || undefined, mime: row.mime || undefined, fname: row.fname || undefined, size: row.size || undefined, dur: row.dur || undefined,
      t: Date.parse(row.updated_at), updatedBy: row.updated_by, filePath: row.file_path || undefined, thumb: row.thumb || it.thumb });
    if (row.doc && typeof row.doc === 'object') it.doc = row.doc; else if (row.type === 'note' && !row.doc && it.doc && !(live && live.rid === row.id)) delete it.doc;
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
      sb.from('space_members').select('*').eq('space_id', spaceId),
      sb.from('space_items').select('*').eq('space_id', spaceId)
    ]);
    if (!s || !(mem || []).some(m => m.user_id === user.id && (m.status || 'active') === 'active')) return null;   // invited but not accepted yet → not ours to show
    const pids = (mem || []).map(m => m.user_id), { data: ps } = pids.length ? await sb.from('profiles').select('*').in('id', pids) : { data: [] };
    const pm = new Map((ps || []).map(p => [p.id, p])), person = m => ({ ...(pm.get(m.user_id) || { id: m.user_id, display_name: 'Someone', username: '' }), role: m.role, added_by: m.added_by });
    const prev = spaces.get(s.id);
    if (prev && Date.now() - (pushT.get(s.id) || 0) < 2500) s.folders = prev.folders;
    const sp = { ...s, members: (mem || []).filter(m => (m.status || 'active') === 'active').map(person).sort((a, b) => (b.role === 'owner') - (a.role === 'owner')), invited: (mem || []).filter(m => m.status === 'pending').map(person) };
    spaces.set(s.id, sp);
    const f = folders.find(x => x.id === sid(s.id)); if (f) Object.assign(f, folderFor(s)); else folders.push(folderFor(s));
    syncSubs(sp);
    const urls = await signed((rows || []).filter(r => r.file_path).map(r => r.file_path));
    (rows || []).forEach(r => toItem(r, urls));
    return sp;
  }
  async function loadAll(){
    const { data } = await sb.from('space_members').select('*').eq('user_id', user.id);
    await Promise.all((data || []).filter(m => (m.status || 'active') === 'active').map(m => loadSpace(m.space_id)));
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
        const it = toItem(editing ? { ...row, body: byRid.get(row.id)?.body ?? row.body, title: byRid.get(row.id)?.title ?? row.title, doc: byRid.get(row.id)?.doc ?? row.doc } : row, urls);
        if (!editing && open !== it) render();
        else if (!editing) renderSide();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'space_members', filter: `user_id=eq.${user.id}` }, async p => {
        if (p.new.status === 'pending'){   // an invite: it waits in the notification centre until you accept
          await Notif.load(); const n = Notif.invite(p.new.space_id);
          toast(n ? `@${n.by.username} invited you to “${n.space.name}”` : 'You have a new invite'); Notif.ping(); return;
        }
        const sp = await loadSpace(p.new.space_id); render();
        if (sp && p.new.added_by !== user.id){ const by = sp.members.find(m => m.id === p.new.added_by); toast(`${by ? '@' + by.username : 'Someone'} shared “${sp.name}” with you`); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_members' }, async p => {
        const s = (p.new && p.new.space_id) || (p.old && p.old.space_id);
        if (p.eventType === 'DELETE' && p.old.user_id === user.id){ removeSpaceLocal(s, 'You were removed from a shared folder'); Notif.load(); return; }
        if (p.eventType === 'UPDATE' && p.new.status === 'active'){
          if (p.new.user_id === user.id && !spaces.has(s)){ await loadSpace(s); render(); Notif.load(); return; }   // accepted on another device
          if (p.new.added_by === user.id && p.new.user_id !== user.id){ await Notif.load(); const n = Notif.joined(s, p.new.user_id); if (n) toast(`@${n.by.username} joined “${n.space.name}”`); Notif.ping(); }
        }
        if (s && spaces.has(s)){ await loadSpace(s); renderSide(); refreshShareDialog(s); }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follows', filter: `following=eq.${user.id}` }, p => People.onFollowed(p.new.follower))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, async p => {
        if (p.eventType === 'DELETE'){ removeSpaceLocal(p.old.id, 'A shared folder was deleted by its owner'); return; }
        const sp = spaces.get(p.new.id); if (sp){ sp.name = p.new.name; const fresh = p.new.folders && Date.now() - (pushT.get(sp.id) || 0) > 2500; if (fresh) sp.folders = p.new.folders; const f = folders.find(x => x.id === sid(sp.id)); if (f) f.name = p.new.name; if (fresh) syncSubs(sp); render(); }
      })
      .subscribe();
  }
  function removeSpaceLocal(spaceId, msg){
    if (!spaces.has(spaceId)) return;
    spaces.delete(spaceId);
    items.filter(i => i.space === spaceId).forEach(i => { byRid.delete(i.rid); known.delete(i.rid); });
    items = items.filter(i => i.space !== spaceId); folders = folders.filter(f => f.id !== sid(spaceId) && f.spaceId !== spaceId);
    if (open && open.space === spaceId) closeItem();
    if (view === sid(spaceId) || String(view).startsWith(sid(spaceId) + '/')) view = 'home';
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
    const fo = folders.find(f => f.id === it.folder), spaceId = fo?.spaceId;
    // the id is made here so the live "new row" echo maps back onto this same item
    const rid = crypto.randomUUID(); it.rid = rid; it.space = spaceId; it.sub = fo?.sub || undefined; byRid.set(rid, it); known.add(rid);
    try {
      const row = { id: rid, space_id: spaceId, sub: fo?.sub || null, type: it.type === 'link' ? 'link' : it.type, title: it.title || '', body: it.body || '', link: it.link || null, ext: it.ext || null, mime: it.mime || null, fname: it.fname || null, size: it.size || null, dur: it.dur || null, created_by: user.id, updated_by: user.id };
      if (it.type === 'note' && it.doc){ await shareMedia(it.doc, spaceId); row.doc = it.doc; row.body = window.Pad ? Pad.toText(it.doc) : row.body; }
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
  // pictures/videos inside a note live in the shared bucket so everyone in the folder can see them
  function noteMedia(d){ const out = []; (d.blocks || []).forEach(b => { if (b.t === 'img') out.push(b); }); (d.objs || []).forEach(o => { if (o.k === 'image' || o.k === 'video') out.push(o); }); if (d.meta && d.meta.cover && typeof d.meta.cover === 'object') out.push(d.meta.cover); return out; }
  async function putNoteFile(blob, spaceId, name){
    const path = `${spaceId}/note/${crypto.randomUUID()}-${String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-60)}`;
    const { error } = await sb.storage.from('shared').upload(path, blob, { contentType: blob.type || 'application/octet-stream' });
    if (error) throw error; return path;
  }
  async function shareMedia(d, spaceId){
    for (const m of noteMedia(d)){
      if (m.path && m.path.startsWith(spaceId + '/')) continue;
      const src = m.src || (m.path ? (await signed([m.path]))[m.path] : null); if (!src) continue;
      try { const b = await (await fetch(src)).blob(); m.path = await putNoteFile(b, spaceId, 'media.' + ((b.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'))); } catch (e) {}
    }
  }
  async function localMedia(d){
    for (const m of noteMedia(d)){
      if (!m.path) continue;
      try { const u = (await signed([m.path]))[m.path]; if (!u) continue; const b = await (await fetch(u)).blob();
        m.src = window.stashNative?.storeFile ? await window.stashNative.storeFile(new File([b], 'note-media.' + (b.type.split('/')[1] || 'bin'), { type: b.type })) : await fileToDataURL(b); delete m.path; } catch (e) {}
    }
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
    if (it.type === 'note' && it.doc) await localMedia(it.doc);
    delete it.rid; delete it.space; delete it.filePath; delete it.updatedBy;
    it.id = uid();
    await sb.from('space_items').delete().eq('id', rid);
    Persist.dirty();
  }
  // the numbers shown on your profile (how many notes, folders…) — counts only, never the contents
  let statsT = null;
  function statsSoon(){
    clearTimeout(statsT); statsT = setTimeout(async () => {
      if (!ready || !prof) return;
      const c = t => items.filter(i => i.type === t).length;
      const st = prof.stats && prof.stats.hidden ? { hidden: true } : { items: items.length, notes: c('note'), images: c('image'), videos: c('video'), docs: c('doc'), links: c('link'), folders: folders.length };
      if (stable(st) === stable(prof.stats || {})) return;
      const { error } = await sb.from('profiles').update({ stats: st }).eq('id', user.id);
      if (!error) prof.stats = st;
    }, 3000);
  }
  async function setStatsHidden(h){ prof.stats = h ? { hidden: true, _: 1 } : { _: 1 }; statsSoon(); }
  let syncing = false;
  async function reconcile(){
    if (ready) statsSoon();
    if (!ready || syncing) return; syncing = true;
    try {
      const fOf = id => folders.find(f => f.id === id);
      for (const it of items){
        if (pending.has(it)) continue;
        const fo = fOf(it.folder), fsp = fo && fo.shared ? fo.spaceId : null;
        if (!it.rid){ if (fsp) upload(it); continue; }
        if (fsp === it.space){
          const ns = fo.sub || null;
          if ((it.sub || null) !== ns){ it.sub = ns || undefined; await sb.from('space_items').update({ sub: ns, updated_by: user.id }).eq('id', it.rid); }
          continue;
        }
        if (fsp && !it.filePath){ const patch = { space_id: fsp, sub: fo.sub || null, updated_by: user.id }; if (it.type === 'note' && it.doc){ await shareMedia(it.doc, fsp); patch.doc = it.doc; } await sb.from('space_items').update(patch).eq('id', it.rid); it.space = fsp; it.sub = fo.sub || undefined; }
        else if (fsp){ const old = it.rid; byRid.delete(old); known.delete(old); delete it.rid; await sb.from('space_items').delete().eq('id', old); upload(it); }
        else await makeLocal(it);
      }
      for (const f of folders.filter(f => f.shared && !f.sub)){ const sp = spaces.get(f.spaceId); if (sp && f.name !== sp.name){ sp.name = f.name; sb.from('spaces').update({ name: f.name }).eq('id', sp.id).then(() => {}); } }
      // folders inside sections: created / renamed / reordered / deleted here → saved on the section
      for (const sp of spaces.values()){
        if (sp.kind !== 'folder') continue;
        const local = folders.filter(f => f.spaceId === sp.id && f.sub).map(f => ({ id: f.sub, name: f.name }));
        if (JSON.stringify(local) !== JSON.stringify(sp.folders || [])){ sp.folders = local; pushT.set(sp.id, Date.now()); await sb.from('spaces').update({ folders: local }).eq('id', sp.id); pushT.set(sp.id, Date.now()); }
      }
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
      <p>Invite people by their @username. They get a notification, and once they accept they can see, add and edit${target.type ? ' this note' : ' everything in this folder'} — live.</p>
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
        const cur = shareFor.spaceId && spaces.get(shareFor.spaceId), already = cur && cur.members.some(m => m.id === data.id), waiting = cur && (cur.invited || []).some(m => m.id === data.id);
        found = data;
        res.innerHTML = `<div class="shperson">${avatarOf(data, 34)}<span><b>${esc(data.display_name)}</b><small>@${esc(data.username)}</small></span><button class="btn w" id="shInv" ${already || waiting ? 'disabled' : ''}>${already ? 'Already in' : waiting ? 'Invited' : 'Invite'}</button></div>`;
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
      const { error } = await sb.from('space_members').insert({ space_id: sp.id, user_id: p.id, role: 'editor', added_by: user.id, status: 'pending' });
      if (error && error.code !== '23505') throw error;
      await loadSpace(sp.id); renderSide(); drawMembers();
      btn.textContent = 'Invite sent ✓'; toast(`Invite sent to @${p.username}`);
      $('#shU').value = ''; setTimeout(() => { if ($('#shRes')) $('#shRes').innerHTML = ''; }, 900);
    } catch (e) { btn.disabled = false; btn.textContent = 'Invite'; toast(e.message || 'Invite failed'); }
  }
  function drawMembers(){
    const el = $('#shMem'); if (!el || !shareFor) return;
    const sp = shareFor.spaceId && spaces.get(shareFor.spaceId);
    if (!sp){ el.innerHTML = `<div class="shmuted" style="margin-top:4px">Only you — not shared yet.</div>`; return; }
    const owner = sp.owner === user.id;
    el.innerHTML = `<div class="shlist">${sp.members.map(m => `<div class="shperson">${avatarOf(m, 30)}<span><b>${esc(m.display_name)}${m.id === user.id ? ' (you)' : ''}</b><small>@${esc(m.username)}</small></span>
      ${m.role === 'owner' ? '<em>Owner</em>' : owner ? `<button class="btn" data-rm="${m.id}">Remove</button>` : m.id === user.id ? `<button class="btn" data-rm="${m.id}">Leave</button>` : '<em>Editor</em>'}</div>`).join('')}${(sp.invited || []).map(m => `<div class="shperson shwait">${avatarOf(m, 30)}<span><b>${esc(m.display_name)}</b><small>@${esc(m.username)} · waiting for them to accept</small></span>${owner || m.added_by === user.id ? `<button class="btn" data-rm="${m.id}" data-cancel="1">Cancel</button>` : '<em>Invited</em>'}</div>`).join('')}</div>`;
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
    if (it.type === 'note' && window.Pad && Pad.current && Pad.current.it === it) return attachPad(it, Pad.current);
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
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
  const hashStr = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  function attachPad(it, pad){
    const sp = spaces.get(it.space), body = $('#pvbody'), bar = $('#pvbar');
    const face = document.createElement('span'); face.className = 'cface'; bar.insertBefore(face, bar.querySelector('.sp').nextSibling);
    const hist = document.createElement('button'); hist.className = 'ib'; hist.textContent = 'History'; bar.insertBefore(hist, face.nextSibling);
    const meta = document.createElement('div'); meta.className = 'cmeta'; pad.metaSlot().appendChild(meta);
    const ov = document.createElement('div'); ov.style.display = 'none'; body.appendChild(ov);
    live = { rid: it.rid, it, pad, peers: new Map(), lastSnap: 0, ov, meta, face, body, edited: false };
    const chan = sb.channel('item:' + it.rid, { config: { presence: { key: user.id }, broadcast: { self: false } } });
    live.chan = chan;
    const alive = () => live && live.chan === chan;
    const me = () => ({ id: user.id, name: prof.display_name, username: prof.username, color: prof.color || COLORS[0], photo: prof.photo });
    let lastLocal = 0;
    const sendFull = () => chan.send({ type: 'broadcast', event: 'dfull', payload: { from: user.id, doc: pad.doc(), title: it.title } });
    chan.on('presence', { event: 'sync' }, () => {
      if (!alive()) return;
      const st = chan.presenceState(), ids = new Set(Object.keys(st));
      for (const id of [...live.peers.keys()]) if (!ids.has(id)) live.peers.delete(id);
      for (const id of ids){ if (id === user.id) continue; const p = st[id][0]; if (!live.peers.has(id)) live.peers.set(id, { ...p }); else Object.assign(live.peers.get(id), p); }
      drawFace(); drawPeers();
    });
    chan.on('broadcast', { event: 'dop' }, ({ payload: o }) => { if (!alive()) return; pad.apply(o.op); if (o.op.t === 'ti') it.title = o.op.v; bump(o.from, { typing: Date.now() }); });
    chan.on('broadcast', { event: 'dfull' }, ({ payload: o }) => { if (!alive()) return; if (o.title != null) it.title = o.title; pad.setDoc(o.doc, true); });
    chan.on('broadcast', { event: 'needfull' }, () => { if (alive()) sendFull(); });
    chan.on('broadcast', { event: 'cur' }, ({ payload: o }) => { if (alive()) bump(o.from, o); });
    chan.on('broadcast', { event: 'hash' }, ({ payload: o }) => {
      if (!alive() || Date.now() - lastLocal < 1500) return;
      if (o.h !== hashStr(stable(pad.doc())) && user.id < o.from) sendFull();
    });
    chan.subscribe(async s => { if (s === 'SUBSCRIBED') await chan.track({ ...me(), at: Date.now() }); });
    function bump(id, data){ const p = live.peers.get(id) || {}; Object.assign(p, data); live.peers.set(id, p); drawPeers(); drawFace(); }
    pad.onOp(op => { if (!alive()) return; lastLocal = Date.now(); live.edited = true; chan.send({ type: 'broadcast', event: 'dop', payload: { from: user.id, op } }); scheduleSave(); });
    pad.onCursor(c => {
      if (c.needFull){ chan.send({ type: 'broadcast', event: 'needfull', payload: { from: user.id } }); return; }
      if (alive()) chan.send({ type: 'broadcast', event: 'cur', payload: { from: user.id, ...c } });
    });
    // pictures added to a shared note go to the shared bucket
    pad.hooks.upload = async f => { const path = await putNoteFile(f, it.space, f.name); const u = (await signed([path]))[path]; return { path, src: u }; };
    pad.hooks.resolve = async p => (await signed([p]))[p];
    if (noteMedia(pad.doc()).some(m => m.path)) pad.setDoc(JSON.parse(JSON.stringify(pad.doc())), true);
    let saveT = null;
    function scheduleSave(){ clearTimeout(saveT); saveT = setTimeout(save, 700); }
    async function save(final){
      if (!live || live.rid !== it.rid) return;
      const d = pad.doc(); it.body = Pad.toText(d);
      await sb.from('space_items').update({ title: it.title || '', body: it.body, doc: d, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', it.rid);
      it.updatedBy = user.id; it.t = Date.now(); drawMeta();
      if (live && live.edited && (final || Date.now() - live.lastSnap > 30000)){
        live.lastSnap = Date.now(); live.edited = false;
        await sb.from('item_history').insert({ item_id: it.rid, user_id: user.id, title: it.title || '', body: it.body, doc: d });
      }
      chan.send({ type: 'broadcast', event: 'hash', payload: { from: user.id, h: hashStr(stable(d)) } });
    }
    live.save = save;
    const p1 = p => (p.name || '').split(' ')[0];
    function drawFace(){
      if (!alive()) return;
      const ps = [...live.peers.values()];
      face.innerHTML = ps.length ? ps.slice(0, 5).map(p => avatarOf({ display_name: p.name, username: p.username, color: p.color, photo: p.photo }, 24, true)).join('') + `<small>${ps.length === 1 ? esc(p1(ps[0])) + ' is here' : ps.length + ' here'}</small>` : '';
      drawMeta();
    }
    function drawMeta(){
      if (!alive()) return;
      const typing = [...live.peers.values()].filter(p => p.typing && Date.now() - p.typing < 2500), by = nameOf(it.updatedBy);
      meta.innerHTML = `<span class="cshare">${svg('users')} Shared${sp ? ` · ${sp.members.length} people` : ''}</span>` +
        (typing.length ? `<span class="ctyping" style="color:${typing[0].color}">${esc(p1(typing[0]))}${typing.length > 1 ? ` +${typing.length - 1}` : ''} is editing…</span>` : `<span>Edited by ${by ? esc(by.id === user.id ? 'you' : by.display_name) : '—'} · ${ago(it.t)}</span>`);
    }
    function drawPeers(){ if (alive()) pad.drawPeers([...live.peers.values()]); }
    live.redraw = drawPeers;
    live.tick = setInterval(() => { drawMeta(); drawPeers(); }, 1000);
    hist.onclick = () => openHistory(it, v => { if (v.title) it.title = v.title; pad.setDoc(v.doc || Pad.fromText(v.body || ''), true); sendFull(); live.edited = true; save(true); toast('Restored that version'); });
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

  /* =====================  people: search, profiles, follow  ===================== */
  const People = (() => {
    let iFollow = new Set(), followsMe = new Set(), seq = 0, qT = null, shownAt = 0;
    const cache = new Map();
    const S = { q: '', results: null, tab: null, lists: {}, who: null, wtab: 'followers', wlists: {} };
    const host = () => $('#peoplev');
    const num = v => { v = +v || 0; return v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(v); };
    const pl = (v, w) => `${num(v)} ${w}${(+v || 0) === 1 ? '' : 's'}`;
    const keep = p => { const c = cache.get(p.id); if (c){ Object.assign(c, p); return c; } cache.set(p.id, p); return p; };
    function reset(){ iFollow = new Set(); followsMe = new Set(); cache.clear(); Object.assign(S, { q: '', results: null, tab: null, lists: {}, who: null, wlists: {} }); shownAt = 0; const h = host(); if (h) h.innerHTML = ''; }

    async function loadMine(){
      const [a, b, me] = await Promise.all([
        sb.from('follows').select('following').eq('follower', user.id),
        sb.from('follows').select('follower').eq('following', user.id),
        sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
      ]);
      iFollow = new Set((a.data || []).map(r => r.following)); followsMe = new Set((b.data || []).map(r => r.follower));
      if (me.data){ const st = prof.stats; Object.assign(prof, me.data); if (st && st._) prof.stats = st; }
    }
    async function profilesOf(ids){
      if (!ids.length) return [];
      const { data } = await sb.from('profiles').select('*').in('id', ids.slice(0, 200));
      const m = new Map((data || []).map(p => [p.id, keep(p)])); return ids.map(i => m.get(i)).filter(Boolean);
    }
    async function listFor(id, kind){
      const col = kind === 'followers' ? 'follower' : 'following', by = kind === 'followers' ? 'following' : 'follower';
      const { data } = await sb.from('follows').select(col + ', created_at').eq(by, id).order('created_at', { ascending: false }).limit(200);
      return profilesOf((data || []).map(r => r[col]));
    }
    async function discover(){
      const { data } = await sb.from('profiles').select('*').neq('id', user.id).order('followers', { ascending: false }).limit(40);
      return (data || []).map(keep).filter(p => !iFollow.has(p.id)).sort((a, b) => (b.followers || 0) - (a.followers || 0)).slice(0, 20);
    }
    async function search(q){
      S.q = q; const my = ++seq;
      const term = q.replace(/^@+/, '').replace(/[,()%*\\"']/g, ' ').trim().slice(0, 40);
      if (!term){ S.results = null; S.q = ''; draw(); return; }
      S.results = null; S.who = null; draw();
      const { data } = await sb.from('profiles').select('*').or(`username.ilike.%${term}%,display_name.ilike.%${term}%`).limit(25);
      if (my !== seq) return;
      const t = term.toLowerCase(), rank = p => { const u = String(p.username).toLowerCase(), d = String(p.display_name).toLowerCase(); return u === t ? 0 : u.startsWith(t) ? 1 : d.startsWith(t) ? 2 : 3; };
      S.results = (data || []).map(keep).sort((a, b) => rank(a) - rank(b) || (b.followers || 0) - (a.followers || 0));
      draw();
    }
    async function loadTab(){
      const tab = S.tab; if (S.lists[tab]) return;
      const l = tab === 'discover' ? await discover() : await listFor(user.id, tab);
      S.lists[tab] = l; if (!S.who && !S.q) draw();
    }
    async function loadWho(){
      const w = S.who, tab = S.wtab; if (!w || S.wlists[tab]) return;
      const l = await listFor(w.id, tab); if (S.who !== w) return;
      S.wlists[tab] = l; draw();
    }
    async function openProfile(id){
      S.who = cache.get(id) || (id === user.id ? keep({ ...prof }) : { id, display_name: '…', username: '' }); S.wtab = 'followers'; S.wlists = {}; draw();
      host().scrollTop = 0;
      const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!data){ if (S.who && S.who.id === id){ S.who = null; draw(); toast("That profile isn't available"); } return; }
      const p = keep(data); if (S.who && S.who.id === id){ S.who = p; draw(); loadWho(); }
    }
    async function toggle(id, btn){
      const on = iFollow.has(id); if (btn) btn.disabled = true;
      const { error } = on ? await sb.from('follows').delete().eq('follower', user.id).eq('following', id) : await sb.from('follows').insert({ follower: user.id, following: id });
      if (error && error.code !== '23505'){ toast(error.message || "Couldn't update — try again"); if (btn) btn.disabled = false; return; }
      on ? iFollow.delete(id) : iFollow.add(id);
      prof.following = Math.max(0, (prof.following || 0) + (on ? -1 : 1));
      const c = cache.get(id); if (c) c.followers = Math.max(0, (c.followers || 0) + (on ? -1 : 1));
      if (!on) delete S.lists.following;
      if (S.who && S.who.id === id){ S.wlists = {}; loadWho(); }
      draw(); if (c && !on) toast(`You're following @${c.username}`);
    }
    async function onFollowed(fid){
      if (!ready || followsMe.has(fid)) return;
      followsMe.add(fid); prof.followers = (prof.followers || 0) + 1; delete S.lists.followers;
      const [p] = await profilesOf([fid]);
      if (p) toast(`@${p.username} followed you${iFollow.has(fid) ? ' back' : ''}`);
      Notif.load().then(() => Notif.ping());
      if (view === 'people'){ if (!S.who && !S.q && S.tab === 'followers') loadTab(); draw(); }
    }

    /* ---------- drawing ---------- */
    function fbtn(p){
      if (p.id === user.id) return '';
      const on = iFollow.has(p.id);
      return `<button class="pfb${on ? ' on' : ''}" data-follow="${p.id}">${on ? '<span class="a">Following</span><span class="b">Unfollow</span>' : followsMe.has(p.id) ? 'Follow back' : 'Follow'}</button>`;
    }
    function rowHTML(p){
      const st = p.stats || {}, bits = [`@${esc(p.username)}`, pl(p.followers, 'follower')];
      if (!st.hidden && st.notes != null) bits.push(pl(st.notes, 'note'));
      return `<div class="prow" data-p="${p.id}">${avatarOf(p, 42)}<div class="pi"><b><span>${esc(p.display_name)}</span>${p.id === user.id ? '<i class="pfy">You</i>' : followsMe.has(p.id) ? '<i class="pfy">Follows you</i>' : ''}</b><small>${bits.join(' · ')}</small>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}</div>${fbtn(p)}</div>`;
    }
    const listHTML = (l, empty) => !l ? '<div class="pempty">Loading…</div>' : l.length ? l.map(rowHTML).join('') : `<div class="pempty">${empty}</div>`;
    function homeHTML(){
      const tabs = [['following', 'Following', prof.following], ['followers', 'Followers', prof.followers], ['discover', 'Discover', null]];
      const empty = { following: "You're not following anyone yet.<br>Search for someone above, or look in Discover.", followers: 'No followers yet. When someone follows you, they show up here.', discover: 'No one new to suggest right now.' }[S.tab];
      return `<div class="pme" data-p="${user.id}">${avatarOf(prof, 46)}<div class="pi"><b><span>${esc(prof.display_name)}</span></b><small>@${esc(prof.username)} · ${pl(prof.followers, 'follower')} · ${num(prof.following)} following</small></div><span class="pview">View profile ›</span></div>
        <div class="ptabs">${tabs.map(([k, l, c]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${c != null ? `<em>${num(c)}</em>` : ''}</button>`).join('')}</div>
        <div class="plist">${listHTML(S.lists[S.tab], empty)}</div>`;
    }
    function resultsHTML(){
      return `<div class="plabel">${S.results ? `${S.results.length ? S.results.length : 'No'} result${S.results.length === 1 ? '' : 's'} for “${esc(S.q.trim())}”` : 'Searching…'}</div>
        <div class="plist">${listHTML(S.results, 'No one found with that name or @username.<br>Check the spelling, or try part of the name.')}</div>`;
    }
    function profileHTML(p){
      const me = p.id === user.id, st = p.stats || {}, hid = !!st.hidden;
      const stat = (v, l, k) => `<button class="pst${k && S.wtab === k ? ' on' : ''}"${k ? ` data-wtab="${k}"` : ' disabled'}><b>${num(v)}</b><small>${l}</small></button>`;
      const mix = [['images', 'image'], ['videos', 'video'], ['docs', 'doc'], ['links', 'link']].filter(([k]) => st[k] > 0).map(([k, w]) => pl(st[k], w)).join(' · ');
      const joined = p.created_at ? `Joined ${new Date(p.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '';
      return `<button class="ib pback" data-back>‹ People</button>
        <div class="phero">${avatarOf(p, 88)}<div class="ph1"><h1>${esc(p.display_name)}</h1><p><span>@${esc(p.username)}</span>${!me && followsMe.has(p.id) ? '<i class="pfy">Follows you</i>' : ''}</p>${p.bio ? `<div class="pbio">${esc(p.bio)}</div>` : ''}<small>${joined}</small></div>${me ? '<button class="pfb ghost" data-edit>Edit profile</button>' : p.username ? fbtn(p) : ''}</div>
        <div class="pstats">${stat(p.followers, 'Followers', 'followers')}${stat(p.following, 'Following', 'following')}${hid ? '' : stat(st.notes, 'Notes') + stat(st.folders, 'Folders') + stat(st.items, 'Items')}</div>
        ${!hid && mix ? `<div class="pmix">Also ${mix}</div>` : hid ? `<div class="pmix">${me ? 'Your' : 'Their'} note and folder counts are hidden.</div>` : ''}
        <div class="ptabs"><button class="${S.wtab === 'followers' ? 'on' : ''}" data-wtab="followers">Followers</button><button class="${S.wtab === 'following' ? 'on' : ''}" data-wtab="following">Following</button></div>
        <div class="plist">${listHTML(S.wlists[S.wtab], S.wtab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.')}</div>`;
    }
    function draw(){
      const b = $('#pplB'); if (!b) return;
      b.innerHTML = S.who ? profileHTML(S.who) : S.q ? resultsHTML() : homeHTML();
      const inp = $('#pplQ'); if (inp){ if (document.activeElement !== inp && inp.value !== S.q) inp.value = S.q; inp.parentElement.classList.toggle('has', !!inp.value); }
    }
    function build(){
      const h = host();
      h.innerHTML = `<div class="ppl"><div class="phead"><h1>People</h1><div class="psearch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pplQ" placeholder="Search by name or @username" autocomplete="off" spellcheck="false"><button id="pplX" title="Clear">✕</button></div></div><div id="pplB"></div></div>`;
      const inp = $('#pplQ');
      inp.oninput = () => { inp.parentElement.classList.toggle('has', !!inp.value); clearTimeout(qT); qT = setTimeout(() => search(inp.value), 220); };
      inp.onkeydown = e => { if (e.key === 'Escape'){ e.stopPropagation(); inp.value = ''; search(''); inp.blur(); } if (e.key === 'Enter'){ clearTimeout(qT); search(inp.value); } };
      $('#pplX').onclick = () => { inp.value = ''; search(''); inp.focus(); };
      h.onclick = e => {
        const f = e.target.closest('[data-follow]'); if (f){ e.stopPropagation(); toggle(f.dataset.follow, f); return; }
        if (e.target.closest('[data-back]')){ S.who = null; draw(); if (!S.q) loadTab(); return; }
        if (e.target.closest('[data-edit]')){ view = 'account'; render(); return; }
        const t = e.target.closest('[data-tab]'); if (t){ S.tab = t.dataset.tab; draw(); loadTab(); return; }
        const w = e.target.closest('[data-wtab]'); if (w){ S.wtab = w.dataset.wtab; draw(); loadWho(); return; }
        const p = e.target.closest('[data-p]'); if (p) openProfile(p.dataset.p);
      };
    }
    async function refresh(){
      await loadMine();
      if (!S.tab) S.tab = iFollow.size ? 'following' : 'discover';
      S.lists = {}; draw(); loadTab(); if (S.who) { S.wlists = {}; loadWho(); }
    }
    function show(){
      const h = host(); if (!h) return;
      if (!ready){ h.innerHTML = '<div class="ppl"><div class="pempty">Sign in to find and follow people.</div></div>'; return; }
      if (!h.querySelector('#pplB')){ build(); draw(); }
      if (Date.now() - shownAt > 12000){ shownAt = Date.now(); refresh(); }
    }
    // from the search box in the title bar: "@name" jumps here
    function find(q){ show(); const inp = $('#pplQ'); if (inp) inp.value = q; clearTimeout(qT); qT = setTimeout(() => search(q), 200); }
    function openMe(){ view = 'people'; render(); openProfile(user.id); }
    let mineLoaded = false;
    const ensure = async () => { if (!mineLoaded){ mineLoaded = true; await loadMine(); } };
    return { show, find, reset: () => { mineLoaded = false; reset(); }, onFollowed, openMe, ensure, toggle, isFollowing: id => iFollow.has(id), open: id => { view = 'people'; if (open) closeItem(); render(); openProfile(id); }, counts: () => prof ? { followers: prof.followers || 0, following: prof.following || 0 } : null };
  })();

  /* =====================  notification centre  ===================== */
  const Notif = (() => {
    let list = [], panel = null, bell = null, busy = new Set(), wired = false;
    const key = () => 'stash-notif-seen:' + (user ? user.id : '');
    const seen = () => { try { return +localStorage.getItem(key()) || 0; } catch (e) { return 0; } };
    const markSeen = () => { try { localStorage.setItem(key(), String(Date.now())); } catch (e) {} };
    const unread = n => n.kind === 'invite' || n.t > seen();
    function mount(){
      if (bell) return;
      bell = document.createElement('button'); bell.className = 'nbell'; bell.id = 'bell'; bell.title = 'Notifications';
      bell.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg><i></i>';
      const bar = $('.bar'), before = $('#talkTop') || $('#askTop'); bar.insertBefore(bell, before);
      bell.onclick = e => { e.stopPropagation(); panel ? close() : openPanel(); };
      if (!wired){ wired = true;
        addEventListener('pointerdown', e => { if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) close(); }, true);
        addEventListener('keydown', e => { if (e.key === 'Escape' && panel){ e.stopPropagation(); close(); } }, true); }
    }
    function reset(){ list = []; close(true); if (bell){ bell.remove(); bell = null; } }
    async function load(){
      if (!user) return;
      await People.ensure();
      const [inv, fol, acc] = await Promise.all([
        sb.from('space_members').select('*').eq('user_id', user.id).eq('status', 'pending'),
        sb.from('follows').select('follower, created_at').eq('following', user.id).order('created_at', { ascending: false }).limit(30),
        sb.from('space_members').select('*').eq('added_by', user.id).eq('status', 'active').limit(100)
      ]);
      const invs = inv.data || [], fols = fol.data || [], accs = (acc.data || []).filter(r => r.user_id !== user.id && r.accepted_at);
      const sids = [...new Set([...invs, ...accs].map(r => r.space_id))], pids = [...new Set([...invs.map(r => r.added_by), ...fols.map(r => r.follower), ...accs.map(r => r.user_id)].filter(Boolean))];
      const [sp, ps] = await Promise.all([sids.length ? sb.from('spaces').select('*').in('id', sids) : { data: [] }, pids.length ? sb.from('profiles').select('*').in('id', pids) : { data: [] }]);
      const SP = new Map((sp.data || []).map(x => [x.id, x])), P = new Map((ps.data || []).map(x => [x.id, x]));
      list = [
        ...invs.map(r => ({ id: 'i:' + r.space_id, kind: 'invite', t: Date.parse(r.added_at) || Date.now(), space: SP.get(r.space_id), by: P.get(r.added_by) })),
        ...fols.map(r => ({ id: 'f:' + r.follower, kind: 'follow', t: Date.parse(r.created_at) || Date.now(), by: P.get(r.follower) })),
        ...accs.map(r => ({ id: 'a:' + r.space_id + ':' + r.user_id, kind: 'joined', t: Date.parse(r.accepted_at), space: SP.get(r.space_id), by: P.get(r.user_id) }))
      ].filter(n => n.by && (n.kind === 'follow' || n.space)).sort((a, b) => (b.kind === 'invite') - (a.kind === 'invite') || b.t - a.t).slice(0, 60);
      badge(); if (panel) draw();
    }
    function badge(){
      if (!bell) return; const c = list.filter(unread).length;
      bell.classList.toggle('has', c > 0); bell.querySelector('i').textContent = c > 9 ? '9+' : c || '';
    }
    function ping(){ if (!bell) return; bell.classList.remove('ping'); void bell.offsetWidth; bell.classList.add('ping'); }
    function rowHTML(n){
      const who = `<b>${esc(n.by.display_name)}</b>`, where = n.space ? `<b>${esc(n.space.name)}</b>` : '', un = unread(n);
      let text, act = '';
      if (n.kind === 'invite'){
        text = `${who} invited you to ${where}`;
        act = `<div class="nact"><button class="nbtn pri" data-acc="${n.space.id}" ${busy.has(n.id) ? 'disabled' : ''}>Accept</button><button class="nbtn" data-dec="${n.space.id}" ${busy.has(n.id) ? 'disabled' : ''}>Decline</button></div>`;
      } else if (n.kind === 'follow'){
        text = `${who} followed you`;
        act = `<div class="nact">${People.isFollowing(n.by.id) ? '<span class="ndone">Following</span>' : `<button class="nbtn pri" data-fb="${n.by.id}">Follow back</button>`}</div>`;
      } else text = `${who} accepted your invite to ${where}`;
      return `<div class="nrow${un ? ' un' : ''}" data-n="${n.id}">${avatarOf(n.by, 36)}<div class="nt"><p>${text}</p><small>@${esc(n.by.username)} · ${ago(n.t)}</small>${act}</div>${un ? '<i class="ndot"></i>' : ''}</div>`;
    }
    function draw(){
      if (!panel) return;
      const inv = list.filter(n => n.kind === 'invite'), rest = list.filter(n => n.kind !== 'invite');
      panel.querySelector('.nlist').innerHTML = list.length
        ? (inv.length ? `<h6>Invites</h6>${inv.map(rowHTML).join('')}` : '') + (rest.length ? `${inv.length ? '<h6>Earlier</h6>' : ''}${rest.map(rowHTML).join('')}` : '')
        : `<div class="nempty"><b>You're all caught up</b>Invites and new followers will show up here.</div>`;
      panel.querySelector('[data-read]').style.visibility = rest.some(unread) ? '' : 'hidden';
    }
    function openPanel(){
      panel = document.createElement('div'); panel.className = 'npanel';
      panel.innerHTML = `<header><b>Notifications</b><button data-read>Mark all as read</button></header><div class="nlist"></div>`;
      $('#app').appendChild(panel); bell.classList.add('open'); draw(); load();
      panel.onclick = async e => {
        const acc = e.target.closest('[data-acc]'), dec = e.target.closest('[data-dec]'), fb = e.target.closest('[data-fb]');
        if (acc){ e.stopPropagation(); return accept(acc.dataset.acc); }
        if (dec){ e.stopPropagation(); return decline(dec.dataset.dec); }
        if (fb){ e.stopPropagation(); fb.disabled = true; await People.toggle(fb.dataset.fb); draw(); return; }
        if (e.target.closest('[data-read]')){ markSeen(); badge(); draw(); return; }
        const r = e.target.closest('[data-n]'); if (!r) return;
        const n = list.find(x => x.id === r.dataset.n); if (!n || n.kind === 'invite') return;
        close();
        if (n.kind === 'follow') People.open(n.by.id);
        else if (spaces.has(n.space.id)){ if (open) closeItem(); view = sid(n.space.id); render(); }
      };
    }
    function close(silent){ if (!panel) return; panel.remove(); panel = null; if (bell) bell.classList.remove('open'); if (!silent){ markSeen(); badge(); } }
    async function accept(spaceId){
      const n = list.find(x => x.id === 'i:' + spaceId); if (!n || busy.has(n.id)) return;
      busy.add(n.id); draw();
      const { error } = await sb.from('space_members').update({ status: 'active', accepted_at: new Date().toISOString() }).eq('space_id', spaceId).eq('user_id', user.id);
      busy.delete(n.id);
      if (error){ toast(error.message || "Couldn't accept — try again"); draw(); return; }
      list = list.filter(x => x !== n); badge();
      const sp = await loadSpace(spaceId);
      close(); if (sp){ if (open) closeItem(); view = sid(spaceId); render(); toast(`You joined “${sp.name}”`); } else { render(); toast("That invite isn't available any more"); }
    }
    async function decline(spaceId){
      const n = list.find(x => x.id === 'i:' + spaceId); if (!n || busy.has(n.id)) return;
      busy.add(n.id); draw();
      await sb.from('space_members').delete().eq('space_id', spaceId).eq('user_id', user.id);
      busy.delete(n.id); list = list.filter(x => x !== n); badge(); draw(); toast('Invite declined');
    }
    return { mount, load, reset, ping, invite: s => list.find(n => n.id === 'i:' + s), joined: (s, u) => list.find(n => n.id === 'a:' + s + ':' + u) };
  })();

  /* =====================  sidebar  ===================== */
  function sideHTML(row){
    if (!ready) return '';
    const secs = folders.filter(f => f.shared && !f.sub);
    let h = `<h6 class="shh"><span>Shared</span><button class="shadd" id="newSection" title="New shared section">${svg('plus')}</button></h6>`;
    if (!secs.length) h += `<button class="nav shhint" id="newSection2">${svg('users')}<span>New shared section</span></button>`;
    for (const f of secs){
      const sp = spaces.get(f.spaceId), others = sp ? sp.members.filter(m => m.id !== user?.id) : [];
      const total = items.filter(i => i.space === f.spaceId).length;
      h += row(f.id, f.name, f.icon, true).replace(/<em>[^<]*<\/em>/, `<span class="cstack">${others.slice(0, 3).map(m => avatarOf(m, 16)).join('')}</span><em>${total}</em>`);
      h += folders.filter(x => x.parent === f.id).map(x => row(x.id, x.name, 'folder', true).replace('class="nav ', 'class="nav csub ')).join('');
    }
    return h;
  }
  async function newSection(){
    if (!ready){ toast('Sign in to share'); return; }
    dialog(`<h3>New shared section</h3><p>A shared space for a team or project. Everything you put in it — folders, notes, images, videos, files — is shared with the people you invite.</p>
      <div class="fld"><div class="in"><input id="nsN" placeholder="e.g. Content Rewards team" maxlength="60"></div></div>
      <div class="row"><button class="btn" id="nsC">Cancel</button><button class="btn w" id="nsGo">Create & invite</button></div>`, close => {
      const N = $('#nsN'); setTimeout(() => N.focus(), 30);
      const go = async () => {
        const name = N.value.trim() || 'Shared'; $('#nsGo').disabled = true;
        const { data: s, error } = await sb.from('spaces').insert({ owner: user.id, kind: 'folder', name }).select().single();
        if (error){ $('#nsGo').disabled = false; toast(error.message); return; }
        const sp = { ...s, folders: s.folders || [], members: [{ ...prof, role: 'owner' }] }; spaces.set(s.id, sp);
        const f = folderFor(s); folders.push(f); close();
        if (open) closeItem(); view = f.id; render(); share(f);
      };
      $('#nsGo').onclick = go; N.onkeydown = e => { if (e.key === 'Enter') go(); }; $('#nsC').onclick = close;
    });
  }
  function addSub(sec, name){
    const sp = spaces.get(sec.spaceId); if (!sp) return null;
    let nm = name || 'New Folder', n = 2; while (folders.some(f => f.parent === sec.id && f.name === nm)) nm = `${name || 'New Folder'} ${n++}`;
    const subId = Math.random().toString(36).slice(2, 10);
    const f = { id: sec.id + '/' + subId, name: nm, icon: 'folder', shared: true, spaceId: sp.id, sub: subId, parent: sec.id };
    const last = folders.reduce((k, x, i) => (x.id === sec.id || x.parent === sec.id) ? i : k, folders.length - 1);
    folders.splice(last + 1, 0, f); return f;
  }
  // turn one of your own folders into a folder inside a shared section (its items become shared)
  function moveInto(local, sec){
    const f = addSub(sec, local.name); if (!f) return;
    items.filter(i => i.folder === local.id).forEach(i => i.folder = f.id);
    folders = folders.filter(x => x !== local);
    if (view === local.id) view = f.id;
    render(); toast(`“${local.name}” is now shared in ${sec.name}`);
  }

  // styles
  const css = document.createElement('style');
  css.textContent = `
.cav{display:inline-grid;place-items:center;border-radius:50%;flex:none !important;color:#fff;font-weight:600;background-size:cover;background-position:center;text-transform:uppercase}
.nbell{position:relative;width:30px;height:28px;border-radius:8px;display:grid;place-items:center;color:rgba(255,255,255,.75);flex:none}
.nbell:hover,.nbell.open{background:rgba(255,255,255,.09);color:#fff}
.nbell svg{width:16px;height:16px}
.nbell i{position:absolute;top:-3px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#f24822;color:#fff;font:700 10px/16px Inter,sans-serif;font-style:normal;text-align:center;display:none;box-shadow:0 0 0 2px #1a1a1a}
.nbell.has i{display:block}
.nbell.ping svg{animation:nring .7s ease}
@keyframes nring{0%,100%{transform:rotate(0)}20%{transform:rotate(-18deg)}45%{transform:rotate(14deg)}70%{transform:rotate(-8deg)}}
.npanel{position:absolute;top:50px;right:14px;z-index:80;width:min(400px,calc(100% - 28px));max-height:min(560px,calc(100% - 70px));display:flex;flex-direction:column;border-radius:14px;background:rgba(30,30,34,.98);border:1px solid var(--line2);box-shadow:0 24px 70px rgba(0,0,0,.6);animation:fadein .16s;overflow:hidden}
.npanel header{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 11px;border-bottom:1px solid var(--line)}
.npanel header b{font-size:14px;font-weight:600}
.npanel header button{font-size:12px;color:#8fb4ff}.npanel header button:hover{text-decoration:underline}
.nlist{overflow:auto;padding:6px}
.nlist h6{font-size:10.5px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;padding:10px 10px 4px}
.nrow{display:flex;gap:11px;padding:10px;border-radius:10px;cursor:pointer;position:relative}
.nrow:hover{background:rgba(255,255,255,.05)}
.nrow .nt{flex:1;min-width:0}
.nrow p{font-size:13px;line-height:1.45;color:rgba(255,255,255,.82);word-break:break-word}.nrow p b{color:#fff;font-weight:600}
.nrow small{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.ndot{flex:none;width:8px;height:8px;border-radius:50%;background:#0d99ff;margin-top:6px}
.nact{display:flex;gap:8px;margin-top:9px;align-items:center}
.nbtn{height:28px;padding:0 13px;border-radius:7px;font-size:12px;font-weight:600;border:1px solid var(--line2);color:#fff}
.nbtn:hover{background:rgba(255,255,255,.07)}.nbtn:disabled{opacity:.5}
.nbtn.pri{background:#0d99ff;border-color:#0d99ff}.nbtn.pri:hover{background:#1ea4ff}
.ndone{font-size:12px;color:var(--muted)}
.nempty{padding:44px 20px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.6}.nempty b{display:block;color:#fff;font-size:14px;margin-bottom:4px}
.ppl{max-width:700px;margin:0 auto;padding:28px 24px 70px}
.phead{display:flex;align-items:center;gap:18px;margin-bottom:18px}.phead h1{font-size:24px;font-weight:600;letter-spacing:-.03em}
.psearch{flex:1;display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:11px;background:rgba(255,255,255,.06);border:1px solid var(--line);transition:border-color .15s}
.psearch:focus-within{border-color:rgba(79,134,232,.75)}
.psearch svg{width:15px;height:15px;opacity:.5;flex:none}
.psearch input{flex:1;min-width:0;background:none;border:0;outline:0;font-size:13.5px}.psearch input::placeholder{color:var(--faint)}
.psearch button{color:var(--faint);font-size:12px;display:none}.psearch.has button{display:block}
.pme,.prow{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:13px;cursor:pointer;transition:background .15s}
.prow:hover,.pme:hover{background:rgba(255,255,255,.05)}
.pme{background:var(--card);border:1px solid var(--line);margin-bottom:16px}
.pi{flex:1;min-width:0}
.pi b{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600}.pi b span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi small{display:block;font-size:12px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi p{font-size:12.5px;color:rgba(255,255,255,.7);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfy{flex:none;font-style:normal;font-size:10.5px;font-weight:500;color:var(--muted);background:rgba(255,255,255,.08);padding:1px 7px;border-radius:999px;white-space:nowrap}
.pview{font-size:12px;color:var(--muted);flex:none}
.pfb{flex:none;height:32px;min-width:98px;padding:0 16px;border-radius:999px;background:#fff;color:#111;font-size:12.5px;font-weight:600;transition:opacity .15s,background .15s,border-color .15s}
.pfb:hover{opacity:.9}.pfb:disabled{opacity:.5}
.pfb.on,.pfb.ghost{background:none;color:#fff;border:1px solid var(--line2)}
.pfb.on .b{display:none}.pfb.on:hover{border-color:rgba(255,90,90,.6);color:#ff8f87;background:rgba(255,90,90,.08);opacity:1}.pfb.on:hover .a{display:none}.pfb.on:hover .b{display:inline}
.ptabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:8px}
.ptabs button{padding:9px 12px;font-size:13px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.ptabs button.on{color:#fff;border-color:#4f86e8}.ptabs em{font-style:normal;color:var(--faint);margin-left:6px;font-variant-numeric:tabular-nums}
.pempty{padding:36px 12px;text-align:center;color:var(--muted);font-size:13px;line-height:1.7}
.plabel{font-size:12px;color:var(--muted);padding:2px 4px 10px}
.pback{margin:-6px 0 12px -8px}
.phero{display:flex;align-items:flex-start;gap:18px;margin-bottom:20px}
.ph1{flex:1;min-width:0}.ph1 h1{font-size:24px;font-weight:600;letter-spacing:-.03em;word-break:break-word}
.ph1 p{font-size:13.5px;color:var(--muted);margin-top:2px;display:flex;gap:8px;align-items:center}
.pbio{font-size:13.5px;line-height:1.5;margin-top:10px;color:rgba(255,255,255,.85);white-space:pre-wrap;word-break:break-word}
.ph1 small{display:block;font-size:12px;color:var(--faint);margin-top:8px}
.pstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:10px}
.pst{padding:13px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line);text-align:left}
.pst:not(:disabled):hover{background:var(--card-h)}.pst:disabled{cursor:default}.pst.on{border-color:rgba(79,134,232,.6)}
.pst b{display:block;font-size:20px;font-weight:600;letter-spacing:-.02em}.pst small{font-size:11px;color:var(--muted)}
.pmix{font-size:12px;color:var(--muted);margin:0 2px 18px}
.shh{display:flex;align-items:center;justify-content:space-between;padding-right:4px!important}.shh .shadd{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;color:var(--muted)}.shh .shadd:hover{background:rgba(255,255,255,.08);color:#fff}.shh .shadd svg{width:13px;height:13px}
.nav.csub{padding-left:30px}.nav.csub svg{width:13px;height:13px}
.nav.shhint{color:var(--muted)}
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
.shwait .cav{opacity:.55}.shwait b{color:rgba(255,255,255,.75)}
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
    people: People, setStatsHidden, statsHidden: () => !!(prof && prof.stats && prof.stats.hidden),
    newSection, addSub, moveInto, sections: () => folders.filter(f => f.shared && !f.sub && spaces.get(f.spaceId)?.kind === 'folder'),
    enabled: () => enabled, ready: () => ready, boot, signOut, updateProfile, share, attach, detach, sideHTML, reconcile,
    me: () => prof, spaceOf: it => it && it.space ? spaces.get(it.space) : null
  };
})();
