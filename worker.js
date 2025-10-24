
// worker.js - updated admin panel (modal form, dynamic tags, score column)
// Cloudflare Workers single-file implementation (updated)
// Bindings: PROFILES_KV

const CONFIG = {
  auth: {
    username: 'admin',
    password: 'password',
    sessionTTL: 60 * 60 * 2
  },
  kvKeys: {
    profiles: 'profiles',
    background: 'backgroundUrl',
    sessionsPrefix: 'session:'
  },
  ui: {
    title: '81神人榜',
    github: 'https://github.com/your/repo'
  }
};

const ADMIN_PROFILES = [
  { id: 'admin-1', name: '周*', avatar: 'https://lm-xiao-fen.github.io/my-inft-image/image1.jpg', contact: 'G114514g@yeah.net', bio: '初中生，up主，YouTuber' },
  { id: 'admin-2', name: '陈*', avatar: 'https://lm-xiao-fen.github.io/my-inft-image/image3.jpg', contact: 'CY66678910@outlook.com', bio: '初中生，一名剪辑up主' },
  { id: 'admin-3', name: '彭*坤', avatar: 'https://lm-xiao-fen.github.io/my-inft-image/image2.jpg', contact: 'pjk666andcxk@outlook.com', bio: '　　' }
];

const SECURITY_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self';"
};

async function getProfiles() {
  const raw = await PROFILES_KV.get(CONFIG.kvKeys.profiles);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}
async function saveProfiles(list) {
  await PROFILES_KV.put(CONFIG.kvKeys.profiles, JSON.stringify(list || []));
}
async function getBackgroundUrl() {
  return await PROFILES_KV.get(CONFIG.kvKeys.background) || '';
}
async function setBackgroundUrl(url) {
  if (!url) { await PROFILES_KV.delete(CONFIG.kvKeys.background); return; }
  await PROFILES_KV.put(CONFIG.kvKeys.background, url);
}
function sessionKey(token) { return CONFIG.kvKeys.sessionsPrefix + token; }
async function createSession(username) {
  const token = crypto.randomUUID();
  const data = { username, created: Date.now() };
  await PROFILES_KV.put(sessionKey(token), JSON.stringify(data), { expirationTtl: CONFIG.auth.sessionTTL });
  return token;
}
async function validateSession(token) {
  if (!token) return null;
  const raw = await PROFILES_KV.get(sessionKey(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function destroySession(token) {
  if (!token) return;
  await PROFILES_KV.delete(sessionKey(token));
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    return handleApi(request, pathname);
  }

  if (request.method === 'GET') {
    if (pathname === '/') return renderIndexPage(request);
    if (pathname === '/admins') return renderAdminsPage(request);
    if (pathname.startsWith('/profile/')) return renderProfilePage(request, pathname.split('/profile/')[1]);
    if (pathname === '/admin') return renderAdminPanel(request);
    return new Response('Not Found', { status: 404 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

async function handleApi(request, pathname) {
  if (pathname === '/api/login' && request.method === 'POST') {
    const body = await request.json().catch(()=>null);
    if (!body || !body.username || !body.password) return json({ success: false, error: 'missing' }, 400);
    if (body.username === CONFIG.auth.username && body.password === CONFIG.auth.password) {
      const token = await createSession(body.username);
      const resp = json({ success: true });
      resp.headers.append('Set-Cookie', `cfprofiles_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.auth.sessionTTL}`);
      return resp;
    } else {
      return json({ success: false, error: 'invalid credentials' }, 401);
    }
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    const cookie = parseCookies(request).cfprofiles_session;
    if (cookie) await destroySession(cookie);
    const resp = json({ success: true });
    resp.headers.append('Set-Cookie', 'cfprofiles_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return resp;
  }

  if (pathname === '/api/session' && request.method === 'GET') {
    const cookie = parseCookies(request).cfprofiles_session;
    const session = await validateSession(cookie);
    return json({ authenticated: !!session });
  }

  if (pathname === '/api/profiles' && request.method === 'GET') {
    const profiles = await getProfiles();
    return json({ success: true, profiles });
  }

  if (pathname === '/api/profiles' && request.method === 'POST') {
    if (!await requireAuth(request)) return json({ success:false, error:'unauthorized' }, 401);
    const body = await request.json().catch(()=>null);
    if (!body || !body.name) return json({ success:false, error:'invalid' }, 400);
    const profiles = await getProfiles();
    const id = 'p-' + Date.now() + '-' + Math.floor(Math.random()*10000);
    const record = {
      id,
      name: body.name || 'unknown',
      avatar: body.avatar || '',
      contact: body.contact || '',
      tags: Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : []),
      bio_md: body.bio_md || '',
      score: Number(body.score || 0)
    };
    profiles.push(record);
    await saveProfiles(profiles);
    return json({ success: true, profile: record });
  }

  if (pathname.startsWith('/api/profiles/') ) {
    const id = pathname.split('/api/profiles/')[1];
    if (request.method === 'PUT') {
      if (!await requireAuth(request)) return json({ success:false, error:'unauthorized' }, 401);
      const body = await request.json().catch(()=>null);
      const profiles = await getProfiles();
      const idx = profiles.findIndex(p=>p.id===id);
      if (idx === -1) return json({ success:false, error:'not found' }, 404);
      const p = profiles[idx];
      p.name = body.name ?? p.name;
      p.avatar = body.avatar ?? p.avatar;
      p.contact = body.contact ?? p.contact;
      p.tags = Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : p.tags);
      p.bio_md = body.bio_md ?? p.bio_md;
      p.score = Number(body.score ?? p.score);
      profiles[idx] = p;
      await saveProfiles(profiles);
      return json({ success:true, profile:p });
    }
    if (request.method === 'DELETE') {
      if (!await requireAuth(request)) return json({ success:false, error:'unauthorized' }, 401);
      const profiles = await getProfiles();
      const idx = profiles.findIndex(p=>p.id===id);
      if (idx === -1) return json({ success:false, error:'not found' }, 404);
      profiles.splice(idx,1);
      await saveProfiles(profiles);
      return json({ success:true });
    }
  }

  if (pathname === '/api/background' && request.method === 'GET') {
    const url = await getBackgroundUrl();
    return json({ success:true, url });
  }
  if (pathname === '/api/background' && request.method === 'POST') {
    if (!await requireAuth(request)) return json({ success:false, error:'unauthorized' }, 401);
    const body = await request.json().catch(()=>null);
    if (!body || typeof body.url !== 'string') return json({ success:false, error:'invalid' }, 400);
    await setBackgroundUrl(body.url);
    return json({ success:true });
  }

  return json({ success:false, error:'unknown endpoint' }, 404);
}

async function requireAuth(request) {
  const cookie = parseCookies(request).cfprofiles_session;
  const session = await validateSession(cookie);
  return !!session;
}
function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const pairs = header.split(';').map(s=>s.trim()).filter(Boolean);
  const obj = {};
  for (const p of pairs) {
    const [k,v] = p.split('=');
    obj[k] = v;
  }
  return obj;
}
function json(obj, status=200) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  return new Response(JSON.stringify(obj), { status, headers });
}

function templateHtml(content, backgroundUrl='') {
  const bgStyle = backgroundUrl ? `style="background-image: url('${escapeHtml(backgroundUrl)}'); background-size: cover; background-position: center;"` : '';
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(CONFIG.ui.title)}</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  body { transition: background-color .2s ease, color .2s ease; }
  .card-hover:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0,0,0,0.12); }
  .avatar { transition: transform .15s ease; }
  .avatar:hover { transform: scale(1.06); }
  .prose img { max-width: 100%; }
  .bg-overlay{ background-color: rgba(255,255,255,0.6); }
  .dark .bg-overlay{ background-color: rgba(10,10,10,0.6); }
  /* modal */
  .modal-backdrop { background-color: rgba(0,0,0,0.4); }
</style>
</head>
<body class="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" ${bgStyle}>
<div class="min-h-screen bg-fixed">
  <div class="container mx-auto px-4">
    <header class="flex justify-between items-center py-6">
      <div class="flex items-center space-x-4">
        ${ADMIN_PROFILES.map(a => `
          <img src="${escapeHtml(a.avatar)}" alt="${escapeHtml(a.name)}" class="w-12 h-12 rounded-full avatar cursor-pointer" onclick="location.href='/admins'" title="${escapeHtml(a.name)}">
        `).join('')}
      </div>
      <div class="flex items-center space-x-3">
        <button id="bgBtn" class="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700">更换背景</button>
        <button id="themeToggle" class="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700">日/夜</button>
      </div>
    </header>

    <main class="py-8">
      ${content}
    </main>

    <footer class="py-6 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
      <div class="text-sm">© ${new Date().getFullYear()} ${escapeHtml(CONFIG.ui.title)}</div>
      <div class="text-sm space-x-4">
        <a href="${escapeHtml(CONFIG.ui.github)}" target="_blank">GitHub</a>
        <a id="loginBtn" class="cursor-pointer">登录</a>
      </div>
    </footer>
  </div>
</div>

<script>
const htmlEl = document.documentElement;
function initTheme() {
  if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}
initTheme();
document.getElementById('themeToggle').addEventListener('click', ()=>{
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
});

document.getElementById('bgBtn').addEventListener('click', async ()=>{
  const url = prompt('请输入背景图片完整 URL（留空可清除）:');
  if (url === null) return;
  try {
    const resp = await fetch('/api/background', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url })});
    const j = await resp.json();
    if (j.success) {
      if (url) { document.body.style.backgroundImage = "url('"+url+"')"; alert('已更新'); }
      else { document.body.style.backgroundImage = ''; alert('已清除'); }
    } else {
      alert('未授权或错误：' + (j.error||''));
    }
  } catch (e) { alert('请求失败'); }
});

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const username = prompt('管理员用户名：');
  if (!username) return;
  const password = prompt('管理员密码：');
  if (!password) return;
  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, password })
    });
    const j = await resp.json();
    if (j.success) { alert('登录成功'); location.reload(); }
    else alert('登录失败：' + (j.error||''));
  } catch (e) {
    alert('请求失败');
  }
});

(async ()=> {
  try {
    const r = await fetch('/api/background');
    const j = await r.json();
    if (j && j.url) document.body.style.backgroundImage = "url('"+j.url+"')";
  } catch(e){}
})();
</script>
</body>
</html>`;
}

async function renderIndexPage() {
  const profiles = (await getProfiles()) || [];
  profiles.sort((a,b)=> (Number(b.score||0) - Number(a.score||0)));
  const cards = profiles.map(p => `
    <a href="/profile/${p.id}" class="block">
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 text-center card-hover transition-all duration-150">
        <img src="${escapeHtml(p.avatar||'')}" class="w-24 h-24 rounded-full mx-auto mb-3 object-cover" alt="${escapeHtml(p.name)}">
        <div class="font-semibold">${escapeHtml(p.name)}</div>
      </div>
    </a>
  `).join('');
  const content = `
    <h1 class="text-2xl font-bold mb-6">排行榜</h1>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      ${cards || '<div class="text-gray-500">暂无人物，管理员可登录添加。</div>'}
    </div>
  `;
  const bg = await getBackgroundUrl();
  return new Response(templateHtml(content, bg), { headers: SECURITY_HEADERS });
}

async function renderAdminsPage() {
  const blocks = ADMIN_PROFILES.map(a => `
    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
      <img src="${escapeHtml(a.avatar)}" class="w-28 h-28 rounded-full mx-auto mb-4 object-cover">
      <h3 class="text-xl font-bold text-center">${escapeHtml(a.name)}</h3>
      <p class="text-center text-sm text-gray-600 dark:text-gray-300">${escapeHtml(a.contact)}</p>
      <p class="mt-3 text-center text-sm">${escapeHtml(a.bio)}</p>
    </div>
  `).join('');
  const content = `
    <h1 class="text-2xl font-bold mb-6">管理员团队</h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      ${blocks}
    </div>
  `;
  const bg = await getBackgroundUrl();
  return new Response(templateHtml(content, bg), { headers: SECURITY_HEADERS });
}

async function renderProfilePage(id) {
  const profiles = await getProfiles();
  const p = profiles.find(x=>x.id===id);
  if (!p) return new Response('Not Found', { status: 404 });
  const tagsHtml = (p.tags||[]).map(t=>`<span class="px-2 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 mr-2">${escapeHtml(t)}</span>`).join('');
  const content = `
    <div class="max-w-3xl mx-auto bg-overlay rounded-lg p-6">
      <div class="flex items-center space-x-6">
        <img src="${escapeHtml(p.avatar)}" class="w-32 h-32 rounded-full object-cover">
        <div>
          <h1 class="text-2xl font-bold">${escapeHtml(p.name)}</h1>
          <div class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(p.contact||'')}</div>
          <div class="mt-2">${tagsHtml}</div>
        </div>
      </div>
      <div class="mt-6 prose dark:prose-invert">
        <div id="md-content">加载中...</div>
      </div>
      <div class="mt-4">
        <a href="/" class="text-blue-600 dark:text-blue-400">返回</a>
      </div>
    </div>

    <script>
      const md = ${JSON.stringify(p.bio_md || '')};
      document.getElementById('md-content').innerHTML = marked.parse(md || '（暂无简介）');
    </script>
  `;
  const bg = await getBackgroundUrl();
  return new Response(templateHtml(content, bg), { headers: SECURITY_HEADERS });
}

// --- Updated admin panel: table + modal form + dynamic tags + score column
async function renderAdminPanel(request) {
  const cookie = parseCookies(request).cfprofiles_session;
  const authed = !!(await validateSession(cookie));
  const content = `
    <h1 class="text-2xl font-bold mb-4">管理员面板</h1>
    <div class="mb-4 flex items-center justify-between">
      <div>
        <button id="refreshBtn" class="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700">刷新列表</button>
        <button id="newBtn" class="px-3 py-1 ml-2 rounded bg-green-200 dark:bg-green-700">新增人物</button>
      </div>
      <div>
        <span class="px-3 py-1 rounded ${authed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${authed ? '已登录' : '未登录'}</span>
        <button id="logoutBtn" class="ml-3 px-2 py-1 rounded bg-gray-200 dark:bg-gray-700">登出</button>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full bg-white dark:bg-gray-800 rounded-lg">
        <thead>
          <tr class="text-left border-b">
            <th class="px-4 py-3">头像</th>
            <th class="px-4 py-3">姓名</th>
            <th class="px-4 py-3">联系方式</th>
            <th class="px-4 py-3">分数</th>
            <th class="px-4 py-3">Tags</th>
            <th class="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody id="listBody">
          <!-- rows inserted here -->
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <div id="modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 modal-backdrop"></div>
      <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-2xl p-6">
        <h2 id="modalTitle" class="text-lg font-bold mb-4">编辑人物</h2>
        <form id="modalForm" class="space-y-3">
          <input type="hidden" id="fieldId" />
          <div>
            <label class="block text-sm">姓名</label>
            <input id="fieldName" class="w-full px-3 py-2 rounded bg-gray-50 dark:bg-gray-700" required />
          </div>
          <div>
            <label class="block text-sm">头像 URL</label>
            <input id="fieldAvatar" class="w-full px-3 py-2 rounded bg-gray-50 dark:bg-gray-700" />
          </div>
          <div>
            <label class="block text-sm">联系方式</label>
            <input id="fieldContact" class="w-full px-3 py-2 rounded bg-gray-50 dark:bg-gray-700" />
          </div>
          <div>
            <label class="block text-sm">分数</label>
            <input id="fieldScore" type="number" class="w-full px-3 py-2 rounded bg-gray-50 dark:bg-gray-700" />
          </div>
          <div>
            <label class="block text-sm">Tags</label>
            <div class="flex space-x-2 mb-2">
              <input id="tagInput" class="flex-1 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700" placeholder="输入标签，回车添加" />
              <button id="addTagBtn" type="button" class="px-3 py-2 rounded bg-blue-200 dark:bg-blue-700">新增</button>
            </div>
            <div id="tagList" class="flex flex-wrap gap-2"></div>
          </div>
          <div>
            <label class="block text-sm">简介（Markdown）</label>
            <textarea id="fieldBio" rows="6" class="w-full px-3 py-2 rounded bg-gray-50 dark:bg-gray-700"></textarea>
          </div>

          <div class="flex justify-end space-x-2">
            <button id="cancelBtn" type="button" class="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700">取消</button>
            <button id="saveBtn" type="submit" class="px-4 py-2 rounded bg-green-500 text-white">保存</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      const api = {
        list: '/api/profiles',
        create: '/api/profiles',
      };

      async function fetchList(){
        const r = await fetch(api.list);
        const j = await r.json();
        const tbody = document.getElementById('listBody');
        tbody.innerHTML = '';
        (j.profiles||[]).forEach(p=>{
          const tr = document.createElement('tr');
          tr.className = 'border-b';
          tr.innerHTML = `
            <td class="px-4 py-3"><img src="\${p.avatar||''}" class="w-12 h-12 rounded-full object-cover"></td>
            <td class="px-4 py-3">\${escapeHtml(p.name)}</td>
            <td class="px-4 py-3">\${escapeHtml(p.contact||'')}</td>
            <td class="px-4 py-3">\${Number(p.score||0)}</td>
            <td class="px-4 py-3">\${(p.tags||[]).map(t=>'<span class=\"px-2 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 mr-2\">'+escapeHtml(t)+'</span>').join('')}</td>
            <td class="px-4 py-3">
              <button class="editBtn px-2 py-1 rounded bg-yellow-200 dark:bg-yellow-700">编辑</button>
              <button class="delBtn px-2 py-1 rounded bg-red-200 dark:bg-red-700 ml-2">删除</button>
            </td>
          `;
          tr.querySelector('.editBtn').addEventListener('click', ()=> openEdit(p));
          tr.querySelector('.delBtn').addEventListener('click', ()=> delProfile(p.id));
          tbody.appendChild(tr);
        });
      }

      document.getElementById('refreshBtn').addEventListener('click', fetchList);
      document.getElementById('newBtn').addEventListener('click', ()=> openEdit(null));
      document.getElementById('logoutBtn').addEventListener('click', async ()=>{
        await fetch('/api/logout', { method:'POST' });
        alert('已登出'); location.reload();
      });

      // modal logic
      const modal = document.getElementById('modal');
      const form = document.getElementById('modalForm');
      const fieldId = document.getElementById('fieldId');
      const fieldName = document.getElementById('fieldName');
      const fieldAvatar = document.getElementById('fieldAvatar');
      const fieldContact = document.getElementById('fieldContact');
      const fieldScore = document.getElementById('fieldScore');
      const fieldBio = document.getElementById('fieldBio');
      const tagInput = document.getElementById('tagInput');
      const tagList = document.getElementById('tagList');
      const addTagBtn = document.getElementById('addTagBtn');

      function openEdit(p){
        clearTagUI();
        if (!p) {
          document.getElementById('modalTitle').textContent = '新增人物';
          fieldId.value = '';
          fieldName.value = '';
          fieldAvatar.value = '';
          fieldContact.value = '';
          fieldScore.value = 0;
          fieldBio.value = '';
        } else {
          document.getElementById('modalTitle').textContent = '编辑人物';
          fieldId.value = p.id;
          fieldName.value = p.name || '';
          fieldAvatar.value = p.avatar || '';
          fieldContact.value = p.contact || '';
          fieldScore.value = Number(p.score||0);
          fieldBio.value = p.bio_md || '';
          (p.tags||[]).forEach(t=> addTagUI(t));
        }
        showModal();
      }
      function showModal(){ modal.classList.remove('hidden'); }
      function hideModal(){ modal.classList.add('hidden'); }

      document.getElementById('cancelBtn').addEventListener('click', (e)=>{ e.preventDefault(); hideModal(); });

      function addTagUI(tag){
        const span = document.createElement('span');
        span.className = 'px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center gap-2';
        span.innerHTML = '<span class=\"text-sm\">'+escapeHtml(tag)+'</span><button type=\"button\" class=\"ml-2 text-red-500 removeTagBtn\">×</button>';
        span.querySelector('.removeTagBtn').addEventListener('click', ()=> { span.remove(); });
        tagList.appendChild(span);
      }
      function clearTagUI(){ tagList.innerHTML = ''; }

      tagInput.addEventListener('keydown', (e)=> {
        if (e.key === 'Enter') { e.preventDefault(); const v = tagInput.value.trim(); if (v) { addTagUI(v); tagInput.value=''; } }
      });
      addTagBtn.addEventListener('click', ()=> { const v = tagInput.value.trim(); if (v) { addTagUI(v); tagInput.value=''; } });

      form.addEventListener('submit', async (e)=> {
        e.preventDefault();
        const id = fieldId.value;
        const payload = {
          name: fieldName.value.trim(),
          avatar: fieldAvatar.value.trim(),
          contact: fieldContact.value.trim(),
          tags: Array.from(tagList.children).map(ch => ch.querySelector('span').textContent),
          bio_md: fieldBio.value,
          score: Number(fieldScore.value||0)
        };
        try {
          let resp;
          if (!id) {
            resp = await fetch('/api/profiles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          } else {
            resp = await fetch('/api/profiles/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          }
          const j = await resp.json();
          if (j.success) { alert('保存成功'); hideModal(); fetchList(); }
          else alert('失败：' + (j.error||''));
        } catch (err) { alert('请求失败'); }
      });

      async function delProfile(id){
        if (!confirm('确认删除？')) return;
        try {
          const r = await fetch('/api/profiles/' + id, { method:'DELETE' });
          const j = await r.json();
          if (j.success) { alert('已删除'); fetchList(); }
          else alert('失败：' + (j.error||''));
        } catch(e) { alert('请求失败'); }
      }

      function escapeHtml(s){ if (!s) return ''; return s.replace(/[&<>"']/g, (m)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }

      // initial load
      fetchList();
    </script>
  `;
  const bg = await getBackgroundUrl();
  return new Response(templateHtml(content, bg), { headers: SECURITY_HEADERS });
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
