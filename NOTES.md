# Teaching Notes

## User Preferences
- Prefers concise, direct communication
- Wants practical, hands-on lessons tied to the codebase
- Values "storage strength" over fluency - wants to actually learn, not just get answers

## Current State
- Mission defined: Integrate Windows-Copilot-API with opencode
- Resources cataloged
- Need to start Lesson 1: Audit current implementation vs opencode requirements

## Key Technical Gaps to Investigate
1. Tool calling support in `server/schemas.py` and provider implementations
2. SSE streaming format compliance (usage chunks, finish_reason)
3. `/v1/models` response richness (capabilities, context windows)
4. Provider-specific tool calling quirks (Copilot vs OpenAI vs Ollama)