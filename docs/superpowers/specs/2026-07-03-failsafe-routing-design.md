# Design Spec: Failsafe Routing for LLM Gateway
**Date:** 2026-07-03
**Status:** Draft (Pending User Review)

## 1. Overview
This document specifies the design for a "failsafe" routing layer for an OpenAI-compatible API gateway. The goal is to ensure high availability by dynamically routing requests across multiple LLM providers (OpenAI, Anthropic, Gemini, etc.) and failing over automatically when providers experience outages or degradation.

## 2. Architecture & Request Flow

### 2.1 High-Level Flow
1. **Model Lookup**: Router receives a request for a specific model (e.g., `gpt-4o`). It looks up all providers configured to support this model in `config.json`.
2. **Provider Scoring**: The router retrieves the current **Error Rate** and **Latency** for these providers. Signals older than **30 seconds** are discarded.
3. **Provider Selection**: 
   - A score $S$ is calculated for each provider based on signals.
   - A **Softmax (Boltzmann)** distribution with temperature $\tau=0.1$ is applied to these scores.
   - A provider is sampled based on the resulting probabilities.
4. **Execution**: 
   - The request is translated from OpenAI format to the selected provider's native format.
   - The request is forwarded to the provider.
5. **Failover Loop**:
   - If the provider returns a failure (5xx, 429, Timeout, DNS), the router:
     - Updates the provider's error rate and latency signals in the state store.
     - Immediately repeats the selection process (Step 3) to pick the next best provider, excluding those already tried for the current request.
     - Repeats until a provider succeeds or all candidates are exhausted.
6. **Terminal Failure**: If all providers are exhausted, the router returns a **503 Service Unavailable** status with a static stub response.

## 3. Data Model & Configuration

### 3.1 Model Mapping (`config.json`)
The configuration uses a provider-grouped JSON structure:
```json
{
  "openai": {
    "gpt-4o": "gpt-4o",
    "gpt-4-turbo": "gpt-4-turbo-preview"
  },
  "anthropic": {
    "gpt-4o": "claude-3-5-sonnet-20240620",
    "claude-3-opus": "claude-3-opus-20240229"
  }
}
```

### 3.2 Credentials
Provider API keys are managed via environment variables (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) to ensure secrets are not stored in version control.

### 3.3 Dynamic State Store
An in-memory, thread-safe store tracks provider health:
- `error_rate`: Floating point (0.0 - 1.0) over a sliding window of recent requests.
- `latency_p99`: 99th percentile latency in milliseconds.
- `last_updated`: Timestamp for staleness checks (30s limit).
- `status`: `HEALTHY`, `UNHEALTHY`, or `PROBING`.

## 4. Scoring & Intelligence

### 4.1 Scoring Formula
Lower scores are preferred.
$$S = (w_1 \times \text{ErrorRate}) + (w_2 \times \frac{\text{Latency\_p99}}{\text{MaxExpectedLatency}})$$
*(Default weights: $w_1=0.7, w_2=0.3$; MaxExpectedLatency = 10,000ms)*

### 4.2 Selection Probability
The probability $P(i)$ of selecting provider $i$ is:
$$P(i) = \frac{e^{-S_i / \tau}}{\sum_{j} e^{-S_j / \tau}}$$
With $\tau = 0.1$, the selection is near-deterministic toward the best-performing provider while maintaining a small degree of exploration.

### 4.3 Hybrid Health Detection
- **Passive Detection**: Every real-time request updates the state store signals.
- **Active Probing**: Background workers periodically call a lightweight endpoint (e.g., `/v1/models`) for `UNHEALTHY` providers.
- **Recovery**: A provider is marked `HEALTHY` only after **3 consecutive successful active probes**.

## 5. Response Handling & Edge Cases

### 5.1 Response Normalization
A translation layer maps provider-specific responses (Anthropic, Gemini, etc.) back to the OpenAI schema, including `choices`, `usage` (tokens), and `finish_reason`.

### 5.2 Mid-Stream Failures
For streaming requests (`stream: true`):
- **Strategy**: Hard Fail.
- If a provider fails after streaming has started, the router stops the stream and appends a trailing error chunk (e.g., `finish_reason: "error"`).
- Re-generation/failover is NOT attempted mid-stream to prevent inconsistent responses.

### 5.3 Total Outage Behavior
When all providers fail for a request:
- **HTTP Status**: `503 Service Unavailable`
- **Response Body**:
  ```json
  {
    "error": {
      "message": "Service temporarily unavailable, please retry",
      "type": "insufficient_capacity",
      "code": "provider_outage"
    }
  }
  ```
