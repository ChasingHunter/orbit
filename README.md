# Orbit

Open-source, provider-agnostic desktop assistant for Windows. Hotkey or voice → ask about anything on screen (selected text, screenshots, the active window) → answers and actions through tools you control.

> **Status:** early (Day 1). Windows 11 only.

## Run

```sh
npm install
npm run dev
```

Hotkeys (change in `%APPDATA%\Orbit\settings.json`, hot-reloaded):

| Action | Default |
|---|---|
| Open bar (+ start Wispr dictation; press again to stop) | `Ctrl+Alt+Space` |
| Screenshot region & ask | `Ctrl+Alt+S` |
| Stop everything | `Ctrl+Alt+Esc` |

In the bar: `Enter` send · `Esc` close · `Ctrl+N` new chat · `/key <name> <value>` store an API key (DPAPI-encrypted) · `/new` reset.

## Models

`settings.json → models.chat` is `"<provider>:<model>"`, e.g. `claude:sonnet`, `ollama:qwen3:4b`.

- **claude-subscription** — uses your own logged-in Claude Code (`claude` → `/login`) through the Claude Agent SDK. Orbit never reads, stores, or relays your credentials. All Claude Code built-in tools, settings, skills and connectors are disabled; the model only sees Orbit's tools.
- **anthropic-api** — Anthropic API key (`/key anthropic sk-...`).
- **openai-compatible** — OpenAI, OpenRouter, Ollama, LM Studio, etc.

Web search needs a free Brave or Tavily key: `/key brave <key>`.

## Disclaimer

Orbit is an independent project, not affiliated with or endorsed by Anthropic. Using a Claude subscription through the Agent SDK is subject to Anthropic's terms and your plan's usage limits, which may change; Orbit is designed so you can switch providers at any time.

## Voice

Orbit triggers [Wispr Flow](https://wisprflow.ai) by sending its hands-free hotkey (read from Wispr's config; override with `voice.wisprCombo`). Wispr pastes the transcript into the bar, and Orbit auto-submits.
