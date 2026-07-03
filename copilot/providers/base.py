"""Extended provider interface for multi-provider routing."""

import threading
from abc import ABC, abstractmethod
from typing import Any, Generator

from copilot.driver import ResourceExhausted


class AbstractProvider(ABC):
    """Interface every provider must implement.

    Subclasses define how to check availability, list models, and execute
    chat/stream requests. The router calls these methods; providers raise
    exceptions on failure and the router decides whether to fail over.
    """

    label: str
    url: str
    working: bool
    supports_stream: bool
    default_model: str
    needs_auth: bool = True

    def __init__(self):
        self._lock = threading.Lock()

    def _handle_status(self, resp: Any):
        """Check for 429 ResourceExhausted or other status errors."""
        if hasattr(resp, "status_code"):
            if resp.status_code == 429:
                raise ResourceExhausted(f"Provider {self.label} quota exceeded (429)")
            resp.raise_for_status()

    @abstractmethod
    def is_available(self) -> bool:
        """Return True if this provider is ready to serve requests."""
        ...

    @abstractmethod
    def list_models(self) -> list[dict]:
        """Return OpenAI-shaped model dicts for GET /v1/models."""
        ...

    @abstractmethod
    def chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict:
        """Return a non-streaming chat completion dict (OpenAI shape).

        ``messages`` is the full OpenAI messages array (system, user, assistant,
        tool). ``tools`` and ``tool_choice`` are optional tool-calling fields.
        """
        ...

    @abstractmethod
    def stream(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> Generator:
        """Yield SSE-formatted chat completion chunk strings.

        ``messages`` is the full OpenAI messages array. ``tools`` and
        ``tool_choice`` are optional tool-calling fields.
        """
        ...
