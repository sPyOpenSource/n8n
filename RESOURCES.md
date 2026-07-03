# Resources for opencode Integration

## Primary References

### opencode Documentation
- **Providers Overview**: https://opencode.ai/docs/providers/
- **Custom Provider Config**: https://opencode.ai/docs/providers/#custom-provider
- **OpenAI Compatible Spec**: https://opencode.ai/docs/providers/#openai-compatible
- **Model Configuration**: https://opencode.ai/docs/models/

### Vercel AI SDK (What opencode uses under the hood)
- **OpenAI Compatible Provider**: https://ai-sdk.dev/docs/reference/ai-sdk-core/openai-compatible
- **Language Model Specification**: https://ai-sdk.dev/docs/reference/ai-sdk-core/language-model
- **Tool Calling**: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- **Streaming Protocol**: https://ai-sdk.dev/docs/reference/ai-sdk-ui/stream-protocol

### OpenAI API Specification
- **Chat Completions**: https://platform.openai.com/docs/api-reference/chat/create
- **Models**: https://platform.openai.com/docs/api-reference/models
- **Tool Calling Guide**: https://platform.openai.com/docs/guides/function-calling

### Models.dev (Capability Schema)
- **Model Schema**: https://models.dev/schema
- **Provider Registry**: https://models.dev/api.json

## Code References (This Repo)
- **Main API**: `server/api.py` - FastAPI endpoints
- **Router**: `server/router.py` - Provider routing & failover
- **Schemas**: `server/schemas.py` - Pydantic models for requests/responses
- **Providers**: `copilot/providers/*.py` - Individual provider implementations
- **Prompt Conversion**: `server/prompt.py` - OpenAI -> Provider format translation
- **OpenAI Format Helpers**: `server/openai_format.py` - SSE chunk formatting

## Testing Tools
- **opencode CLI**: `npx opencode-ai@latest` or installed binary
- **curl**: Manual API testing
- **Postman/Insomnia**: GUI API testing