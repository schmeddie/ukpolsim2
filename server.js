const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, getSetting, setSetting, getAllSettings } = require('./database');
const { generateEmails, generateNews, generateCalendarEvents } = require('./ai-service');
const { generateMPs, generatePMName, SCENARIOS, CONSTITUENCIES } = require('./mp-generator');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wrap sync route handlers so thrown errors become JSON 500s
function wrap(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

// ─── Settings ──────────────────────────────────────────────────────────────

app.get('/api/settings', wrap((req, res) => {
  const settings = getAllSettings();
  if (settings.api_key) settings.api_key = settings.api_key.replace(/.(?=.{4})/g, '•');
  res.json(settings);
}));

app.post('/api/settings', wrap((req, res) => {
  const { ai_provider, api_key, ai_model, custom_endpoint } = req.body;
  if (ai_provider) setSetting('ai_provider', ai_provider);
  if (api_key && !api_key.includes('•')) setSetting('api_key', api_key);
  if (ai_model) setSetting('ai_model', ai_model);
  if (custom_endpoint !== undefined) setSetting('custom_endpoint', custom_endpoint);
  res.json({ ok: true });
}));

app.get('/api/settings/raw', wrap((req, res) => {
  const settings = getAllSettings();
  res.json(settings);
}));

// ─── Scenarios ─────────────────────────────────────────────────────────────

app.get('/api/scenarios', wrap((req, res) => {
  res.json(SCENARIOS);
}));

app.get('/api/constituencies', wrap((req, res) => {
  res.json(CONSTITUENCIES.map(c => c.name).sort());
}));

// ─── Character ─────────────────────────────────────────────────────────────

app.get('/api/character', wrap((req, res) => {
  const db = getDb();
  const player = db.prepare('SELECT * FROM player ORDER BY id DESC LIMIT 1').get();
  res.json(player || null);
}));

app.post('/api/character', wrap((req, res) => {
  const { name, party, constituency, backstory_id, backstory_text, bio } = req.body;
  if (!name || !party || !constituency || !backstory_id || !backstory_text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const db = getDb();
  db.prepare('DELETE FROM player').run();
  db.prepare(`INSERT INTO player (name, party, constituency, backstory_id, backstory_text, bio)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run([name, party, constituency, backstory_id, backstory_text, bio || '']);
  res.json({ ok: true });
}));

// ─── Game State ─────────────────────────────────────────────────────────────

app.get('/api/game/state', wrap((req, res) => {
  const db = getDb();
  const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
  if (!state) return res.json(null);
  const unread = db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE read = 0').get();
  res.json({ ...state, unread_emails: unread.cnt });
}));

app.post('/api/game/new', wrap((req, res) => {
  const { scenario_id } = req.body;
  const scenario = SCENARIOS.find(s => s.id === scenario_id);
  if (!scenario) return res.status(400).json({ error: 'Unknown scenario' });

  const db = getDb();
  const player = db.prepare('SELECT * FROM player ORDER BY id DESC LIMIT 1').get();
  if (!player) return res.status(400).json({ error: 'Create a character first' });

  const pmName = generatePMName(scenario, player.name);
  const finalPmName = (player.party === scenario.pm_party && Math.random() < 0.05)
    ? player.name : pmName;

  db.prepare('DELETE FROM game_state').run();
  db.prepare('DELETE FROM mps').run();
  db.prepare('DELETE FROM emails').run();
  db.prepare('DELETE FROM calendar_events').run();
  db.prepare('DELETE FROM news_items').run();

  const govSeats = scenario.seat_distribution[scenario.pm_party] || 0;
  const majority = govSeats > 325;
  db.prepare(`INSERT INTO game_state (id, game_date, scenario_id, scenario_name, pm_name, pm_party, government_majority, day_number)
              VALUES (1, ?, ?, ?, ?, ?, ?, ?)`)
    .run([scenario.start_date, scenario.id, scenario.name, finalPmName,
          scenario.pm_party, majority ? govSeats - 325 : 0, 1]);

  const mps = generateMPs(scenario, player.constituency);
  const insertMP = db.prepare(`INSERT INTO mps (name, first_name, last_name, party, constituency, region, role, backstory, gender, age, is_player)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const mp of mps) {
      insertMP.run([mp.name, mp.first_name, mp.last_name, mp.party, mp.constituency,
                    mp.region, mp.role, mp.backstory, mp.gender, mp.age, mp.is_player]);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  db.prepare('UPDATE mps SET name = ?, first_name = ?, last_name = ?, party = ?, role = ? WHERE is_player = 1')
    .run([player.name, player.name.split(' ')[0], player.name.split(' ').slice(1).join(' '),
          player.party, 'Backbencher']);

  seedInitialCalendar(db, scenario.start_date);
  res.json({ ok: true, scenario: scenario.name });
}));

function seedInitialCalendar(db, startDate) {
  const d = new Date(startDate);
  const events = [
    { offset: 1,  title: 'New Parliament Assembles',  description: 'MPs gather in the House of Commons for the first time after the election. The Speaker is elected and oaths are taken.',                                            type: 'parliament'   },
    { offset: 3,  title: 'State Opening of Parliament', description: 'His Majesty the King delivers the King\'s Speech, outlining the new government\'s legislative programme.',                                                     type: 'parliament'   },
    { offset: 7,  title: 'First PMQs',                 description: 'Prime Minister\'s Questions — the new PM faces the Commons for the first time.',                                                                                 type: 'pmqs'         },
    { offset: 10, title: 'Constituency Surgery',       description: 'Your first surgery session. Constituents queue up with planning complaints, benefits issues, and one man\'s grievance about a missing wheelie bin.',              type: 'constituency' },
    { offset: 14, title: 'Emergency Budget Debate',    description: 'The Chancellor presents an emergency fiscal statement responding to the economic situation inherited from the previous government.',                              type: 'debate'       },
    { offset: 21, title: 'PMQs',                       description: 'Weekly Prime Minister\'s Questions.',                                                                                                                            type: 'pmqs'         },
    { offset: 28, title: 'PMQs',                       description: 'Weekly Prime Minister\'s Questions.',                                                                                                                            type: 'pmqs'         },
  ];
  const insert = db.prepare(`INSERT INTO calendar_events (event_date, title, description, event_type, is_generated)
                             VALUES (?, ?, ?, ?, 0)`);
  for (const e of events) {
    const date = new Date(d);
    date.setDate(date.getDate() + e.offset);
    insert.run([date.toISOString().split('T')[0], e.title, e.description, e.type]);
  }
}

// ─── Advance Day ─────────────────────────────────────────────────────────────

app.post('/api/game/advance', async (req, res, next) => {
  try {
    const db = getDb();
    const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
    if (!state) return res.status(400).json({ error: 'No active game' });

    const player = db.prepare('SELECT * FROM player ORDER BY id DESC LIMIT 1').get();
    if (!player) return res.status(400).json({ error: 'No player' });

    const currentDate = new Date(state.game_date);
    currentDate.setDate(currentDate.getDate() + 1);
    const newDate = currentDate.toISOString().split('T')[0];
    const newDay = state.day_number + 1;

    db.prepare('UPDATE game_state SET game_date = ?, day_number = ? WHERE id = 1')
      .run([newDate, newDay]);

    const recentNews = db.prepare('SELECT headline FROM news_items ORDER BY id DESC LIMIT 5').all()
      .map(n => n.headline);

    const newState = { ...state, game_date: newDate, day_number: newDay };
    const results = { emails: false, news: false, events: false, errors: [] };

    try {
      const emails = await generateEmails(newState, player, recentNews);
      const insertEmail = db.prepare(`INSERT INTO emails (game_date, sender_name, sender_email, subject, body, email_type)
                                      VALUES (?, ?, ?, ?, ?, ?)`);
      for (const e of emails) {
        insertEmail.run([newDate, e.sender_name, e.sender_email, e.subject, e.body, e.email_type]);
      }
      results.emails = true;
    } catch (err) {
      results.errors.push(`Emails: ${err.message}`);
    }

    try {
      const news = await generateNews(newState, player);
      const insertNews = db.prepare(`INSERT INTO news_items (game_date, headline, summary, source, category)
                                     VALUES (?, ?, ?, ?, ?)`);
      for (const n of news) {
        insertNews.run([newDate, n.headline, n.summary, n.source, n.category]);
      }
      results.news = true;
    } catch (err) {
      results.errors.push(`News: ${err.message}`);
    }

    if (newDay % 5 === 0) {
      try {
        const events = await generateCalendarEvents(newState, player);
        const insertEvent = db.prepare(`INSERT INTO calendar_events (event_date, title, description, event_type, is_generated)
                                        VALUES (?, ?, ?, ?, 1)`);
        for (const e of events) {
          insertEvent.run([e.event_date, e.title, e.description, e.event_type]);
        }
        results.events = true;
      } catch (err) {
        results.errors.push(`Events: ${err.message}`);
      }
    }

    res.json({ ok: true, new_date: newDate, day: newDay, ...results });
  } catch (err) {
    next(err);
  }
});

// ─── MPs ─────────────────────────────────────────────────────────────────────

app.get('/api/mps', wrap((req, res) => {
  const db = getDb();
  const { party, region, search, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM mps WHERE 1=1';
  const params = [];
  if (party)  { query += ' AND party = ?';                             params.push(party); }
  if (region) { query += ' AND region = ?';                            params.push(region); }
  if (search) { query += ' AND (name LIKE ? OR constituency LIKE ?)';  params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY party, name LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const mps = db.prepare(query).all(params);

  let countQuery = 'SELECT COUNT(*) as cnt FROM mps WHERE 1=1';
  const countParams = [];
  if (party)  { countQuery += ' AND party = ?';                            countParams.push(party); }
  if (region) { countQuery += ' AND region = ?';                           countParams.push(region); }
  if (search) { countQuery += ' AND (name LIKE ? OR constituency LIKE ?)'; countParams.push(`%${search}%`, `%${search}%`); }
  const total = db.prepare(countQuery).get(countParams.length ? countParams : []).cnt;

  res.json({ mps, total });
}));

app.get('/api/parliament/summary', wrap((req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT party, COUNT(*) as seats FROM mps GROUP BY party ORDER BY seats DESC').all();
  res.json(rows);
}));

// ─── Emails ──────────────────────────────────────────────────────────────────

app.get('/api/emails', wrap((req, res) => {
  const db = getDb();
  const { unread_only } = req.query;
  let query = 'SELECT * FROM emails';
  if (unread_only === 'true') query += ' WHERE read = 0';
  query += ' ORDER BY id DESC';
  res.json(db.prepare(query).all());
}));

app.get('/api/emails/:id', wrap((req, res) => {
  const db = getDb();
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get([req.params.id]);
  if (!email) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE emails SET read = 1 WHERE id = ?').run([req.params.id]);
  res.json({ ...email, read: 1 });
}));

app.post('/api/emails/:id/read', wrap((req, res) => {
  const db = getDb();
  db.prepare('UPDATE emails SET read = 1 WHERE id = ?').run([req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/emails/read-all', wrap((req, res) => {
  const db = getDb();
  db.prepare('UPDATE emails SET read = 1').run();
  res.json({ ok: true });
}));

// ─── Calendar ────────────────────────────────────────────────────────────────

app.get('/api/calendar', wrap((req, res) => {
  const db = getDb();
  const state = db.prepare('SELECT game_date FROM game_state WHERE id = 1').get();
  if (!state) return res.json([]);
  const events = db.prepare(`SELECT * FROM calendar_events WHERE event_date >= ?
                              ORDER BY event_date ASC LIMIT 60`)
    .all([state.game_date]);
  res.json(events);
}));

// ─── News ────────────────────────────────────────────────────────────────────

app.get('/api/news', wrap((req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM news_items ORDER BY id DESC LIMIT 20').all());
}));

// ─── Backstory options ────────────────────────────────────────────────────────

app.get('/api/backstories', wrap((req, res) => {
  res.json([
    { id: 'doctor',      label: 'NHS Doctor',           description: 'A former consultant who entered politics to fix the health service from the inside.' },
    { id: 'union',       label: 'Trade Union Rep',       description: 'Two decades fighting for workers on the factory floor before entering Westminster.' },
    { id: 'entrepreneur',label: 'Business Owner',        description: 'Built a business from scratch and brings private sector pragmatism to politics.' },
    { id: 'teacher',     label: 'Teacher',               description: 'Spent years in the classroom before deciding the only way to improve education was to change the system.' },
    { id: 'military',    label: 'Military Veteran',      description: 'Served multiple tours abroad. Now fights on a different kind of front line.' },
    { id: 'lawyer',      label: 'Barrister',             description: 'A human rights lawyer who believes parliament is the highest court in the land.' },
    { id: 'journalist',  label: 'Journalist',            description: 'Covered Westminster for years before deciding to get on the other side of the press lobby.' },
    { id: 'councillor',  label: 'Local Councillor',      description: 'Started fixing potholes and got addicted to public service. Worked their way up.' },
    { id: 'advisor',     label: 'Political Adviser',     description: 'Spent years whispering in ministers\' ears. Now it\'s their turn to do the talking.' },
    { id: 'activist',    label: 'Activist/Campaigner',   description: 'A lifelong campaigner who got tired of shouting at the gates and decided to walk through them.' },
  ]);
}));

// ─── Static fallback ─────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global JSON error handler ───────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', req.method, req.path, err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UK Political Simulator running at http://localhost:${PORT}`);
});
