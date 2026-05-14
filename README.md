# UK Political Simulator

A lightweight, AI-powered UK politics simulation game. Play as a newly elected MP navigating Westminster — read your mail, track the parliamentary calendar, and watch the country unfold.

## Features

- **BYOK AI** — bring your own API key for OpenAI, OpenRouter, or any OpenAI-compatible endpoint (Ollama, LiteLLM, CharacterAI, etc.)
- **Character creation** — name, party, constituency (all 650 real UK seats), and backstory
- **7 world scenarios** — Labour Landslide, Conservative Landslide, two Hung Parliaments, Reform Surge, Progressive Alliance, National Unity Government
- **650 generated MPs** — named, aged, regioned, and assigned roles (Cabinet, Shadow Cabinet, backbenchers) based on the scenario
- **AI email inbox** — daily emails from constituents, the party whip, journalists, lobbyists, and colleagues, generated with full game-state context
- **AI news** — 5 headlines per day from realistic UK outlets, with animated ticker
- **Parliamentary calendar** — seeded events (State Opening, PMQs, surgeries) plus AI-generated future events
- **Parliament view** — seat bar, majority indicator, full party breakdown
- **MPs directory** — all 650 MPs, searchable and filterable by party and region

## Requirements

- Node.js 18+
- An API key for a supported AI provider

## Getting Started

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

On first run you'll be walked through:
1. **API setup** — enter your key and choose a provider
2. **Character creation** — who are you?
3. **World selection** — what political landscape will you inhabit?

## AI Provider Setup

| Provider | Where to get a key | Example model |
|---|---|---|
| OpenAI | [platform.openai.com](https://platform.openai.com) | `gpt-4o-mini` |
| OpenRouter | [openrouter.ai](https://openrouter.ai) | `openai/gpt-4o-mini` |
| Custom endpoint | Any OpenAI-compatible API | `gpt-4o-mini` |

The custom endpoint option works with Ollama (`http://localhost:11434/v1`), LiteLLM, vLLM, CharacterAI, and anything else that speaks the OpenAI chat completions format.

Your API key is stored only in the local `game.db` SQLite file on your machine.

## Gameplay

Each turn you **advance the day** — the AI generates a fresh batch of emails and headlines. Every 5 days it also generates new calendar events.

- **Inbox** — read emails from constituents (ranging from touching to gloriously petty), the party whip, journalists, and lobbyists
- **Calendar** — track PMQs, votes, committee meetings, and constituency surgeries
- **Parliament** — monitor the balance of power and your government's majority
- **MPs** — browse all 650 members, search by name or constituency, filter by party or region

## File Structure

```
server.js          Express API server
database.js        SQLite schema and helpers
ai-service.js      Multi-provider AI client (emails, news, calendar events)
mp-generator.js    650 MP generation — names, constituencies, parties, roles
public/
  index.html       Single-page app shell
  style.css        Dark Westminster theme
  app.js           Frontend logic
game.db            Created on first run (gitignored)
```

## Data

Parliamentary data is fictional and generated for entertainment. Constituency names are real. Party seat distributions are based on plausible (or historically inspired) election outcomes.
