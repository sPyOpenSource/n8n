"""Flatten an OpenAI ``messages`` array into a single Copilot prompt.

Copilot's protocol has no role/system channel — it takes one prompt string per
turn — so we collapse the whole conversation into one piece of text.
"""

from typing import Any, List, Optional, Union

from .schemas import ChatMessage


def content_text(content: Optional[Union[str, List[Any]]]) -> str:
    """Extract plain text from a message's content (string or content-parts)."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts = []
    for part in content:
        if isinstance(part, dict):
            if part.get("type") == "text":
                parts.append(part.get("text", ""))
        else:
            parts.append(str(part))
    return "\n".join(p for p in parts if p)


def trim_messages(messages: list[dict], max_messages: int = 15) -> list[dict]:
    """Keep system prompts + last N messages for token reduction.

    Always preserves every ``system`` role message (they carry AGENTS.md,
    LSP data, etc.). From the remaining messages only the most recent
    ``max_messages`` are kept — older conversational context is dropped.

    Set ``max_messages`` to 0 to drop all conversational context (system
    prompts are still preserved). Pass ``max_messages=None`` to disable
    trimming entirely.

    This is the primary lever for controlling token consumption when the
    conversation has grown long (e.g. after many opencode tool loops).
    """
    if max_messages is None or not messages:
        return messages

    system = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]

    if len(non_system) <= max_messages:
        return messages

    trimmed = non_system[-max_messages:] if max_messages > 0 else []
    return system + trimmed


def messages_to_prompt(messages: List[ChatMessage]) -> str:
    """Flatten an OpenAI ``messages`` array into a single Copilot prompt."""
    system = "\n\n".join(
        content_text(m.content) for m in messages if m.role == "system" and m.content
    )
    convo = [m for m in messages if m.role != "system"]

    if len(convo) == 1 and convo[0].role == "user":
        body = content_text(convo[0].content)  # simple single-turn request
    else:
        lines = []
        for m in convo:
            label = "User" if m.role == "user" else "Assistant"
            lines.append(f"{label}: {content_text(m.content)}")
        lines.append("Assistant:")  # cue Copilot to continue
        body = "\n".join(lines)

    if system and body:
        return f"{system}\n\n{body}"
    return system or body
