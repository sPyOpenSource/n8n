"""FastAPI app wiring multiple providers onto the OpenAI Chat Completions API."""

import logging
import json

from fastapi import FastAPI, Body
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from copilot.driver import ClearanceRequired
from copilot.providers.copilot_provider import CopilotProvider
from copilot.providers.ollama_provider import OllamaProvider
from copilot.providers.openai_provider import OpenAIProvider
from copilot.providers.openrouter_provider import OpenRouterProvider
from copilot.providers.google_provider import GoogleProvider
from copilot.providers.nvidia_provider import NvidiaProvider
from copilot.providers.opencode_zen_provider import OpencodeZenProvider

from .config import config
from .openai_format import completion_response, new_id, sse_event, stream_chunk
from .prompt import trim_messages
from .ratelimit import TokenBucket
from .model_config import ModelConfig
from .score_keeper import ScoreKeeper
from .selector import ProviderSelector
from .health_watcher import HealthWatcher
from .router import Router, FailsafeRouter
from .schemas import ChatCompletionRequest

app = FastAPI(title="Copilot OpenAI-compatible API", version="1.0.0")

log = logging.getLogger(__name__)


def _build_router() -> Router | FailsafeRouter:
    """Instantiate providers from config and return a Router."""
    registry = {
        "copilot": lambda: CopilotProvider(interactive_clear=False, headless_clear=False),
        "ollama": lambda: OllamaProvider(),
        "openai": lambda: OpenAIProvider(),
        "openrouter": lambda: OpenRouterProvider(),
        "google": lambda: GoogleProvider(),
        "nvidia": lambda: NvidiaProvider(),
        "opencode_zen": lambda: OpencodeZenProvider(),
    }

    # Check for failsafe config
    model_config_path = config.get("MODEL_CONFIG_PATH")
    mc = ModelConfig(model_config_path) if model_config_path else ModelConfig("")
    if mc.all_models():
        # Failsafe mode: build provider map keyed by name
        providers = {}
        priority = config.get("PROVIDER_PRIORITY").split(",")
        for name in [p.strip() for p in priority]:
            factory = registry.get(name)
            #if factory is None:
            #    log.warning("Unknown provider %r; skipping", name)
            #    continue
            try:
                p = factory()
                if p.is_available():
                    providers[name] = p
                    log.info("Provider %s: available (%d models)", p.label, len(p.list_models()))
                else:
                    log.info("Provider %s: not available (skipping)", p.label)
            except Exception as exc:
                log.warning("Provider %s failed: %s", name, exc)
        return FailsafeRouter(
            providers=providers,
            model_config=mc,
            score_keeper=ScoreKeeper(),
            selector=ProviderSelector(),
            health_watcher=HealthWatcher(),
        )

    # Legacy mode: priority-ordered list
    providers = []
    priority = config.get("PROVIDER_PRIORITY").split(",")
    for name in [p.strip() for p in priority]:
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


# Global state
router = _build_router()
_rate_limiter = TokenBucket(config.get("RATE_LIMIT_RPM"), config.get("RATE_LIMIT_BURST"))

def reload_server_state():
    """Update router and rate limiter when config changes."""
    global router, _rate_limiter
    log.info("Updating server state from new configuration...")
    router = _build_router()
    _rate_limiter.update_limits(config.get("RATE_LIMIT_RPM"), config.get("RATE_LIMIT_BURST"))

config.on_reload(reload_server_state)

_CLEARANCE_HELP = (
    "Cloudflare clearance expired and could not be refreshed headlessly. "
    "Re-clear in a browser: run `python -m copilot login` (or `python tests/diagnostic.py`) "
    "and pass the 'verify you're human' check, then retry."
)


def _rate_limited_response():
    allowed, wait = _rate_limiter.try_acquire()
    if allowed:
        return None
    secs = max(1, round(wait))
    rpm = config.get("RATE_LIMIT_RPM")
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(secs)},
        content={"error": {
            "message": f"Rate limit exceeded (>{rpm:g} req/min). Retry in {secs}s.",
            "type": "rate_limit_error",
            "code": "rate_limit_exceeded",
        }},
    )


def _stream(messages: list, model: str, conversation_id=None, tools=None, tool_choice=None):
    cid = new_id()
    created = int(__import__("time").time())
    try:
        yield from router.stream(messages, model=model or config.get("MODEL_NAME"), tools=tools, tool_choice=tool_choice, conversation_id=conversation_id)
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
    # Convert typed request models to plain dicts for downstream providers
    messages = [m.model_dump(exclude_none=True) for m in req.messages]
    #print("Received chat request:", messages)
    max_msgs = config.get("MAX_MESSAGES") or 25
    messages = trim_messages(messages, max_messages=max_msgs)
    tools = [t.model_dump(exclude_none=True) for t in req.tools] if req.tools else None
    tool_choice = req.tool_choice

    # Quick sanity — at least one message should have text content
    has_text = any(
        isinstance(m.get("content"), str) and m["content"].strip()
        for m in messages
    )
    if not has_text:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "no text content in messages", "type": "invalid_request_error"}},
        )
    #print(f"Chat messages={messages}, tools={len(tools) if tools else 0}, tool_choice={tool_choice}")
    model = req.model or config.get("MODEL_NAME")
    limited = _rate_limited_response()
    if limited is not None:
        return limited

    if req.stream:
        return StreamingResponse(
            _stream(messages, model, req.conversation_id, tools=tools, tool_choice=tool_choice),
            media_type="text/event-stream",
        )

    try:
        result = router.chat(messages, model=model, tools=tools, tool_choice=tool_choice, conversation_id=req.conversation_id)
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


@app.get("/admin", response_class=HTMLResponse)
def admin_ui():
    """Serve the Admin UI."""
    return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Open Router Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; color: #f8fafc; }
        .card { background-color: #1e293b; border: 1px solid #334155; }
        .input-field { background-color: #0f172a; border: 1px solid #334155; color: #f8fafc; }
    </style>
</head>
<body class="p-8">
    <div class="max-w-4xl mx-auto">
        <header class="mb-8 flex justify-between items-center">
            <h1 class="text-3xl font-bold text-white">Open Router <span class="text-blue-400">Admin</span></h1>
            <div id="status" class="text-sm px-3 py-1 rounded-full bg-green-900 text-green-300">Connected</div>
        </header>

        <div class="card rounded-xl p-6 shadow-xl">
            <h2 class="text-xl font-semibold mb-6 text-slate-300">Server Configuration</h2>
            <form id="config-form" class="space-y-6">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Provider Priority (comma-separated)</label>
                        <input type="text" name="PROVIDER_PRIORITY" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Default Model Name</label>
                        <input type="text" name="MODEL_NAME" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Rate Limit (RPM)</label>
                        <input type="number" name="RATE_LIMIT_RPM" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Rate Limit Burst</label>
                        <input type="number" name="RATE_LIMIT_BURST" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">OpenAI Base URL</label>
                        <input type="text" name="OPENAI_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">OpenRouter Base URL</label>
                        <input type="text" name="OPENROUTER_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Google Base URL</label>
                        <input type="text" name="GOOGLE_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">NVIDIA Base URL</label>
                        <input type="text" name="NVIDIA_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">OpenCode Zen Base URL</label>
                        <input type="text" name="OPENCODE_ZEN_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-sm font-medium text-slate-400 mb-2">Ollama Base URL</label>
                        <input type="text" name="OLLAMA_BASE_URL" class="input-field p-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    </div>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        Save Configuration
                    </button>
                </div>
            </form>
        </div>

        <div class="mt-8 card rounded-xl p-6 shadow-xl">
            <h2 class="text-xl font-semibold mb-4 text-slate-300">Active Model Pool</h2>
            <div id="model-list" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Models will be loaded here -->
                <div class="text-slate-500 italic">Loading models...</div>
            </div>
        </div>

        <div class="mt-8 card rounded-xl p-6 shadow-xl">
            <h2 class="text-xl font-semibold mb-4 text-slate-300">Model Configuration <span class="text-sm text-slate-500">(provider-grouped JSON)</span></h2>
            <div class="mb-2 text-sm text-slate-400" id="model-config-path"></div>
            <textarea id="model-config-editor" class="input-field p-3 rounded-lg w-full font-mono text-sm" rows="12" spellcheck="false"></textarea>
            <div class="flex justify-end pt-4 gap-3">
                <button id="model-config-reload-btn" class="bg-slate-600 hover:bg-slate-500 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                    Reload from Disk
                </button>
                <button id="model-config-save-btn" class="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                    Save Model Config
                </button>
            </div>
            <div id="model-config-status" class="mt-2 text-sm"></div>
        </div>
    </div>

    <script>
        async function loadConfig() {
            try {
                const res = await fetch('/admin/config');
                const config = await res.json();
                const form = document.getElementById('config-form');
                
                Object.entries(config).forEach(([key, value]) => {
                    const input = form.elements[key];
                    if (input) input.value = value;
                });
                
                loadModels();
            } catch (e) {
                document.getElementById('status').textContent = 'Error loading config';
                document.getElementById('status').className = 'text-sm px-3 py-1 rounded-full bg-red-900 text-red-300';
            }
        }

        async function loadModels() {
            try {
                const res = await fetch('/v1/models');
                const data = await res.json();
                const container = document.getElementById('model-list');
                container.innerHTML = '';
                
                data.data.forEach(m => {
                    const div = document.createElement('div');
                    div.className = 'p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300';
                    div.textContent = m.id;
                    container.appendChild(div);
                });
            } catch (e) {
                console.error('Failed to load models', e);
            }
        }

        document.getElementById('config-form').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const config = {};
            formData.forEach((value, key) => {
                // Try to parse numbers
                if (!isNaN(value) && value.trim() !== '') {
                    config[key] = value.includes('.') ? parseFloat(value) : parseInt(value, 10);
                } else {
                    config[key] = value;
                }
            });

            try {
                const res = await fetch('/admin/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (res.ok) {
                    alert('Configuration saved and server reloaded!');
                    loadModels();
                } else {
                    throw new Error('Failed to save');
                }
            } catch (e) {
                alert('Error saving configuration: ' + e.message);
            }
        };

        async function loadModelConfig() {
            try {
                const [configRes, dataRes] = await Promise.all([
                    fetch('/admin/config'),
                    fetch('/admin/model-config')
                ]);
                const config = await configRes.json();
                const data = await dataRes.json();
                const pathLabel = document.getElementById('model-config-path');
                pathLabel.textContent = 'Path: ' + (config.MODEL_CONFIG_PATH || 'config/models.json');
                document.getElementById('model-config-editor').value = JSON.stringify(data, null, 2);
            } catch (e) {
                document.getElementById('model-config-editor').value = '{}';
            }
        }

        document.getElementById('model-config-save-btn').onclick = async () => {
            const btn = document.getElementById('model-config-save-btn');
            const status = document.getElementById('model-config-status');
            btn.disabled = true;
            btn.textContent = 'Saving...';
            try {
                const raw = document.getElementById('model-config-editor').value;
                const parsed = JSON.parse(raw);
                const res = await fetch('/admin/model-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                });
                if (res.ok) {
                    status.textContent = 'Saved and server reloaded ✓';
                    status.className = 'mt-2 text-sm text-green-400';
                    loadModels();
                } else {
                    const err = await res.json();
                    throw new Error(err.error || 'Save failed');
                }
            } catch (e) {
                status.textContent = 'Error: ' + e.message;
                status.className = 'mt-2 text-sm text-red-400';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Save Model Config';
            }
        };

        document.getElementById('model-config-reload-btn').onclick = () => {
            loadModelConfig();
            document.getElementById('model-config-status').textContent = 'Reloaded from disk ✓';
            document.getElementById('model-config-status').className = 'mt-2 text-sm text-green-400';
        };

        loadConfig();
        loadModelConfig();
    </script>
</body>
</html>
    """


@app.get("/admin/config")
def get_config():
    """Return the current merged configuration."""
    return config._cached_config


@app.post("/admin/config")
def set_config(cfg: dict = Body(...)):
    """Update the JSON config and reload the server state."""
    try:
        config.reload()
        return {"status": "ok", "config": config._cached_config}
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": str(exc)}
        )


@app.get("/admin/model-config")
def get_model_config():
    """Return the raw provider-grouped model config JSON."""
    path = config.get("MODEL_CONFIG_PATH")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(data)
    except FileNotFoundError:
        return JSONResponse({})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@app.post("/admin/model-config")
def set_model_config(cfg: dict = Body(...)):
    """Write the provider-grouped model config and reload the server."""
    path = config.get("MODEL_CONFIG_PATH")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        reload_server_state()
        return {"status": "ok", "path": path}
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": str(exc)}
        )
