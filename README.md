# Orbit

Orbit is a small assistant that sits in your Windows tray. Press a hotkey, say or type a question, and it answers with whatever you were looking at as context: the text you had selected, the window you were in, or a part of the screen you snip.

I wanted something like the Gemini or Copilot sidebar, but for every app on my PC, open source, and not tied to one AI company. You can point it at your Claude subscription, an API key, or a model running locally in Ollama, and everything else works the same.

It's early (version 0.7). It can remember things about you, work in the background, use Notion, Slack, Gmail and Google Calendar, set reminders, and run n8n-style workflows that you build by asking or on a canvas. The full roadmap is in [plan.md](plan.md).

## Install

Grab `Orbit-Setup-x.y.z.exe` from [Releases](../../releases) and run it. It isn't code-signed yet, so Windows will show a blue "Windows protected your PC" screen. Click "More info", then "Run anyway".

After that Orbit starts with Windows and keeps itself up to date (both can be switched off in Settings). It lives in the tray. Click the icon to open the bar, or right-click it for the dashboard, where you connect services, look through your memory and history, and see background jobs.

The first time it starts, the dashboard opens on the Setup page and asks you to sign in to Claude. That's the only step you need.

### What it needs

It runs on any Windows 10 or 11 PC (64-bit). The installer carries everything the core needs: its own copy of Claude Code, the speech-to-text engine, the sandbox workflow code runs in, and the rest. You don't need Node, Python or anything else to get going.

The rest is optional, and only matters for the feature next to it:

| Thing | What it's for | Where it comes from |
|---|---|---|
| Claude sign-in | Claude models on your subscription | One click on the Setup page |
| Speech model (Parakeet, about 480 MB) | Talking to Orbit, all on your PC | Download button on the Setup page, or `/install-voice` |
| Brave or Tavily key | Web search | Free tier, paste it on the Setup page |
| [uv](https://docs.astral.sh/uv/) | Pocket TTS voice replies, Gmail and Calendar | Install it yourself |
| [Node.js](https://nodejs.org/) | Slack and other `npx` integrations | Install it yourself |
| [Ollama](https://ollama.com/) | Offline answers, private memories, the fallback when you hit your Claude limit | Install it yourself |

The Setup page checks all of these and tells you what's there, what's missing, and what's fine to skip.

Orbit tries not to install a second copy of things you already have. If you already use Claude Code, you can switch Settings over to your own install so only one copy runs (the bundled one stays pinned to the version Orbit was tested with, which is why it's the default). uv, Ollama and Pocket TTS all use their normal caches, so models you've already downloaded aren't downloaded again.

## Using it

| What | Hotkey |
|---|---|
| Open the bar and start talking (press again to stop and send) | `Ctrl+Alt+Space` |
| Snip part of the screen and ask about it | `Ctrl+Alt+S` |
| Stop anything that's running | `Ctrl+Alt+Esc` |

If you had text selected when you opened the bar, it shows up as a small chip above the input, next to one for the app you were in. Remove either one if you don't want to send it. Press Enter to send, Esc or click anywhere else to close, Ctrl+N to start over.

When you have text selected, a row of quick actions shows up: Explain, Summarise, Fix grammar, Translate and Reply. Fix grammar puts the corrected text straight back where your selection was; Reply copies a draft to your clipboard. You can change the list in `settings.json`.

For any other answer that rewrites your selection, click "Paste back". Your clipboard is put back the way it was afterwards.

You can also attach files: drag them onto the bar, paste them, or click the paperclip. PDFs, Word, Excel, PowerPoint, images and any text or code file work. Orbit keeps a copy for 30 days so follow-up questions can still read it, and only the first 20,000 characters go along with your question (the model reads on if it needs more). Images are shrunk to the size Claude uses anyway, so a big photo doesn't cost more tokens than it has to.

In a browser, Orbit also picks up the address of the tab you're on, so "what's this article saying?" can read the whole page, not just what you selected.

The last answer has a Retry button, and hovering your last message shows a pencil to edit it; either one replaces that exchange instead of adding to it. The small menu next to the paperclip switches the model for the current chat only (a new chat goes back to your default). Answers can include tables and math formulas.

Every conversation is kept in the dashboard's History, and you can pick one up again from there.

A few commands you can type in the bar:

- `/key brave <key>` saves an API key. Keys are encrypted with Windows' own data protection and never sent to a model.
- `/install-voice` downloads the speech model.
- `/new` clears the conversation.

## Voice

Speech-to-text runs on your own machine using NVIDIA's Parakeet model through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). No account, no word limit, nothing leaves your PC. The first time you use it, Orbit downloads the model (482 MB). On my 4-core i5 laptop it turns 10 seconds of speech into text in about 1.3 seconds. It only does English for now.

You can press the hotkey once to start and again to send, or switch to hold-to-talk in Settings: hold while you speak, let go to send.

Orbit can talk back too. With [Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) installed (`uv tool install pocket-tts`, or just have `uvx` available), turn on Spoken replies in Settings and pick a voice. It runs on your CPU, starts speaking the first sentence while the rest of the answer is still being written, and by default only speaks when you asked by voice. Esc, closing the bar or asking something new stops it. Windows' built-in voice works as a fallback if you don't want to install anything.

If you'd rather use [Wispr Flow](https://wisprflow.ai), set `voice.engine` to `"wispr"` in settings and Orbit will trigger it with Wispr's own shortcut.

## Memory

Tell Orbit "remember that Sam is my cofounder, his email is sam@example.com" and it saves that on your PC. Later, when you ask something related ("email Sam the notes"), the matching memories go along with your question, so you don't have to repeat yourself. You can see, edit and delete everything it knows in the dashboard.

When you mention something worth keeping in passing ("my dentist is Dr. Mehta, 022 5555 0100"), Orbit shows a small "Remember this?" chip. It only saves if you click Save.

Mark a memory private and it's only ever sent to models running on your own machine, like Ollama. Orbit refuses to store anything that looks like a password, card number or API key, even if you ask.

## Background jobs

Say "research the best Postgres hosting for a startup in India, in the background" and Orbit hands it to a separate agent so you can keep going. When it's done you get a notification, and the result is saved as a markdown file (the dashboard has it too). For jobs that split up neatly, it can run up to four agents at the same time and put their answers together. If a job needs something from you halfway through, it asks in the bar and waits.

## Your files

Orbit can read files in the folders you allow (Downloads and Desktop to start; change them in Settings). It reads PDFs and plain text, so "summarise the PDFs in my Downloads" works, and so does a workflow that reads each new invoice that lands there. It can't read anything outside those folders, even through shortcuts.

It only changes files in a folder when you turn on "Orbit can change files here" for that folder in Settings. Then it can create, edit, rename, move, copy and delete files there, so "rename the scans in Downloads by invoice number" works. Before any change, the old file is backed up to `%APPDATA%\Orbit\snapshots` (kept 30 days, up to 2 GB), and deleting just moves the file there. A batch like 40 renames is one approval card that lists every change, and one Undo. If you edited a file after Orbit did, Undo tells you and asks before putting the old one back (your newer version gets backed up too). Orbit won't create or rename anything to a type that runs when you open it, like .exe, .bat or .ps1.

## Reminders and workflows

"Remind me in 30 minutes to stretch" or "remind me every weekday at 9 to check the deploy" sets a desktop notification. It works offline.

Workflows are jobs Orbit runs on a schedule or when you ask. Describe one in the bar ("every Friday at 5, summarise my week and save it as a note") and Orbit writes it, shows it to you, and saves it once you approve. A workflow can call tools, ask a model to write or decide something, and stop to let you review before anything gets sent. Each run and step is logged on the dashboard's Workflows page.

There's a ready-made one to start with: a daily tech digest that reads Hacker News, Google News, TechCrunch and Product Hunt every morning and writes you a short roundup of big tech, AI, startups and new products worth trying. Add it from the Workflows page.

Workflows don't have to wait for a clock. They can start when a feed has new posts, when a web page (or one part of it, like a price) changes, when a search in Gmail or another connected app returns something new, when a file lands in a folder, or when another app calls a local webhook.

Inside a workflow, steps can branch ("if the model thinks this email is about a payment, do this, otherwise that"), repeat for every item in a list, run side by side, or reshape data with a few lines of JavaScript. That code runs in a sandbox with no access to your files or the internet.

If you'd rather see it than read YAML, the Workflows page has a visual editor: the flow is drawn as boxes you click to edit, with a palette for adding steps.

Workflows only run while Orbit is running. If your PC was off at the scheduled time, Orbit asks, runs it, or skips it the next time it starts, depending on how the workflow is set up. They're plain YAML files in `%APPDATA%\Orbit\workflows` if you want to edit them by hand.

## Connecting your apps

Open the dashboard and go to Integrations.

Notion is one click: it opens Notion in your browser and you pick which pages Orbit can see.

Slack and Google take a few minutes of setup, because neither lets outside apps connect without you creating your own app or OAuth client first. The dashboard walks you through it step by step. Your tokens are encrypted on your PC and never shown to the model.

Anything that works over MCP can be added the same way by editing `integrations.json`. If a service isn't connected and you ask for something that needs it, Orbit tells you instead of pretending.

## Choosing a model

In `settings.json`, `models.chat` looks like `"claude:sonnet"` or `"ollama:qwen3:4b"`: the provider name, a colon, then the model.

To use your Claude subscription, click "Sign in to Claude" on the Setup page. A console window runs Claude Code's own sign-in, which opens your browser. Orbit talks to Claude through Anthropic's Agent SDK and never reads or stores your login. It also switches off all of Claude Code's own tools (shell, file editing and so on), so the model can only use what Orbit gives it.

Different jobs can use different models: `models.quick` for the quick actions (Haiku by default), `models.chat` for the bar, `models.research` for background jobs (Sonnet by default).

You can also use an Anthropic API key (`/key anthropic sk-...`) or anything with an OpenAI-compatible API: OpenAI, OpenRouter, Ollama, LM Studio.

Web search needs a free key from [Brave Search](https://brave.com/search/api/) or Tavily.

If you're offline, or your Claude plan hits its limit, Orbit can fall back to a model running in Ollama on your PC. Offline it switches by itself and tells you; at a limit it asks first.

## What it's allowed to do

Every tool has a risk class: it only reads, it changes Orbit's own stuff (memories, reminders, workflows, its files folder), it acts in another service (sends, posts, creates), or it deletes something outside Orbit. On the dashboard's Permissions page you pick how much Orbit can do without asking:

| Level | Reads | Orbit's own stuff | Other services | Deletes |
|---|---|---|---|---|
| Strict | asks | asks | asks | asks |
| Careful (default) | runs | runs | asks | asks |
| Trusted | runs | runs | runs | asks |
| Full | runs | runs | runs | runs |

Below the levels you can set any single tool to always ask, always run, or never run, and that wins over the level. When a card does pop up, "Allow for this chat" lets that tool run without asking again until you start a new chat or hit the stop hotkey. At Strict, even steps a workflow was told to pre-approve ask you.

Text you select and pages Orbit reads are treated as data, so a web page can't talk the model into doing something. Every tool call is logged, and the Logs page shows what was asked, whether you approved it, and what came back.

## Undoing things

Everything Orbit changes goes into a journal first: memories it saves, edits or deletes, reminders, workflows, files it writes to its files folder, and files it changes in folders you made writable. The Logs page lists recent changes with an Undo button, and you can also just say "undo that" in the bar.

Your folders are read-only unless you say otherwise, and workflow code runs in a sandbox with no file or network access. Things that leave your PC, like a sent email or a Slack post, can't be pulled back, which is why they ask first unless you've chosen Trusted or Full. Those are always in the log, so you can see exactly what went out and fix it by hand.

## How many tokens it uses

I built this to run on a Claude subscription, so it tries hard not to waste it. Claude Code's extras that cost tokens in the background (chat titles, prompt suggestions, auto memory and so on) are switched off. Tool descriptions are kept short, and the long workflow guide is only loaded when the model is actually writing a workflow. Quick actions go to Haiku.

In practice a follow-up message costs about 5k tokens, and nearly all of that comes from the prompt cache (which counts far less against your limits). Starting a new chat costs under 1k new tokens.

The Usage page shows tokens per day and which features used them. Background work (workflows, background jobs) has a daily budget, 300k tokens by default. Once it's used up, background runs are skipped until midnight and you get one notification. You can raise the budget (or set it to 0 for no limit) on the same page. Things you ask for in the bar are never blocked.

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
