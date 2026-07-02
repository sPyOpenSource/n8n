"""Copilot provider — wraps the existing CopilotClient."""

import time

from copilot.client import CopilotClient
from copilot.driver import ClearanceRequired

from .base import AbstractProvider


class CopilotProvider(AbstractProvider):
    """Provider backed by the signed-in Copilot session."""

    label = "Microsoft Copilot"
    url = "https://copilot.microsoft.com"
    working = True
    supports_stream = True
    default_model = "copilot"
    needs_auth = False

    def __init__(self, interactive_clear=False, headless_clear=False):
        super().__init__()
        self._client = CopilotClient(
            interactive_clear=interactive_clear,
            headless_clear=headless_clear,
        )

    def is_available(self) -> bool:
        return True

    def list_models(self) -> list[dict]:
        return [
            {"id": self.default_model, "object": "model", "created": 0, "owned_by": "microsoft"}
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        with self._lock:
            reply = self._client.chat(prompt, conversation_id=conversation_id)
        return {
            "id": "chatcmpl-copilot",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model or self.default_model,
            "conversation_id": reply.conversation_id,
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": reply.text}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    def stream(self, prompt: str, model: str, conversation_id: str | None = None):
        from server.openai_format import new_id, sse_event, stream_chunk
        print(model)
        cid = new_id()
        created = int(time.time())
        with self._lock:
            try:
                yield sse_event(stream_chunk(cid, created, model, {"role": "assistant"}))
                stream = self._client.stream(prompt, conversation_id=conversation_id)
                for piece in stream:
                    if isinstance(piece, str) and piece:
                        yield sse_event(stream_chunk(cid, created, model, {"content": piece}))
                yield sse_event(
                    stream_chunk(cid, created, model, {}, finish="stop",
                                 conversation_id=stream.conversation_id)
                )
            except ClearanceRequired:
                yield sse_event(
                    stream_chunk(cid, created, model,
                                 {"content": "\n[error: Cloudflare clearance expired]"},
                                 finish="error")
                )
            except Exception as exc:
                yield sse_event(
                    stream_chunk(cid, created, model,
                                 {"content": f"\n[error: {exc}]"},
                                 finish="error")
                )
        yield "data: [DONE]\n\n"
