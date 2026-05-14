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
let dailyEvents = [];
let calendarCurrentMonth = null;
let calendarSelectedDate = null;
let calendarEventsData = [];
let currentClockInterval = 5000;

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
  if (name === 'government') loadGovernment();
  if (name === 'office') loadOffice();
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

let allMpNames = [];
let mpRegex = null;
let mpNameToId = {};

async function loadMpNames() {
  try {
    allMpNames = await api('/api/mps/names');
    const names = allMpNames.map(m => m.name).sort((a,b) => b.length - a.length);
    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    mpRegex = new RegExp('\\b(' + escapedNames.join('|') + ')\\b', 'g');
    allMpNames.forEach(m => mpNameToId[m.name] = m.id);
  } catch(e) {}
}

function enrichTextWithMpLinks(text) {
  if (!text) return '';
  let escaped = escHtml(text);
  if (!mpRegex) return escaped;
  return escaped.replace(mpRegex, (match) => {
    return `<span class="mp-link" onclick="showMpModal(${mpNameToId[match]})">${match}</span>`;
  });
}

async function fetchGameState() {
  const oldDate = gameState?.game_date;
  const oldTime = gameState?.game_time;
  const newState = await api('/api/game/state');
  if (newState && oldDate === newState.game_date && oldTime) {
    newState.game_time = oldTime;
  }
  gameState = newState;
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
  if (!allConstituencies.includes(constituency)) { toast('Please select a valid constituency from the list', 'error'); return; }
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
  loadMpNames();
  fetchDailyEvents();
  startClock();
  showTab('dashboard');

  if (!window.gameInitialized) {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        showTab(btn.dataset.tab);
        document.querySelector('.sidenav')?.classList.remove('open');
      });
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
    window.gameInitialized = true;

    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
      document.querySelector('.sidenav').classList.toggle('open');
    });
  }

  // Load game settings
  loadGameSettings();
}

// ── Clock & Time ──────────────────────────────────────────────────────────

function startClock() {
  if(window.clockInterval) clearInterval(window.clockInterval);
  window.clockPaused = false;
  window.clockInterval = setInterval(() => {
    if(window.clockPaused) return;
    tickClock();
  }, currentClockInterval);
}

function setTimeSpeed(speedMultiplier) {
  currentClockInterval = 5000 / speedMultiplier;
  document.querySelectorAll('.btn-time').forEach(b => b.classList.remove('active'));
  document.querySelector(`.btn-time[data-speed="${speedMultiplier}"]`)?.classList.add('active');
  if(window.clockInterval) clearInterval(window.clockInterval);
  window.clockInterval = setInterval(() => {
    if(window.clockPaused) return;
    tickClock();
  }, currentClockInterval);
}

async function tickClock() {
  if(!gameState || !gameState.game_time) return;
  let [hh, mm] = gameState.game_time.split(':').map(Number);
  mm += 1;
  if(mm >= 60) { hh += 1; mm -= 60; }
  
  if(hh >= 24) {
    window.clockPaused = true;
    gameState.game_time = '00:00';
    document.getElementById('tb-time').textContent = '00:00';
    toast("Midnight has struck. Time to advance the day.", "success");
    return;
  }
  
  gameState.game_time = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  document.getElementById('tb-time').textContent = gameState.game_time;
  
  if(mm % 15 === 0) {
    api('/api/game/sync-time', 'POST', { time: gameState.game_time }).catch(()=>{});
    const currentTab = document.querySelector('.tab.active')?.id;
    if (currentTab === 'tab-inbox') loadEmails();
    api('/api/game/state').then(s => {
      gameState.unread_emails = s.unread_emails;
      updateTopbar();
    });
  }
  checkTriggers();
}

async function fetchDailyEvents() {
  try {
    const events = await api('/api/calendar/today');
    dailyEvents = events.filter(e => e.status === 'pending' && e.event_time);
  } catch(e) {}
}

function checkTriggers() {
  const current = gameState.game_time;
  const trigger = dailyEvents.find(e => e.event_time <= current && e.status === 'pending');
  if (trigger) {
    window.clockPaused = true;
    document.getElementById('event-title').textContent = trigger.title;
    document.getElementById('event-desc').textContent = trigger.description;
    document.getElementById('event-outcome').classList.add('hidden');
    document.getElementById('event-action-area').classList.remove('hidden');
    document.getElementById('event-close').classList.add('hidden');
    document.getElementById('event-input').value = '';
    document.getElementById('event-modal').dataset.eventId = trigger.id;
    document.getElementById('event-modal').classList.remove('hidden');
  }
}

async function submitEventAction() {
  const id = document.getElementById('event-modal').dataset.eventId;
  const action = document.getElementById('event-input').value;
  if(!action) return;
  
  document.getElementById('event-action-area').classList.add('hidden');
  document.getElementById('event-outcome').textContent = 'Generating outcome...';
  document.getElementById('event-outcome').classList.remove('hidden');
  
  const res = await api(`/api/game/event/${id}/resolve`, 'POST', { action });
  const appText = res.approval_change > 0 ? `+${res.approval_change}` : res.approval_change;
  const partyText = res.party_change > 0 ? `+${res.party_change}` : res.party_change;
  
  let relText = '';
  if (res.rel_changes && res.rel_changes.length > 0) {
    relText = ' | Relations: ' + res.rel_changes.map(rc => `${rc.name} ${rc.change > 0 ? '+' : ''}${rc.change}`).join(', ');
  }
  
  document.getElementById('event-outcome').innerHTML = `${enrichTextWithMpLinks(res.outcome)}<br><br><span style="font-weight:600;font-size:12px;color:var(--text2)">Stat Changes: Approval ${appText} | Party ${partyText}${relText}</span>`;
  document.getElementById('event-close').classList.remove('hidden');
  
  player = await api('/api/character');
  updateTopbar();
  
  const ev = dailyEvents.find(e => e.id == id);
  if (ev) ev.status = 'resolved';
}

function closeEventModal() { document.getElementById('event-modal').classList.add('hidden'); window.clockPaused = false; }

function updateTopbar() {
  if (!gameState) return;
  document.getElementById('tb-date').textContent = formatDate(gameState.game_date);
  document.getElementById('tb-time').textContent = gameState.game_time;
  document.getElementById('tb-day').textContent = `Day ${gameState.day_number}`;
  if (player) {
    document.getElementById('tb-player').textContent = player.name;
    document.getElementById('tb-approval').textContent = player.approval_rating;
    document.getElementById('tb-party').textContent = player.party_standing;
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
  await fetchGameState();
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
    <div class="profile-backstory" style="margin-top:10px;border-color:var(--accent)"><strong>Approval:</strong> ${player.approval_rating}% &nbsp;|&nbsp; <strong>Party Whip:</strong> ${player.party_standing}%</div>
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
    <div class="news-item" onclick="openNews(${n.id})">
      <div class="news-headline">${escHtml(n.headline)}</div>
      <div class="news-meta"><span class="cat cat-${n.category}">${n.category}</span> ${escHtml(n.source)}</div>
    </div>`).join('');
  updateNewsTicker(news);
}

function updateNewsTicker(news) {
  const ticker = document.getElementById('news-ticker');
  if (!news.length) { ticker.innerHTML = ''; return; }
  const items = news.map(n => `<span class="ticker-item" style="cursor:pointer" onclick="openNews(${n.id})"><strong>${escHtml(n.source)}:</strong> ${escHtml(n.headline)}</span>`).join('');
  ticker.innerHTML = `<div class="ticker-inner">${items}${items}</div>`;
}

async function openNews(id) {
  const modal = document.getElementById('news-modal');
  const body = document.getElementById('news-modal-body');
  modal.classList.remove('hidden');
  body.innerHTML = '<div style="padding:20px;text-align:center;"><div class="spinner-sm" style="margin:0 auto"></div></div>';
  
  try {
    const news = await api(`/api/news/${id}`);
    body.innerHTML = `
      <div class="news-view-header">
        <div class="news-view-headline">${escHtml(news.headline)}</div>
        <div class="news-view-meta">
          <span class="cat cat-${news.category}">${news.category}</span>
          <span>${escHtml(news.source)}</span>
          <span>${formatDate(news.game_date)}</span>
        </div>
      </div>
      <div id="news-article-area" class="news-view-body">
        ${news.body ? enrichTextWithMpLinks(news.body) : '<div class="spinner-sm" style="margin: 0 auto"></div><div style="text-align:center;margin-top:8px;color:var(--text3)">Writing article...</div>'}
      </div>
    `;
    if (!news.body) {
      const res = await api(`/api/news/${id}/generate-body`, 'POST');
      document.getElementById('news-article-area').innerHTML = enrichTextWithMpLinks(res.body);
    }
  } catch (err) { body.innerHTML = `<div style="color:var(--red);padding:20px">Failed to load article</div>`; }
}

function closeNewsModal() { document.getElementById('news-modal').classList.add('hidden'); }

async function loadUpcomingEvents() {
  const events = await api('/api/calendar');
  const upcoming = events.filter(e => e.event_date >= gameState.game_date).slice(0, 4);
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
        <div class="event-title">${escHtml(e.title)}</div>
        <div class="event-desc">${escHtml(e.description).slice(0, 80)}…</div>
      </div>
    </div>`;
  }).join('');
}

// ── Advance Day ─────────────────────────────────────────────────────────────

async function advanceDay() {
  const btn = document.getElementById('btn-advance');
  const label = document.getElementById('advance-label');
  const spinner = document.getElementById('advance-spinner');

  window.clockPaused = true;
  btn.disabled = true;
  label.classList.add('hidden');
  spinner.classList.remove('hidden');

  try {
    const result = await api('/api/game/advance', 'POST');
    await fetchGameState();
    player = await api('/api/character');
    updateTopbar();

    fetchDailyEvents();
    window.clockPaused = false;
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
        <span>${e.read ? '' : '<span class="unread-dot"></span>'}${e.is_player ? 'You: ' : ''}${escHtml(e.sender_name)}</span>
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

  let senderDisplay = email.is_player ? `<strong>You</strong> to ${email.sender_name}` : `From: <strong>${escHtml(email.sender_name)}</strong>`;
  document.getElementById('email-viewer').innerHTML = `
    <div class="email-view-header">
      <div class="email-view-subject">${escHtml(email.subject)}</div>
      <div class="email-view-meta">
        <span>${senderDisplay} &lt;${escHtml(email.sender_email)}&gt;</span>
        <span>${formatDate(email.game_date)}</span>
        <span>${email.delivery_time}</span>
        <span class="email-type-badge type-${email.email_type}">${typeLabels[email.email_type] || email.email_type}</span>
      </div>
    </div>
    <div class="email-view-body ${email.is_player ? 'player-email-body' : ''}">${enrichTextWithMpLinks(email.body)}</div>
    ${email.is_player ? '' : `
    <div class="email-reply-area">
      <textarea id="email-reply-input" placeholder="Write a reply..."></textarea>
      <button class="btn-sm" onclick="sendEmailReply(${email.id})">Send Reply</button>
    </div>`}
  `;

  // Update unread count
  await fetchGameState();
  updateTopbar();
}

async function sendEmailReply(id) {
  const input = document.getElementById('email-reply-input');
  const reply = input.value.trim();
  if(!reply) return;
  
  input.disabled = true;
  toast('Sending reply...', 'info');
  
  try {
    await api(`/api/emails/${id}/reply`, 'POST', { reply });
    toast('Reply sent! They will respond shortly.', 'success');
    input.value = '';
    input.disabled = false;
    loadEmails();
    player = await api('/api/character');
    updateTopbar();
  } catch(e) { toast(e.message, 'error'); input.disabled = false; }
}

async function markAllRead() {
  await api('/api/emails/read-all', 'POST');
  await loadEmails();
  await fetchGameState();
  updateTopbar();
  document.getElementById('email-viewer').innerHTML = '<div class="email-placeholder">Select an email to read</div>';
}

// ── Calendar ───────────────────────────────────────────────────────────────

async function loadCalendar() {
  calendarEventsData = await api('/api/calendar');
  const container = document.getElementById('calendar-view');

  if (!calendarCurrentMonth && gameState) {
    calendarCurrentMonth = new Date(gameState.game_date);
    calendarCurrentMonth.setDate(1);
  }
  if (!calendarSelectedDate && gameState) {
    calendarSelectedDate = gameState.game_date;
  }

  if (!calendarCurrentMonth) return;

  container.innerHTML = `
    <div class="calendar-layout">
      <div class="calendar-main">
        <div class="calendar-controls">
          <button class="btn-sm" onclick="changeCalMonth(-1)">← Prev</button>
          <h3 id="cal-month-label">Month Year</h3>
          <button class="btn-sm" onclick="changeCalMonth(1)">Next →</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
      </div>
      <div class="calendar-sidebar">
        <h3 id="cal-sidebar-date" style="margin-bottom:12px;font-size:16px;">Selected Date</h3>
        <div id="cal-sidebar-events"></div>
      </div>
    </div>
  `;
  renderCalendarGrid();
  renderCalendarSidebar();
}

window.changeCalMonth = function(dir) {
  calendarCurrentMonth.setMonth(calendarCurrentMonth.getMonth() + dir);
  renderCalendarGrid();
}

window.selectCalDate = function(dateStr) {
  calendarSelectedDate = dateStr;
  renderCalendarGrid();
  renderCalendarSidebar();
}

function renderCalendarGrid() {
  const year = calendarCurrentMonth.getFullYear();
  const month = calendarCurrentMonth.getMonth();
  document.getElementById('cal-month-label').textContent = calendarCurrentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let startOffset = firstDay.getDay() - 1;
  if (startOffset === -1) startOffset = 6;

  const daysInMonth = lastDay.getDate();

  let gridHtml = '';
  const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const d of daysOfWeek) {
    gridHtml += `<div class="cal-header-day">${d}</div>`;
  }

  for (let i = 0; i < startOffset; i++) {
    gridHtml += `<div class="cal-cell empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    const dateStr = `${year}-${mStr}-${dStr}`;

    const dayEvents = calendarEventsData.filter(e => e.event_date === dateStr);
    const isToday = gameState && dateStr === gameState.game_date;
    const isSelected = dateStr === calendarSelectedDate;

    let dotsHtml = dayEvents.map(e => `<div class="cal-dot cal-type-${e.event_type}"></div>`).join('');

    gridHtml += `
      <div class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'active' : ''}" onclick="selectCalDate('${dateStr}')">
        <div class="cal-day-num">${d}</div>
        <div class="cal-dots">${dotsHtml}</div>
      </div>
    `;
  }

  document.getElementById('cal-grid').innerHTML = gridHtml;
}

function renderCalendarSidebar() {
  const dayEvents = calendarEventsData.filter(e => e.event_date === calendarSelectedDate);
  dayEvents.sort((a, b) => (a.event_time || '00:00').localeCompare(b.event_time || '00:00'));

  const d = new Date(calendarSelectedDate + 'T00:00:00');
  document.getElementById('cal-sidebar-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const container = document.getElementById('cal-sidebar-events');
  if (!dayEvents.length) {
    container.innerHTML = '<div style="color:var(--text3);font-size:13px">No events scheduled.</div>';
    return;
  }

  const typeIcons = { pmqs: '🎙️', vote: '🗳️', committee: '📋', debate: '💬', party: '🎪', constituency: '🏘️', parliament: '🏛️', other: '📌' };

  container.innerHTML = dayEvents.map(e => `
    <div class="calendar-event cal-type-${e.event_type}" style="flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
        <div class="cal-tag">${e.event_time || '12:00'}</div>
        <div class="cal-tag">${e.event_type}</div>
      </div>
      <div class="cal-info" style="width:100%">
        <div class="cal-title">${typeIcons[e.event_type] || '📌'} ${escHtml(e.title)}</div>
        <div class="cal-desc">${escHtml(e.description)}</div>
      </div>
    </div>
  `).join('');
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

// ── Government ────────────────────────────────────────────────────────────

async function loadGovernment() {
  const data = await api('/api/government');
  const container = document.getElementById('government-view');
  
  const renderList = (title, mps) => {
    if (!mps.length) return '';
    return `
      <h3 style="margin:20px 0 12px;font-size:16px;color:var(--text2)">${title}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;">
        ${mps.map(mp => `
          <div class="cabinet-card" onclick="showMpModal(${mp.id})" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;margin-bottom:4px">${mp.role}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="mp-party-dot" style="background:${partyColor(mp.party)}"></span>
              <span style="font-weight:600;font-size:14px">${escHtml(mp.name)}${mp.is_player ? ' ⭐' : ''}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  container.innerHTML = `
    <div>
      ${renderList('The Cabinet', data.cabinet)}
      ${renderList('Shadow Cabinet', data.shadow)}
    </div>
  `;
}

// ── Office & Staff ────────────────────────────────────────────────────────

async function loadOffice() {
  const p = await api('/api/character');
  const staff = [
    { id: 'staff_pr', name: 'PR Manager', cost: 40000, desc: 'Handles media relations and helps spin public scandals to protect your Approval Rating.', active: p.staff_pr },
    { id: 'staff_caseworker', name: 'Constituency Caseworker', cost: 30000, desc: 'Manages the inbox, handles constituent complaints, and keeps the locals happy.', active: p.staff_caseworker },
    { id: 'staff_researcher', name: 'Parliamentary Researcher', cost: 35000, desc: 'Writes speeches, briefs you on upcoming bills, and manages parliamentary tactics.', active: p.staff_researcher }
  ];
  
  const totalBudget = 150000;
  const spent = staff.filter(s => s.active).reduce((sum, s) => sum + s.cost, 0);
  const remaining = totalBudget - spent;
  const pct = (spent / totalBudget) * 100;
  
  document.getElementById('office-view').innerHTML = `
    <div class="budget-container">
      <div style="display:flex;justify-content:space-between;font-weight:700">
        <span>Annual Office Budget</span>
        <span>£${spent.toLocaleString()} spent / £${totalBudget.toLocaleString()}</span>
      </div>
      <div class="budget-bar"><div class="budget-fill" style="width:${pct}%"></div></div>
      <div style="font-size:12px;color:var(--text2)">Remaining available funds: <strong>£${remaining.toLocaleString()}</strong></div>
    </div>
    <h3 style="font-size:15px;margin-bottom:12px">Available Staff Candidates</h3>
    <div class="staff-grid">
      ${staff.map(s => `
        <div class="staff-card ${s.active ? 'hired' : ''}">
          <div class="staff-header">
            <div>
              <div class="staff-title">${s.name}</div>
              <div class="staff-cost">£${s.cost.toLocaleString()} / year</div>
            </div>
            ${s.active ? '<span class="staff-badge badge-hired">Hired</span>' : ''}
          </div>
          <div class="staff-desc">${s.desc}</div>
          <button class="btn-sm staff-action" onclick="toggleStaff('${s.id}', ${s.active})">${s.active ? 'Fire Staff Member' : 'Hire Candidate'}</button>
        </div>
      `).join('')}
    </div>
  `;
}

window.toggleStaff = async function(role, currentlyHired) {
  try {
    await api('/api/office/staff', 'POST', { role, hired: !currentlyHired });
    toast(currentlyHired ? 'Staff member let go.' : 'Staff member hired!', 'success');
    loadOffice();
  } catch (err) { toast(err.message, 'error'); }
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
    <tr onclick="showMpModal(${mp.id})" data-mp="${escHtml(JSON.stringify({ id: mp.id, name: mp.name, party: mp.party, constituency: mp.constituency, region: mp.region, role: mp.role, age: mp.age, gender: mp.gender, backstory: mp.backstory, relationship: mp.relationship }))}">
      <td><span class="mp-party-dot" style="background:${partyColor(mp.party)}"></span>${escHtml(mp.name)}${mp.is_player ? ' ⭐' : ''}</td>
      <td>${escHtml(mp.party)}</td>
      <td>${escHtml(mp.constituency)}</td>
      <td>${escHtml(mp.region)}</td>
      <td>${escHtml(mp.role)}</td>
      <td>${mp.age}</td>
      <td><span style="font-weight:600;color:${mp.relationship > 60 ? 'var(--green)' : mp.relationship < 40 ? 'var(--red)' : 'var(--text)'}">${mp.relationship}</span></td>
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

async function showMpModal(id) {
  const modal = document.getElementById('mp-modal');
  const body = document.getElementById('mp-modal-body');
  modal.classList.remove('hidden');
  body.innerHTML = '<div style="padding:20px;text-align:center;"><div class="spinner-sm" style="margin:0 auto"></div></div>';

  try {
    const mp = await api(`/api/mps/${id}`);
    body.innerHTML = `
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
      <div style="margin:16px 0 20px 0;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em">Relationship Status</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;">
            <div style="width:${mp.relationship}%;height:100%;background:${mp.relationship > 60 ? 'var(--green)' : mp.relationship < 40 ? 'var(--red)' : 'var(--yellow)'};transition:width 0.3s;"></div>
          </div>
          <div style="font-size:13px;font-weight:700;color:${mp.relationship > 60 ? 'var(--green)' : mp.relationship < 40 ? 'var(--red)' : 'var(--text)'}">${mp.relationship} / 100</div>
        </div>
      </div>
      <div id="mp-profile-area" class="modal-mp-backstory">
        ${mp.profile_text ? enrichTextWithMpLinks(mp.profile_text) : '<div class="spinner-sm" style="margin: 0 auto"></div><div style="text-align:center;margin-top:8px;color:var(--text3)">Researching profile...</div>'}
      </div>
    `;
    if (!mp.profile_text) {
      const res = await api(`/api/mps/${id}/generate-profile`, 'POST');
      document.getElementById('mp-profile-area').innerHTML = enrichTextWithMpLinks(res.profile_text);
    }
  } catch (err) { body.innerHTML = `<div style="color:var(--red);padding:20px">Failed to load MP</div>`; }
}

function closeMpModal() {
  document.getElementById('mp-modal').classList.add('hidden');
}

document.getElementById('mp-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mp-modal')) closeMpModal();
});
document.getElementById('news-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('news-modal')) closeNewsModal();
});

// ── Game Settings ──────────────────────────────────────────────────────────

async function loadGameSettings() {
  try {
    const s = await api('/api/settings/raw');
    if (s.ai_provider) document.getElementById('gs-provider').value = s.ai_provider;
    if (s.ai_model) document.getElementById('gs-model').value = s.ai_model;
    if (s.custom_endpoint) document.getElementById('gs-endpoint').value = s.custom_endpoint;
    if (s.memory_context_limit) document.getElementById('gs-memory-limit').value = s.memory_context_limit;
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
  const limit = document.getElementById('gs-memory-limit').value;
  await api('/api/settings', 'POST', { ai_provider: provider, api_key: apiKey || undefined, ai_model: model, custom_endpoint: endpoint, memory_context_limit: limit });
  const notice = document.getElementById('gs-saved');
  notice.classList.remove('hidden');
  setTimeout(() => notice.classList.add('hidden'), 2000);
}

async function checkContext() {
  const debug = document.getElementById('context-debug');
  debug.classList.remove('hidden');
  debug.textContent = 'Calculating...';
  try {
    const data = await api('/api/debug/context');
    debug.innerHTML = `<strong>Estimated Context Tokens: ~${data.estimated_tokens}</strong> (Memories loaded: ${data.memory_count})<br><br><strong>Sample Payload Prefix:</strong><br>${escHtml(data.prompt)}`;
  } catch (err) {
    debug.textContent = `Error: ${err.message}`;
  }
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
