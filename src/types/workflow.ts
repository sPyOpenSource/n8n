export type NodeType = 'webhook' | 'interval' | 'httpReq' | 'aiTransform' | 'aiFilter' | 'jsCode' | 'customFetch' | 'outputLog' | 'wsClient' | 'wsServer' | 'chatgptTransform' | 'copilotTransform' | 'ollamaTransform' | 'transformRouter' | 'openSwarm';

export type NodeCategory = 'trigger' | 'action' | 'utility' | 'ai';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  category: NodeCategory;
  position: { x: number; y: number };
  config: {
    // webhook/interval
    payload?: string;
    seconds?: number;
    
    // httpReq
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: string;
    body?: string;
    
    // aiTransform
    prompt?: string;
    inputField?: string;
    systemInstruction?: string;
    
    // ChatGPT Transform
    openaiApiKey?: string;
    openaiModel?: string;

    // GitHub Copilot Transform
    githubToken?: string;
    copilotModel?: string;

    // Ollama Transform
    ollamaUrl?: string;
    ollamaModel?: string;

    // Transform Router
    routingMode?: 'rules' | 'ai';
    routeKey?: string;
    routeAMatch?: string;
    routeBMatch?: string;
    routeCMatch?: string;

    // OpenSwarm Agent Orchestrator
    swarmAgents?: string;
    swarmInstructions?: string;
    swarmMaxTurns?: number;
    
    // aiFilter
    condition?: string;
    
    // jsCode
    code?: string;
    
    // customFetch
    source?: 'weather' | 'news' | 'quote' | 'bitcoin';

    // WebSocket client & server
    wsUrl?: string;
    operation?: 'listen' | 'send' | 'broadcast';
  };
}

export interface Connection {
  id: string;
  fromId: string;
  fromPort: 'output' | 'true' | 'false' | 'routeA' | 'routeB' | 'routeC';
  toId: string;
  toPort: 'input';
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: Connection[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  nodeId?: string;
  nodeName?: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  activeNodeId: string | null;
  executedNodes: Record<string, 'success' | 'failed' | 'pending'>;
  nodeOutputs: Record<string, any>; // maps nodeId -> node's final JSON output
  logs: LogEntry[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  workflow: Omit<Workflow, 'id'>;
}
