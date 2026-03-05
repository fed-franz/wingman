/**
 * Wingman Sidebar — UI logic
 */

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("btn-send");
const settingsBtn = document.getElementById("btn-settings");
const clearBtn = document.getElementById("btn-clear");

let isWaiting = false;
let streamingBubble = null;
let streamingContent = "";

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

sendBtn.addEventListener("click", sendMessage);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

settingsBtn.addEventListener("click", () => {
  messenger.runtime.openOptionsPage();
});

clearBtn.addEventListener("click", async () => {
  await messenger.runtime.sendMessage({ type: "clear_history" });
  messagesEl.innerHTML = "";
  streamingBubble = null;
  streamingContent = "";
});

// Real-time events pushed from the background script
messenger.runtime.onMessage.addListener((message) => {
  if (message.type !== "agent_event") return;
  handleAgentEvent(message.event);
});

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isWaiting) return;

  inputEl.value = "";
  setWaiting(true);
  appendBubble("user", text);
  showTypingIndicator();

  try {
    const response = await messenger.runtime.sendMessage({ type: "chat", text });
    if (response?.type === "error") {
      removeTypingIndicator();
      appendError(response.error);
    }
  } catch (err) {
    removeTypingIndicator();
    appendError(err.message);
  } finally {
    setWaiting(false);
  }
}

// ---------------------------------------------------------------------------
// Agent event handler
// ---------------------------------------------------------------------------

function handleAgentEvent(event) {
  switch (event.type) {
    case "thinking":
      // typing indicator already visible
      break;

    case "tool_start": {
      removeTypingIndicator();
      appendToolStatus(toolLabel(event.name, event.input), false);
      showTypingIndicator();
      break;
    }

    case "tool_done": {
      removeTypingIndicator();
      showTypingIndicator();
      break;
    }

    case "tool_error": {
      removeTypingIndicator();
      appendToolStatus(`✗ ${event.name}: ${event.error}`, true);
      showTypingIndicator();
      break;
    }

    case "stream_delta": {
      removeTypingIndicator();
      if (!streamingBubble) {
        streamingBubble = createBubble("assistant");
        streamingContent = "";
      }
      streamingContent += event.text;
      renderMarkdown(streamingBubble, streamingContent);
      scrollToBottom();
      break;
    }

    case "text": {
      removeTypingIndicator();
      if (streamingBubble) {
        // Already rendered via stream_delta — just reset state
        streamingBubble = null;
        streamingContent = "";
      } else {
        appendBubble("assistant", event.text);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function appendBubble(role, text) {
  const el = createBubble(role);
  if (role === "assistant") {
    renderMarkdown(el, text);
  } else {
    el.textContent = text;
  }
  scrollToBottom();
  return el;
}

function createBubble(role) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  messagesEl.appendChild(el);
  return el;
}

function appendError(text) {
  const el = document.createElement("div");
  el.className = "bubble error";
  el.textContent = `⚠ ${text}`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendToolStatus(text, isError = false) {
  const el = document.createElement("div");
  el.className = `tool-status${isError ? " error" : ""}`;
  el.textContent = `› ${text}`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

let typingEl = null;

function showTypingIndicator() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "typing-indicator";
  typingEl.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setWaiting(val) {
  isWaiting = val;
  sendBtn.disabled = val;
  inputEl.disabled = val;
}

function renderMarkdown(el, text) {
  if (typeof marked !== "undefined") {
    el.innerHTML = marked.parse(text, { breaks: true });
  } else {
    el.textContent = text;
  }
}

// ---------------------------------------------------------------------------
// Tool label helpers — human-readable status lines
// ---------------------------------------------------------------------------

function toolLabel(name, input) {
  switch (name) {
    case "list_folders": return "Listing folders…";
    case "search_messages": {
      const parts = [];
      if (input.query) parts.push(`"${input.query}"`);
      if (input.from) parts.push(`from ${input.from}`);
      if (input.unread) parts.push("unread");
      if (input.has_attachment) parts.push("with attachments");
      return `Searching messages${parts.length ? " — " + parts.join(", ") : "…"}`;
    }
    case "get_message": return `Reading message #${input.message_id}…`;
    case "get_thread": return "Fetching thread…";
    case "move_messages": return `Moving ${input.message_ids?.length ?? ""} message(s)…`;
    case "copy_messages": return `Copying ${input.message_ids?.length ?? ""} message(s)…`;
    case "delete_messages": return `Deleting ${input.message_ids?.length ?? ""} message(s)…`;
    case "mark_messages": return `Marking ${input.message_ids?.length ?? ""} message(s)…`;
    case "tag_messages": return `Tagging ${input.message_ids?.length ?? ""} message(s)…`;
    case "create_folder": return `Creating folder "${input.name}"…`;
    case "open_compose": return "Opening compose window…";
    case "get_current_message": return "Reading selected message…";
    default: return `${name}…`;
  }
}
