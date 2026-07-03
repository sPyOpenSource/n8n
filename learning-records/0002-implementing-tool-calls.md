# 0002: Implementing Tool Calling in the API

## Context

After understanding the wire format of tool calling (learning record 0001), I implemented it across the entire server codebase. This was a foundational change affecting the schema, provider interface, router, and API layer.

## Changes Made

### 1. `server/schemas.py` — New Request Models
- Added `FunctionDefinition`, `ToolDefinition`, `ToolCallFunction`, `ToolCall` Pydantic models
- Updated `ChatMessage` with optional `tool_calls`, `tool_call_id`, `name` fields
- Added `tools` (list of tool definitions) and `tool_choice` to `ChatCompletionRequest`

### 2. `server/openai_format.py` — Response Builders
- `completion_response()` now accepts optional `tool_calls` and `finish_reason` parameters
- `stream_chunk()` now supports `usage` metadata and handles empty choices for intermediate chunks

### 3. `copilot/providers/base.py` — Provider Interface
- Changed from `chat(prompt: str, ...)` to `chat(messages: list[dict], model, tools=None, tool_choice=None, ...)`
- Same change for `stream()`
- This is the single most impactful change — it enables the entire tool calling pipeline

### 4. Pass-Through Providers (OpenAI, OpenRouter, Google, NVIDIA)
- Each now builds the request body with `messages`, `tools`, and `tool_choice` directly
- The upstream API handles tool calling natively — we just forward the response

### 5. Legacy Providers (Copilot, Ollama)
- These providers convert the `messages` array back to a `prompt` string internally
- They ignore `tools` since their native protocols don't support tool calling
- Preserves backward compatibility

### 6. `server/router.py` — Router Interface
- Both `Router` and `FailsafeRouter` updated to pass `messages`, `tools`, `tool_choice` through

### 7. `server/api.py` — HTTP Endpoint
- `ChatCompletionRequest` is now parsed with full OpenAI schema support
- Messages are converted to dicts via `model_dump(exclude_none=True)` before routing
- Tools and tool_choice are passed through to the router

## Key Insight

The upstream providers (OpenAI, OpenRouter, etc.) already support tool calling at their API level. The bottleneck was our server collapsing messages to a single prompt and ignoring the tools field. By stopping that collapse, tool calling "just works" for the pass-through providers.

## Remaining Work
- Copilot and Ollama providers need native tool calling support
- Model discovery (`/v1/models`) should report `supports_tools: true/false`
- Testing against actual opencode is the next step

## Related Resources
- OpenAI Tool Calling: https://platform.openai.com/docs/guides/function-calling
- Vercel AI SDK: https://ai-sdk.dev/docs/reference/ai-sdk-core/openai-compatible
