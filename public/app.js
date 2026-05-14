/* UK Political Simulator — Frontend */

const API = '';

// ── State ─────────────────────────────────────────────────────────────────

let gameState = null;
let player = null;
let selectedScenario = null;
let selectedBackstory = null;
let mpPage = 0;
const MP_PAGE_SIZE = 50;
let mpPartyFilter = '';
let mpRegionFilter = '';
let mpSearchQuery = '';
let allConstituencies = [];

// ── Utilities ──────────────────────────────────────────────────────────────

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`)?.classList.add('active');
  if (name === 'inbox') loadEmails();
  if (name === 'calendar') loadCalendar();
  if (name === 'parliament') loadParliament();
  if (name === 'mps') { mpPage = 0; loadMPs(); }
  if (name === 'dashboard') loadDashboard();
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function partyClass(party) {
  return 'party-' + (party || 'other').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
}

function partyColor(party) {
  const map = {
    'Labour': '#E4003B',
    'Conservative': '#0087DC',
    'Liberal Democrats': '#FAA61A',
    'SNP': '#FDF38E',
    'Plaid Cymru': '#3F8428',
    'Green': '#00B140',
    'Reform UK': '#12B6CF',
    'DUP': '#D46A4C',
    'Sinn Féin': '#326760',
    'Alliance Party': '#F6CB2F',
    'SDLP': '#2AA82C',
    'UUP': '#9999FF',
  };
  return map[party] || '#888';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Setup: API Config ──────────────────────────────────────────────────────

const providerNotes = {
  openai: 'Get your key at platform.openai.com. Default model: gpt-4o-mini',
  openrouter: 'Get your key at openrouter.ai. Supports hundreds of models. Use format like openai/gpt-4o-mini or anthropic/claude-3-haiku',
  custom: 'Any OpenAI-compatible endpoint (e.g. CharacterAI, Ollama, LiteLLM, vLLM). Make sure it supports /chat/completions.',
};

document.getElementById('setup-provider').addEventListener('change', function () {
  const v = this.value;
  document.getElementById('provider-note').textContent = providerNotes[v] || '';
  document.getElementById('setup-endpoint-group').classList.toggle('hidden', v !== 'custom');
  const modelInput = document.getElementById('setup-model');
  if (v === 'openai') modelInput.placeholder = 'gpt-4o-mini';
  else if (v === 'openrouter') modelInput.placeholder = 'openai/gpt-4o-mini';
  else modelInput.placeholder = 'gpt-4o-mini';
});

async function loadSetupScreen() {
  try {
    const settings = await api('/api/settings/raw');
    if (settings.ai_provider) document.getElementById('setup-provider').value = settings.ai_provider;
    if (settings.api_key) document.getElementById('setup-apikey').value = '••••••••••••' + settings.api_key.slice(-4);
    if (settings.ai_model) document.getElementById('setup-model').value = settings.ai_model;
    if (settings.custom_endpoint) document.getElementById('setup-endpoint').value = settings.custom_endpoint;
    document.getElementById('setup-provider').dispatchEvent(new Event('change'));
  } catch {}
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const provider = document.getElementById('setup-provider').value;
  const apiKey = document.getElementById('setup-apikey').value.trim();
  const model = document.getElementById('setup-model').value.trim();
  const endpoint = document.getElementById('setup-endpoint').value.trim();

  if (!apiKey || apiKey.startsWith('••')) {
    // Only validate if it's not a masked existing key
    const existing = await api('/api/settings/raw');
    if (!existing.api_key) { toast('Please enter an API key', 'error'); return; }
  }

  await api('/api/settings', 'POST', { ai_provider: provider, api_key: apiKey, ai_model: model, custom_endpoint: endpoint });

  // Check if we already have a character and game
  const [char, state] = await Promise.all([
    api('/api/character').catch(() => null),
    api('/api/game/state').catch(() => null),
  ]);

  if (char && state) {
    player = char;
    gameState = state;
    initGame();
  } else if (char) {
    await loadWorldScreen();
    showScreen('screen-world');
  } else {
    await loadCharacterScreen();
    showScreen('screen-character');
  }
});

// ── Character Screen ───────────────────────────────────────────────────────

async function loadCharacterScreen() {
  // Load backstories
  const backstories = await api('/api/backstories');
  const grid = document.getElementById('backstory-grid');
  grid.innerHTML = backstories.map(b => `
    <div class="backstory-option" data-id="${b.id}" data-text="${b.description}" onclick="selectBackstory(this)">
      <div class="label">${b.label}</div>
      <div class="desc">${b.description}</div>
    </div>`).join('');

  // Load constituencies for autocomplete
  allConstituencies = await api('/api/constituencies');
  setupConstituencyAutocomplete();
}

function selectBackstory(el) {
  document.querySelectorAll('.backstory-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedBackstory = { id: el.dataset.id, text: el.dataset.text };
}

function setupConstituencyAutocomplete() {
  const input = document.getElementById('char-constituency-input');
  const dropdown = document.getElementById('constituency-dropdown');
  const hidden = document.getElementById('char-constituency');

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    if (!q) { dropdown.classList.add('hidden'); return; }
    const matches = allConstituencies.filter(c => c.toLowerCase().includes(q)).slice(0, 12);
    if (!matches.length) { dropdown.classList.add('hidden'); return; }
    dropdown.innerHTML = matches.map(c =>
      `<div class="dropdown-item" onclick="pickConstituency('${c.replace(/'/g, "\\'")}', this)">${c}</div>`
    ).join('');
    dropdown.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.form-group')) dropdown.classList.add('hidden');
  });
}

function pickConstituency(name) {
  document.getElementById('char-constituency-input').value = name;
  document.getElementById('char-constituency').value = name;
  document.getElementById('constituency-dropdown').classList.add('hidden');
}

document.getElementById('btn-save-character').addEventListener('click', async () => {
  const name = document.getElementById('char-name').value.trim();
  const party = document.getElementById('char-party').value;
  const constituency = document.getElementById('char-constituency').value || document.getElementById('char-constituency-input').value.trim();
  const bio = document.getElementById('char-bio').value.trim();

  if (!name) { toast('Enter your name', 'error'); return; }
  if (!constituency) { toast('Select a constituency', 'error'); return; }
  if (!selectedBackstory) { toast('Choose a backstory', 'error'); return; }

  await api('/api/character', 'POST', {
    name, party, constituency,
    backstory_id: selectedBackstory.id,
    backstory_text: selectedBackstory.text,
    bio
  });

  await loadWorldScreen();
  showScreen('screen-world');
});

// ── World Screen ───────────────────────────────────────────────────────────

async function loadWorldScreen() {
  const scenarios = await api('/api/scenarios');
  const grid = document.getElementById('scenario-grid');
  grid.innerHTML = scenarios.map(s => {
    const topParties = Object.entries(s.seat_distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const pills = topParties.map(([p, seats]) =>
      `<span class="seat-pill" style="background:${partyColor(p)};color:${p === 'SNP' ? '#000' : '#fff'}">${p.split(' ')[0]} ${seats}</span>`
    ).join('');
    return `<div class="scenario-card" data-id="${s.id}" onclick="selectScenario('${s.id}', this)">
      <div class="scenario-name">${s.name}</div>
      <div class="scenario-desc">${s.description}</div>
      <div class="scenario-seats">${pills}</div>
    </div>`;
  }).join('');
}

function selectScenario(id, el) {
  document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedScenario = id;
  document.getElementById('btn-start-game').disabled = false;
}

document.getElementById('btn-start-game').addEventListener('click', async () => {
  if (!selectedScenario) return;
  showScreen('screen-loading');
  document.getElementById('loading-title').textContent = 'Generating Parliament...';
  document.getElementById('loading-sub').textContent = 'Filling 650 seats, dispatching whips, brewing tea';

  try {
    await api('/api/game/new', 'POST', { scenario_id: selectedScenario });

    document.getElementById('loading-title').textContent = 'Ready!';
    document.getElementById('loading-sub').textContent = 'Welcome to Westminster';

    player = await api('/api/character');
    gameState = await api('/api/game/state');
    setTimeout(() => initGame(), 800);
  } catch (err) {
    toast(err.message, 'error');
    showScreen('screen-world');
  }
});

// ── Game Init ──────────────────────────────────────────────────────────────

function initGame() {
  updateTopbar();
  showScreen('screen-game');
  showTab('dashboard');

  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  document.getElementById('btn-advance').addEventListener('click', advanceDay);
  document.getElementById('btn-mark-all-read').addEventListener('click', markAllRead);
  document.getElementById('btn-new-game').addEventListener('click', newGame);
  document.getElementById('btn-save-gs').addEventListener('click', saveGameSettings);

  // MP filters
  let mpSearchTimeout;
  document.getElementById('mp-search').addEventListener('input', e => {
    clearTimeout(mpSearchTimeout);
    mpSearchTimeout = setTimeout(() => { mpSearchQuery = e.target.value; mpPage = 0; loadMPs(); }, 300);
  });
  document.getElementById('mp-party-filter').addEventListener('change', e => { mpPartyFilter = e.target.value; mpPage = 0; loadMPs(); });
  document.getElementById('mp-region-filter').addEventListener('change', e => { mpRegionFilter = e.target.value; mpPage = 0; loadMPs(); });

  // Load game settings
  loadGameSettings();
}

function updateTopbar() {
  if (!gameState) return;
  document.getElementById('tb-date').textContent = formatDate(gameState.game_date);
  document.getElementById('tb-day').textContent = `Day ${gameState.day_number}`;
  if (player) {
    document.getElementById('tb-player').textContent = player.name;
    const badge = document.getElementById('tb-party-badge');
    badge.textContent = player.party;
    badge.style.background = partyColor(player.party);
    badge.style.color = player.party === 'SNP' ? '#000' : '#fff';
  }
  const unread = gameState.unread_emails || 0;
  const badge = document.getElementById('unread-badge');
  if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// ── Dashboard ──────────────────────────────────────────────────────────────

async function loadDashboard() {
  gameState = await api('/api/game/state');
  updateTopbar();
  renderProfileCard();
  await Promise.all([loadParliamentMini(), loadDashboardNews(), loadUpcomingEvents()]);
}

function renderProfileCard() {
  if (!player) return;
  const initials = player.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const color = partyColor(player.party);
  document.getElementById('profile-card').innerHTML = `
    <div class="profile-avatar" style="background:${color}">${initials}</div>
    <div class="profile-name">${player.name} MP</div>
    <div class="profile-meta">${player.party} · ${player.constituency}</div>
    <div class="profile-backstory">${player.backstory_text}</div>
  `;
}

async function loadParliamentMini() {
  const rows = await api('/api/parliament/summary');
  const total = rows.reduce((s, r) => s + r.seats, 0);
  const bar = rows.slice(0, 8).map(r =>
    `<div class="parl-segment" style="width:${(r.seats/total*100).toFixed(1)}%;background:${partyColor(r.party)};title='${r.party}: ${r.seats}'" title="${r.party}: ${r.seats} seats"></div>`
  ).join('');
  const legend = rows.slice(0, 6).map(r =>
    `<div class="legend-item"><div class="legend-dot" style="background:${partyColor(r.party)}"></div>${r.party} <strong>${r.seats}</strong></div>`
  ).join('');

  const majority = gameState?.government_majority;
  const majText = majority > 0
    ? `${gameState.pm_party} majority of ${majority * 2} (${majority} over 325)`
    : `Hung Parliament — no overall majority`;

  document.getElementById('parliament-mini').innerHTML = `
    <div class="parl-bar">${bar}</div>
    <div class="parl-legend">${legend}</div>
    <div class="parl-majority">${majText}</div>
    <div class="parl-majority" style="margin-top:6px">PM: <strong>${gameState?.pm_name}</strong> (${gameState?.pm_party})</div>
  `;
}

async function loadDashboardNews() {
  const news = await api('/api/news');
  if (!news.length) {
    document.getElementById('news-list').innerHTML = '<div style="color:var(--text3);font-size:13px">No headlines yet — advance the day to generate news.</div>';
    updateNewsTicker([]);
    return;
  }
  document.getElementById('news-list').innerHTML = news.slice(0, 5).map(n => `
    <div class="news-item">
      <div class="news-headline">${n.headline}</div>
      <div class="news-meta"><span class="cat cat-${n.category}">${n.category}</span> ${n.source}</div>
    </div>`).join('');
  updateNewsTicker(news);
}

function updateNewsTicker(news) {
  const ticker = document.getElementById('news-ticker');
  if (!news.length) { ticker.innerHTML = ''; return; }
  const items = news.map(n => `<span class="ticker-item"><strong>${n.source}:</strong> ${n.headline}</span>`).join('');
  ticker.innerHTML = `<div class="ticker-inner">${items}${items}</div>`;
}

async function loadUpcomingEvents() {
  const events = await api('/api/calendar');
  const upcoming = events.slice(0, 4);
  if (!upcoming.length) {
    document.getElementById('upcoming-events').innerHTML = '<div style="color:var(--text3);font-size:13px">No upcoming events.</div>';
    return;
  }
  document.getElementById('upcoming-events').innerHTML = upcoming.map(e => {
    const d = new Date(e.event_date + 'T00:00:00');
    return `<div class="event-item">
      <div class="event-date-badge">
        <div class="day">${d.getDate()}</div>
        <div class="month">${d.toLocaleDateString('en-GB', { month: 'short' })}</div>
      </div>
      <div>
        <div class="event-title">${e.title}</div>
        <div class="event-desc">${e.description.slice(0, 80)}…</div>
      </div>
    </div>`;
  }).join('');
}

// ── Advance Day ─────────────────────────────────────────────────────────────

async function advanceDay() {
  const btn = document.getElementById('btn-advance');
  const label = document.getElementById('advance-label');
  const spinner = document.getElementById('advance-spinner');

  btn.disabled = true;
  label.classList.add('hidden');
  spinner.classList.remove('hidden');

  try {
    const result = await api('/api/game/advance', 'POST');
    gameState = await api('/api/game/state');
    updateTopbar();

    let msg = `Advanced to ${formatDate(result.new_date)}`;
    if (result.errors?.length) msg += ` (⚠ ${result.errors.join('; ')})`;
    toast(msg, result.errors?.length ? 'error' : 'success');

    // Refresh whichever tab is active
    const activeTab = document.querySelector('.tab.active')?.id?.replace('tab-', '');
    if (activeTab) showTab(activeTab);
    else loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    label.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

// ── Emails ────────────────────────────────────────────────────────────────

async function loadEmails() {
  const emails = await api('/api/emails');
  const list = document.getElementById('email-list');

  if (!emails.length) {
    list.innerHTML = '<div style="padding:20px;color:var(--text3);font-size:13px">No emails yet. Advance the day to receive mail.</div>';
    return;
  }

  list.innerHTML = emails.map(e => `
    <div class="email-list-item ${e.read ? '' : 'unread'}" onclick="openEmail(${e.id})" data-id="${e.id}">
      <div class="email-sender">
        <span>${e.read ? '' : '<span class="unread-dot"></span>'}${escHtml(e.sender_name)}</span>
        <span class="email-date">${formatShortDate(e.game_date)}</span>
      </div>
      <div class="email-subject">${escHtml(e.subject)}</div>
      <div class="email-preview">${escHtml(e.body.slice(0, 80))}</div>
    </div>`).join('');
}

async function openEmail(id) {
  document.querySelectorAll('.email-list-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.email-list-item[data-id="${id}"]`)?.classList.add('active');

  const email = await api(`/api/emails/${id}`);
  // Mark as read in list
  const li = document.querySelector(`.email-list-item[data-id="${id}"]`);
  if (li) { li.classList.remove('unread'); li.querySelector('.unread-dot')?.remove(); }

  const typeLabels = { constituent: 'Constituent', party: 'Party', media: 'Media', lobby: 'Lobby', colleague: 'Colleague' };

  document.getElementById('email-viewer').innerHTML = `
    <div class="email-view-header">
      <div class="email-view-subject">${escHtml(email.subject)}</div>
      <div class="email-view-meta">
        <span>From: <strong>${escHtml(email.sender_name)}</strong> &lt;${escHtml(email.sender_email)}&gt;</span>
        <span>${formatDate(email.game_date)}</span>
        <span class="email-type-badge type-${email.email_type}">${typeLabels[email.email_type] || email.email_type}</span>
      </div>
    </div>
    <div class="email-view-body">${escHtml(email.body)}</div>
  `;

  // Update unread count
  gameState = await api('/api/game/state');
  updateTopbar();
}

async function markAllRead() {
  await api('/api/emails/read-all', 'POST');
  await loadEmails();
  gameState = await api('/api/game/state');
  updateTopbar();
  document.getElementById('email-viewer').innerHTML = '<div class="email-placeholder">Select an email to read</div>';
}

// ── Calendar ───────────────────────────────────────────────────────────────

async function loadCalendar() {
  const events = await api('/api/calendar');
  const container = document.getElementById('calendar-view');

  if (!events.length) {
    container.innerHTML = '<div style="color:var(--text3);padding:20px">No upcoming events.</div>';
    return;
  }

  // Group by month
  const groups = {};
  for (const e of events) {
    const d = new Date(e.event_date + 'T00:00:00');
    const key = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }

  const typeIcons = { pmqs: '🎙️', vote: '🗳️', committee: '📋', debate: '💬', party: '🎪', constituency: '🏘️', parliament: '🏛️', other: '📌' };

  container.innerHTML = Object.entries(groups).map(([month, evs]) => `
    <div class="calendar-group">
      <div class="calendar-month-header">${month}</div>
      ${evs.map(e => {
        const d = new Date(e.event_date + 'T00:00:00');
        return `<div class="calendar-event cal-type-${e.event_type}">
          <div class="cal-date">
            <div class="cal-day">${d.getDate()}</div>
            <div class="cal-month">${d.toLocaleDateString('en-GB', { month: 'short' })}</div>
          </div>
          <div class="cal-info">
            <div class="cal-title">${typeIcons[e.event_type] || '📌'} ${escHtml(e.title)}</div>
            <div class="cal-desc">${escHtml(e.description)}</div>
          </div>
          <div class="cal-tag">${e.event_type}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ── Parliament ──────────────────────────────────────────────────────────────

async function loadParliament() {
  const [rows, state] = await Promise.all([
    api('/api/parliament/summary'),
    api('/api/game/state'),
  ]);

  const total = rows.reduce((s, r) => s + r.seats, 0);
  const govSeats = rows.find(r => r.party === state?.pm_party)?.seats || 0;
  const majority = govSeats > 325;

  const barSegments = rows.map(r =>
    `<div class="parl-segment" style="width:${(r.seats/total*100).toFixed(2)}%;background:${partyColor(r.party)}" title="${r.party}: ${r.seats}"></div>`
  ).join('');

  const partyCards = rows.map(r => {
    const pct = (r.seats / total * 100).toFixed(1);
    return `<div class="party-row">
      <div class="party-color-dot" style="background:${partyColor(r.party)}"></div>
      <div>
        <div class="party-name">${r.party}</div>
        <div class="party-seat-bar" style="width:${Math.min(pct,100)}%;background:${partyColor(r.party)};max-width:120px;height:3px;border-radius:2px;margin-top:3px;display:block"></div>
      </div>
      <div class="party-seat-count">${r.seats}</div>
    </div>`;
  }).join('');

  document.getElementById('parliament-view').innerHTML = `
    <div class="parliament-header">
      <div class="parliament-pm">
        Prime Minister: <strong>${state?.pm_name || '—'}</strong>
        <span class="party-badge" style="background:${partyColor(state?.pm_party)};color:${state?.pm_party === 'SNP' ? '#000' : '#fff'}">${state?.pm_party}</span>
      </div>
      <div style="color:var(--text2);font-size:13px;margin-bottom:12px">
        ${majority ? `Government majority of ${(govSeats - 325) * 2} seats` : '⚠️ Hung Parliament — no overall majority'}
        · Scenario: ${state?.scenario_name}
      </div>
      <div class="seats-visual">
        <div class="seats-bar">${barSegments}</div>
        <div class="majority-line">
          <div class="majority-marker"></div>
          <div class="majority-label">326 majority</div>
        </div>
      </div>
      <div class="party-rows" style="margin-top:32px">${partyCards}</div>
    </div>
  `;
}

// ── MPs ───────────────────────────────────────────────────────────────────

async function loadMPs() {
  const params = new URLSearchParams({
    limit: MP_PAGE_SIZE,
    offset: mpPage * MP_PAGE_SIZE,
  });
  if (mpPartyFilter) params.set('party', mpPartyFilter);
  if (mpRegionFilter) params.set('region', mpRegionFilter);
  if (mpSearchQuery) params.set('search', mpSearchQuery);

  const { mps, total } = await api(`/api/mps?${params}`);
  const tbody = document.getElementById('mp-tbody');

  tbody.innerHTML = mps.map(mp => `
    <tr onclick="showMpModal(${mp.id})" data-mp='${JSON.stringify({ id: mp.id, name: mp.name, party: mp.party, constituency: mp.constituency, region: mp.region, role: mp.role, age: mp.age, gender: mp.gender, backstory: mp.backstory })}'>
      <td><span class="mp-party-dot" style="background:${partyColor(mp.party)}"></span>${escHtml(mp.name)}${mp.is_player ? ' ⭐' : ''}</td>
      <td>${escHtml(mp.party)}</td>
      <td>${escHtml(mp.constituency)}</td>
      <td>${escHtml(mp.region)}</td>
      <td>${escHtml(mp.role)}</td>
      <td>${mp.age}</td>
    </tr>`).join('');

  // Pagination
  const totalPages = Math.ceil(total / MP_PAGE_SIZE);
  const pagination = document.getElementById('mp-pagination');
  let pages = '';
  pages += `<button ${mpPage === 0 ? 'disabled' : ''} onclick="changeMpPage(${mpPage - 1})">← Prev</button>`;
  for (let i = Math.max(0, mpPage - 2); i <= Math.min(totalPages - 1, mpPage + 2); i++) {
    pages += `<button class="${i === mpPage ? 'active' : ''}" onclick="changeMpPage(${i})">${i + 1}</button>`;
  }
  pages += `<button ${mpPage >= totalPages - 1 ? 'disabled' : ''} onclick="changeMpPage(${mpPage + 1})">Next →</button>`;
  pages += `<span style="color:var(--text3);font-size:12px;padding:6px"> ${total} total</span>`;
  pagination.innerHTML = pages;
}

function changeMpPage(page) {
  mpPage = page;
  loadMPs();
}

function showMpModal(id) {
  const row = document.querySelector(`#mp-tbody tr[data-mp]`);
  // Find by iterating
  const rows = document.querySelectorAll('#mp-tbody tr[data-mp]');
  let mp = null;
  rows.forEach(r => { const d = JSON.parse(r.dataset.mp); if (d.id === id) mp = d; });
  if (!mp) return;

  const modal = document.getElementById('mp-modal');
  document.getElementById('mp-modal-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div class="profile-avatar" style="background:${partyColor(mp.party)};width:48px;height:48px;font-size:18px">
        ${mp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
      </div>
      <div>
        <div class="modal-mp-name">${escHtml(mp.name)}</div>
        <div class="modal-mp-meta">
          <span class="party-badge" style="background:${partyColor(mp.party)};color:${mp.party === 'SNP' ? '#000' : '#fff'}">${mp.party}</span>
          &nbsp;${mp.role} · Age ${mp.age}
        </div>
      </div>
    </div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:12px">📍 ${escHtml(mp.constituency)} (${escHtml(mp.region)})</div>
    <div class="modal-mp-backstory">${escHtml(mp.backstory)}</div>
  `;
  modal.classList.remove('hidden');
}

function closeMpModal() {
  document.getElementById('mp-modal').classList.add('hidden');
}

document.getElementById('mp-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mp-modal')) closeMpModal();
});

// ── Game Settings ──────────────────────────────────────────────────────────

async function loadGameSettings() {
  try {
    const s = await api('/api/settings/raw');
    if (s.ai_provider) document.getElementById('gs-provider').value = s.ai_provider;
    if (s.ai_model) document.getElementById('gs-model').value = s.ai_model;
    if (s.custom_endpoint) document.getElementById('gs-endpoint').value = s.custom_endpoint;
    document.getElementById('gs-provider').addEventListener('change', function () {
      document.getElementById('gs-endpoint-group').classList.toggle('hidden', this.value !== 'custom');
    });
    document.getElementById('gs-provider').dispatchEvent(new Event('change'));
  } catch {}
}

async function saveGameSettings() {
  const provider = document.getElementById('gs-provider').value;
  const apiKey = document.getElementById('gs-apikey').value.trim();
  const model = document.getElementById('gs-model').value.trim();
  const endpoint = document.getElementById('gs-endpoint').value.trim();
  await api('/api/settings', 'POST', { ai_provider: provider, api_key: apiKey || undefined, ai_model: model, custom_endpoint: endpoint });
  const notice = document.getElementById('gs-saved');
  notice.classList.remove('hidden');
  setTimeout(() => notice.classList.add('hidden'), 2000);
}

function newGame() {
  if (!confirm('Start a new game? This will delete your current save.')) return;
  player = null; gameState = null;
  loadCharacterScreen().then(() => {
    showScreen('screen-character');
  });
}

// ── XSS prevention ────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const [charRes, stateRes] = await Promise.all([
      api('/api/character').catch(() => null),
      api('/api/game/state').catch(() => null),
    ]);

    if (charRes && stateRes) {
      player = charRes;
      gameState = stateRes;
      initGame();
      return;
    }

    await loadSetupScreen();
    showScreen('screen-setup');
  } catch (err) {
    await loadSetupScreen();
    showScreen('screen-setup');
  }
}

boot();
