const { getAllSettings } = require('./database');

async function callAI(messages, systemPrompt = null) {
  const settings = getAllSettings();
  const provider = settings.ai_provider || 'openai';
  const apiKey = settings.api_key;
  const model = settings.ai_model || getDefaultModel(provider);
  const customEndpoint = settings.custom_endpoint;

  if (!apiKey) throw new Error('No API key configured. Go to Settings to add one.');

  const endpoint = getEndpoint(provider, customEndpoint);
  const headers = getHeaders(provider, apiKey);

  const messagesPayload = [];
  if (systemPrompt) messagesPayload.push({ role: 'system', content: systemPrompt });
  messagesPayload.push(...messages);

  const body = {
    model,
    messages: messagesPayload,
    temperature: 0.85,
    max_tokens: 2000,
  };

  if (provider === 'openrouter') {
    body.transforms = ['middle-out'];
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API error (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0]) {
    throw new Error('Unexpected API response format');
  }

  return data.choices[0].message.content;
}

function getEndpoint(provider, customEndpoint) {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
    case 'custom': return customEndpoint || 'https://api.openai.com/v1/chat/completions';
    default: return 'https://api.openai.com/v1/chat/completions';
  }
}

function getHeaders(provider, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://ukpolsim.local';
    headers['X-Title'] = 'UK Political Simulator';
  }
  return headers;
}

function getDefaultModel(provider) {
  switch (provider) {
    case 'openai': return 'gpt-4o-mini';
    case 'openrouter': return 'openai/gpt-4o-mini';
    case 'custom': return 'gpt-4o-mini';
    default: return 'gpt-4o-mini';
  }
}

async function generateEmails(gameState, player, recentEvents) {
  const { game_date, scenario_name, pm_name, pm_party } = gameState;

  const systemPrompt = `You are a creative writer for a UK political simulation game. Generate realistic, entertaining emails that an MP would receive.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Prime Minister: ${pm_name} (${pm_party})
- Player character: ${player.name}, ${player.party} MP for ${player.constituency}
- Player backstory: ${player.backstory_text}
${recentEvents.length > 0 ? `\nRECENT EVENTS:\n${recentEvents.map(e => `- ${e}`).join('\n')}` : ''}

Generate between 4 and 6 emails. Mix serious political content with entertaining/absurd constituent issues. Include:
- 1-2 constituent emails (can range from touching to hilariously petty)
- 1 party whip email (voting instructions or party business)
- 1 from a journalist, lobbyist, or think tank
- Optionally 1 from a colleague MP or minister

Return ONLY a valid JSON array. Each object must have:
- "sender_name": string (full name)
- "sender_email": string (realistic email address)
- "subject": string
- "body": string (2-4 paragraphs, formal but readable)
- "email_type": one of "constituent", "party", "media", "lobby", "colleague"

Make the tone vary: some urgent, some mundane, some amusing. Reference real UK political issues (NHS, housing, energy, transport). Be creative with constituent complaints - they can be wonderfully British.`;

  const content = await callAI([
    { role: 'user', content: 'Generate today\'s emails for this MP.' }
  ], systemPrompt);

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON array');

  return JSON.parse(jsonMatch[0]);
}

async function generateNews(gameState, player) {
  const { game_date, scenario_name, pm_name, pm_party } = gameState;

  const systemPrompt = `You are generating UK political news headlines for a simulation game.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Prime Minister: ${pm_name} (${pm_party})

Generate 5 news headlines for today. Mix parliamentary, economic, and human interest political stories.

Return ONLY a valid JSON array. Each object must have:
- "headline": string (punchy, tabloid/broadsheet style)
- "summary": string (1-2 sentences)
- "source": string (e.g. "BBC Politics", "The Guardian", "Daily Mail", "The Times", "Sky News")
- "category": one of "parliament", "economy", "party", "international", "scandal"`;

  const content = await callAI([
    { role: 'user', content: 'Generate today\'s political news.' }
  ], systemPrompt);

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

async function generateCalendarEvents(gameState, player) {
  const { game_date, scenario_name } = gameState;

  const systemPrompt = `You are generating parliamentary calendar events for a UK political simulation game.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Player: ${player.name}, ${player.party} MP for ${player.constituency}

Generate 3-5 upcoming parliamentary events for the next 2 weeks. Include a mix of:
- PMQs / Oral Questions
- Committee meetings
- Votes / Divisions
- Party events
- Constituency surgeries
- Debates

Return ONLY a valid JSON array. Each object must have:
- "event_date": string (ISO date format, within 14 days of ${game_date})
- "title": string
- "description": string (1-2 sentences)
- "event_type": one of "pmqs", "vote", "committee", "debate", "party", "constituency", "other"`;

  const content = await callAI([
    { role: 'user', content: 'Generate upcoming parliamentary events.' }
  ], systemPrompt);

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

module.exports = { callAI, generateEmails, generateNews, generateCalendarEvents };
