# Wingman ✈

**AI chat sidebar for Thunderbird.** Talk to an AI in natural language and have it act on your mailbox — searching, reading, moving, tagging, and drafting emails across all your folders and accounts.

## Features

- **Natural language email management** — "Move all newsletter emails to a Newsletters folder", "Find unread emails from Alice this week", "Draft a reply saying I'll be 10 minutes late"
- **Full mailbox access** — search, read, move, copy, delete, tag, flag, compose
- **Multiple AI providers** — Claude (Anthropic), ChatGPT (OpenAI), Ollama (local), OpenRouter, or any OpenAI-compatible endpoint
- **Privacy-first option** — point it at a local Ollama instance and your email never leaves your machine
- **Streaming responses** — text appears word by word, not all at once
- **Inline tool status** — see exactly what the AI is doing ("Searching inbox…", "Moving 3 messages…")
- **Markdown rendering** — responses render with bold, lists, and code blocks
- **Dark + light theme** — follows your system preference

## Installation

### From source (development)

1. Clone this repo
2. Download `marked.min.js` into `vendor/` (see Dependencies below)
3. Open Thunderbird → **Tools → Developer Tools → Debug Add-ons**
4. Click **Load Temporary Add-on…**
5. Select `manifest.json` from this folder

### Dependencies

Wingman uses [marked.js](https://marked.js.org/) for markdown rendering. Download it manually:

```bash
mkdir vendor
curl -o vendor/marked.min.js https://cdn.jsdelivr.net/npm/marked/marked.min.js
```

## Configuration

Open Wingman's settings via the ⚙️ icon in the sidebar header, or via **Add-on Manager → Wingman → Preferences**.

| Setting | Default | Notes |
|---|---|---|
| Provider | Anthropic | Anthropic, OpenAI, Ollama, OpenRouter, Custom |
| API Key | — | Stored locally only, never synced |
| Base URL | Provider default | Override for custom/local endpoints |
| Model | claude-sonnet-4-20250514 | Any model supported by your provider |
| Max tokens | 2048 | Max tokens per AI response |
| Max search results | 20 | Cap on `search_messages` results |
| Body truncation | 2000 chars | Long email bodies are truncated before sending to AI |
| Streaming | On | Stream text as it arrives |
| Auto-clear history | Off | Clear conversation when sidebar closes |

## Privacy

> ⚠ **Cloud providers** (Anthropic, OpenAI, OpenRouter, Groq, etc.) will receive your email content — subjects, sender addresses, and message bodies — as part of AI requests. The settings page shows a warning when a cloud provider is selected.
>
> ✓ **Local providers** (Ollama, LM Studio, or any `localhost` endpoint) process everything on your machine. No email data is transmitted externally. The settings page shows a confirmation banner when a local endpoint is configured.

## Supported tools

Wingman gives the AI access to these mailbox operations:

| Tool | What it does |
|---|---|
| `list_folders` | List all folders across all accounts |
| `search_messages` | Search by sender, subject, date, read status, attachments, flags |
| `get_message` | Read a message's full body (plain text, HTML stripped) |
| `get_thread` | Fetch an entire email thread |
| `move_messages` | Move messages to a folder |
| `copy_messages` | Copy messages to a folder |
| `delete_messages` | Trash or permanently delete messages |
| `mark_messages` | Mark read/unread, flagged/unflagged |
| `tag_messages` | Add or remove tags |
| `create_folder` | Create a new folder |
| `open_compose` | Open a pre-filled compose window (user sends — Wingman never sends automatically) |
| `get_current_message` | Get the message currently selected in Thunderbird |

## Example conversations

> "Find all unread emails from my manager this week"

> "Move all newsletter emails in my inbox to a Newsletters folder, create it if it doesn't exist"

> "Summarise the email thread about the Q4 budget"

> "Draft a reply to Alice's last email saying I'll be 10 minutes late"

> "Find all emails with attachments from the last month that I haven't replied to, and flag them"

## Project structure

```
wingman/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Background service worker: tool execution + API calls
├── providers/
│   ├── anthropic.js        # Anthropic API adapter
│   └── openai.js           # OpenAI-compatible adapter (Ollama, OpenAI, OpenRouter…)
├── sidebar/
│   ├── sidebar.html        # Chat UI
│   ├── sidebar.js          # UI logic
│   └── sidebar.css         # Styling
├── options/
│   ├── options.html        # Settings page
│   └── options.js
├── vendor/
│   └── marked.min.js       # Markdown renderer (add manually, see Installation)
└── icons/
    └── icon.png
```

## Development notes

- Message IDs from `messenger.messages` are session-only — they reset on Thunderbird restart. Don't persist them to storage.
- Background script is an MV3 service worker — conversation history lives in memory and is cleared when Thunderbird restarts (or when you click 🗑).
- Internal conversation history is stored in Anthropic format throughout. The OpenAI adapter translates to/from OpenAI wire format on each request, keeping `background.js` provider-agnostic.

## License

MIT
