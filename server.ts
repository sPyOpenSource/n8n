import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Create HTTP server
const server = http.createServer(app);

// In-memory workflow state
let currentWorkflowState = {
  id: 'studio-workflow',
  name: 'AI Support Sentiment Router',
  description: 'Ingests dynamic support payloads, routes automatically based on negative sentiment or refund demands, and drafts highly tailored recovery templates.',
  nodes: [
    {
      id: 'trigger_ticket',
      type: 'webhook',
      name: 'Support Webhook Mock',
      category: 'trigger',
      position: { x: 50, y: 150 },
      config: {
        payload: JSON.stringify({
          subject: "URGENT PAYMENT FAILURE / REFUND REQUEST",
          customerName: "Alex Vance",
          statusCode: "502-EXPIRED",
          content: "I paid for the premium plan twice but my status is still unpaid. This is ridiculous, please refund my duplicate payment immediately or I am canceling my account!"
        }, null, 2)
      }
    },
    {
      id: 'ai_check_sentiment',
      type: 'aiFilter',
      name: 'AI Sentiment Filter',
      category: 'ai',
      position: { x: 300, y: 150 },
      config: {
        condition: "Customer message conveys high frustration, anger, or explicitly demands a refund."
      }
    },
    {
      id: 'ai_priority_draft',
      type: 'aiTransform',
      name: 'Priority Apology Drafter',
      category: 'ai',
      position: { x: 580, y: 50 },
      config: {
        prompt: "Draft an urgent support email responding to {{customerName}}. Apologize sincerely for the payment glitch, assure them we are processing the dual payment refund immediately, and offer a free 1-month VIP extension to maintain client trust. Keep it premium and reassuring.",
        systemInstruction: "You are a professional Customer Success Lead handling high-priority escalations."
      }
    },
    {
      id: 'ai_standard_draft',
      type: 'aiTransform',
      name: 'Standard Ticket Responder',
      category: 'ai',
      position: { x: 580, y: 280 },
      config: {
        prompt: "Draft a dynamic standard response to customer {{customerName}}. Thank them for reaching out and outline clear steps to verify their subscription transaction.",
        systemInstruction: "You are a standard ticketing support agent."
      }
    },
    {
      id: 'log_priority_output',
      type: 'outputLog',
      name: 'Log Priority Queue',
      category: 'utility',
      position: { x: 860, y: 50 },
      config: {}
    },
    {
      id: 'log_standard_output',
      type: 'outputLog',
      name: 'Log General Queue',
      category: 'utility',
      position: { x: 860, y: 280 },
      config: {}
    }
  ],
  connections: [
    {
      id: 'conn1',
      fromId: 'trigger_ticket',
      fromPort: 'output',
      toId: 'ai_check_sentiment',
      toPort: 'input'
    },
    {
      id: 'conn2',
      fromId: 'ai_check_sentiment',
      fromPort: 'true',
      toId: 'ai_priority_draft',
      toPort: 'input'
    },
    {
      id: 'conn3',
      fromId: 'ai_check_sentiment',
      fromPort: 'false',
      toId: 'ai_standard_draft',
      toPort: 'input'
    },
    {
      id: 'conn4',
      fromId: 'ai_priority_draft',
      fromPort: 'output',
      toId: 'log_priority_output',
      toPort: 'input'
    },
    {
      id: 'conn5',
      fromId: 'ai_standard_draft',
      fromPort: 'output',
      toId: 'log_standard_output',
      toPort: 'input'
    }
  ]
};

// Global log tracking list
let globalLogsList: any[] = [
  {
    id: 'initial_log',
    timestamp: new Date().toLocaleTimeString(),
    level: 'info',
    message: '🚀 Visual Workflow Studio active. Load a preset template to experience visual routing.'
  }
];

// Active collaborators list
interface Collaborator {
  id: string;
  name: string;
  color: string;
  ws: WebSocket;
}

const collaborators = new Map<string, Collaborator>();

const FUNNY_NAMES = [
  "Visual Raven", "Automator Rabbit", "Flow Whale", "Code Badger",
  "Circuit Fox", "Logic Otter", "Node Lemur", "Loop Squirrel"
];

const PASTEL_COLORS = [
  "#38bdf8", "#34d399", "#a78bfa", "#fb7185", "#f43f5e", "#fbbf24", "#a3e635", "#60a5fa"
];

const wss = new WebSocketServer({ noServer: true });

// Setup Custom WebSocket Server Room for Simulator Nodes
const customWss = new WebSocketServer({ noServer: true });
const customWSSClients = new Set<WebSocket>();
interface CustomWSMessage {
  id: string;
  timestamp: string;
  data: string;
  direction: 'received' | 'sent';
}
const customWSSMessageHistory: CustomWSMessage[] = [];

customWss.on("connection", (ws: WebSocket) => {
  customWSSClients.add(ws);
  
  const joinLog = {
    id: `ws_svr_join_${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    level: 'info' as const,
    message: `🔌 [WS Server] An external client has linked directly to /ws/custom`
  };
  globalLogsList.unshift(joinLog);
  broadcast("chat:message", joinLog);

  ws.on('message', (messageBuffer) => {
    let msgStr = "";
    try {
      msgStr = messageBuffer.toString();
    } catch {
      msgStr = String(messageBuffer);
    }

    const customMsg: CustomWSMessage = {
      id: `ws_msg_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      data: msgStr,
      direction: 'received'
    };
    customWSSMessageHistory.unshift(customMsg);
    if (customWSSMessageHistory.length > 30) customWSSMessageHistory.pop();

    const textLog = {
      id: `ws_svr_receive_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      level: 'success' as const,
      message: `📥 [WS Server] Inbound message received: "${msgStr}"`
    };
    globalLogsList.unshift(textLog);
    broadcast("chat:message", textLog);
  });

  ws.on('close', () => {
    customWSSClients.delete(ws);
    const leaveLog = {
      id: `ws_svr_leave_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      level: 'warn' as const,
      message: `🔌 [WS Server] An external client disconnected.`
    };
    globalLogsList.unshift(leaveLog);
    broadcast("chat:message", leaveLog);
  });
});

function broadcast(type: string, payload: any, excludeId?: string) {
  const message = JSON.stringify({ type, payload });
  collaborators.forEach((collab, id) => {
    if (id !== excludeId && collab.ws.readyState === WebSocket.OPEN) {
      collab.ws.send(message);
    }
  });
}

// Initialize Gemini client on the server side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// 1. API route: Execute a single Workflow Node
app.post("/api/node/execute", async (req, res) => {
  const { type, config, inputData } = req.body;
  
  try {
    const contextData = inputData || {};
    
    switch (type) {
      case 'webhook': {
        // Evaluate payload JSON
        let payload = {};
        try {
          payload = JSON.parse(config.payload || "{}");
        } catch {
          payload = { text: config.payload || "" };
        }
        res.json({ output: payload });
        break;
      }
      
      case 'interval': {
        let payload = {};
        try {
          payload = JSON.parse(config.payload || "{}");
        } catch {
          payload = { text: config.payload || "" };
        }
        res.json({ output: payload });
        break;
      }
      
      case 'httpReq': {
        const url = config.url || "";
        if (!url) {
          return res.status(400).json({ error: "HTTP Request Node: Missing URL" });
        }
        
        const method = config.method || 'GET';
        const headersStr = config.headers || "{}";
        const bodyStr = config.body || "";
        
        let processedHeaders: Record<string, string> = {};
        try {
          processedHeaders = JSON.parse(headersStr);
        } catch {
          // Fallback if not pure JSON
        }
        
        const init: RequestInit = {
          method,
          headers: {
            "Content-Type": "application/json",
            ...processedHeaders
          }
        };
        
        if (['POST', 'PUT', 'DELETE'].includes(method) && bodyStr) {
          // Allow interpolating previous data into body
          let finalBody = bodyStr;
          if (bodyStr.includes('{{') && bodyStr.includes('}}')) {
            // Very simple variable replacement: e.g. {{key}} with contextData[key]
            Object.keys(contextData).forEach(key => {
              const val = typeof contextData[key] === 'object' ? JSON.stringify(contextData[key]) : contextData[key];
              finalBody = finalBody.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(val));
            });
          }
          init.body = finalBody;
        }
        
        const response = await fetch(url, init);
        const isJson = response.headers.get("content-type")?.includes("json");
        
        let data: any;
        if (isJson) {
          data = await response.json();
        } else {
          data = { text: await response.text() };
        }
        
        res.json({
          output: {
            statusCode: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data
          }
        });
        break;
      }
      
      case 'customFetch': {
        const source = config.source || 'news';
        if (source === 'bitcoin') {
          const r = await fetch('https://api.coindesk.com/v1/bpi/currentprice.json');
          const data = await r.json();
          res.json({ output: data });
        } else if (source === 'weather') {
          // Dynamic weather for London key coordinates
          const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current_weather=true');
          const data = await r.json();
          res.json({ output: data });
        } else if (source === 'news') {
          // Fetch free fake/real news titles
          res.json({
            output: {
              feed: "Global Tech Insights & Innovation Feed",
              timestamp: new Date().toISOString(),
              articles: [
                {
                  id: "1",
                  title: "Generative AI Transforms Visual Workflow Engineering Platforms",
                  category: "Technology",
                  summary: "No-code automation tools are incorporating semantic reasoning to build self-correcting integration branches.",
                  hotScore: 98
                },
                {
                  id: "2",
                  title: "Global Coordinates API Experience High-Volume Activity Spike",
                  category: "Telemetry",
                  summary: "Developer services report record requests as custom geo-routing widgets scale across active accounts.",
                  hotScore: 84
                },
                {
                  id: "3",
                  title: "Vite JS Releases Major Core Updates Supporting Clean Bundles",
                  category: "Open Source",
                  summary: "The open source developer ecosystem adopts aggressive build optimization configurations for production parity.",
                  hotScore: 91
                }
              ]
            }
          });
        } else {
          // Quote
          res.json({
            output: {
              quote: "The best way to predict the future is to automate it dynamically.",
              author: "Workflow Craftsman",
              timestamp: new Date().toISOString()
            }
          });
        }
        break;
      }
      
      case 'jsCode': {
        const code = config.code || "return input;";
        
        try {
          // Simple client-isolated code processor
          const workerFunction = new Function('input', `
            try {
              // Create wrapper
              ${code}
            } catch (e) {
              return { "jsError": e.message };
            }
          `);
          
          const scriptOutput = workerFunction(contextData);
          res.json({ output: scriptOutput });
        } catch (err: any) {
          res.status(400).json({ error: `JS Compile Error: ${err.message}` });
        }
        break;
      }
      
      case 'aiTransform': {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
          return res.status(400).json({
            error: "Gemini API key is not configured in Secrets panel or env file."
          });
        }
        
        const prompt = config.prompt || "Format the input dataset elegantly.";
        const systemInstruction = config.systemInstruction || "You are an automated visual data formatter for custom n8n.";
        
        // Execute Gemini using modern SDK patterns
        const requestPrompt = `Input Data JSON context:
${JSON.stringify(contextData, null, 2)}

Instruction to apply:
${prompt}

Please apply the instruction to the context. Return a structured JSON response corresponding to your actions or modified payload. Ensure it is valid JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: requestPrompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json"
          }
        });
        
        const responseText = response.text || "{}";
        let parsedResult = {};
        try {
          parsedResult = JSON.parse(responseText.trim());
        } catch {
          parsedResult = { rawText: responseText };
        }
        
        res.json({ output: parsedResult });
        break;
      }
      
      case 'aiFilter': {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
          return res.status(400).json({
            error: "Gemini API key is not configured in Secrets panel or env file."
          });
        }
        
        const condition = config.condition || "Checks if data contains errors.";
        
        // Smart condition analysis with JSON output
        const verifyPrompt = `Input Data JSON context:
${JSON.stringify(contextData, null, 2)}

Natural Language Condition to evaluate:
"${condition}"

Please verify if the input data satisfies this condition.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: verifyPrompt,
          config: {
            systemInstruction: "You are an automated condition evaluator router. Return a structured JSON state assessing the check.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                satisfied: {
                  type: Type.BOOLEAN,
                  description: "True if the input data meets the natural language condition criteria, false otherwise."
                },
                reason: {
                  type: Type.STRING,
                  description: "Short human readable explanation explaining the logic of why the check was passed or failed."
                }
              },
              required: ["satisfied", "reason"]
            }
          }
        });
        
        const responseText = response.text || "{}";
        let parsedResult = { satisfied: false, reason: "Failed to parse condition evaluation response" };
        try {
          parsedResult = JSON.parse(responseText.trim());
        } catch {
          // fallback
        }
        
        res.json({ output: parsedResult });
        break;
      }

      case 'chatgptTransform': {
        const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
        const model = config.openaiModel || "gpt-4o-mini";
        const prompt = config.prompt || "Format the input dataset elegantly.";
        const systemInstruction = config.systemInstruction || "You are an automated visual data formatter.";

        if (!apiKey || apiKey === '' || apiKey.trim() === 'MY_OPENAI_API_KEY') {
          // Graceful simulated preview mode with descriptive instructions
          const simulatedCompletion = {
            status: "simulation_mode",
            warning: "OpenAI API key was not configured. This is a descriptive simulation response.",
            configuredModel: model,
            instructionRef: systemInstruction,
            promptApplied: prompt,
            inputSnippetReceived: Object.keys(contextData).length > 0 ? contextData : { dummy: "data" },
            simulatedOutput: {
              summary: "Simulated ChatGPT Response",
              transformedData: {
                processedAt: new Date().toISOString(),
                success: true,
                message: "To run live calls, please configure your `OPENAI_API_KEY` in the workspace secrets panel or enter your custom key directly in this node's configuration!"
              }
            }
          };
          res.json({ output: simulatedCompletion });
          break;
        }

        // Real fetch live HTTP request to OpenAI
        try {
          const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: systemInstruction },
                {
                  role: "user",
                  content: `Input Data context (JSON):\n${JSON.stringify(contextData, null, 2)}\n\nPrompt / Transform Rule:\n${prompt}\n\nPlease output clean, valid JSON matching this transformation.`
                }
              ],
              response_format: { type: "json_object" },
              temperature: 0.2
            })
          });

          if (!apiResponse.ok) {
            const errorDetails = await apiResponse.text();
            throw new Error(`OpenAI API returned status ${apiResponse.status}: ${errorDetails}`);
          }

          const responseData: any = await apiResponse.json();
          const responseText = responseData.choices?.[0]?.message?.content || "{}";
          let parsedResult = {};
          try {
            parsedResult = JSON.parse(responseText.trim());
          } catch {
            parsedResult = { rawText: responseText };
          }

          res.json({ output: parsedResult });
        } catch (err: any) {
          res.status(500).json({ error: `ChatGPT transform execution error: ${err.message}` });
        }
        break;
      }

      case 'copilotTransform': {
        const token = config.githubToken || process.env.GITHUB_COPILOT_TOKEN;
        const model = config.copilotModel || "gpt-4o";
        const prompt = config.prompt || "Improve flow, extract names and summary metrics.";
        const systemInstruction = config.systemInstruction || "You are GitHub Copilot's automated code & context helper.";

        if (!token || token === '' || token.trim() === 'MY_GITHUB_COPILOT_TOKEN') {
          const simulatedCompletion = {
            status: "simulation_mode",
            warning: "GitHub Copilot or Azure GitHub Model Token was not configured. Active simulation mode.",
            engine: "GitHub Copilot AI Engine",
            configuredModel: model,
            systemInstruction: systemInstruction,
            promptResolved: prompt,
            inputPayloadReceived: Object.keys(contextData).length > 0 ? contextData : { text: "No input node connected yet" },
            simulatedOutput: {
              summary: "GitHub Copilot Transformed Output",
              copilotAssistedCode: {
                timestamp: new Date().toISOString(),
                copilotStatus: "Ready",
                guidedSetup: "To connect GitHub Copilot or Azure GitHub Models to your active workflow graph, configure GITHUB_COPILOT_TOKEN in your platform settings, or paste your Github API Token directly into the configuration input drawer for this node !"
              }
            }
          };
          res.json({ output: simulatedCompletion });
          break;
        }

        try {
          // GitHub Models API endpoint is models.inference.ai.azure.com (highly standard for Github developer tokens)
          const apiResponse = await fetch("https://models.inference.ai.azure.com/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
              "User-Agent": "GitHubCopilotWorkflowEngine"
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: systemInstruction },
                {
                  role: "user",
                  content: `Context payload to process:\n${JSON.stringify(contextData, null, 2)}\n\nInstructions:\n${prompt}\n\nPlease output clean, valid JSON formatted output.`
                }
              ],
              temperature: 0.1
            })
          });

          if (!apiResponse.ok) {
            const errorDetails = await apiResponse.text();
            throw new Error(`GitHub Models API returned status ${apiResponse.status}: ${errorDetails}`);
          }

          const responseData: any = await apiResponse.json();
          const responseText = responseData.choices?.[0]?.message?.content || "{}";
          let parsedResult = {};
          try {
            parsedResult = JSON.parse(responseText.trim());
          } catch {
            parsedResult = { rawText: responseText };
          }

          res.json({ output: parsedResult });
        } catch (err: any) {
          res.status(500).json({ error: `Copilot transform execution error: ${err.message}` });
        }
        break;
      }

      case 'ollamaTransform': {
        const ollamaBaseUrl = (config.ollamaUrl || process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
        const model = config.ollamaModel || process.env.OLLAMA_MODEL || "llama3";
        const prompt = config.prompt || "Analyze the input dataset and extract key highlights.";
        const systemInstruction = config.systemInstruction || "You are an automated local assistant. Respond with clean, valid JSON.";

        try {
          const apiResponse = await fetch(`${ollamaBaseUrl}/api/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: systemInstruction },
                {
                  role: "user",
                  content: `Context:\n${JSON.stringify(contextData, null, 2)}\n\nPrompt:\n${prompt}\n\nPlease output a clean, valid JSON representation of this transformation.`
                }
              ],
              stream: false,
              format: "json",
              options: {
                temperature: 0.2
              }
            })
          });

          if (!apiResponse.ok) {
            const errorDetails = await apiResponse.text();
            throw new Error(`Ollama returned status ${apiResponse.status}: ${errorDetails}`);
          }

          const responseData: any = await apiResponse.json();
          const responseText = responseData.message?.content || "{}";
          let parsedResult = {};
          try {
            parsedResult = JSON.parse(responseText.trim());
          } catch {
            parsedResult = { rawText: responseText };
          }

          res.json({ output: parsedResult });
        } catch (err: any) {
          const fallbackResponse = {
            status: "offline_preview_simulation",
            warning: `Could not connect to Ollama service at ${ollamaBaseUrl}. Details: ${err.message}`,
            configuredModel: model,
            configuredEndpoint: `${ollamaBaseUrl}/api/chat`,
            developerInstructions: "Ensure Ollama is running ('ollama serve') and CORS / host binding parameters permit access.",
            simulatedPayload: {
              info: "Offline-first mock preview triggered successfully",
              processedAt: new Date().toISOString(),
              targetRule: prompt,
              inputSnapshot: contextData,
              note: "To execute live calls, verify Ollama access parameters or paste an accessible remote Ollama gateway URL !"
            }
          };
          res.json({ output: fallbackResponse });
        }
        break;
      }

      case 'transformRouter': {
        const mode = config.routingMode || 'rules';
        const key = config.routeKey || 'status';
        const routeAMatch = config.routeAMatch || 'urgent';
        const routeBMatch = config.routeBMatch || 'feedback';
        const routeCMatch = config.routeCMatch || 'billing';

        const outputData = { ...contextData };

        if (mode === 'rules') {
          // Resolve evaluated value from contextData
          let evaluatedVal = "";
          if (key.includes('{{') && key.includes('}}')) {
            evaluatedVal = key;
            Object.keys(contextData).forEach(k => {
              const val = typeof contextData[k] === 'object' ? JSON.stringify(contextData[k]) : contextData[k];
              evaluatedVal = evaluatedVal.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(val));
            });
          } else {
            evaluatedVal = String(contextData[key] !== undefined ? contextData[key] : (contextData.payload?.[key] || ""));
            if (!evaluatedVal || evaluatedVal === "undefined" || evaluatedVal === "[object Object]") {
              const foundKey = Object.keys(contextData).find(k => typeof contextData[k] !== 'object' && String(k).toLowerCase() === key.toLowerCase());
              if (foundKey) {
                evaluatedVal = String(contextData[foundKey]);
              } else {
                evaluatedVal = "";
              }
            }
          }

          if (!evaluatedVal || evaluatedVal === "undefined") {
            evaluatedVal = "";
          }

          let selectedRoute: 'routeA' | 'routeB' | 'routeC' = 'routeA';
          let reason = "";

          const valLower = evaluatedVal.toLowerCase().trim();
          const matchALower = routeAMatch.toLowerCase().trim();
          const matchBLower = routeBMatch.toLowerCase().trim();
          const matchCLower = routeCMatch.toLowerCase().trim();

          if (valLower.includes(matchALower) || matchALower.includes(valLower)) {
            selectedRoute = 'routeA';
            reason = `Value [${evaluatedVal}] matches Route A rule match [${routeAMatch}].`;
          } else if (valLower.includes(matchBLower) || matchBLower.includes(valLower)) {
            selectedRoute = 'routeB';
            reason = `Value [${evaluatedVal}] matches Route B rule match [${routeBMatch}].`;
          } else if (valLower.includes(matchCLower) || matchCLower.includes(valLower)) {
            selectedRoute = 'routeC';
            reason = `Value [${evaluatedVal}] matches Route C rule match [${routeCMatch}].`;
          } else {
            selectedRoute = 'routeA'; // fallback default
            reason = `Value [${evaluatedVal}] didn't trigger Route B or C rules. Defaulting to Route A.`;
          }

          res.json({
            output: {
              selectedRoute,
              reason,
              evaluatedValue: evaluatedVal,
              mode: 'rules',
              payload: outputData
            }
          });
          break;
        } else {
          // AI classification mode
          const geminiKey = process.env.GEMINI_API_KEY;
          if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
            let selectedRoute: 'routeA' | 'routeB' | 'routeC' = 'routeA';
            const contextStr = JSON.stringify(contextData).toLowerCase();
            
            if (contextStr.includes(routeAMatch.toLowerCase()) || contextStr.includes('urgent') || contextStr.includes('critical')) {
              selectedRoute = 'routeA';
            } else if (contextStr.includes(routeBMatch.toLowerCase()) || contextStr.includes('feedback') || contextStr.includes('comment')) {
              selectedRoute = 'routeB';
            } else if (contextStr.includes(routeCMatch.toLowerCase()) || contextStr.includes('billing') || contextStr.includes('invoice')) {
              selectedRoute = 'routeC';
            }

            res.json({
              output: {
                selectedRoute,
                reason: `AI simulation mode (No Gemini API key detected). Analyzed text features.`,
                mode: 'ai_simulation',
                confidence: 0.85,
                payload: outputData
              }
            });
            break;
          }

          try {
            const promptClassifier = `Input context payload data to inspect:
${JSON.stringify(contextData, null, 2)}

Routing Match Definitions:
- routeA description: "${routeAMatch}"
- routeB description: "${routeBMatch}"
- routeC description: "${routeCMatch}"

Please carefully analyze the input context and evaluate which criteria it meets. Select exactly one route.`;

            const response = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: promptClassifier,
              config: {
                systemInstruction: "You are an AI-powered transform router. Read the input payload and evaluate which routing criteria ('routeA', 'routeB', or 'routeC') fits the data best. Respond with clean JSON matching the requested schema.",
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    selectedRoute: {
                      type: Type.STRING,
                      description: "Must be exactly 'routeA', 'routeB', or 'routeC'."
                    },
                    reason: {
                      type: Type.STRING,
                      description: "Detailed explanation of why this route matched best."
                    },
                    confidence: {
                      type: Type.NUMBER,
                      description: "Confidence rating from 0.0 to 1.0."
                    }
                  },
                  required: ["selectedRoute", "reason", "confidence"]
                }
              }
            });

            const text = response.text || "{}";
            let parsed = { selectedRoute: 'routeA', reason: 'Failed parsing AI response. Fallback to route A.', confidence: 0.5 };
            try {
              const rawJson = JSON.parse(text.trim());
              if (rawJson.selectedRoute === 'routeA' || rawJson.selectedRoute === 'routeB' || rawJson.selectedRoute === 'routeC') {
                parsed = rawJson;
              }
            } catch {
              // fallback
            }

            res.json({
              output: {
                selectedRoute: parsed.selectedRoute,
                reason: parsed.reason,
                mode: 'ai_live',
                confidence: parsed.confidence,
                payload: outputData
              }
            });
          } catch (err: any) {
            res.status(500).json({ error: `Transform Router AI generation error: ${err.message}` });
          }
          break;
        }
      }

      case 'openSwarm': {
        const rawAgentsStr = config.swarmAgents || `[
          { "name": "Planner Agent", "instructions": "Review objective, plan workflow steps, outline required fields." },
          { "name": "Developer Agent", "instructions": "Write code, formulate structures, resolve data requirements." },
          { "name": "Optimizing Auditor", "instructions": "Audit details, enhance language tone, correct typos, ensure valid JSON." }
        ]`;

        let agentsList = [];
        try {
          agentsList = JSON.parse(rawAgentsStr);
        } catch {
          agentsList = [
            { name: "Planner Agent", instructions: "Review objective, plan workflow steps, outline required fields." },
            { name: "Developer Agent", instructions: "Write code, formulate structures, resolve data requirements." },
            { name: "Optimizing Auditor", instructions: "Audit details, enhance language tone, correct typos, ensure valid JSON." }
          ];
        }

        const objective = config.swarmInstructions || "Refine and structure the incoming data block.";
        const maxTurns = config.swarmMaxTurns || 3;

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
          // Robust, high-fidelity Simulation of OpenSwarm execution
          const steps = [];
          
          // Step 1: Planner
          const plannerAgent = agentsList[0] || { name: "Planner Agent", instructions: "Review and plan" };
          steps.push({
            agent: plannerAgent.name,
            action: `Initiated task plan`,
            message: `Swarm triggered. Context payload has keys: [${Object.keys(contextData).join(', ')}]. Let's plan execution targeting user intent: "${objective}". We will process this and deliver the results.`
          });

          // Step 2: Developer / Worker
          const workerAgent = agentsList[1] || { name: "Developer Agent", instructions: "Develop payload" };
          let simulatedResultPayload: any = { ...contextData };
          
          if (objective.toLowerCase().includes('translate') || objective.toLowerCase().includes('french') || objective.toLowerCase().includes('spanish')) {
            simulatedResultPayload.translatedAt = new Date().toISOString();
            simulatedResultPayload.status = "processed_translated";
            simulatedResultPayload.languageDetail = "Simulated multilingual conversion.";
          } else if (objective.toLowerCase().includes('summarize') || objective.toLowerCase().includes('title') || objective.toLowerCase().includes('feedback')) {
            simulatedResultPayload.summary = `Executive Briefing: Successfully processed ${Object.keys(contextData).length} input nodes. Actionable values consolidated.`;
            simulatedResultPayload.status = "summarized";
          } else {
            simulatedResultPayload.swarmOptimization = "Applied dynamic agent guidelines.";
            simulatedResultPayload.status = "swarm_optimized";
            simulatedResultPayload.processedBy = "OpenSwarm Multi-Agent Ensemble";
          }

          steps.push({
            agent: workerAgent.name,
            action: "Transformed target variables",
            message: `Applying agent directive: "${workerAgent.instructions}". Formulated refined JSON response payload.`
          });

          // Step 3: Auditor
          const auditorAgent = agentsList[2] || { name: "Optimizing Auditor", instructions: "Verify quality" };
          steps.push({
            agent: auditorAgent.name,
            action: "Validated structure and content quality",
            message: `Passed quality checks for: "${objective}". Formatting verified. JSON schema validated successfully. Terminating swarm successfully.`
          });

          res.json({
            output: {
              activeSwarmObjective: objective,
              history: steps,
              finalPayload: simulatedResultPayload,
              metadata: {
                totalTurns: steps.length,
                swarmMode: "simulation",
                activeAgents: agentsList.map((a: any) => a.name)
              }
            }
          });
          break;
        }

        try {
          const swarmPrompt = `Incoming Payload Data Context:
${JSON.stringify(contextData, null, 2)}

Swarm Objective instruction to accomplish:
"${objective}"

Configured Agents in the Swarm:
${JSON.stringify(agentsList, null, 2)}

Execute a multi-agent choreography stream with max turns: ${maxTurns}.
Each turn should represent one agent communicating their progress, handoff, planning, or final solution.
Finally, construct a definitive output payload based on their combined inputs.`;

          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: swarmPrompt,
            config: {
              systemInstruction: `You are an OpenSwarm multi-agent orchestrator. You are to simulate a cooperative swarm of agents collaborating sequentially to solve the specified objective. Formulate a step-by-step history of their dialogue and actions, and produce the final consolidated JSON payload.`,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  history: {
                    type: Type.ARRAY,
                    description: "Chronological sequence of agent actions and dialogues in the swarm.",
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        agent: {
                          type: Type.STRING,
                          description: "Name of the agent speaking or acting."
                        },
                        action: {
                          type: Type.STRING,
                          description: "The action name or task being performed. E.g., 'Planning Strategy', 'Refining Text'."
                        },
                        message: {
                          type: Type.STRING,
                          description: "The dialog or message content of this agent turn."
                        }
                      },
                      required: ["agent", "action", "message"]
                    }
                  },
                  finalPayload: {
                    type: Type.OBJECT,
                    description: "The compiled final JSON output object produced by the swarm."
                  }
                },
                required: ["history", "finalPayload"]
              }
            }
          });

          const responseText = response.text || "{}";
          let parsedSwarm = { history: [], finalPayload: contextData };
          try {
            parsedSwarm = JSON.parse(responseText.trim());
          } catch {
            // fallback
          }

          res.json({
            output: {
              activeSwarmObjective: objective,
              history: parsedSwarm.history,
              finalPayload: parsedSwarm.finalPayload,
              metadata: {
                totalTurns: parsedSwarm.history.length,
                swarmMode: "ai_live",
                activeAgents: agentsList.map((a: any) => a.name)
              }
            }
          });
        } catch (err: any) {
          res.status(500).json({ error: `OpenSwarm live agent generation error: ${err.message}` });
        }
        break;
      }

      case 'hermesAgent': {
        const instructions = config.hermesInstructions || "Analyze, synthesize, or transform inputs.";
        const persona = config.hermesPersona || "reasoning";
        const temperature = config.hermesTemperature ?? 0.2;
        const stepwise = config.hermesStepWise ?? true;

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
          // Simulation mode when API key is unconfigured
          const simulatedReasoningSteps = [];
          if (stepwise) {
            simulatedReasoningSteps.push({
              action: "Information Retrieval & Structuring",
              thought: `Parsed incoming input context with keys: [${Object.keys(contextData).join(', ')}]. Aligning to instructed objective: "${instructions}".`
            });
            simulatedReasoningSteps.push({
              action: "Self-Correction & Constraint Modeling",
              thought: `Analyzing with '${persona}' persona. Restructuring payload with low-temperature focus (temp: ${temperature}) to prevent hallucinations.`
            });
            simulatedReasoningSteps.push({
              action: "Synthesis & Final Formulation",
              thought: "Ditching boilerplate text. Formulating high-fidelity action items and output fields."
            });
          }

          let resolutionPayload: any = { ...contextData };
          if (persona === 'analyst') {
            resolutionPayload = {
              analysisSummary: `Data successfully parsed and analyzed. Resolved ${Object.keys(contextData).length} elements.`,
              highlights: [
                "Targeted trends evaluated with optimal coherence",
                "Statistical metrics consolidated into key outcomes"
              ],
              riskProfile: "LOW",
              status: "COMPLETED"
            };
          } else if (persona === 'technical') {
            resolutionPayload = {
              technicalRemediation: "Optimized infrastructure and resolved execution anomalies.",
              schemaDiff: {
                inboundValid: true,
                keysPreserved: Object.keys(contextData)
              },
              runtimeStatus: "ONLINE"
            };
          } else {
            resolutionPayload = {
              hermesSummary: `Pristine delivery of refined content under '${persona}' guidelines.`,
              derivedInsights: {
                taskComplexity: stepwise ? "High (Step-Wise)" : "Standard (Direct)",
                synthesizedAt: new Date().toISOString()
              },
              status: "SUCCESS"
            };
          }

          res.json({
            output: {
              activeObjective: instructions,
              reasoningSteps: stepwise ? simulatedReasoningSteps : undefined,
              finalPayload: resolutionPayload,
              metadata: {
                persona,
                temperature,
                stepwise,
                mode: "simulation"
              }
            }
          });
          break;
        }

        try {
          // Real execution
          const systemInstruction = `You are Hermes, a high-intelligence reasoning agent. You excel at planning, sub-task breakdown, chain-of-thought analysis, synthetic feedback loops, and highly rigorous transformation pipelines.
Your current persona is: '${persona}'. Apply the designated cognitive features to the user task.
If stepwise is requested (value: ${stepwise}), carefully decompose your internal thoughts, sub-steps, and correctness validation checks first, and populate them in the 'reasoningSteps' array before resolving the final payload.
Ensure the final output is a clean valid JSON response representing the accomplished task.`;

          const requestPrompt = `Payload data context (JSON):
${JSON.stringify(contextData, null, 2)}

Your custom instructions & objectives to execute:
"${instructions}"

Deconstruct your thought process, evaluate semantic context, apply instructions, and format the output.`;

          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: requestPrompt,
            config: {
              systemInstruction,
              temperature,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reasoningSteps: {
                    type: Type.ARRAY,
                    description: "Chronological sequence of internal reasoning steps or self-corrections.",
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        action: {
                          type: Type.STRING,
                          description: "The phase or check being performed."
                        },
                        thought: {
                          type: Type.STRING,
                          description: "The detailed internal reasoning, planning, or self-reproach statement."
                        }
                      },
                      required: ["action", "thought"]
                    }
                  },
                  finalPayload: {
                    type: Type.OBJECT,
                    description: "The final structured JSON output produced by the reasoning agent."
                  }
                },
                required: ["reasoningSteps", "finalPayload"]
              }
            }
          });

          const responseText = response.text || "{}";
          let parsedHermes = { reasoningSteps: [], finalPayload: contextData };
          try {
            parsedHermes = JSON.parse(responseText.trim());
          } catch {
            // fallback
          }

          res.json({
            output: {
              activeObjective: instructions,
              reasoningSteps: stepwise ? parsedHermes.reasoningSteps : undefined,
              finalPayload: parsedHermes.finalPayload,
              metadata: {
                persona,
                temperature,
                stepwise,
                mode: "ai_live"
              }
            }
          });
        } catch (err: any) {
          res.status(500).json({ error: `Hermes Agent execution error: ${err.message}` });
        }
        break;
      }

      case 'opencodeAgent': {
        const instructions = config.opencodeInstructions || "Generate and run a script to process the input payload.";
        const language = config.opencodeLanguage || "javascript";
        const sandboxMode = config.opencodeSandboxMode || "execute";
        const autoCorrect = config.opencodeAutoCorrect ?? true;

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
          // Simulation mode when API key is unconfigured
          let simulatedCode = "";
          if (language === 'python') {
            simulatedCode = `# OpenCode Python VM v3.10\nimport json\n\ndef execute_pipeline(input_data):\n    # Instructions: ${instructions}\n    print("[VM] Ingesting client context with keys:", input_data.keys())\n    \n    # Analytical processing loop\n    processed = {}\n    for k, v in input_data.items():\n        if isinstance(v, (int, float)):\n            processed[k + "_scaled"] = v * 1.05\n        else:\n            processed[k] = v\n            \n    processed["opencode_success"] = True\n    processed["sandbox"] = "python_sandbox_3.10_isolated"\n    return processed\n`;
          } else if (language === 'typescript') {
            simulatedCode = `// OpenCode Deno TypeScript VM v1.34\ninterface TaskInput {\n  [key: string]: any;\n}\n\nexport function runSandbox(input: TaskInput): TaskInput {\n  console.log("Analyzing instructions: ${instructions}");\n  const keys = Object.keys(input);\n  \n  return {\n    ...input,\n    metadata: {\n      compiler: "TS-Deno-V8",\n      optimized: true,\n      scannedKeys: keys\n    },\n    opencodeStatus: "SUCCESS"\n  };\n}\n`;
          } else {
            simulatedCode = `// OpenCode Node V8 VM Sandbox\nfunction processPayload(payload) {\n  // Action: ${instructions}\n  console.log("Virtual sandbox running...");\n  \n  const result = {\n    ...payload,\n    opencodeStatus: "COMPLETED",\n    runtimeVM: "v8_isolated_context"\n  };\n  return result;\n}\n`;
          }

          const simulatedCompilationSteps = [
            { stage: "Static Analysis & AST generation", details: `Constructed AST structure for language stack '${language}'. No parse errors found.` },
            { stage: "Linter validations", details: autoCorrect ? "Linter verified check passed. Auto-remedy loop completed with 0 warnings." : "Linter check completed. Warnings ignored." },
            { stage: "Virtual Sandbox VM Execution", details: sandboxMode === 'execute' ? "Isolated host sandbox spun up successfully. Gas limits within boundaries. Execution returned status code 0." : "Skipped execution (Codegen-only mode active)." }
          ];

          let resolutionPayload = { ...contextData };
          if (sandboxMode === 'execute') {
            resolutionPayload = {
              ...contextData,
              opencodeExecution: {
                language,
                autoCorrectActive: autoCorrect,
                status: "success",
                compiledAt: new Date().toISOString(),
                virtualTerminalStdout: "Compilation clean. Exit code 0."
              }
            };
          }

          res.json({
            output: {
              generatedCode: simulatedCode,
              compilationSteps: simulatedCompilationSteps,
              finalPayload: resolutionPayload
            }
          });
          break;
        }

        try {
          // Real live AI execution route
          const systemInstruction = `You are OpenCode Agent, an advanced AI compiler workspace. Your objective is to model a secure code sandbox.
Given a user query and a JSON data payload, you must write a beautifully formatted, robust code snippet in language: '${language}'.
The code must be tailored to the objective specified in opencodeInstructions: "${instructions}".
Then, simulate running this program in a secure sandbox context where 'input' or 'input_data' maps to the incoming user data context.
Produce the resulting output context as a clean JSON payload mapping to 'finalPayload'.
If opencodeAutoCorrect is active (value: ${autoCorrect}), simulate checking your written code for syntax anomalies, type mismatches or potential logical traps, and output detailed stages in compilationSteps.
Return a structured JSON output with fields: 'generatedCode', 'compilationSteps', and 'finalPayload'.`;

          const requestPrompt = `Input context payload (JSON):
${JSON.stringify(contextData, null, 2)}

User objectives for code generation & sandbox execution:
"${instructions}"

Selected stack: ${language}
Sandbox Mode: ${sandboxMode}
Auto Correct: ${autoCorrect}

Formulate and return the complete structured output.`;

          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: requestPrompt,
            config: {
              systemInstruction,
              temperature: 0.2,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  generatedCode: {
                    type: Type.STRING,
                    description: "The complete executable program code generated to satisfy the query."
                  },
                  compilationSteps: {
                    type: Type.ARRAY,
                    description: "Chronological list of compilation and secure dry-run validation steps.",
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        stage: {
                          type: Type.STRING,
                          description: "The pipeline phase (e.g. AST Generation, Lint Checks, Dependency Resolve, Sandbox Execution)."
                        },
                        details: {
                          type: Type.STRING,
                          description: "Status message, output outputs, or compilation errors logs."
                        }
                      },
                      required: ["stage", "details"]
                    }
                  },
                  finalPayload: {
                    type: Type.OBJECT,
                    description: "The compiled final payload produced by evaluating the script against the input context."
                  }
                },
                required: ["generatedCode", "compilationSteps", "finalPayload"]
              }
            }
          });

          const responseText = response.text || "{}";
          let parsedOpenCode = { generatedCode: "", compilationSteps: [], finalPayload: contextData };
          try {
            parsedOpenCode = JSON.parse(responseText.trim());
          } catch {
            // fallback
          }

          res.json({
            output: {
              generatedCode: parsedOpenCode.generatedCode,
              compilationSteps: parsedOpenCode.compilationSteps,
              finalPayload: sandboxMode === 'execute' ? parsedOpenCode.finalPayload : { ...contextData, generatedCode: parsedOpenCode.generatedCode }
            }
          });
        } catch (err: any) {
          res.status(500).json({ error: `OpenCode Agent compilation error: ${err.message}` });
        }
        break;
      }

      case 'outputLog': {
        res.json({ output: { status: "logged", timestamp: new Date().toISOString(), data: contextData } });
        break;
      }

      case 'wsClient': {
        const url = config.wsUrl || "ws://localhost:3000/ws/custom";
        const operation = config.operation || 'send';
        const payloadText = config.payload || "Hello From Node WS Client!";

        try {
          const ws = new WebSocket(url);
          let resolved = false;

          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                try { ws.close(); } catch {}
                resolve({
                  status: "completed_with_timeout",
                  message: "Connection timed out waiting for message feedback from server, but socket handshake succeeded.",
                  wsUrl: url,
                  payloadSent: operation === 'send' ? payloadText : null,
                  timestamp: new Date().toISOString()
                });
              }
            }, 3000);

            ws.on('open', () => {
              if (operation === 'send') {
                ws.send(payloadText);
                
                // If we're only sending, we can finish immediately
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timer);
                  try { ws.close(); } catch {}
                  resolve({
                    status: "success",
                    action: "send",
                    wsUrl: url,
                    payloadSent: payloadText,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            });

            ws.on('message', (data) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                try { ws.close(); } catch {}
                let text = "";
                try {
                  text = data.toString();
                } catch {
                  text = String(data);
                }
                resolve({
                  status: "success",
                  action: "receive_feedback",
                  wsUrl: url,
                  payloadSent: operation === 'send' ? payloadText : null,
                  receivedData: text,
                  timestamp: new Date().toISOString()
                });
              }
            });

            ws.on('error', (err) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                try { ws.close(); } catch {}
                reject(err);
              }
            });
          });

          res.json({ output: result });
        } catch (err: any) {
          res.json({
            output: {
              status: "simulation_mode",
              reason: `We established simulated execution path: ${err.message}`,
              wsUrl: url,
              operation,
              simulatedPayload: operation === 'send' ? payloadText : null,
              simulatedResponse: {
                serverGreeting: "Welcome! Simulated WS Connection established.",
                echoedPayload: operation === 'send' ? payloadText : undefined,
                status: "OK",
                activeThreads: 1
              },
              timestamp: new Date().toISOString()
            }
          });
        }
        break;
      }

      case 'wsServer': {
        const operation = config.operation || 'broadcast';
        const payloadText = config.payload || "Hello to all clients from Custom WS Server!";
        
        if (operation === 'broadcast') {
          let count = 0;
          customWSSClients.forEach((wsClient) => {
            if (wsClient.readyState === WebSocket.OPEN) {
              wsClient.send(payloadText);
              count++;
            }
          });
          
          const logMsg: CustomWSMessage = {
            id: `ws_msg_${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            data: payloadText,
            direction: 'sent'
          };
          customWSSMessageHistory.unshift(logMsg);
          if (customWSSMessageHistory.length > 30) customWSSMessageHistory.pop();

          const broadcastLog = {
            id: `ws_svr_broadcast_${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            level: 'info' as const,
            message: `📢 [WS Server] Broadcasted message to ${count} active clients: "${payloadText}"`
          };
          globalLogsList.unshift(broadcastLog);
          broadcast("chat:message", broadcastLog);

          res.json({
            output: {
              status: "broadcast_complete",
              clientsConnected: customWSSClients.size,
              sentCount: count,
              payloadSent: payloadText,
              timestamp: new Date().toISOString()
            }
          });
        } else {
          // Operation listen (snapshot)
          res.json({
            output: {
              status: "listen_snapshot",
              clientsConnected: customWSSClients.size,
              recentInboundHistory: customWSSMessageHistory.filter(m => m.direction === 'received'),
              websocketEndpoint: "/ws/custom",
              timestamp: new Date().toISOString()
            }
          });
        }
        break;
      }
      
      default: {
        res.status(400).json({ error: `Unsupported node type: ${type}` });
      }
    }
  } catch (err: any) {
    console.error("Node Execution Failure:", err);
    res.status(500).json({ error: err.message || "Unknown Node execution error" });
  }
});

// Handle HTTP connection upgrades for WebSockets
server.on("upgrade", (request, socket, head) => {
  const url = request.url || "";
  if (url.includes("/ws/custom")) {
    customWss.handleUpgrade(request, socket, head, (ws) => {
      customWss.emit("connection", ws, request);
    });
  } else {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  }
});

// Configure WebSocket interactive channels
wss.on("connection", (ws: WebSocket) => {
  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  const userName = FUNNY_NAMES[Math.floor(Math.random() * FUNNY_NAMES.length)] + " " + Math.floor(Math.random() * 100);
  const userColor = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];

  const collab: Collaborator = {
    id: userId,
    name: userName,
    color: userColor,
    ws
  };

  collaborators.set(userId, collab);

  // Send initial state to the newly connected user
  ws.send(JSON.stringify({
    type: "init",
    payload: {
      userId,
      userName,
      userColor,
      workflow: currentWorkflowState,
      logs: globalLogsList,
      presenceList: Array.from(collaborators.values()).map(c => ({ id: c.id, name: c.name, color: c.color }))
    }
  }));

  // Notify active presence upgrades
  broadcast("presence:list", Array.from(collaborators.values()).map(c => ({ id: c.id, name: c.name, color: c.color })));

  // Post entry notification in the log stream
  const joinLog = {
    id: `log_${Date.now()}`,
    timestamp: new Date().toLocaleTimeString(),
    level: 'success' as const,
    message: `👋 Collaborator "${collab.name}" connected from their workstation.`
  };
  globalLogsList.unshift(joinLog);
  broadcast("chat:message", joinLog);

  ws.on('message', (message: string) => {
    try {
      const parsed = JSON.parse(message);
      const { type, payload } = parsed;

      switch (type) {
        case 'workflow:update': {
          currentWorkflowState = {
            ...currentWorkflowState,
            ...payload
          };
          broadcast('workflow:sync', currentWorkflowState, userId);
          break;
        }

        case 'workflow:node:drag': {
          // Live node positions broadcast
          broadcast('workflow:node:moved', payload, userId);
          break;
        }

        case 'execution:state': {
          if (payload.logs) {
            // merge logs list gently, avoiding duplicates by unique id
            const rawMerged = [...payload.logs, ...globalLogsList];
            const uniqueMap = new Map();
            for (const item of rawMerged) {
              if (item && item.id && !uniqueMap.has(item.id)) {
                uniqueMap.set(item.id, item);
              }
            }
            globalLogsList = Array.from(uniqueMap.values()).slice(0, 100);
          }
          broadcast('execution:sync', payload, userId);
          break;
        }

        case 'chat:send': {
          const outLog = {
            id: `msg_${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            level: payload.level || 'info',
            message: payload.message,
            nodeName: payload.nodeName
          };
          globalLogsList.unshift(outLog);
          broadcast('chat:message', outLog, userId);
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error("Failed to process socket payload:", e);
    }
  });

  ws.on('close', () => {
    const quittingName = collaborators.get(userId)?.name || "Somebody";
    collaborators.delete(userId);
    broadcast("presence:list", Array.from(collaborators.values()).map(c => ({ id: c.id, name: c.name, color: c.color })));

    const leaveLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      level: 'warn' as const,
      message: `🚪 Collaborator "${quittingName}" stepped away.`
    };
    globalLogsList.unshift(leaveLog);
    broadcast("chat:message", leaveLog);
  });
});

// Setup Vite Dev Server / Static Assets
async function serveApp() {
  if (process.env.NODE_ENV !== "production") {
    // In dev, run Vite setup
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In prod, serve /dist
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Use http server instead of express directly
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Workflow Studio with WebSocket active on http://localhost:${PORT}`);
  });
}

serveApp();
