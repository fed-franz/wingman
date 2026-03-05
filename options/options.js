/**
 * Wingman Options Page
 */

const PROVIDER_DEFAULTS = {
  anthropic: {
    baseURL: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    needsKey: true,
    isLocal: false,
    baseURLHint: "Anthropic API endpoint",
    modelHint: "e.g. claude-sonnet-4-20250514, claude-haiku-4-5-20251001, claude-opus-4",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o",
    needsKey: true,
    isLocal: false,
    baseURLHint: "OpenAI API endpoint",
    modelHint: "e.g. gpt-4o, gpt-4o-mini, gpt-4-turbo",
  },
  ollama: {
    baseURL: "http://localhost:11434/v1",
    model: "llama3.1",
    needsKey: false,
    isLocal: true,
    baseURLHint: "Local Ollama endpoint — no data leaves your machine",
    modelHint: "e.g. llama3.1, qwen2.5:72b, mistral, phi4",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4",
    needsKey: true,
    isLocal: false,
    baseURLHint: "OpenRouter API endpoint",
    modelHint: "e.g. anthropic/claude-sonnet-4, openai/gpt-4o, meta-llama/llama-3.1-70b",
  },
  custom: {
    baseURL: "",
    model: "",
    needsKey: false,
    isLocal: false,
    baseURLHint: "Any OpenAI-compatible endpoint",
    modelHint: "Enter the model name used by your endpoint",
  },
};

const providerEl = document.getElementById("provider");
const baseURLEl = document.getElementById("baseURL");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const maxTokensEl = document.getElementById("maxTokens");
const maxResultsEl = document.getElementById("maxResults");
const truncateLimitEl = document.getElementById("truncateLimit");
const streamingEl = document.getElementById("streaming");
const autoClearEl = document.getElementById("autoClear");
const saveBtn = document.getElementById("btn-save");
const statusEl = document.getElementById("status");
const privacyWarningEl = document.getElementById("privacy-warning");
const privacyOkEl = document.getElementById("privacy-ok");
const fieldApiKey = document.getElementById("field-api-key");
const baseURLHintEl = document.getElementById("base-url-hint");
const modelHintEl = document.getElementById("model-hint");

// ---------------------------------------------------------------------------
// Load saved settings
// ---------------------------------------------------------------------------

async function load() {
  const s = await messenger.storage.local.get([
    "provider", "apiKey", "baseURL", "model",
    "maxTokens", "maxResults", "truncateLimit", "streaming", "autoClear",
  ]);

  providerEl.value = s.provider ?? "anthropic";
  apiKeyEl.value = s.apiKey ?? "";
  maxTokensEl.value = s.maxTokens ?? 2048;
  maxResultsEl.value = s.maxResults ?? 20;
  truncateLimitEl.value = s.truncateLimit ?? 2000;
  streamingEl.checked = s.streaming ?? true;
  autoClearEl.checked = s.autoClear ?? false;

  applyProviderUI(s.provider ?? "anthropic", {
    baseURL: s.baseURL,
    model: s.model,
  });
}

function applyProviderUI(provider, overrides = {}) {
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.custom;

  if (overrides.baseURL) {
    baseURLEl.value = overrides.baseURL;
  } else {
    baseURLEl.value = defaults.baseURL;
  }
  if (overrides.model) {
    modelEl.value = overrides.model;
  } else {
    modelEl.value = defaults.model;
  }

  baseURLHintEl.textContent = defaults.baseURLHint;
  modelHintEl.textContent = defaults.modelHint;
  fieldApiKey.style.display = defaults.needsKey ? "block" : "none";
  privacyWarningEl.classList.toggle("visible", !defaults.isLocal);
  privacyOkEl.classList.toggle("visible", defaults.isLocal);
}

providerEl.addEventListener("change", () => {
  applyProviderUI(providerEl.value);
});

// ---------------------------------------------------------------------------
// Save settings
// ---------------------------------------------------------------------------

saveBtn.addEventListener("click", async () => {
  await messenger.storage.local.set({
    provider: providerEl.value,
    apiKey: apiKeyEl.value.trim(),
    baseURL: baseURLEl.value.trim(),
    model: modelEl.value.trim(),
    maxTokens: parseInt(maxTokensEl.value, 10),
    maxResults: parseInt(maxResultsEl.value, 10),
    truncateLimit: parseInt(truncateLimitEl.value, 10),
    streaming: streamingEl.checked,
    autoClear: autoClearEl.checked,
  });

  statusEl.textContent = "Settings saved.";
  statusEl.className = "";
  setTimeout(() => { statusEl.textContent = ""; }, 2500);
});

load();
