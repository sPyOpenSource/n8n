# Windows Copilot API - OpenAI-Compatible Server for opencode Integration

## Why Learn This?

This repository is an OpenAI-compatible API gateway (bridging Microsoft Copilot, Ollama, OpenAI, OpenRouter, Google, NVIDIA). 

**The Goal:** Adapt this server to be a first-class backend for **opencode** (the AI coding agent).

opencode uses the Vercel AI SDK and expects a strict OpenAI-compatible contract. "Better integration" means:
1. **Tool Calling**: Full support for `tools`/`function_calling` in requests and `tool_calls` in responses.
2. **Streaming Reliability**: SSE streams that handle opencode's agentic loops (multi-turn tool use) without breaking.
3. **Model Discovery**: `/v1/models` returning rich metadata (context windows, capabilities) so opencode's `/models` picker works optimally.
4. **Agentic System Prompts**: Handling opencode's long, structured system prompts (AGENTS.md context, LSP data) without truncation.
5. **Performance**: Low latency for the rapid request/response cycles of an autonomous agent.

This is a valuable skill for:
1. **AI Infrastructure**: Building gateways that serve autonomous agents, not just chat UIs.
2. **Protocol Engineering**: Debugging subtle incompatibilities between "OpenAI-compatible" implementations.
3. **Developer Experience**: Making local/private models feel as capable as frontier APIs.

## What You'll Learn

- The exact OpenAI API surface opencode exercises (chat/completions, models, embeddings?)
- How the Vercel AI SDK (`ai` package) constructs requests and parses responses.
- Tool-calling schemas: `tools` definition format, `tool_choice` handling, parallel tool calls.
- Streaming edge cases: chunk buffering, finish reasons, usage metadata in final chunks.
- Model capability advertising via `/v1/models` (context length, supports_tools, supports_vision).
- Authentication patterns opencode expects (Bearer token, custom headers).

## Primary Resources

1. **This Repo**: `server/api.py`, `server/router.py`, `server/schemas.py`, `copilot/providers/`
2. **opencode Docs**: https://opencode.ai/docs/providers/ (Custom provider config using `@ai-sdk/openai-compatible`)
3. **Vercel AI SDK**: https://ai-sdk.dev/docs/reference/ai-sdk-core/openai-compatible
4. **OpenAI API Spec**: https://platform.openai.com/docs/api-reference/chat
5. **Models.dev**: https://models.dev/ (Schema opencode uses for provider capabilities)

## Learning Path

1. **Audit**: Compare current `server/api.py` implementation against opencode's requirements (Tool calling, Streaming, Model metadata).
2. **Reference**: Build a "OpenAI Contract for Agents" reference doc (`reference/openai-agent-contract.html`).
3. **Lesson 1**: Implement/verify `tool_calls` support in the request/response cycle.
4. **Lesson 2**: Harden SSE streaming for agentic loops (usage chunks, error recovery).
5. **Lesson 3**: Enrich `/v1/models` with capability metadata opencode consumes.
6. **Lesson 4**: Add opencode-specific config presets (baseURL, headers, model mapping).
7. **Validate**: Run opencode against the local server (`opencode --provider openai-compatible --base-url http://localhost:8080/v1`).