# Orbit

Orbit is a small assistant that sits in your Windows tray. Press a hotkey, say or type a question, and it answers with whatever you were looking at as context: the text you had selected, the window you were in, or a part of the screen you snip.

I wanted something like the Gemini or Copilot sidebar, but for every app on my PC, open source, and not tied to one AI company. You can point it at your Claude subscription, an API key, or a model running locally in Ollama, and everything else works the same.

It's early (version 0.1). The basics work. Connecting Slack, Google and Notion, memory, and scheduled workflows are next. The full roadmap is in [plan.md](plan.md).

## Install

Grab `Orbit Setup x.y.z.exe` from [Releases](../../releases) and run it. It isn't code-signed yet, so Windows will show a blue "Windows protected your PC" screen. Click "More info", then "Run anyway".

After that Orbit lives in the tray. Right-click the icon to open the settings file.

## Using it

| What | Hotkey |
|---|---|
| Open the bar and start talking (press again to stop and send) | `Ctrl+Alt+Space` |
| Snip part of the screen and ask about it | `Ctrl+Alt+S` |
| Stop anything that's running | `Ctrl+Alt+Esc` |

If you had text selected when you opened the bar, it shows up as a small chip above the input, next to one for the app you were in. Remove either one if you don't want to send it. Press Enter to send, Esc or click anywhere else to close, Ctrl+N to start over.

When the answer is a rewrite of your selection, click "Paste back" and Orbit puts it where your selection was. Your clipboard is put back the way it was afterwards.

A few commands you can type in the bar:

- `/key brave <key>` saves an API key. Keys are encrypted with Windows' own data protection and never sent to a model.
- `/install-voice` downloads the speech model.
- `/new` clears the conversation.

## Voice

Speech-to-text runs on your own machine using NVIDIA's Parakeet model through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). No account, no word limit, nothing leaves your PC. The first time you use it, Orbit downloads the model (482 MB). On my 4-core i5 laptop it turns 10 seconds of speech into text in about 1.3 seconds. It only does English for now.

If you'd rather use [Wispr Flow](https://wisprflow.ai), set `voice.engine` to `"wispr"` in settings and Orbit will trigger it with Wispr's own shortcut.

## Choosing a model

In `settings.json`, `models.chat` looks like `"claude:sonnet"` or `"ollama:qwen3:4b"`: the provider name, a colon, then the model.

To use your Claude subscription, install Claude Code, run `claude` once, and log in with `/login`. Orbit talks to it through Anthropic's Agent SDK. It never touches your login details, and it switches off all of Claude Code's own tools, so the model can only use what Orbit gives it.

You can also use an Anthropic API key (`/key anthropic sk-...`) or anything with an OpenAI-compatible API: OpenAI, OpenRouter, Ollama, LM Studio.

Web search needs a free key from [Brave Search](https://brave.com/search/api/) or Tavily.

## What it's allowed to do

Anything that changes something (sending, posting, writing, deleting) shows you a card first and waits for you to approve it. You can change that per tool in settings: always ask, always allow, or never. Text you select and pages Orbit reads are treated as data, so a web page can't talk the model into doing something. Every tool call is written to `%APPDATA%\Orbit\logs\audit.jsonl` if you want to check what happened.

## Working on it

```sh
npm install
npm run dev          # runs with hot reload
npm run typecheck
npm run test:e2e     # opens the app with Playwright and screenshots the bar
npm run dist         # builds the installer into dist/
```

## Disclaimer

This is an independent project. It isn't affiliated with or endorsed by Anthropic, NVIDIA or Wispr. Using your Claude subscription this way falls under Anthropic's terms and your plan's usage limits, and those can change. That's one reason Orbit lets you switch providers whenever you want.

## License

[MIT](LICENSE)
