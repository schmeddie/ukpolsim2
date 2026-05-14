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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API error (${response.status}): ${text.slice(0, 300)}`);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0]) {
      throw new Error('Unexpected API response format');
    }

    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('AI API request timed out after 60 seconds.');
    }
    throw error;
  }
}

function getEndpoint(provider, customEndpoint) {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
    case 'custom': {
      let endpoint = customEndpoint || 'https://api.openai.com/v1/chat/completions';
      endpoint = endpoint.trim();
      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
      }
      return endpoint;
    }
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

async function generateEmails(gameState, player, recentEvents, memories = []) {
  const { game_date, scenario_name, pm_name, pm_party } = gameState;
  
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';
  const memoryString = memories.length ? `\nPLAYER MEMORY (Past Actions):\n${memories.map(m => `- [${m.game_date}] ${m.memory_text}`).join('\n')}` : '';

  const systemPrompt = `You are a creative writer for a UK political simulation game. Generate realistic, entertaining emails that an MP would receive.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Prime Minister: ${pm_name} (${pm_party})
- Player character: ${player.name}, ${player.party} MP for ${player.constituency}
- Player backstory: ${player.backstory_text}
- Approval Rating: ${player.approval_rating}% | Party Standing: ${player.party_standing}%
- Staff Hired: ${staffString}
${recentEvents.length > 0 ? `\nRECENT EVENTS:\n${recentEvents.map(e => `- ${e}`).join('\n')}` : ''}
${memoryString}

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
- "delivery_time": string (HH:MM format, realistic random time between 07:30 and 21:00)

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
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';

  const systemPrompt = `You are generating UK political news headlines for a simulation game.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Prime Minister: ${pm_name} (${pm_party})
- Player Staff: ${staffString}

Generate 5 news headlines for today. Mix parliamentary, economic, and human interest political stories.

Return ONLY a valid JSON array. Each object must have:
- "headline": string (punchy, tabloid/broadsheet style)
- "summary": string (1-2 sentences)
- "source": string (e.g. "BBC Politics", "The Guardian", "Daily Mail", "The Times", "Sky News")
- "category": one of "parliament", "economy", "party", "international", "scandal"
- "mechanics": an object containing actionable state changes (use null for fields that don't apply). It MUST have these keys:
  - "minister_resigned": string (exact role of a resigning cabinet minister, else null)
  - "defecting_mp_name": string (full name of an MP changing parties, else null)
  - "defecting_to_party": string (the party they are joining, else null)
  - "byelection_resigning_mp_name": string (full name of an MP stepping down, else null)
  - "byelection_winning_party": string (the party that won the by-election, else null)
  - "player_approval_change": integer (-5 to 5, only if the news directly impacts the player's reputation)
  - "mp_relationship_changes": array of objects [{"mp_name": "Full Name", "change": integer (-10 to 10)}], else null`;

  const content = await callAI([
    { role: 'user', content: 'Generate today\'s political news.' }
  ], systemPrompt);

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

async function generateCalendarEvents(gameState, player, memories = []) {
  const { game_date, scenario_name } = gameState;
  const memoryString = memories.length ? `\nPLAYER MEMORY (Past Actions):\n${memories.map(m => `- [${m.game_date}] ${m.memory_text}`).join('\n')}` : '';
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';

  const systemPrompt = `You are generating parliamentary calendar events for a UK political simulation game.

GAME STATE:
- Date: ${game_date}
- Scenario: ${scenario_name}
- Player: ${player.name}, ${player.party} MP for ${player.constituency}
- Staff Hired: ${staffString}
${memoryString}

Generate 3-5 upcoming parliamentary events for the next 2 weeks. Include a mix of:
- PMQs / Oral Questions
- Committee meetings
- Votes / Divisions
- Party events
- Constituency surgeries
- Debates

Return ONLY a valid JSON array. Each object must have:
- "event_date": string (ISO date format, within 14 days of ${game_date})
- "event_time": string (HH:MM format, realistic times between 08:00 and 20:00)
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

async function generateDailyEvents(gameState, player, memories = []) {
  const { game_date, scenario_name } = gameState;
  const memoryString = memories.length ? `\nPLAYER MEMORY (Past Actions):\n${memories.map(m => `- [${m.game_date}] ${m.memory_text}`).join('\n')}` : '';
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';
  const systemPrompt = `You are generating a daily event schedule for a UK political simulation game.
  Date: ${game_date}
  Player: ${player.name}, ${player.party} MP for ${player.constituency}
  Staff Hired: ${staffString}
  ${memoryString}
  
  Generate 2 to 4 career-focused political events for TODAY. Focus on parliamentary business, media ambushes, constituent crises, or party drama. Skip mundane personal things.
  
  Return ONLY a valid JSON array. Each object must have:
  - "event_time": string (HH:MM format, realistic times between 08:00 and 20:00)
  - "title": string
  - "description": string (1-2 sentences)
  - "event_type": one of "pmqs", "vote", "committee", "debate", "party", "constituency", "other"`;
  
  const content = await callAI([{ role: 'user', content: 'Generate today\'s events.' }], systemPrompt);
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  return JSON.parse(jsonMatch[0]);
}

async function resolveEventAction(gameState, player, event, action) {
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';
  const systemPrompt = `You are the game master for a UK political simulator.
  Player: ${player.name}, ${player.party} MP for ${player.constituency}.
  Approval Rating: ${player.approval_rating}% | Party Standing: ${player.party_standing}%
  Staff Hired: ${staffString}
  Event: ${event.title} - ${event.description}
  The MP decided to: "${action}"
  
  Evaluate this action. Return ONLY a valid JSON object with the following keys:
  - "outcome": string (a realistic, immersive outcome, 2-3 sentences)
  - "approval_change": integer (between -10 and 10, how this affects public approval)
  - "party_change": integer (between -10 and 10, how this affects their standing with the party whip)
  - "memory_note": string (1 brief sentence summarizing the action and outcome to serve as long-term memory for future events)
  - "mp_relationship_changes": array of objects [{"mp_name": "Full Name", "change": integer (-10 to 10)}], else empty array`;
  const content = await callAI([{ role: 'user', content: 'Resolve this action.' }], systemPrompt);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch[0]);
}

async function generateEmailReply(gameState, player, originalEmail, playerReply) {
  const systemPrompt = `You are roleplaying as a sender replying to an MP in a UK political simulator.
  Player: ${player.name}, ${player.party} MP.
  Sender: ${originalEmail.sender_name} (${originalEmail.email_type})
  Original message: ${originalEmail.body}
  MP's reply: "${playerReply}"
  
  Evaluate this interaction and generate the sender's follow-up response. Return ONLY a valid JSON object with the following keys:
  - "body": string (the text of the sender's reply)
  - "approval_change": integer (between -5 and 5, how this affects public approval, or 0)
  - "party_change": integer (between -5 and 5, how this affects their standing with the party whip, or 0)
  - "memory_note": string (1 brief sentence summarizing the email exchange to serve as long-term memory for future events, or null if inconsequential)
  - "mp_relationship_changes": array of objects [{"mp_name": "Full Name", "change": integer (-5 to 5)}], or empty array`;
  const content = await callAI([{ role: 'user', content: 'Generate the reply.' }], systemPrompt);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch[0]);
}

async function generateNewsArticle(gameState, newsItem, player) {
  const systemPrompt = `You are a journalist for ${newsItem.source} in a UK political simulation game.
  Date: ${gameState.game_date}
  Prime Minister: ${gameState.pm_name} (${gameState.pm_party})
  Player MP: ${player.name} (${player.party})
  
  Expand the following into a realistic 3-4 paragraph news article:
  Headline: "${newsItem.headline}"
  Summary: "${newsItem.summary}"
  
  Return ONLY a valid JSON object with the key "body" containing the article text. Include realistic quotes from relevant politicians.`;
  
  const content = await callAI([{ role: 'user', content: 'Write the full article.' }], systemPrompt);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch[0]);
}

async function generateMpProfile(gameState, mp) {
  const systemPrompt = `You are writing a biographical profile for a UK political simulation game.
  MP: ${mp.name}, ${mp.party} MP for ${mp.constituency}
  Age: ${mp.age}, Role: ${mp.role}
  Basic Backstory: "${mp.backstory}"
  
  Expand this into a full, detailed biographical profile (2-3 paragraphs). Discuss their early life, career before politics, and political reputation. 
  Return ONLY a valid JSON object with the key "profile" containing the text.`;
  
  const content = await callAI([{ role: 'user', content: 'Write the profile.' }], systemPrompt);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch[0]);
}

function getSampleContext(gameState, player, recentEvents, memories) {
  const memoryString = memories.length ? `\nPLAYER MEMORY (Past Actions):\n${memories.map(m => `- [${m.game_date}] ${m.memory_text}`).join('\n')}` : '';
  const staffString = [player.staff_pr ? 'PR Manager' : '', player.staff_caseworker ? 'Caseworker' : '', player.staff_researcher ? 'Parliamentary Researcher' : ''].filter(Boolean).join(', ') || 'None';
  return `GAME STATE:
- Date: ${gameState.game_date}
- Scenario: ${gameState.scenario_name}
- Prime Minister: ${gameState.pm_name} (${gameState.pm_party})
- Player character: ${player.name}, ${player.party} MP for ${player.constituency}
- Player backstory: ${player.backstory_text}
- Approval Rating: ${player.approval_rating}% | Party Standing: ${player.party_standing}%
- Staff Hired: ${staffString}
${recentEvents.length > 0 ? `\nRECENT EVENTS:\n${recentEvents.map(e => `- ${e}`).join('\n')}` : ''}${memoryString}`;
}

module.exports = { callAI, generateEmails, generateNews, generateCalendarEvents, generateDailyEvents, resolveEventAction, generateEmailReply, generateNewsArticle, generateMpProfile, getSampleContext };
