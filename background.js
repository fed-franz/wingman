/**
 * Wingman — Background Service Worker
 * Orchestrates the agentic tool-use loop and executes messenger.* API calls.
 */

import * as AnthropicProvider from "./providers/anthropic.js";
import * as OpenAIProvider from "./providers/openai.js";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Wingman, an AI email assistant embedded in Thunderbird.
You have access to the user's mailbox via a set of tools. You can search for messages,
read their contents, move or copy them, tag them, mark them as read/unread, and open
compose windows to draft replies.

When the user asks you to do something involving emails, always use your tools to
actually do it — don't just describe what you would do.

When searching or listing messages, retrieve only what you need. Avoid fetching full
message bodies unless the user's request requires reading content (not just headers).

Always confirm what you did after completing an action. If you moved 12 messages, say
so. If you couldn't find what the user was looking for, say why.

Keep responses concise. You are embedded in a narrow sidebar.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_folders",
    description: "List all mail folders across all accounts.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_messages",
    description: "Search for messages matching criteria. Returns headers only (no body).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Subject/body search term" },
        folder_id: { type: "string", description: "Limit search to this folder" },
        from: { type: "string" },
        to: { type: "string" },
        unread: { type: "boolean" },
        flagged: { type: "boolean" },
        has_attachment: { type: "boolean" },
        date_after: { type: "string", description: "ISO date string" },
        date_before: { type: "string", description: "ISO date string" },
        max_results: { type: "integer", default: 20, maximum: 100 },
      },
      required: [],
    },
  },
  {
    name: "get_message",
    description: "Get the full body and details of a specific message.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "integer" } },
      required: ["message_id"],
    },
  },
  {
    name: "get_thread",
    description: "Get all messages in a thread, ordered by date.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "integer", description: "Any message in the thread" } },
      required: ["message_id"],
    },
  },
  {
    name: "move_messages",
    description: "Move one or more messages to a folder.",
    input_schema: {
      type: "object",
      properties: {
        message_ids: { type: "array", items: { type: "integer" } },
        destination_folder_id: { type: "string" },
      },
      required: ["message_ids", "destination_folder_id"],
    },
  },
  {
    name: "copy_messages",
    description: "Copy one or more messages to a folder.",
    input_schema: {
      type: "object",
      properties: {
        message_ids: { type: "array", items: { type: "integer" } },
        destination_folder_id: { type: "string" },
      },
      required: ["message_ids", "destination_folder_id"],
    },
  },
  {
    name: "delete_messages",
    description: "Move messages to trash, or permanently delete if requested.",
    input_schema: {
      type: "object",
      properties: {
        message_ids: { type: "array", items: { type: "integer" } },
        permanent: { type: "boolean", default: false },
      },
      required: ["message_ids"],
    },
  },
  {
    name: "mark_messages",
    description: "Mark messages as read/unread or flagged/unflagged.",
    input_schema: {
      type: "object",
      properties: {
        message_ids: { type: "array", items: { type: "integer" } },
        read: { type: "boolean" },
        flagged: { type: "boolean" },
      },
      required: ["message_ids"],
    },
  },
  {
    name: "tag_messages",
    description: "Add or remove tags on messages.",
    input_schema: {
      type: "object",
      properties: {
        message_ids: { type: "array", items: { type: "integer" } },
        add_tags: { type: "array", items: { type: "string" } },
        remove_tags: { type: "array", items: { type: "string" } },
      },
      required: ["message_ids"],
    },
  },
  {
    name: "create_folder",
    description: "Create a new mail folder.",
    input_schema: {
      type: "object",
      properties: {
        parent_folder_id: { type: "string" },
        name: { type: "string" },
      },
      required: ["parent_folder_id", "name"],
    },
  },
  {
    name: "open_compose",
    description: "Open a compose window pre-filled with content. The user reviews and sends — Wingman never sends automatically.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reply_to_message_id: { type: "integer" },
      },
      required: [],
    },
  },
  {
    name: "get_current_message",
    description: "Get the message the user currently has selected/open in Thunderbird.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(name, input, settings) {
  const truncateLimit = settings.truncateLimit ?? 2000;

  switch (name) {
    case "list_folders": {
      const accounts = await messenger.accounts.list();
      const folders = [];
      for (const account of accounts) {
        folders.push(...flattenFolders(account.folders, account.name));
      }
      return folders;
    }

    case "search_messages": {
      const maxResults = Math.min(input.max_results ?? 20, settings.maxResults ?? 20);
      const queryInfo = {};
      if (input.query) queryInfo.body = input.query;
      if (input.folder_id) queryInfo.folderId = input.folder_id;
      if (input.from) queryInfo.author = input.from;
      if (input.to) queryInfo.recipients = input.to;
      if (input.unread !== undefined) queryInfo.unread = input.unread;
      if (input.flagged !== undefined) queryInfo.flagged = input.flagged;
      if (input.has_attachment !== undefined) queryInfo.attachment = input.has_attachment;
      if (input.date_after) queryInfo.fromDate = new Date(input.date_after);
      if (input.date_before) queryInfo.toDate = new Date(input.date_before);

      const results = [];
      let remaining = maxResults;
      let page = await messenger.messages.query(queryInfo);

      while (page && remaining > 0) {
        for (const msg of page.messages) {
          if (remaining-- <= 0) break;
          results.push({
            id: msg.id,
            subject: msg.subject,
            from: msg.author,
            date: msg.date,
            folder: msg.folder?.name,
            folder_id: msg.folder?.id,
            read: msg.read,
            flagged: msg.flagged,
          });
        }
        page = (page.id && remaining > 0) ? await messenger.messages.continueList(page.id) : null;
      }
      return results;
    }

    case "get_message": {
      const [full, header] = await Promise.all([
        messenger.messages.getFull(input.message_id),
        messenger.messages.get(input.message_id),
      ]);
      const body = extractPlainText(full.parts);
      const truncated = body.length > truncateLimit;
      return {
        id: header.id,
        subject: header.subject,
        from: header.author,
        to: header.recipients?.join(", "),
        date: header.date,
        body: truncated ? body.slice(0, truncateLimit) + "\n[... message truncated]" : body,
        truncated,
      };
    }

    case "get_thread": {
      const header = await messenger.messages.get(input.message_id);
      const page = await messenger.messages.query({ subject: header.subject, folderId: header.folder?.id });
      const msgs = (page.messages ?? []).sort((a, b) => new Date(a.date) - new Date(b.date));

      const results = [];
      for (const msg of msgs) {
        const full = await messenger.messages.getFull(msg.id);
        const body = extractPlainText(full.parts);
        const truncated = body.length > truncateLimit;
        results.push({
          id: msg.id,
          subject: msg.subject,
          from: msg.author,
          date: msg.date,
          body: truncated ? body.slice(0, truncateLimit) + "\n[... truncated]" : body,
        });
      }
      return results;
    }

    case "move_messages": {
      const folder = await folderById(input.destination_folder_id);
      await messenger.messages.move(input.message_ids, folder);
      return { moved: input.message_ids.length };
    }

    case "copy_messages": {
      const folder = await folderById(input.destination_folder_id);
      await messenger.messages.copy(input.message_ids, folder);
      return { copied: input.message_ids.length };
    }

    case "delete_messages": {
      await messenger.messages.delete(input.message_ids, input.permanent ?? false);
      return { deleted: input.message_ids.length };
    }

    case "mark_messages": {
      const updates = {};
      if (input.read !== undefined) updates.read = input.read;
      if (input.flagged !== undefined) updates.flagged = input.flagged;
      for (const id of input.message_ids) {
        await messenger.messages.update(id, updates);
      }
      return { updated: input.message_ids.length };
    }

    case "tag_messages": {
      for (const id of input.message_ids) {
        const msg = await messenger.messages.get(id);
        let tags = msg.tags ?? [];
        if (input.add_tags) tags = [...new Set([...tags, ...input.add_tags])];
        if (input.remove_tags) tags = tags.filter((t) => !input.remove_tags.includes(t));
        await messenger.messages.update(id, { tags });
      }
      return { updated: input.message_ids.length };
    }

    case "create_folder": {
      const parent = await folderById(input.parent_folder_id);
      const newFolder = await messenger.folders.create(parent, input.name);
      return { id: newFolder.id, name: newFolder.name };
    }

    case "open_compose": {
      let tabId;
      if (input.reply_to_message_id) {
        const tab = await messenger.compose.beginReply(input.reply_to_message_id);
        tabId = tab.id;
      } else {
        const tab = await messenger.compose.beginNew();
        tabId = tab.id;
      }
      const details = {};
      if (input.to) details.to = [input.to];
      if (input.subject) details.subject = input.subject;
      if (input.body) details.body = input.body;
      if (Object.keys(details).length > 0) {
        await messenger.compose.setComposeDetails(tabId, details);
      }
      return { opened: true };
    }

    case "get_current_message": {
      const tabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
      if (!tabs.length) return { error: "No active mail tab" };
      const selected = await messenger.mailTabs.getSelectedMessages(tabs[0].id);
      if (!selected.messages.length) return { error: "No message selected" };
      const msg = selected.messages[0];
      const full = await messenger.messages.getFull(msg.id);
      const body = extractPlainText(full.parts);
      const truncated = body.length > truncateLimit;
      return {
        id: msg.id,
        subject: msg.subject,
        from: msg.author,
        to: msg.recipients?.join(", "),
        date: msg.date,
        body: truncated ? body.slice(0, truncateLimit) + "\n[... truncated]" : body,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenFolders(folders, accountName, pathPrefix = "") {
  const result = [];
  for (const folder of folders ?? []) {
    const path = pathPrefix ? `${pathPrefix}/${folder.name}` : folder.name;
    result.push({
      id: folder.id,
      name: folder.name,
      path,
      accountName,
      specialUse: folder.specialUse,
      unreadCount: folder.unreadMessageCount,
      totalCount: folder.totalMessageCount,
    });
    if (folder.subFolders?.length) {
      result.push(...flattenFolders(folder.subFolders, accountName, path));
    }
  }
  return result;
}

async function folderById(folderId) {
  const accounts = await messenger.accounts.list();
  for (const account of accounts) {
    const found = findFolderById(account.folders, folderId);
    if (found) return found;
  }
  throw new Error(`Folder not found: ${folderId}`);
}

function findFolderById(folders, id) {
  for (const folder of folders ?? []) {
    if (folder.id === id) return folder;
    const found = findFolderById(folder.subFolders, id);
    if (found) return found;
  }
  return null;
}

function extractPlainText(parts) {
  if (!parts) return "";
  for (const part of parts) {
    if (part.contentType === "text/plain" && part.body) return part.body;
  }
  for (const part of parts) {
    if (part.contentType === "text/html" && part.body) {
      return part.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (part.parts?.length) {
      const found = extractPlainText(part.parts);
      if (found) return found;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

async function runAgentLoop(history, settings, onEvent) {
  const provider = settings.provider === "anthropic" ? AnthropicProvider : OpenAIProvider;
  const params = {
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    maxTokens: settings.maxTokens ?? 2048,
    messages: history,
  };

  while (true) {
    let result;

    if (settings.streaming) {
      const gen = provider.stream(params);
      for await (const event of gen) {
        if (event.type === "delta") {
          onEvent({ type: "stream_delta", text: event.text });
        } else if (event.type === "done") {
          result = event.result;
        }
      }
    } else {
      onEvent({ type: "thinking" });
      result = await provider.chat(params);
    }

    if (result.type === "text") {
      onEvent({ type: "text", text: result.text });
      history.push({ role: "assistant", content: result.text });
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const call of result.calls) {
      onEvent({ type: "tool_start", name: call.name, input: call.input });
      let content;
      try {
        content = await executeTool(call.name, call.input, settings);
        onEvent({ type: "tool_done", name: call.name });
      } catch (err) {
        content = { error: err.message };
        onEvent({ type: "tool_error", name: call.name, error: err.message });
      }
      toolResults.push({ id: call.id, content });
    }

    const rawPayload = result.rawContent ?? result.rawAssistantMessage;
    provider.appendToolResults(history, rawPayload, toolResults);
    params.messages = history;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const stored = await messenger.storage.local.get([
    "provider", "apiKey", "baseURL", "model",
    "maxTokens", "truncateLimit", "maxResults", "streaming",
  ]);
  return {
    provider: stored.provider ?? "anthropic",
    apiKey: stored.apiKey ?? "",
    baseURL: stored.baseURL ?? "http://localhost:11434/v1",
    model: stored.model ?? "claude-sonnet-4-20250514",
    maxTokens: stored.maxTokens ?? 2048,
    truncateLimit: stored.truncateLimit ?? 2000,
    maxResults: stored.maxResults ?? 20,
    streaming: stored.streaming ?? true,
  };
}

// ---------------------------------------------------------------------------
// Message handling (sidebar <-> background)
// ---------------------------------------------------------------------------

// Per-session conversation histories keyed by tab ID
const conversations = {};

messenger.runtime.onMessage.addListener(async (message, sender) => {
  const tabId = sender.tab?.id ?? "sidebar";

  if (message.type === "chat") {
    const settings = await loadSettings();

    if (!settings.apiKey && settings.provider !== "ollama") {
      return { type: "error", error: "No API key set. Open settings (⚙️) to configure Wingman." };
    }

    if (!conversations[tabId]) conversations[tabId] = [];
    const history = conversations[tabId];
    history.push({ role: "user", content: message.text });

    try {
      await runAgentLoop(history, settings, (event) => {
        // Push real-time events to the sidebar
        messenger.runtime.sendMessage({ type: "agent_event", event }).catch(() => {});
      });
    } catch (err) {
      return { type: "error", error: err.message };
    }

    return { type: "ok" };
  }

  if (message.type === "clear_history") {
    conversations[tabId] = [];
    return { type: "ok" };
  }
});
