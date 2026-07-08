"""Pydantic request models for the OpenAI-compatible endpoints."""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel


class FunctionDefinition(BaseModel):
    """A function definition inside a tool."""
    name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


class ToolDefinition(BaseModel):
    """A tool in the tools array sent by opencode."""
    type: str = "function"
    function: FunctionDefinition


class ToolCallFunction(BaseModel):
    """The function payload inside a tool call response."""
    name: str
    arguments: str


class ToolCall(BaseModel):
    """A tool call returned by the model in an assistant message."""
    id: str
    type: str = "function"
    function: ToolCallFunction


class ChatMessage(BaseModel):
    role: str
    # content is a plain string, or OpenAI "content parts" (list of dicts), or
    # null for some tool/assistant messages.
    content: Optional[Union[str, List[Any], None]] = None
    # Present on assistant messages when the model calls tools
    tool_calls: Optional[List[ToolCall]] = None
    # Present on tool role messages (links back to a tool call)
    tool_call_id: Optional[str] = None
    # Name of the tool that produced this message (tool role)
    name: Optional[str] = None


class ChatCompletionRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    stream: bool = False
    # OpenAI tool calling fields
    tools: Optional[List[ToolDefinition]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None
    # Copilot's own conversation id (returned in earlier responses). Pass it back
    # to continue that thread; omit it to start a fresh conversation. Outside
    # OpenAI's schema, but standard clients can set it via extra_body.
    conversation_id: Optional[str] = None
    # Any other OpenAI fields (temperature, max_tokens, ...) are accepted and
    # ignored — Copilot's consumer protocol doesn't expose those knobs.
