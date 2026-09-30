# Orbit

Orbit is a small assistant that sits in your Windows tray. Press a hotkey, say or type a question, and it answers with whatever you were looking at as context: the text you had selected, the window you were in, or a part of the screen you snip.

I wanted something like the Gemini or Copilot sidebar, but for every app on my PC, open source, and not tied to one AI company. You can point it at your Claude subscription, an API key, or a model running locally in Ollama, and everything else works the same.

It's early (version 0.3). It can remember things about you, work in the background, use Notion, Slack, Gmail and Google Calendar, set reminders, and run workflows on a schedule. Event triggers, branching and a visual workflow editor are next. The full roadmap is in [plan.md](plan.md).

## Install

Grab `Orbit Setup x.y.z.exe` from [Releases](../../releases) and run it. It isn't code-signed yet, so Windows will show a blue "Windows protected your PC" screen. Click "More info", then "Run anyway".

After that Orbit lives in the tray. Click the icon to open the bar, or right-click it for the dashboard, where you connect services, look through your memory and history, and see background jobs.

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

## Memory

Tell Orbit "remember that Sam is my cofounder, his email is sam@example.com" and it saves that on your PC. Later, when you ask something related ("email Sam the notes"), the matching memories go along with your question, so you don't have to repeat yourself. You can see, edit and delete everything it knows in the dashboard.

Mark a memory private and it's only ever sent to models running on your own machine, like Ollama. Orbit refuses to store anything that looks like a password, card number or API key, even if you ask.

## Background jobs

Say "research the best Postgres hosting for a startup in India, in the background" and Orbit hands it to a separate agent so you can keep going. When it's done you get a notification, and the result is saved as a markdown file (the dashboard has it too). For jobs that split up neatly, it can run up to four agents at the same time and put their answers together.

## Reminders and workflows

"Remind me in 30 minutes to stretch" or "remind me every weekday at 9 to check the deploy" sets a desktop notification. It works offline.

Workflows are jobs Orbit runs on a schedule or when you ask. Describe one in the bar ("every Friday at 5, summarise my week and save it as a note") and Orbit writes it, shows it to you, and saves it once you approve. A workflow can call tools, ask a model to write or decide something, and stop to let you review before anything gets sent. Each run and step is logged on the dashboard's Workflows page.

There's a ready-made one to start with: a daily tech digest that reads Hacker News, Google News, TechCrunch and Product Hunt every morning and writes you a short roundup of big tech, AI, startups and new products worth trying. Add it from the Workflows page.

Workflows only run while Orbit is running. If your PC was off at the scheduled time, Orbit asks, runs it, or skips it the next time it starts, depending on how the workflow is set up. They're plain YAML files in `%APPDATA%\Orbit\workflows` if you want to edit them by hand.

## Connecting your apps

Open the dashboard and go to Integrations.

Notion is one click: it opens Notion in your browser and you pick which pages Orbit can see.

Slack and Google take a few minutes of setup, because neither lets outside apps connect without you creating your own app or OAuth client first. The dashboard walks you through it step by step. Your tokens are encrypted on your PC and never shown to the model.

Anything that works over MCP can be added the same way by editing `integrations.json`. If a service isn't connected and you ask for something that needs it, Orbit tells you instead of pretending.

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
node scripts/e2e-dashboard.mjs   # dashboard pages, no model calls
npm run dist         # builds the installer into dist/
```

## Disclaimer

This is an independent project. It isn't affiliated with or endorsed by Anthropic, NVIDIA or Wispr. Using your Claude subscription this way falls under Anthropic's terms and your plan's usage limits, and those can change. That's one reason Orbit lets you switch providers whenever you want.

## License

[MIT](LICENSE)
