/**
 * Anthropic (Claude) provider adapter.
 * Translates the internal message/tool format to the Anthropic API format and back.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function toAnthropicTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Send a request to the Anthropic API and return the parsed response.
 * @returns {{ type: 'text', text: string } | { type: 'tool_calls', calls: Array<{id, name, input}>, rawContent }}
 */
async function chat({ apiKey, model, system, messages, tools, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens ?? 2048,
    system,
    tools: toAnthropicTools(tools),
    messages,
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Anthropic API error ${response.status}`);
  }

  const data = await response.json();

  if (data.stop_reason === "tool_use") {
    const calls = data.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    return { type: "tool_calls", calls, rawContent: data.content };
  }

  const textBlock = data.content.find((b) => b.type === "text");
  return { type: "text", text: textBlock?.text ?? "" };
}

/**
 * Stream a request to the Anthropic API.
 * Yields { type: 'delta', text } chunks, then { type: 'done', result }.
 */
async function* stream({ apiKey, model, system, messages, tools, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens ?? 2048,
    system,
    tools: toAnthropicTools(tools),
    messages,
    stream: true,
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Anthropic API error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let stopReason = null;
  let toolBlocks = [];
  let currentToolBlock = null;
  let textAccum = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;

      let event;
      try { event = JSON.parse(raw); } catch { continue; }

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        currentToolBlock = { id: event.content_block.id, name: event.content_block.name, inputRaw: "" };
      } else if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta") {
          textAccum += event.delta.text;
          yield { type: "delta", text: event.delta.text };
        } else if (event.delta?.type === "input_json_delta" && currentToolBlock) {
          currentToolBlock.inputRaw += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop" && currentToolBlock) {
        let input = {};
        try { input = JSON.parse(currentToolBlock.inputRaw); } catch { /* ignore */ }
        toolBlocks.push({ id: currentToolBlock.id, name: currentToolBlock.name, input });
        currentToolBlock = null;
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason ?? stopReason;
      }
    }
  }

  if (stopReason === "tool_use") {
    yield { type: "done", result: { type: "tool_calls", calls: toolBlocks, rawContent: toolBlocks } };
  } else {
    yield { type: "done", result: { type: "text", text: textAccum } };
  }
}

/**
 * Append tool results to the conversation history in Anthropic format.
 */
function appendToolResults(history, rawContent, toolResults) {
  history.push({ role: "assistant", content: rawContent });
  history.push({
    role: "user",
    content: toolResults.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
    })),
  });
  return history;
}

export { chat, stream, appendToolResults };
