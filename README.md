# Orbit

Open-source, provider-agnostic desktop assistant for Windows. Press a hotkey (or just talk) and ask about anything on screen — selected text, a screenshot region, the active window — then get answers and actions through tools you control.

> **Status: 0.1 (early).** Windows 11 only. Core loop works; integrations (Slack, Google, Notion), memory and workflows are next — see [plan.md](plan.md).

## Install

Download `Orbit Setup x.y.z.exe` from [Releases](../../releases) and run it. The installer isn't code-signed yet, so Windows SmartScreen will warn: **More info → Run anyway**.

Orbit lives in the tray. Settings: tray → *Edit settings.json* (validated, hot-reloaded).

## Use

| Action | Default hotkey |
|---|---|
| Open bar + start dictation (press again to stop and send) | `Ctrl+Alt+Space` |
| Screenshot a region and ask about it | `Ctrl+Alt+S` |
| Stop everything | `Ctrl+Alt+Esc` |

Selected text and the active window are attached automatically as removable chips. In the bar: `Enter` send · `Esc` or click outside to close · `Ctrl+N` new chat · **Paste back** replaces your selection with the answer (clipboard is restored).

Slash commands: `/key <name> <value>` store an API key (encrypted with Windows DPAPI) · `/install-voice` download the speech model · `/new` reset.

## Voice

Dictation runs **fully offline** with NVIDIA Parakeet TDT 0.6B (int8) via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): free, unlimited, English with punctuation. One-time 482 MB download on first use. On a 4-core laptop CPU it transcribes ~7× faster than real time.

Prefer [Wispr Flow](https://wisprflow.ai)? Set `voice.engine` to `"wispr"`; Orbit triggers it through Wispr's own hotkey.

## Models

`settings.json → models.chat` is `"<provider>:<model>"`, e.g. `claude:sonnet`, `ollama:qwen3:4b`. Tools, approvals and context behave identically on every provider.

- **claude-subscription** — uses your own logged-in Claude Code (run `claude`, then `/login`) through the Claude Agent SDK. Orbit never reads, stores or relays your credentials. All Claude Code built-in tools, settings, skills and connectors are disabled; the model only sees Orbit's tools.
- **anthropic-api** — Anthropic API key (`/key anthropic sk-...`).
- **openai-compatible** — OpenAI, OpenRouter, Ollama, LM Studio, etc.

Web search needs a free [Brave Search](https://brave.com/search/api/) or Tavily key: `/key brave <key>`.

## Safety

Tools that change things (send, post, write, delete) require an approval card by default; per-tool policy is `ask` / `always` / `never` in `settings.json`. Selected text and web pages are passed to the model as untrusted data. Every tool call is logged to `%APPDATA%\Orbit\logs\audit.jsonl`.

## Develop

```sh
npm install
npm run dev          # hot reload
npm run typecheck
npm run test:e2e     # Playwright drives the app and screenshots each bar state
npm run dist         # NSIS installer in dist/
```

## Disclaimer

Orbit is an independent project, not affiliated with or endorsed by Anthropic, NVIDIA or Wispr. Using a Claude subscription through the Agent SDK is subject to Anthropic's terms and your plan's usage limits, which may change; Orbit is built so you can switch providers at any time.

## License

[MIT](LICENSE)
