/* ── Adobe Launch AI Assistant — app.js ─────────────────────────────────── */
const SESSION_ID = `session_${Date.now()}`;
let isLoading    = false;
let companyCache = [];
let currentMode  = 'ai'; // 'ai' | 'direct'

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatArea      = document.getElementById('contentArea');
const messages      = document.getElementById('messages');
const welcome       = document.getElementById('welcome');
const userInput     = document.getElementById('userInput');
const sendBtn       = document.getElementById('sendBtn');
const clearBtn      = document.getElementById('clearBtn');
const toolsList     = document.getElementById('toolsList');
const toolCount     = document.getElementById('toolCount');
const statusDot     = document.getElementById('statusDot');
const statusText    = document.getElementById('statusText');
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const modalOverlay  = document.getElementById('modalOverlay');
const modalTitle    = document.getElementById('modalTitle');
const modalBody     = document.getElementById('modalBody');
const modalClose    = document.getElementById('modalClose');
const modeAIBtn     = document.getElementById('modeAI');
const modeDirectBtn = document.getElementById('modeDirect');
const panelAI       = document.getElementById('panelAI');
const panelDirect   = document.getElementById('panelDirect');
const modePill      = document.getElementById('modePill');
const modePillText  = document.getElementById('modePillText');
const topbarSub     = document.getElementById('topbarSub');
const inputModeTag  = document.getElementById('inputModeTag');
const inputWrapper  = document.getElementById('inputWrapper');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setStatus('loading', 'Connecting...');
  try {
    const res  = await fetch('/api/tools');
    const data = await res.json();
    renderToolsList(data.tools);
    setStatus('online', `${data.tools.length} tools ready`);
  } catch {
    setStatus('error', 'Connection failed');
  }
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

function renderToolsList(tools) {
  toolCount.textContent = tools.length;
  toolsList.innerHTML   = '';
  tools.forEach(t => {
    const el = document.createElement('div');
    el.className   = 'tool-item';
    el.textContent = t.name;
    el.title       = t.description;
    toolsList.appendChild(el);
  });
}

// ── Mode switching ────────────────────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  if (mode === 'ai') {
    modeAIBtn.classList.add('active', 'ai-active');
    modeAIBtn.classList.remove('direct-active');
    modeDirectBtn.classList.remove('active', 'ai-active', 'direct-active');
    panelAI.classList.remove('hidden');
    panelDirect.classList.add('hidden');
    modePill.className = 'badge-pill ai-pill';
    modePillText.textContent = 'AI Chat';
    topbarSub.textContent = 'AI Chat Mode — natural language → Gemini → Reactor API';
    inputModeTag.className = 'input-mode-tag';
    inputModeTag.innerHTML = '<span class="pill-dot ai-dot"></span> AI';
    inputWrapper.classList.remove('direct-mode');
    userInput.placeholder = "Ask anything… 'Create a rule that fires on all pages'";
  } else {
    modeDirectBtn.classList.add('active', 'direct-active');
    modeDirectBtn.classList.remove('ai-active');
    modeAIBtn.classList.remove('active', 'ai-active', 'direct-active');
    panelDirect.classList.remove('hidden');
    panelAI.classList.add('hidden');
    modePill.className = 'badge-pill direct-pill';
    modePillText.textContent = 'Direct API';
    topbarSub.textContent = 'Direct API Mode — click sidebar buttons → instant Reactor API results';
    inputModeTag.className = 'input-mode-tag direct';
    inputModeTag.innerHTML = '<span class="pill-dot direct-dot"></span> Direct';
    inputWrapper.classList.add('direct-mode');
    userInput.placeholder = "Or type a query here to search resources directly…";
  }
  // Hide welcome, show messages if there's content
  if (messages.children.length > 0) {
    welcome.style.display  = 'none';
    messages.style.display = '';
  }
}

modeAIBtn.addEventListener('click',     () => switchMode('ai'));
modeDirectBtn.addEventListener('click', () => switchMode('direct'));

// Init mode
modeAIBtn.classList.add('active', 'ai-active');

// ── Sidebar & modal controls ──────────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
mobileMenuBtn?.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
document.addEventListener('click', e => {
  if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-open') &&
      !sidebar.contains(e.target) && e.target !== mobileMenuBtn)
    sidebar.classList.remove('mobile-open');
});

modalClose.addEventListener('click',   () => modalOverlay.classList.remove('open'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });

function showModal(title, content) {
  modalTitle.textContent = title;
  modalBody.innerHTML    = `<pre>${escapeHtml(content)}</pre>`;
  modalOverlay.classList.add('open');
}

clearBtn.addEventListener('click', async () => {
  await fetch(`/api/session/${SESSION_ID}`, { method: 'DELETE' });
  messages.innerHTML     = '';
  messages.style.display = 'none';
  welcome.style.display  = '';
  toast('Conversation cleared', 'info');
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const tc = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(msg)}</span>`;
  tc.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ── Direct API helpers ────────────────────────────────────────────────────────
async function directGet(endpoint, params = {}) {
  const url = new URL(`/api/direct/${endpoint}`, location.origin);
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && url.searchParams.set(k, v));
  const res  = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json.data;
}

// ── Picker helpers ────────────────────────────────────────────────────────────
async function pickProperty() {
  if (!companyCache.length) {
    showLoading('Fetching companies...');
    try { companyCache = await directGet('companies'); }
    catch (e) { renderError(e.message); return null; }
  }
  const company = companyCache.length === 1
    ? companyCache[0]
    : await pickFromList('Select a company', companyCache, 'name');
  if (!company) return null;

  showLoading(`Fetching properties for ${company.name}...`);
  let props;
  try { props = await directGet('properties', { company_id: company.id }); }
  catch (e) { renderError(e.message); return null; }
  if (!props.length) { renderError('No properties found.'); return null; }
  return props.length === 1 ? props[0] : await pickFromList('Select a property', props, 'name');
}

function pickFromList(title, items, labelKey) {
  return new Promise(resolve => {
    modalTitle.textContent = title;
    modalBody.innerHTML    = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.style.cssText = 'padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;text-align:left;font-size:13px;transition:background .12s;';
      btn.innerHTML = `<strong>${escapeHtml(item[labelKey])}</strong><span style="font-size:11px;color:var(--text3);margin-left:8px;">${item.id || ''}</span>`;
      btn.onmouseover = () => btn.style.background = 'var(--bg4)';
      btn.onmouseout  = () => btn.style.background = 'var(--bg3)';
      btn.onclick = () => { modalOverlay.classList.remove('open'); resolve(item); };
      wrap.appendChild(btn);
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'margin-top:6px;padding:8px;background:none;border:1px solid var(--border);border-radius:8px;color:var(--text3);cursor:pointer;font-size:13px;';
    cancel.onclick = () => { modalOverlay.classList.remove('open'); resolve(null); };
    wrap.appendChild(cancel);
    modalBody.appendChild(wrap);
    modalOverlay.classList.add('open');
  });
}

// ── Show/hide helpers ─────────────────────────────────────────────────────────
function showMessages() {
  welcome.style.display  = 'none';
  messages.style.display = '';
}

function showLoading(msg) {
  showMessages();
  const el = appendDirectMsg(`⏳ ${msg}`);
  el.dataset.loading = 'true';
  return el;
}

function renderError(msg) {
  document.querySelectorAll('[data-loading]').forEach(e => e.remove());
  appendMsg('assistant', `❌ ${msg}`, true);
  toast(msg, 'error');
}


// ── Direct result renderer ────────────────────────────────────────────────────
function renderDirectResult(title, rows, columns, options = {}) {
  document.querySelectorAll('[data-loading]').forEach(e => e.remove());
  if (!rows || !rows.length) { appendDirectMsg(`**${title}**\n\nNo results found.`); return; }

  const msg    = document.createElement('div');
  msg.className = 'message assistant direct-result';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = '<span style="font-size:15px">⚡</span>';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'result-header';
  hdr.innerHTML = `
    <div class="result-title">${escapeHtml(title)}</div>
    <div class="result-meta">
      <span class="direct-badge">⚡ Direct API</span>
      <span>${rows.length} result${rows.length !== 1 ? 's' : ''}</span>
    </div>`;
  bubble.appendChild(hdr);

  // Table
  const hasActions = options.rowActions?.length > 0;
  const allCols    = hasActions ? [...columns, { key: '__actions__', label: 'Actions' }] : columns;

  const tbl = document.createElement('table');
  tbl.className = 'result-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>' + allCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('') + '</tr>';
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.onclick = e => { if (e.target.tagName === 'BUTTON') return; showModal('Row Detail', JSON.stringify(row, null, 2)); };

    columns.forEach(c => {
      const td  = document.createElement('td');
      const val = row[c.key];
      td.textContent = val === undefined || val === null ? '—' : Array.isArray(val) ? val.join(', ') : String(val);

      if (c.key === 'state') {
        const clr = { published:'#22c55e', approved:'#3b82f6', submitted:'#f59e0b', development:'#a78bfa' };
        td.style.color = clr[val] || 'var(--text2)';
        td.style.fontWeight = '600';
      }
      if (c.key === 'enabled') {
        td.style.color = val ? '#22c55e' : '#ef4444';
        td.textContent = val ? '✓ Yes' : '✗ No';
      }
      if (c.key === 'status') {
        const clr = { succeeded:'#22c55e', failed:'#ef4444', pending:'#f59e0b', active:'#22c55e' };
        td.style.color = clr[String(val).toLowerCase()] || 'var(--text2)';
      }
      tr.appendChild(td);
    });

    if (hasActions) {
      const td = document.createElement('td');
      options.rowActions.forEach(a => {
        const btn = document.createElement('button');
        btn.className   = 'row-action-btn';
        btn.textContent = a.label;
        btn.onclick = e => { e.stopPropagation(); a.fn(row); };
        td.appendChild(btn);
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  bubble.appendChild(tbl);

  // Action bar
  const bar = document.createElement('div');
  bar.className = 'result-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className   = 'result-action-btn copy';
  copyBtn.textContent = '📋 Copy JSON';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => copyBtn.textContent = '📋 Copy JSON', 1800);
    toast('Copied to clipboard', 'success');
  };
  bar.appendChild(copyBtn);

  // "Ask AI about this" button
  const aiBtn = document.createElement('button');
  aiBtn.className   = 'result-action-btn';
  aiBtn.textContent = '🤖 Ask AI about this';
  aiBtn.onclick = () => {
    switchMode('ai');
    userInput.value = `I can see these ${title} results: ${JSON.stringify(rows.slice(0,3))}. What can you tell me about them and what actions can I take?`;
    userInput.dispatchEvent(new Event('input'));
    toast('Switched to AI Chat mode', 'info');
  };
  bar.appendChild(aiBtn);

  bubble.appendChild(bar);
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messages.appendChild(msg);
  scrollBottom();
}


// ── All direct API quick actions ──────────────────────────────────────────────
async function quickListCompanies() {
  showLoading('Fetching companies...');
  try {
    const data = await directGet('companies');
    companyCache = data;
    renderDirectResult('Companies', data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'org_id', label:'Org ID' }, { key:'created', label:'Created' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListProperties() {
  if (!companyCache.length) { showLoading('Fetching companies...'); try { companyCache = await directGet('companies'); } catch(e) { renderError(e.message); return; } }
  const co = companyCache.length === 1 ? companyCache[0] : await pickFromList('Select company', companyCache, 'name');
  if (!co) return;
  showLoading(`Properties for ${co.name}...`);
  try {
    const data = await directGet('properties', { company_id: co.id });
    renderDirectResult(`Properties — ${co.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'platform', label:'Platform' }, { key:'enabled', label:'Enabled' }, { key:'updated', label:'Updated' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListRules() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Rules for ${p.name}...`);
  try {
    const data = await directGet('rules', { property_id: p.id });
    renderDirectResult(`Rules — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'enabled', label:'Enabled' }, { key:'updated', label:'Updated' }
    ], { rowActions: [{ label:'View Components', fn: async row => {
      showLoading(`Components for "${row.name}"...`);
      try {
        const comps = await directGet('rule-components', { rule_id: row.id });
        renderDirectResult(`Components — ${row.name}`, comps, [
          { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'delegate_descriptor_id', label:'Type' }, { key:'order', label:'Order' }
        ]);
      } catch(e) { renderError(e.message); }
    }}]});
  } catch(e) { renderError(e.message); }
}

async function quickListRuleComponents() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Rules for ${p.name}...`);
  let rules; try { rules = await directGet('rules', { property_id: p.id }); } catch(e) { renderError(e.message); return; }
  if (!rules.length) { renderError('No rules found.'); return; }
  const rule = rules.length === 1 ? rules[0] : await pickFromList('Select rule', rules, 'name');
  if (!rule) return;
  showLoading(`Components for "${rule.name}"...`);
  try {
    const data = await directGet('rule-components', { rule_id: rule.id });
    renderDirectResult(`Components — ${rule.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'delegate_descriptor_id', label:'Type' }, { key:'order', label:'Order' }, { key:'created', label:'Created' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListDataElements() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Data elements for ${p.name}...`);
  try {
    const data = await directGet('data-elements', { property_id: p.id });
    renderDirectResult(`Data Elements — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'delegate_descriptor_id', label:'Type' }, { key:'storage_duration', label:'Storage' }, { key:'updated', label:'Updated' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListExtensions() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Extensions for ${p.name}...`);
  try {
    const data = await directGet('extensions', { property_id: p.id });
    renderDirectResult(`Extensions — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'version', label:'Version' }, { key:'enabled', label:'Enabled' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickBrowseExtensionPackages() {
  const q = prompt('Filter by name (blank = all):');
  showLoading('Browsing extension catalog...');
  try {
    const data = await directGet('extension-packages', { name: q || '', page_size: 50 });
    renderDirectResult('Extension Catalog', data, [
      { key:'name', label:'Package' }, { key:'display_name', label:'Display Name' }, { key:'version', label:'Version' }, { key:'author', label:'Author' }, { key:'id', label:'ID' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListLibraries() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Libraries for ${p.name}...`);
  try {
    const data = await directGet('libraries', { property_id: p.id });
    renderDirectResult(`Libraries — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'state', label:'State' }, { key:'updated', label:'Updated' }
    ], { rowActions: [{ label:'View Resources', fn: async row => {
      showLoading(`Resources in "${row.name}"...`);
      try {
        const res = await directGet('library-resources', { library_id: row.id });
        renderDirectResult(`Resources — ${row.name}`, res, [
          { key:'id', label:'ID' }, { key:'type', label:'Type' }, { key:'name', label:'Name' }, { key:'revision', label:'Revision' }
        ]);
      } catch(e) { renderError(e.message); }
    }}]});
  } catch(e) { renderError(e.message); }
}

async function quickListLibraryResources() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Libraries for ${p.name}...`);
  let libs; try { libs = await directGet('libraries', { property_id: p.id }); } catch(e) { renderError(e.message); return; }
  if (!libs.length) { renderError('No libraries found.'); return; }
  const lib = libs.length === 1 ? libs[0] : await pickFromList('Select library', libs, 'name');
  if (!lib) return;
  showLoading(`Resources in "${lib.name}"...`);
  try {
    const data = await directGet('library-resources', { library_id: lib.id });
    renderDirectResult(`Resources — ${lib.name}`, data, [
      { key:'id', label:'ID' }, { key:'type', label:'Type' }, { key:'name', label:'Name' }, { key:'revision', label:'Revision' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListBuilds() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Builds for ${p.name}...`);
  try {
    const data = await directGet('builds', { property_id: p.id });
    renderDirectResult(`Builds — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'status', label:'Status' }, { key:'created', label:'Created' }, { key:'updated', label:'Updated' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListEnvironments() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Environments for ${p.name}...`);
  try {
    const data = await directGet('environments', { property_id: p.id });
    renderDirectResult(`Environments — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'stage', label:'Stage' }, { key:'created', label:'Created' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListHosts() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Hosts for ${p.name}...`);
  try {
    const data = await directGet('hosts', { property_id: p.id });
    renderDirectResult(`Hosts — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'type_of', label:'Type' }, { key:'status', label:'Status' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListSecrets() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Secrets for ${p.name}...`);
  try {
    const data = await directGet('secrets', { property_id: p.id });
    renderDirectResult(`Secrets — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'name', label:'Name' }, { key:'type_of', label:'Type' }, { key:'status', label:'Status' }, { key:'created', label:'Created' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickListCallbacks() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Callbacks for ${p.name}...`);
  try {
    const data = await directGet('callbacks', { property_id: p.id });
    renderDirectResult(`Callbacks — ${p.name}`, data, [
      { key:'id', label:'ID' }, { key:'url', label:'Webhook URL' }, { key:'subscriptions', label:'Subscriptions' }, { key:'created', label:'Created' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickSearch() {
  const p = await pickProperty(); if (!p) return;
  const q = prompt('Search query:'); if (!q) return;
  const typeIn = prompt('Filter type (blank=all):\nrules, data_elements, extensions, rule_components');
  showLoading(`Searching "${q}"...`);
  try {
    const url = new URL('/api/direct/search', location.origin);
    url.searchParams.set('property_id', p.id);
    url.searchParams.set('query', q);
    if (typeIn) url.searchParams.set('type_in', typeIn);
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderDirectResult(`Search: "${q}"`, json.data, [
      { key:'id', label:'ID' }, { key:'type', label:'Type' }, { key:'name', label:'Name' }, { key:'updated', label:'Updated' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickAuditLog() {
  const p = await pickProperty(); if (!p) return;
  showLoading(`Audit log for ${p.name}...`);
  try {
    const data = await directGet('audit-events', { property_id: p.id, page_size: 50 });
    renderDirectResult(`Audit Log — ${p.name}`, data, [
      { key:'action', label:'Action' }, { key:'resource_type', label:'Resource Type' }, { key:'resource_id', label:'Resource ID' }, { key:'created', label:'When' }
    ]);
  } catch(e) { renderError(e.message); }
}

async function quickProfile() {
  showLoading('Fetching profile...');
  try {
    const data = await directGet('profile');
    renderDirectResult('My Profile', [data], [
      { key:'id', label:'ID' }, { key:'display_name', label:'Display Name' }, { key:'email', label:'Email' }
    ]);
  } catch(e) { renderError(e.message); }
}

// ── Wire up sidebar buttons ───────────────────────────────────────────────────
const QUICK_ACTIONS = {
  'quick-companies':         quickListCompanies,
  'quick-properties':        quickListProperties,
  'quick-rules':             quickListRules,
  'quick-rule-components':   quickListRuleComponents,
  'quick-data-elements':     quickListDataElements,
  'quick-extensions':        quickListExtensions,
  'quick-ext-packages':      quickBrowseExtensionPackages,
  'quick-libraries':         quickListLibraries,
  'quick-library-resources': quickListLibraryResources,
  'quick-builds':            quickListBuilds,
  'quick-environments':      quickListEnvironments,
  'quick-hosts':             quickListHosts,
  'quick-secrets':           quickListSecrets,
  'quick-callbacks':         quickListCallbacks,
  'quick-search':            quickSearch,
  'quick-audit':             quickAuditLog,
  'quick-profile':           quickProfile,
};

document.querySelectorAll('[data-action]').forEach(el => {
  const fn = QUICK_ACTIONS[el.dataset.action];
  if (fn) el.addEventListener('click', fn);
});

// ── AI prompt chips ───────────────────────────────────────────────────────────
document.querySelectorAll('[data-prompt]').forEach(el => {
  el.addEventListener('click', () => {
    switchMode('ai');
    userInput.value = el.dataset.prompt;
    userInput.dispatchEvent(new Event('input'));
    sendMessage();
  });
});

// Welcome card buttons
window.switchMode = switchMode;


// ── Input handling ────────────────────────────────────────────────────────────
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
  sendBtn.disabled = !userInput.value.trim() || isLoading;
});

userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// ── Gemini AI chat ────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;

  // If in direct mode and user types, switch to AI
  if (currentMode === 'direct') switchMode('ai');

  showMessages();
  appendMsg('user', text);

  userInput.value        = '';
  userInput.style.height = 'auto';
  sendBtn.disabled       = true;
  isLoading              = true;
  setStatus('loading', 'Thinking...');

  const thinkingEl    = appendThinking();
  const turnToolCalls = [];

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, sessionId: SESSION_ID }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    const processSSE = chunk => {
      buffer += chunk;
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const block of events) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        let eventType = 'message', dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          if (line.startsWith('data:'))  dataStr   = line.slice(5).trim();
        }
        if (!dataStr) continue;
        let evt; try { evt = JSON.parse(dataStr); } catch { continue; }

        if (eventType === 'tool_call') {
          const toolEl = document.createElement('div');
          toolEl.className   = 'tool-running';
          toolEl.textContent = ` ${evt.name}`;
          thinkingEl.querySelector('.thinking-content').appendChild(toolEl);
          turnToolCalls.push(evt);
          scrollBottom();
        }
        if (eventType === 'answer') {
          thinkingEl.remove();
          appendAssistantMsg(evt.text, evt.toolCalls || turnToolCalls);
          scrollBottom();
        }
        if (eventType === 'error') {
          thinkingEl.remove();
          appendMsg('assistant', `❌ ${evt.message}`, true);
          toast(evt.message, 'error');
          scrollBottom();
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      processSSE(decoder.decode(value, { stream: true }));
    }
    if (document.contains(thinkingEl)) thinkingEl.remove();

  } catch (err) {
    if (document.contains(thinkingEl)) thinkingEl.remove();
    appendMsg('assistant', `❌ Network error: ${err.message}`, true);
    toast(err.message, 'error');
  }

  isLoading = false;
  setStatus('online', '74 tools ready');
  sendBtn.disabled = !userInput.value.trim();
  userInput.focus();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function appendMsg(role, text, isError = false) {
  const msg    = document.createElement('div');
  msg.className = `message ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'user') {
    avatar.textContent = 'V';
  } else {
    avatar.innerHTML = adobeSVG('ag');
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (isError) bubble.style.borderColor = 'rgba(250,15,0,.4)';
  bubble.innerHTML = renderMD(text);
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messages.appendChild(msg);
  scrollBottom();
  return msg;
}

function appendAssistantMsg(text, toolCalls = []) {
  const msg    = document.createElement('div');
  msg.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = adobeSVG('am');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (toolCalls.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'tool-calls';
    toolCalls.forEach(tc => {
      const tag = document.createElement('span');
      tag.className   = 'tool-tag';
      tag.textContent = tc.name;
      tag.title       = 'Click to see args';
      tag.onclick = () => showModal(`⚙ ${tc.name}`, JSON.stringify(tc.args || {}, null, 2));
      tags.appendChild(tag);
    });
    bubble.appendChild(tags);
  }

  const textDiv = document.createElement('div');
  textDiv.innerHTML = renderMD(text);
  bubble.appendChild(textDiv);

  // "View as table" button if response looks like a list
  if (text.includes('|') && text.includes('\n')) {
    const tblBtn = document.createElement('button');
    tblBtn.className   = 'result-action-btn';
    tblBtn.textContent = '📊 View as table';
    tblBtn.style.marginTop = '8px';
    tblBtn.onclick = () => showModal('Response', text);
    bubble.appendChild(tblBtn);
  }

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messages.appendChild(msg);
  scrollBottom();
  return msg;
}

function appendThinking() {
  const msg    = document.createElement('div');
  msg.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = adobeSVG('at');
  const bubble = document.createElement('div');
  bubble.className = 'bubble thinking-content';
  bubble.innerHTML = `<div class="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div><span>Thinking…</span></div>`;
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messages.appendChild(msg);
  scrollBottom();
  return msg;
}

function appendDirectMsg(text) {
  const msg    = document.createElement('div');
  msg.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = '<span style="font-size:15px">⚡</span>';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMD(text);
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messages.appendChild(msg);
  scrollBottom();
  return msg;
}

function adobeSVG(id) {
  return `<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="url(#${id})"/>
    <path d="M8 24L14 8h4l6 16h-4l-1.2-3.4H13.2L12 24H8zm6.2-6.4h3.6L16 12.4l-1.8 5.2z" fill="white"/>
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FA0F00"/><stop offset="1" stop-color="#FF6B35"/>
    </linearGradient></defs></svg>`;
}

function scrollBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMD(text) {
  if (!text) return '';
  let h = escapeHtml(text);
  h = h.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_m, c) => `<pre><code>${c.trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  h = h.replace(/((?:^[-*] .+\n?)+)/gm, b => '<ul>' + b.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('') + '</ul>');
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, b => '<ol>' + b.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('') + '</ol>');
  h = h.replace(/^---$/gm, '<hr/>');
  h = h.split(/\n{2,}/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<(h[1-3]|ul|ol|pre|hr|li)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
  }).filter(Boolean).join('\n');
  return h;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();






