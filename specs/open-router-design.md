# Open Router Functionality — Multi-Provider Routing

## Problem

The server bridges a single Copilot account into an OpenAI-compatible API. If Copilot is down, rate-limited, or Cloudflare-blocked, every request fails. There is no fallback and no way to leverage other available LLM backends.

## Solution

Add a `Router` layer between the FastAPI endpoints and a pool of providers (Copilot, Ollama, OpenAI). Incoming requests are routed to the highest-priority available provider, with automatic failover on transient errors. Users configure provider priority and credentials via environment variables.

## Architecture

```
Client request → api.py → Router.chat() → [Copilot, Ollama, OpenAI] (priority order)
                                              ↓ first success
                                           OpenAI-format response
```

The router holds an ordered list of provider instances sorted by configured priority. It iterates the list until a provider succeeds, or all have been tried.

## Providers

### CopilotProvider (existing, adapted)

Wraps the existing `CopilotClient`. No new driver code.

- `is_available()`: always `True` (session persists on disk, auto-refreshes)
- `list_models()`: returns `[{"id": "copilot", "object": "model", "owned_by": "microsoft"}]`
- `chat()` / `stream()`: delegates to `client.chat()` / `client.stream()`
- Serialization lock moves from `_upstream_lock` in `api.py` into this provider

### OllamaProvider (new)

Uses Ollama's local REST API at `OLLAMA_BASE_URL`.

- `is_available()`: probes `GET /api/tags` at startup; per-request, returns the cached result (refreshed on a 30-second TTL so a newly-started Ollama is detected without restart)
- `list_models()`: calls `GET /api/tags`, maps each model to `{"id": "<name>", "owned_by": "ollama"}`
- `chat()`: calls `POST /api/chat` with `{model, messages, stream: false}`, normalizes the response into the project's `completion_response()` format
- `stream()`: calls `POST /api/chat` with `{model, messages, stream: true}`, converts the newline-delimited JSON stream into SSE `chat.completion.chunk` events

### OpenAIProvider (new)

Proxies requests to the official OpenAI API.

- `is_available()`: returns `True` if `OPENAI_API_KEY` is set
- `list_models()`: returns a static curated list from `OPENAI_MODELS` env var (default: `gpt-4o, gpt-4o-mini, o3-mini`) to avoid exposing key-controlled model access
- `chat()` / `stream()`: forwards the request verbatim to `POST /v1/chat/completions` on `OPENAI_BASE_URL` and relays the response. Streaming responses are relayed byte-for-byte as SSE without re-encoding
- Passes `Authorization: Bearer <key>` and optional `OpenAI-Organization: <org>` headers

## Provider Contract

Extend `AbstractProvider` with:

```python
class AbstractProvider(ABC):
    label: str
    url: str
    working: bool
    supports_stream: bool
    default_model: str
    needs_auth: bool = True

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def list_models(self) -> list[dict]: ...

    @abstractmethod
    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> ChatReply: ...

    @abstractmethod
    def stream(self, prompt: str, model: str, conversation_id: str | None = None) -> Generator: ...
```

## Configuration

All configuration is via environment variables, consistent with the existing `RATE_LIMIT_RPM` pattern.

| Variable | Default | Purpose |
|---|---|---|
| `PROVIDER_PRIORITY` | `copilot,ollama,openai` | Comma-separated provider order; first = highest priority |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server address |
| `OPENAI_API_KEY` | unset | OpenAI API key; provider disabled if absent |
| `OPENAI_BASE_URL` | `https://api.openai.com` | OpenAI API base (supports Azure/proxy overrides) |
| `OPENAI_ORG_ID` | unset | Optional OpenAI organization header |
| `OPENAI_MODELS` | `gpt-4o,gpt-4o-mini,o3-mini` | Comma-separated models to advertise |

Existing `RATE_LIMIT_RPM` and `RATE_LIMIT_BURST` are unchanged; they apply at the server level before the router is reached.

## Routing Logic

1. If the request's `model` field matches a provider's model list (e.g., `model="llama3"` → Ollama, `model="gpt-4o"` → OpenAI), route directly to that provider. No failover for explicit model picks.
2. If `model` is empty or unrecognized, iterate providers in `PROVIDER_PRIORITY` order. First success returns immediately.
3. Providers with `is_available() == False` are skipped entirely (no network call).

### Error Handling

| Error | Behavior |
|---|---|
| `ConnectionError` | Try next provider |
| `ClearanceRequired` | Try next provider |
| `RateLimitError` (429) | Try next provider |
| `AuthenticationError` (401/403) | Skip this provider for this request |
| `InvalidRequestError` (400) | Return immediately — bad input is bad for any provider |
| All providers exhausted | Return last error as OpenAI-shaped error response |

### Streaming Failover

Streaming cannot be retried once bytes have been sent to the client.

- Call `is_available()` before starting the stream
- If the provider fails **before** emitting any content, try the next provider
- If it fails **after** content has started streaming, propagate the error as an SSE error event (same pattern as existing `ClearanceRequired` handling)
- No mid-stream failover — it would produce garbled output

## Model Listing

`GET /v1/models` returns the union of all available providers' model lists:

```json
{
  "object": "list",
  "data": [
    {"id": "copilot", "object": "model", "owned_by": "microsoft"},
    {"id": "llama3", "object": "model", "owned_by": "ollama"},
    {"id": "gpt-4o", "object": "model", "owned_by": "openai"}
  ]
}
```

Duplicate model IDs across providers are resolved by priority — the higher-priority provider wins.

## Concurrency

- Copilot-specific `_upstream_lock` moves into `CopilotProvider` — only Copilot requests are serialized
- Ollama and OpenAI manage their own concurrency — no global lock
- The router does not serialize; it dispatches to the selected provider

## File Layout

```
copilot/providers/
    __init__.py             # exports provider registry
    base.py                 # AbstractProvider (extended from models.py with routing methods)
    copilot_provider.py     # adapter around existing CopilotClient
    ollama_provider.py      # new
    openai_provider.py      # new
server/
    router.py               # new — Router class with failover logic
```

## Backward Compatibility

- When no additional providers are configured (no `OLLAMA_BASE_URL`, no `OPENAI_API_KEY`), behavior is identical to today
- `/v1/models` returns just `[copilot]` if that's the only available provider
- The `/v1/chat/completions` request/response shape is unchanged from the client's perspective
- The existing `server/config.py` constants (`MODEL_NAME`, `RATE_LIMIT_RPM`, `RATE_LIMIT_BURST`) remain

## Testing

### Unit tests — `tests/test_router.py`

- Router iterates providers in priority order
- Router skips unavailable providers
- Router fails over on transient errors
- Router returns immediately on fatal (400) errors
- Router aggregates models from all providers
- Model-specific routing sends request to the correct provider

### Unit tests — `tests/test_ollama_provider.py`, `tests/test_openai_provider.py`

- `is_available()` returns correct bool based on config
- `list_models()` returns proper format
- `chat()` / `stream()` format conversion (mocked HTTP responses)

### Integration tests — extending `tests/test_server.py`

- Server starts with only Copilot — same behavior as today
- Server starts with Ollama available — `/v1/models` includes Ollama models
- Request with `model="llama3"` routes to Ollama
- Request with no model goes to highest-priority available provider

### Existing tests untouched

`tests/stress.py`, `tests/ratelimit.py`, `tests/gpqa_bench.py`, and `tests/diagnostic.py` operate against the running server and require no changes.
