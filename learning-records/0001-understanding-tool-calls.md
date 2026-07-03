# 0001: Understanding Tool Calls in the OpenAI API

## Context

While analyzing how `opencode` communicates with its providers, I discovered that Tool Calling is the central mechanism that enables agentic behavior. The current server implementation completely ignores the `tools` parameter in requests and does not generate `tool_calls` in responses, making it unusable for `opencode`.

## Key Insight

Tool Calling is not an optional feature — it is the defining distinction between a "chat API" and an "agent API". opencode relies on the LLM having agency to call functions (read files, execute bash, edit code).

## New Wire Format Elements

The following fields must be supported at a minimum for opencode integration:

- **Request**: `tools` (array of function definitions), `tool_choice` (how the tool is selected)
- **Response (non-streaming)**: `choices[0].message.tool_calls` (array), `choices[0].finish_reason: "tool_calls"`
- **Response (streaming)**: `choices[0].delta.tool_calls[]` with streaming delta structure
- **Conversation**: `role: "tool"` messages matching `tool_call_id` to previous tool_calls
- **Stream termination**: Correct `finish_reason` values and optional `usage` metadata

## Implications

1. The `AbstractProvider` interface must change to pass `messages` and `tools` through
2. The provider implementations must be updated to handle tool call generation
3. The streaming code must reconstruct delta chunks for tool_calls
4. Tool call IDs must be unique strings (typically `call_` + random hex)

## Open Questions

- How do providers like "Copilot" (which don't natively support tool calling) handle this?
- Should the server implement a "passthrough" for providers that already support tools (OpenAI, Google)?
- For providers that don't support tools, should the server simulate tool calling?

## Related Resources

- OpenAI Tool Calling Guide: https://platform.openai.com/docs/guides/function-calling
- Reference Doc: `reference/openai-tool-calls.html`
