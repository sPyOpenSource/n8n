import React, { useState, useEffect } from 'react';
import { 
  Workflow, 
  WorkflowNode, 
  Connection, 
  ExecutionState, 
  LogEntry, 
  NodeType, 
  NodeCategory 
} from './types/workflow';
import { TEMPLATES } from './data/templates';
import { executeNodeOnServer } from './utils/workflowEngine';
import Canvas from './components/Canvas';
import { 
  Play, 
  Plus, 
  Flame, 
  Trash2, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  CheckCircle2, 
  XCircle, 
  Settings, 
  Download, 
  Upload, 
  Terminal, 
  AlertTriangle,
  Radio,
  FileText,
  HelpCircle,
  Activity,
  Zap,
  Cpu,
  Globe,
  Compass,
  Code,
  CloudDrizzle,
  BookOpen
} from 'lucide-react';

export default function App() {
  // Current loaded Workflow state
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'studio-workflow',
    name: 'AI Support Sentiment Router',
    description: 'Ingests dynamic support payloads, routes automatically based on negative sentiment or refund demands, and drafts highly tailored recovery templates.',
    nodes: TEMPLATES[0].workflow.nodes as WorkflowNode[],
    connections: TEMPLATES[0].workflow.connections as Connection[],
  });

  // Editor states
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'logs'>('editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  
  // Execution Telemetry
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    activeNodeId: null,
    executedNodes: {},
    nodeOutputs: {},
    logs: [
      {
        id: 'initial_log',
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: '🚀 Visual Workflow Studio active. Load a preset template to experience visual routing.'
      }
    ]
  });

  const [isExecuting, setIsExecuting] = useState(false);

  // Collaborative WebSocket State
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [userColor, setUserColor] = useState<string>('');
  const [collaborators, setCollaborators] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  // Ref to always have the latest socket for callbacks
  const socketRef = React.useRef<WebSocket | null>(null);
  socketRef.current = socket;

  // Emit data to WebSocket server
  const emit = React.useCallback((type: string, payload: any, currentSocket: WebSocket | null = socketRef.current) => {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify({ type, payload }));
    }
  }, []);

  // Sync execution state changes to collaborators
  const updateExecutionStateAndBroadcast = React.useCallback((
    updater: (prev: ExecutionState) => ExecutionState
  ) => {
    setExecutionState(prev => {
      const next = updater(prev);
      emit('execution:state', {
        status: next.status,
        activeNodeId: next.activeNodeId,
        executedNodes: next.executedNodes,
        nodeOutputs: next.nodeOutputs,
        logs: next.logs
      });
      return next;
    });
  }, [emit]);

  // Combined logger that triggers real-time broadcast and list update
  const addLog = React.useCallback((level: LogEntry['level'], message: string, nodeId?: string, nodeName?: string) => {
    const newLog: LogEntry = {
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      nodeId,
      nodeName
    };
    setExecutionState(prev => {
      const logs = [newLog, ...prev.logs].slice(0, 100);
      emit('execution:state', { logs });
      return {
        ...prev,
        logs
      };
    });
  }, [emit]);

  // Main real-time synchronization effect
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketAddress = `${protocol}//${window.location.host}`;
    
    console.log(`Connecting to collaborative websocket channel: ${socketAddress}`);
    const ws = new WebSocket(socketAddress);

    ws.onopen = () => {
      console.log('Successfully established real-time sync channel.');
    };

    ws.onmessage = (event) => {
      try {
        const parsedMessage = JSON.parse(event.data);
        const { type, payload } = parsedMessage;

        switch (type) {
          case 'init': {
            setUserId(payload.userId);
            setUserName(payload.userName);
            setUserColor(payload.userColor);
            setWorkflow(payload.workflow);
            setCollaborators(payload.presenceList);
            if (payload.logs) {
              setExecutionState(prev => ({
                ...prev,
                logs: payload.logs
              }));
            }
            break;
          }

          case 'presence:list': {
            setCollaborators(payload);
            break;
          }

          case 'workflow:sync': {
            setWorkflow(payload);
            break;
          }

          case 'workflow:node:moved': {
            const { nodeId, position } = payload;
            setWorkflow(prev => ({
              ...prev,
              nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, position } : n)
            }));
            break;
          }

          case 'execution:sync': {
            const { status, activeNodeId, executedNodes, nodeOutputs, logs } = payload;
            
            setExecutionState(prev => {
              const updatedState = { ...prev };
              if (status !== undefined) updatedState.status = status;
              if (activeNodeId !== undefined) updatedState.activeNodeId = activeNodeId;
              if (executedNodes !== undefined) {
                updatedState.executedNodes = { ...prev.executedNodes, ...executedNodes };
              }
              if (nodeOutputs !== undefined) {
                updatedState.nodeOutputs = { ...prev.nodeOutputs, ...nodeOutputs };
              }
              if (logs !== undefined) {
                updatedState.logs = logs;
              }
              return updatedState;
            });

            if (status === 'running') {
              setIsExecuting(true);
            } else if (status === 'completed' || status === 'failed' || status === 'idle') {
              setIsExecuting(false);
            }
            break;
          }

          case 'chat:message': {
            setExecutionState(prev => ({
              ...prev,
              logs: [payload, ...prev.logs].slice(0, 100)
            }));
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('WebSocket payload parse failed:', err);
      }
    };

    ws.onclose = () => {
      console.log('Websocket closed. Reconnecting in 3s...');
      setTimeout(() => {
        setReconnectTrigger(prev => prev + 1);
      }, 3000);
    };

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, [reconnectTrigger]);

  // Find Currently selected node
  const selectedNode = workflow.nodes.find(n => n.id === selectedNodeId);

  // Auto select first node on load if none selected
  useEffect(() => {
    if (workflow.nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(workflow.nodes[0].id);
    }
  }, [workflow.nodes]);

  // Handle preset load
  const loadTemplate = (templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    
    const nextWf = {
      id: `workflow_${Date.now()}`,
      name: template.name,
      description: template.description,
      nodes: JSON.parse(JSON.stringify(template.workflow.nodes)),
      connections: JSON.parse(JSON.stringify(template.workflow.connections))
    };
    setWorkflow(nextWf);
    emit('workflow:update', nextWf);

    setExecutionState({
      status: 'idle',
      activeNodeId: null,
      executedNodes: {},
      nodeOutputs: {},
      logs: [
        {
          id: `log_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          level: 'success',
          message: `🎯 Hot-loaded workflow preset template: "${template.name}" successfully.`
        }
      ]
    });

    // Auto select first node
    if (template.workflow.nodes.length > 0) {
      setSelectedNodeId(template.workflow.nodes[0].id);
    }
  };

  // Node creations catalog
  const NODE_CATALOG = [
    {
      type: 'webhook' as NodeType,
      category: 'trigger' as NodeCategory,
      name: 'Webhook Ingest',
      description: 'Trigger payload webhook container',
      icon: <Globe className="w-5 h-5 text-emerald-400" />,
      defaultConfig: { payload: JSON.stringify({ event: 'purchase_created', customerEmail: 'test@example.com', amount: 89.99 }, null, 2) } as WorkflowNode['config']
    },
    {
      type: 'interval' as NodeType,
      category: 'trigger' as NodeCategory,
      name: 'Interval Clock',
      description: 'Trigger actions on continuous delay',
      icon: <Activity className="w-5 h-5 text-emerald-400" />,
      defaultConfig: { seconds: 15, payload: JSON.stringify({ triggerType: 'cron_pulse', priority: 'standard' }, null, 2) } as WorkflowNode['config']
    },
    {
      type: 'customFetch' as NodeType,
      category: 'trigger' as NodeCategory,
      name: 'Live Client puller',
      description: 'Pull from active weather, bitcoin rates or news API streams',
      icon: <CloudDrizzle className="w-5 h-5 text-emerald-400" />,
      defaultConfig: { source: 'news' } as WorkflowNode['config']
    },
    {
      type: 'httpReq' as NodeType,
      category: 'action' as NodeCategory,
      name: 'HTTP Endpoint request',
      description: 'Call external web JSON API',
      icon: <Compass className="w-5 h-5 text-blue-400" />,
      defaultConfig: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/1', headers: '{}', body: '' } as WorkflowNode['config']
    },
    {
      type: 'aiTransform' as NodeType,
      category: 'ai' as NodeCategory,
      name: 'Gemini AI transform',
      description: 'Instruct smart generative model directly',
      icon: <Cpu className="w-5 h-5 text-purple-400" />,
      defaultConfig: { prompt: 'Format customer context dynamically standard response.', systemInstruction: 'You are professional Customer Success Lead' } as WorkflowNode['config']
    },
    {
      type: 'aiFilter' as NodeType,
      category: 'ai' as NodeCategory,
      name: 'Gemini AI filter',
      description: 'Evaluate conditions to route paths (True/False)',
      icon: <Settings className="w-5 h-5 text-purple-400" />,
      defaultConfig: { condition: 'Data implies urgent request.' } as WorkflowNode['config']
    },
    {
      type: 'jsCode' as NodeType,
      category: 'utility' as NodeCategory,
      name: 'Custom Javascript routine',
      description: 'Write manual mappings & transforms',
      icon: <Code className="w-5 h-5 text-amber-400" />,
      defaultConfig: { code: 'return {\n  ...input,\n  timestamp: new Date().toISOString(),\n  processed: true\n};' } as WorkflowNode['config']
    },
    {
      type: 'outputLog' as NodeType,
      category: 'utility' as NodeCategory,
      name: 'Persistence storage Logger',
      description: 'Print final payload summaries',
      icon: <BookOpen className="w-5 h-5 text-slate-300" />,
      defaultConfig: {} as WorkflowNode['config']
    }
  ];

  // Search filtered catalog
  const filteredCatalog = NODE_CATALOG.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Spawn new Node on Canvas center viewport
  const addNewNode = (item: typeof NODE_CATALOG[0]) => {
    // Offset standard positions to prevent exact overlaps
    const count = workflow.nodes.length;
    const offset = (count % 5) * 40;
    
    const newNode: WorkflowNode = {
      id: `${item.type}_${Date.now()}`,
      type: item.type,
      name: `${item.name} #${count + 1}`,
      category: item.category,
      position: { x: 120 + offset, y: 150 + offset },
      config: { ...item.defaultConfig }
    };

    setWorkflow(prev => {
      const next = {
        ...prev,
        nodes: [...prev.nodes, newNode]
      };
      emit('workflow:update', next);
      return next;
    });

    setSelectedNodeId(newNode.id);
    addLog('info', `Added new node to workspace: "${newNode.name}"`);
  };

  // Modify currently edited active node config
  const updateNodeConfig = (updates: Partial<WorkflowNode['config']>) => {
    if (!selectedNodeId) return;
    setWorkflow(prev => {
      const next = {
        ...prev,
        nodes: prev.nodes.map(n => n.id === selectedNodeId ? { ...n, config: { ...n.config, ...updates } } : n)
      };
      emit('workflow:update', next);
      return next;
    });
  };

  const updateNodeName = (name: string) => {
    if (!selectedNodeId) return;
    setWorkflow(prev => {
      const next = {
        ...prev,
        nodes: prev.nodes.map(n => n.id === selectedNodeId ? { ...n, name } : n)
      };
      emit('workflow:update', next);
      return next;
    });
  };

  // Run the whole visual sequence topologically
  const runVisualWorkflow = async () => {
    if (isExecuting) return;
    setIsExecuting(true);

    addLog('info', '⚙️ Visual execution initiated. Preparing topological sort and dependency checking...');

    setExecutionState(prev => ({
      ...prev,
      status: 'running',
      activeNodeId: null,
      executedNodes: {},
      nodeOutputs: {}
    }));

    // Find trigger start points or free nodes
    let startNodes = workflow.nodes.filter(n => n.category === 'trigger');
    if (startNodes.length === 0 && workflow.nodes.length > 0) {
      // Find nodes with no incoming connections
      const targetIds = workflow.connections.map(c => c.toId);
      const roots = workflow.nodes.filter(n => !targetIds.includes(n.id));
      startNodes = roots.length > 0 ? [roots[0]] : [workflow.nodes[0]];
    }

    if (startNodes.length === 0) {
      addLog('error', 'Execution halted: Node architecture has no entry triggers or starting positions.');
      setExecutionState(prev => ({ ...prev, status: 'failed' }));
      setIsExecuting(false);
      return;
    }

    const queue: string[] = startNodes.map(n => n.id);
    const outputs: Record<string, any> = {};
    const executed: Record<string, 'success' | 'failed' | 'pending'> = {};

    queue.forEach(id => { executed[id] = 'pending'; });

    let hasFailed = false;

    while (queue.length > 0 && !hasFailed) {
      const currentNodeId = queue.shift()!;
      const node = workflow.nodes.find(n => n.id === currentNodeId);
      if (!node) continue;

      setExecutionState(prev => ({
        ...prev,
        activeNodeId: currentNodeId,
        executedNodes: { ...prev.executedNodes, [currentNodeId]: 'pending' }
      }));

      addLog('info', `Active executor running: [${node.name}]...`, node.id, node.name);
      
      // Delay slightly mock visualization
      await new Promise(resolve => setTimeout(resolve, 900));

      try {
        const finalOutputResult = await executeNodeOnServer(node, outputs);
        outputs[currentNodeId] = finalOutputResult;
        executed[currentNodeId] = 'success';

        addLog('success', `✔ [${node.name}] completed. Output generated: ${JSON.stringify(finalOutputResult).slice(0, 100)}...`, node.id, node.name);

        setExecutionState(prev => ({
          ...prev,
          executedNodes: { ...prev.executedNodes, [currentNodeId]: 'success' },
          nodeOutputs: { ...prev.nodeOutputs, [currentNodeId]: finalOutputResult }
        }));

        // Trace and push connected children paths
        const outputConnections = workflow.connections.filter(c => c.fromId === currentNodeId);

        outputConnections.forEach(conn => {
          let followPath = true;

          // If AI conditional filter checking, read dynamic decision
          if (node.type === 'aiFilter') {
            const resultSatisfied = !!finalOutputResult.satisfied;
            if (conn.fromPort === 'true' && !resultSatisfied) followPath = false;
            if (conn.fromPort === 'false' && resultSatisfied) followPath = false;

            if (followPath) {
              addLog('info', `Decision router chose branch: [${conn.fromPort.toUpperCase()}] -> to destination [${workflow.nodes.find(n => n.id === conn.toId)?.name}]`, node.id, node.name);
            }
          }

          if (followPath) {
            if (!queue.includes(conn.toId) && executed[conn.toId] !== 'success') {
              queue.push(conn.toId);
              executed[conn.toId] = 'pending';
            }
          }
        });

      } catch (err: any) {
        executed[currentNodeId] = 'failed';
        hasFailed = true;
        addLog('error', `❌ Execution error on node "${node.name}": ${err.message || err}`, node.id, node.name);

        setExecutionState(prev => ({
          ...prev,
          status: 'failed',
          activeNodeId: null,
          executedNodes: { ...prev.executedNodes, [currentNodeId]: 'failed' }
        }));
        break;
      }
    }

    setExecutionState(prev => ({
      ...prev,
      status: hasFailed ? 'failed' : 'completed',
      activeNodeId: null
    }));
    setIsExecuting(false);
  };

  // Test executing a Single Node standalone
  const testSingleNode = async () => {
    if (!selectedNodeId || !selectedNode) return;
    addLog('info', `Running single node testing routine for: "${selectedNode.name}"`);
    
    setExecutionState(prev => ({
      ...prev,
      activeNodeId: selectedNodeId,
      executedNodes: { ...prev.executedNodes, [selectedNodeId]: 'pending' }
    }));

    try {
      // Stub inputs context from previous execution state or dummy object
      const compiledOutputsContext = { ...executionState.nodeOutputs };
      const output = await executeNodeOnServer(selectedNode, compiledOutputsContext);

      addLog('success', `🌟 Testing verified success! Output context captured.`, selectedNode.id, selectedNode.name);
      
      setExecutionState(prev => ({
        ...prev,
        activeNodeId: null,
        executedNodes: { ...prev.executedNodes, [selectedNodeId]: 'success' },
        nodeOutputs: { ...prev.nodeOutputs, [selectedNodeId]: output }
      }));
    } catch (err: any) {
      addLog('error', `Single test failed: ${err.message || err}`, selectedNode.id, selectedNode.name);
      setExecutionState(prev => ({
        ...prev,
        activeNodeId: null,
        executedNodes: { ...prev.executedNodes, [selectedNodeId]: 'failed' }
      }));
    }
  };

  // JSON files downloader or trigger manual loaders
  const exportWorkflowJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(workflow, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${workflow.name.toLowerCase().replace(/\s+/g, '_')}_n8n_preset.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    addLog('info', 'Workflow configurations JSON exported to downloads.');
  };

  const clearWorkspace = () => {
    const cleared = {
      id: `workflow_${Date.now()}`,
      name: 'Blank Custom Automation Branch',
      description: 'Start dragging triggers and AI handlers onto the glass grid.',
      nodes: [],
      connections: []
    };
    setWorkflow(cleared);
    emit('workflow:update', cleared);

    setExecutionState({
      status: 'idle',
      activeNodeId: null,
      executedNodes: {},
      nodeOutputs: {},
      logs: [{
        id: `clear_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: 'Deleted all workflow nodes. Canvas cleared.'
      }]
    });
    setSelectedNodeId(null);
  };

  return (
    <div className="w-full h-screen bg-[#020617] text-slate-100 font-sans overflow-hidden relative flex flex-col">
      {/* Mesh Glimmer Blobs in Background */}
      <div className="absolute top-[-10%] left-[-15%] w-[45%] h-[45%] bg-indigo-600/15 rounded-full blur-[140px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none z-0"></div>
      
      {/* Header Bar */}
      <header className="h-16 border-b border-white/10 backdrop-blur-md bg-white/5 flex items-center justify-between px-6 z-20 relative">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 flex items-center justify-center bg-[#741ca1] border border-white/10 rounded-xl shadow-lg shadow-[#741ca1]/30 hover:bg-[#8521b8] transition-colors cursor-pointer select-none">
            <svg 
              viewBox="0 0 100 66" 
              className="w-6.5 h-[18px] text-[#ff637f]" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="7.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <circle cx="20" cy="33" r="8.5" />
              <circle cx="45" cy="33" r="8.5" />
              <circle cx="78" cy="20" r="8.5" />
              <circle cx="78" cy="46" r="8.5" />
              <path d="M 28.5 33 L 36.5 33" />
              <path d="M 53.5 33 C 62 33, 62 20, 69.5 20" />
              <path d="M 53.5 33 C 62 33, 62 46, 69.5 46" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                value={workflow.name} 
                onChange={(e) => {
                  const updated = { ...workflow, name: e.target.value };
                  setWorkflow(updated);
                  emit('workflow:update', updated);
                }}
                className="font-semibold text-white bg-transparent outline-none border-b border-transparent focus:border-white/30 px-1 py-0.5 rounded text-sm transition"
              />
              <span className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest text-slate-400 border border-white/5">Studio Workspace</span>
            </div>
            <p className="text-[10px] text-slate-400 tracking-wide mt-0.5 truncate max-w-sm">{workflow.description}</p>
          </div>
        </div>

        {/* Dynamic running parameters indicator */}
        <div className="flex items-center gap-3">
          {/* Preset Select Dropdown */}
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg p-1">
            <span className="text-[10px] uppercase font-bold text-indigo-300 px-2">Presets:</span>
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => loadTemplate(t.id)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer hover:bg-white/5 ${
                  workflow.name.includes(t.name) 
                    ? 'bg-white/10 text-white shadow-sm border border-white/5' 
                    : 'text-slate-400'
                }`}
              >
                {t.id === 'customer_sentiment_router' ? 'Apology Router' : 'BTC Recapper'}
              </button>
            ))}
          </div>

          {/* Real-time active collaborators avatar list */}
          {collaborators.length > 1 && (
            <div className="flex items-center gap-1.5 bg-white/3 border border-indigo-500/10 px-2.5 py-1 rounded-lg">
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-[9px] uppercase font-bold font-mono tracking-wider text-slate-400">Sync ({collaborators.length}):</span>
              <div className="flex -space-x-1.5 items-center">
                {collaborators.map(c => {
                  const isMe = c.id === userId;
                  return (
                    <div 
                      key={c.id} 
                      title={isMe ? `${c.name} (You)` : c.name}
                      style={{ backgroundColor: c.color }}
                      className={`w-4.5 h-4.5 rounded-full border border-slate-900 flex items-center justify-center text-[8px] font-bold text-slate-950 uppercase relative ${isMe ? 'ring-1 ring-white/60' : ''}`}
                    >
                      {c.name.charAt(0)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="h-8 w-px bg-white/10 mx-1"></div>

          {/* Core Controls */}
          <div className="flex gap-2">
            <button
              onClick={clearWorkspace}
              className="p-2 bg-white/5 text-slate-300 hover:text-white rounded-lg border border-white/10 hover:bg-white/10 transition text-xs flex items-center gap-1.5 font-medium cursor-pointer"
              title="Clean Slate"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
            <button
              onClick={exportWorkflowJson}
              className="p-2 bg-white/5 text-slate-300 hover:text-white rounded-lg border border-white/10 hover:bg-white/10 transition text-xs flex items-center gap-1.5 font-medium cursor-pointer"
              title="Save Preset File"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <button
              onClick={runVisualWorkflow}
              disabled={isExecuting || workflow.nodes.length === 0}
              className={`px-5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-lg transition duration-200 cursor-pointer ${
                isExecuting 
                  ? 'bg-purple-600/40 text-purple-200 cursor-not-allowed shadow-none' 
                  : 'bg-indigo-600 hover:bg-indigo-505 text-white shadow-indigo-600/20 active:scale-95'
              }`}
            >
              <Play className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
              {isExecuting ? 'Executing...' : 'Run Workflow'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Multi Frame Workspace grid */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        
        {/* Left Library Shelf */}
        <aside className={`${leftPanelCollapsed ? "w-0 border-r-0" : "w-68 border-r"} border-white/10 backdrop-blur-xl bg-white/2 z-10 flex flex-col relative overflow-hidden transition-all duration-300 ease-in-out`}>
          <div className="w-68 flex flex-col h-full shrink-0">
            <div className="p-4 border-b border-white/5 bg-white/1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#818cf8]">Node Catalog</span>
              <span className="text-[9px] px-1.5 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-50o/10 font-mono">
                {NODE_CATALOG.length} types
              </span>
            </div>
            <input 
              type="text" 
              placeholder="Search components..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 hover:border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-550 transition"
            />
          </div>

          {/* Node Category Lists */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-thin scrollbar-thumb-white/10">
            {/* Triggers Category */}
            <div className="space-y-2">
              <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-2">1. Triggers & Inputs</h3>
              {filteredCatalog.filter(c => c.category === 'trigger').map(item => (
                <div 
                  key={item.type}
                  onClick={() => addNewNode(item)}
                  className="group flex flex-col p-2.5 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 cursor-pointer hover:border-white/15 transition duration-150 active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition duration-150">{item.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* AI Integration Category */}
            <div className="space-y-2">
              <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-2">2. Intelligent AI Routines</h3>
              {filteredCatalog.filter(c => c.category === 'ai').map(item => (
                <div 
                  key={item.type}
                  onClick={() => addNewNode(item)}
                  className="group flex flex-col p-2.5 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 cursor-pointer hover:border-white/15 transition duration-150 active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition duration-150">{item.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions Category */}
            <div className="space-y-2">
              <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-2">3. End Actions</h3>
              {filteredCatalog.filter(c => c.category === 'action').map(item => (
                <div 
                  key={item.type}
                  onClick={() => addNewNode(item)}
                  className="group flex flex-col p-2.5 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 cursor-pointer hover:border-white/15 transition duration-150 active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition duration-150">{item.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Utilities Category */}
            <div className="space-y-2">
              <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-2">4. Utilities & Scripts</h3>
              {filteredCatalog.filter(c => c.category === 'utility').map(item => (
                <div 
                  key={item.type}
                  onClick={() => addNewNode(item)}
                  className="group flex flex-col p-2.5 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 cursor-pointer hover:border-white/15 transition duration-150 active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition duration-150">{item.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

            <div className="p-3 bg-white/2 border-t border-white/5 text-[9px] font-mono text-slate-500 text-center uppercase tracking-wide">
              Server API Grounding Connected
            </div>
          </div>
        </aside>

        {/* Collapsible Panel Handle Button */}
        <button
          onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
          style={{ left: leftPanelCollapsed ? '0px' : '271px' }}
          className="absolute top-1/2 -translate-y-1/2 w-5 h-10 bg-[#090d16]/95 border-t border-b border-r border-white/10 hover:border-white/20 hover:bg-slate-800 text-slate-400 hover:text-white rounded-r-md flex items-center justify-center cursor-pointer transition-all duration-300 ease-in-out z-20 shadow-md backdrop-blur-md"
          title={leftPanelCollapsed ? "Expand Catalog" : "Collapse Catalog"}
        >
          {leftPanelCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Visual Flow grid Canvas column holds actual mapping canvas */}
        <div className="flex-1 flex flex-col relative">
          <Canvas 
            nodes={workflow.nodes}
            connections={workflow.connections}
            selectedNodeId={selectedNodeId}
            executionState={executionState}
            onUpdateNodes={(nodes) => {
              setWorkflow(prev => ({ ...prev, nodes }));
            }}
            onUpdateConnections={(connections) => {
              const updated = { ...workflow, connections };
              setWorkflow(updated);
              emit('workflow:update', updated);
            }}
            onSelectNode={setSelectedNodeId}
            onNodeDrag={(nodeId, position) => {
              emit('workflow:node:drag', { nodeId, position });
            }}
            onDragEnd={() => {
              emit('workflow:update', workflow);
            }}
          />

          {/* Bottom Execution Telemetry Drawer Console */}
          <div className="h-31 border-t border-white/10 backdrop-blur-xl bg-[#020617]/95 flex flex-col z-10">
            <div className="h-10 border-b border-white/5 bg-white/2 flex items-center justify-between px-6">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-mono">Live Logs & Evaluations Terminal</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-slate-400 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${executionState.status === 'running' ? 'bg-purple-500 animate-ping' : executionState.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                  Engine State: <strong className="uppercase text-slate-200">{executionState.status}</strong>
                </span>
                <button
                  onClick={() => setExecutionState(prev => ({ ...prev, logs: [{ id: 'manual', timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Clear stdout' }] }))}
                  className="text-[10px] font-mono font-bold text-slate-400 hover:text-white hover:bg-white/5 px-2 py-0.5 rounded transition"
                >
                  Clear Console Output
                </button>
              </div>
            </div>

            {/* Logs streams flow list */}
            <div className="flex-1 overflow-y-auto px-6 py-3 font-mono text-xs space-y-1 scrollbar-thin scrollbar-thumb-white/5">
              {executionState.logs.length === 0 ? (
                <div className="text-slate-550 text-center py-8">
                  No execution outputs recorded or evaluations queued. Press "Run Workflow" above.
                </div>
              ) : (
                executionState.logs.map(log => {
                  let alertColor = 'text-slate-300 border-l-2 border-slate-500/35';
                  if (log.level === 'success') alertColor = 'text-emerald-400 border-l-2 border-emerald-500/50';
                  if (log.level === 'warn') alertColor = 'text-orange-300 border-l-2 border-orange-500/50';
                  if (log.level === 'error') alertColor = 'text-red-400 bg-red-950/15 border-l-2 border-red-500/50';

                  return (
                    <div key={log.id} className={`p-1 pl-3.5 mb-1 text-[11px] leading-relaxed transition ${alertColor}`}>
                      <span className="text-slate-500 mr-2 text-[10px] font-semibold">[{log.timestamp}]</span>
                      {log.nodeName && (
                        <span className="bg-indigo-950/40 text-indigo-300 border border-indigo-900/40 px-1 rounded text-[9px] font-bold mr-2 uppercase">
                          {log.nodeName}
                        </span>
                      )}
                      <span>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Panel Handle Button Right */}
        <button
          onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
          style={{ right: rightPanelCollapsed ? '0px' : '319px' }}
          className="absolute top-1/2 -translate-y-1/2 w-5 h-10 bg-[#090d16]/95 border-t border-b border-l border-white/10 hover:border-white/20 hover:bg-slate-800 text-slate-400 hover:text-white rounded-l-md flex items-center justify-center cursor-pointer transition-all duration-300 ease-in-out z-20 shadow-md backdrop-blur-md"
          title={rightPanelCollapsed ? "Expand Properties" : "Collapse Properties"}
        >
          {rightPanelCollapsed ? (
            <ChevronLeft className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Right Configuration Drawer Panel holds details editable config parameters */}
        <aside className={`${rightPanelCollapsed ? "w-0 border-l-0" : "w-80 border-l"} border-white/10 backdrop-blur-xl bg-white/2 z-10 flex flex-col relative overflow-hidden transition-all duration-300 ease-in-out`}>
          <div className="w-80 flex flex-col h-full shrink-0">
            <div className="p-4 border-b border-white/5 bg-white/1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-sm">Component Properties</h2>
            </div>
            {selectedNode && (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-white/15 text-slate-300 rounded uppercase font-bold tracking-wider">
                {selectedNode.type}
              </span>
            )}
          </div>

          {selectedNode ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-white/5">
              {/* Common name editor */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-[#818cf8]">Node Inspector Name</label>
                <input 
                  type="text"
                  value={selectedNode.name}
                  onChange={(e) => updateNodeName(e.target.value)}
                  className="w-full bg-[#030712] border border-white/10 hover:border-white/15 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition font-medium"
                />
              </div>

              {/* Dynamic Type Properties Panel */}
              {selectedNode.type === 'webhook' && (
                <div className="space-y-4">
                  <div className="p-3 bg-indigo-500/10 border border-indigo-505/20 rounded-lg">
                    <h5 className="text-[11px] font-bold text-indigo-300 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-indigo-400" />
                      Incoming Payload (Mock)
                    </h5>
                    <p className="text-[10px] text-slate-400 mt-1">This payload simulates the dynamic properties ingested when a request reaches your URL.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Trigger Body Context JSON</label>
                    <textarea
                      rows={8}
                      value={selectedNode.config.payload || ''}
                      onChange={(e) => updateNodeConfig({ payload: e.target.value })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-[10px] font-mono text-emerald-300 focus:outline-none focus:ring-1 focus:ring-indigo-550 resize-none h-44"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'interval' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Continuous interval Seconds</label>
                      <span className="text-xs font-mono text-emerald-400 font-bold">{selectedNode.config.seconds || 15}s</span>
                    </div>
                    <input 
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={selectedNode.config.seconds || 15}
                      onChange={(e) => updateNodeConfig({ seconds: parseInt(e.target.value) })}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Clock Event Payload</label>
                    <textarea
                      rows={6}
                      value={selectedNode.config.payload || ''}
                      onChange={(e) => updateNodeConfig({ payload: e.target.value })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-[10px] font-mono text-emerald-300 focus:outline-none focus:ring-1 focus:ring-indigo-550 resize-none h-36"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'customFetch' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">Select Source API Feed</label>
                    <select
                      value={selectedNode.config.source || 'news'}
                      onChange={(e) => updateNodeConfig({ source: e.target.value as any })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none cursor-pointer"
                    >
                      <option value="news">Global Technology News Feed</option>
                      <option value="weather">London Weather Station (Live)</option>
                      <option value="bitcoin">CoinDesk Bitcoin Index (Live Price)</option>
                      <option value="quote">Inspirational Automation Quote</option>
                    </select>
                  </div>
                  <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                      This trigger fetches high-fidelity data feeds dynamically during execution, making key variables like weather coordinates or coin values instantly accessible in downstream nodes via the syntax: <br />
                      <code className="text-[10px] font-semibold text-orange-200 mt-1.5 block">{"{{fetch_weather.temp}}"}</code>
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.type === 'httpReq' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <div className="w-24 space-y-1.5">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">METHOD</label>
                      <select
                        value={selectedNode.config.method || 'GET'}
                        onChange={(e) => updateNodeConfig({ method: e.target.value as any })}
                        className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none"
                      >
                        <option>GET</option>
                        <option>POST</option>
                        <option>PUT</option>
                        <option>DELETE</option>
                      </select>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">DESTINATION URL</label>
                      <input 
                        type="text"
                        value={selectedNode.config.url || ''}
                        onChange={(e) => updateNodeConfig({ url: e.target.value })}
                        placeholder="https://api.domain.com/data"
                        className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Headers JSON Object</label>
                    <textarea
                      rows={2}
                      value={selectedNode.config.headers || ''}
                      onChange={(e) => updateNodeConfig({ headers: e.target.value })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-[10px] font-mono text-blue-300 focus:outline-none"
                      placeholder='{ "Authorization": "Bearer key" }'
                    />
                  </div>

                  {['POST', 'PUT', 'DELETE'].includes(selectedNode.config.method || 'GET') && (
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Body Payload template</label>
                      <textarea
                        rows={5}
                        value={selectedNode.config.body || ''}
                        onChange={(e) => updateNodeConfig({ body: e.target.value })}
                        className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-[10px] font-mono text-blue-300 focus:outline-none resize-none"
                        placeholder='{ "title": "New item", "userId": 1 }'
                      />
                    </div>
                  )}
                </div>
              )}

              {selectedNode.type === 'aiTransform' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-[#818cf8]">System System Instruction Prompt</label>
                    <input 
                      type="text"
                      value={selectedNode.config.systemInstruction || ''}
                      onChange={(e) => updateNodeConfig({ systemInstruction: e.target.value })}
                      placeholder="You are a helpful automation system"
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-xs text-slate-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-[#818cf8]">Prompt Instructions</label>
                    <textarea
                      rows={6}
                      value={selectedNode.config.prompt || ''}
                      onChange={(e) => updateNodeConfig({ prompt: e.target.value })}
                      placeholder="e.g. Draft beautiful feedback email to {{name}}."
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none resize-none h-32"
                    />
                  </div>

                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg space-y-1">
                    <h6 className="text-[10px] font-bold text-purple-300 uppercase tracking-widest font-mono">Dynamic Variable Guide</h6>
                    <p className="text-[9px] text-slate-400">
                      Use double curly brackets to interpolate data from preceding nodes!
                      For example: <br />
                      <code className="text-purple-200 block mt-1 font-mono font-bold">{"Hello {{customerName}}"}</code>
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.type === 'aiFilter' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-[#818cf8]">Routing Filter Condition</label>
                    <textarea
                      rows={4}
                      value={selectedNode.config.condition || ''}
                      onChange={(e) => updateNodeConfig({ condition: e.target.value })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none h-24"
                      placeholder="e.g. Checks if customer ticket contains refund request"
                    />
                  </div>
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                    <p className="text-[9px] text-slate-300">
                      We submit this boolean validation prompt directly to a server-side Gemini 1.5 flash agent. The executor branches dynamically to the <strong>TRUE</strong> output port or <strong>FALSE</strong> output port based on this evaluation.
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.type === 'jsCode' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Ruturn JS transformation function</label>
                    <textarea
                      rows={12}
                      value={selectedNode.config.code || ''}
                      onChange={(e) => updateNodeConfig({ code: e.target.value })}
                      className="w-full bg-[#030712] border border-white/10 rounded-lg p-2.5 text-[10px] font-mono text-amber-300 focus:outline-none h-62"
                    />
                  </div>
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-[9px] text-slate-400 leading-relaxed">
                      Transform context JSON records in Node runtime safely. Reference preceding nodes using <code className="text-amber-200">input.name_of_node</code> context wrappers.
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.type === 'outputLog' && (
                <div className="space-y-4">
                  <div className="p-4 bg-white/5 rounded-lg border border-white/10 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-slate-300" />
                    <span className="text-xs font-semibold">Logging Endpoint</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">This node displays compiled logs and outputs evaluated dynamically at the end of the workspace branch trace.</p>
                </div>
              )}

              {/* Single Test Actions */}
              <div className="pt-4 border-t border-white/5">
                <button
                  onClick={testSingleNode}
                  disabled={isExecuting}
                  className="w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs font-semibold cursor-pointer transition active:scale-95 disabled:opacity-40"
                >
                  Test Single Step execution
                </button>
              </div>

              {/* Dynamic previous run output preview block */}
              {executionState.nodeOutputs[selectedNode.id] && (
                <div className="pt-4 space-y-1.5 border-t border-white/5">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-[#34d399] block font-mono">Last Evaluated JSON Output</label>
                  <pre className="p-2.5 bg-[#030712] border border-emerald-500/20 rounded-lg text-[9px] font-mono text-emerald-400 overflow-x-auto max-h-56 scrollbar-thin">
                    {JSON.stringify(executionState.nodeOutputs[selectedNode.id], null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-500 text-center space-y-2">
              <HelpCircle className="w-8 h-8 text-white/5" />
              <p className="text-xs">No active node selected on the canvas grid.</p>
              <p className="text-[10px] text-slate-600">Double click background or click an existing node card to configure endpoints.</p>
            </div>
          )}

          {/* Persistent Workspace telemetry cost */}
          {selectedNode && (
            <div className="mt-auto p-4 bg-indigo-500/5 border-t border-indigo-500/10 relative">
              <div className="flex items-center justify-between text-[11px] mb-1.5 text-slate-300">
                <span className="text-indigo-300 font-medium">Evaluation Speed index</span>
                <span className="font-mono text-[10px]">~230ms / iteration</span>
              </div>
              <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="w-[82%] h-full bg-gradient-to-r from-indigo-500 to-purple-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
              </div>
            </div>
          )}
          </div>
        </aside>

      </div>
    </div>
  );
}
