"""FastAPI app wiring multiple providers onto the OpenAI Chat Completions API."""

import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

from copilot.driver import ClearanceRequired
from copilot.providers.copilot_provider import CopilotProvider
from copilot.providers.ollama_provider import OllamaProvider
from copilot.providers.openai_provider import OpenAIProvider

from .config import MODEL_NAME, PROVIDER_PRIORITY, RATE_LIMIT_BURST, RATE_LIMIT_RPM
from .openai_format import completion_response, new_id, sse_event, stream_chunk
from .prompt import messages_to_prompt
from .ratelimit import TokenBucket
from .router import Router
from .schemas import ChatCompletionRequest

app = FastAPI(title="Copilot OpenAI-compatible API", version="1.0.0")

log = logging.getLogger(__name__)


def _build_router() -> Router:
    """Instantiate providers from env config and return a Router."""
    registry = {
        "copilot": lambda: CopilotProvider(interactive_clear=False, headless_clear=False),
        "ollama": lambda: OllamaProvider(),
        "openai": lambda: OpenAIProvider(),
    }
    providers = []
    for name in PROVIDER_PRIORITY:
        factory = registry.get(name)
        if factory is None:
            log.warning("Unknown provider %r in PROVIDER_PRIORITY; skipping", name)
            continue
        try:
            p = factory()
            if p.is_available():
                providers.append(p)
                log.info("Provider %s: available (%d models)", p.label, len(p.list_models()))
            else:
                log.info("Provider %s: not available (skipping)", p.label)
        except Exception as exc:
            log.warning("Provider %s failed to initialize: %s; skipping", name, exc)
    if not providers:
        log.warning("No providers available — server will reject all requests")
    return Router(providers)


router = _build_router()

_CLEARANCE_HELP = (
    "Cloudflare clearance expired and could not be refreshed headlessly. "
    "Re-clear in a browser: run `python -m copilot login` (or `python tests/diagnostic.py`) "
    "and pass the 'verify you're human' check, then retry."
)

_rate_limiter = TokenBucket(RATE_LIMIT_RPM, RATE_LIMIT_BURST)


def _rate_limited_response():
    allowed, wait = _rate_limiter.try_acquire()
    if allowed:
        return None
    secs = max(1, round(wait))
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(secs)},
        content={"error": {
            "message": f"Rate limit exceeded (>{RATE_LIMIT_RPM:g} req/min). Retry in {secs}s.",
            "type": "rate_limit_error",
            "code": "rate_limit_exceeded",
        }},
    )


def _stream(prompt: str, model: str, conversation_id=None):
    cid = new_id()
    created = int(__import__("time").time())
    try:
        yield from router.stream(prompt, model=model or MODEL_NAME, conversation_id=conversation_id)
    except ClearanceRequired:
        yield sse_event(
            stream_chunk(cid, created, model, {"content": f"\n[error: {_CLEARANCE_HELP}]"}, finish="error")
        )
    except Exception as exc:
        yield sse_event(
            stream_chunk(cid, created, model, {"content": f"\n[error: {exc}]"}, finish="error")
        )


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": router.list_models()}


@app.get("/v1/models/{model_id:path}")
def get_model_id(model_id: str):
    return {"id": model_id, "object": "model", "created": 0, "owned_by": "unknown"}


@app.get("/api/v1/models")
def list_api_models():
    return {"object": "list", "data": router.list_models()}


@app.get("/v1/probs")
def get_problems():
    return {"problems": []}


@app.post("/api/show")
def post_show():
    return {"show": []}


@app.get("/models")
def get_models():
    return {"object": "list", "data": router.list_models()}


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest):
    prompt = messages_to_prompt(req.messages)
    if not prompt.strip():
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "no text content in messages", "type": "invalid_request_error"}},
        )
    model = req.model or MODEL_NAME

    limited = _rate_limited_response()
    if limited is not None:
        return limited

    if req.stream:
        return StreamingResponse(
            _stream(prompt, model, req.conversation_id), media_type="text/event-stream"
        )

    try:
        result = router.chat(prompt, model=model, conversation_id=req.conversation_id)
    except ClearanceRequired:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": _CLEARANCE_HELP, "type": "clearance_required"}},
        )
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": str(exc), "type": "upstream_error"}},
        )
    return result


@app.get("/version")
def get_version():
    return {"version": app.version}


@app.get("/")
def root():
    return {"service": "Copilot OpenAI-compatible API", "endpoints": ["/v1/models", "/v1/chat/completions", "/version"]}
