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
      
      case 'outputLog': {
        res.json({ output: { status: "logged", timestamp: new Date().toISOString(), data: contextData } });
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
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
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
            // merge logs list gently
            globalLogsList = [...payload.logs, ...globalLogsList].slice(0, 100);
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
