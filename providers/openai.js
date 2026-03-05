/**
 * OpenAI-compatible provider adapter.
 * Works with: OpenAI, Ollama, LM Studio, Groq, OpenRouter, vLLM, llama.cpp, and any
 * other server that implements the OpenAI /v1/chat/completions API.
 *
 * PRIVACY NOTE: If the base URL points to a remote service (OpenAI, Groq, OpenRouter, etc.),
 * your email content will be transmitted to that service's servers.
 * Use a local endpoint (e.g. http://localhost:11434/v1 for Ollama) to keep data on-device.
 */

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Convert internal Anthropic-style history to OpenAI messages format.
 * Internal history is stored in Anthropic format; this translates on the fly.
 */
function toOpenAIMessages(system, history) {
  const messages = [{ role: "system", content: system }];

  for (const msg of history) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        // tool_result blocks → OpenAI tool messages
        for (const block of msg.content) {
          if (block.type === "tool_result") {
            messages.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }
      } else {
        messages.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        // Anthropic assistant turn with tool_use blocks → OpenAI tool_calls
        const textBlock = msg.content.find((b) => b.type === "text");
        const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
        const assistantMsg = {
          role: "assistant",
          content: textBlock?.text ?? null,
        };
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks.map((b) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }));
        }
        messages.push(assistantMsg);
      } else {
        messages.push({ role: "assistant", content: msg.content });
      }
    }
  }

  return messages;
}

async function chat({ apiKey, baseURL, model, system, messages, tools, maxTokens }) {
  const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model,
    max_tokens: maxTokens ?? 2048,
    tools: toOpenAITools(tools),
    tool_choice: "auto",
    messages: toOpenAIMessages(system, messages),
  };

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API error ${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;

  if (finishReason === "tool_calls") {
    const calls = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }));
    return { type: "tool_calls", calls, rawAssistantMessage: choice.message };
  }

  return { type: "text", text: choice?.message?.content ?? "" };
}

async function* stream({ apiKey, baseURL, model, system, messages, tools, maxTokens }) {
  const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model,
    max_tokens: maxTokens ?? 2048,
    tools: toOpenAITools(tools),
    tool_choice: "auto",
    messages: toOpenAIMessages(system, messages),
    stream: true,
  };

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let textAccum = "";
  const toolCallsMap = {};
  let finishReason = null;

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

      const delta = event.choices?.[0]?.delta;
      finishReason = event.choices?.[0]?.finish_reason ?? finishReason;

      if (delta?.content) {
        textAccum += delta.content;
        yield { type: "delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsMap[tc.index]) {
            toolCallsMap[tc.index] = { id: tc.id ?? "", name: tc.function?.name ?? "", argumentsRaw: "" };
          }
          if (tc.id) toolCallsMap[tc.index].id = tc.id;
          if (tc.function?.name) toolCallsMap[tc.index].name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[tc.index].argumentsRaw += tc.function.arguments;
        }
      }
    }
  }

  if (finishReason === "tool_calls") {
    const calls = Object.values(toolCallsMap).map((tc) => ({
      id: tc.id,
      name: tc.name,
      input: JSON.parse(tc.argumentsRaw),
    }));
    const rawAssistantMessage = {
      role: "assistant",
      content: textAccum || null,
      tool_calls: Object.values(toolCallsMap).map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argumentsRaw },
      })),
    };
    yield { type: "done", result: { type: "tool_calls", calls, rawAssistantMessage } };
  } else {
    yield { type: "done", result: { type: "text", text: textAccum } };
  }
}

/**
 * Append tool results to the conversation history.
 * Converts OpenAI rawAssistantMessage back into Anthropic-style blocks so history stays uniform.
 */
function appendToolResults(history, rawAssistantMessage, toolResults) {
  const content = [];
  if (rawAssistantMessage.content) {
    content.push({ type: "text", text: rawAssistantMessage.content });
  }
  for (const tc of rawAssistantMessage.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    });
  }
  history.push({ role: "assistant", content });

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
