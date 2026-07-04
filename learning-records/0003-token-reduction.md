# 0003: Token Reduction via Sliding Window

## Context

During an opencode session, the conversation grows rapidly — each tool call produces a user/assistant/tool message triplet, and a single turn can generate 5–10 tool calls. After 10–20 turns, the message array can reach 50–200 messages, consuming 5,000–20,000 tokens before the model generates a single response.

## Key Insight

**System prompts are identity; conversation history is context.** System prompts carry AGENTS.md, tool definitions, and behavioral instructions — they must never be dropped. Conversation history is background context that the model may or may not need for the current turn. Old turns are already *done*.

## Decision

Implement a sliding window trim that:
- Always preserves all `system` role messages
- Keeps only the last N non-system messages (default 15)
- Is configurable via `MAX_MESSAGES` setting (0 = system only, null = disable)

## Implementation

- `server/prompt.py`: New `trim_messages()` function
- `server/api.py`: Called before messages reach the router
- `server/config.py`: `MAX_MESSAGES` default of 15

## Edge Cases Found

1. **`max_messages=0`**: Python slice `list[-0:]` returns the *entire* list, not empty. Must guard with `if max_messages > 0` or `else []`.
2. **`max_messages=None`**: Must disable trimming, not crash with `None > 0` TypeError.
3. **Multiple system prompts**: opencode might inject multiple system messages. The algorithm preserves all of them, which is correct.

## Trade-offs

- **Pros**: Drastically reduces token consumption for long agent sessions; simple, predictable algorithm; no dependencies.
- **Cons**: The model loses awareness of early conversation context. For opencode this is usually fine (each turn is self-contained), but chat applications may need larger windows.

## Related

- Reference: `reference/token-reduction.html`
- Lesson: `lessons/0003-token-reduction.html`
