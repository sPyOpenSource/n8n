import React, { useState, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { 
  WorkflowNode, 
  Connection, 
  ExecutionState 
} from '../types/workflow';
import { 
  Play, 
  X, 
  Check, 
  AlertTriangle, 
  Compass, 
  Globe, 
  Cpu, 
  Code, 
  Settings, 
  TrendingUp, 
  CloudDrizzle, 
  BookOpen, 
  Flame, 
  Activity, 
  CornerDownRight, 
  Trash2,
  ZoomIn,
  ZoomOut,
  Wifi,
  Server,
  Sparkles,
  Bot,
  GitBranch,
  Network
} from 'lucide-react';

interface CanvasProps {
  nodes: WorkflowNode[];
  connections: Connection[];
  selectedNodeId: string | null;
  executionState: ExecutionState;
  onUpdateNodes: (nodes: WorkflowNode[]) => void;
  onUpdateConnections: (connections: Connection[]) => void;
  onSelectNode: (nodeId: string | null) => void;
  onNodeDrag?: (nodeId: string, position: { x: number, y: number }) => void;
  onDragEnd?: () => void;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 90;

export default function Canvas({
  nodes,
  connections,
  selectedNodeId,
  executionState,
  onUpdateNodes,
  onUpdateConnections,
  onSelectNode,
  onNodeDrag,
  onDragEnd,
}: CanvasProps) {
  // Canvas viewing coordinates (pan and zoom fully synced with D3)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomBehaviorRef = useRef<any>(null);

  // Active drag states
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [activeWire, setActiveWire] = useState<{
    fromId: string;
    fromPort: 'output' | 'true' | 'false' | 'routeA' | 'routeB' | 'routeC';
    currentX: number;
    currentY: number;
  } | null>(null);

  // Bind D3.js zoom behavior
  useEffect(() => {
    if (!canvasRef.current) return;
    const view = d3.select(canvasRef.current);

    const zoomBehavior = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.5, 2.0])
      .filter((event) => {
        // Prevent background panning when user drags nodes, ports, links, delete button, or controls
        return !event.ctrlKey && !event.button && 
               !event.target.closest('.port-handler') && 
               !event.target.closest('[id^="node-"]') && 
               !event.target.closest('[id^="delete-btn-"]') &&
               !event.target.closest('#canvas-zoom-controls');
      })
      .on('zoom', (event) => {
        setPan({ x: event.transform.x, y: event.transform.y });
        setZoom(event.transform.k);
      });

    zoomBehaviorRef.current = zoomBehavior;
    view.call(zoomBehavior);

    // Initial positioning coordinate system
    view.call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(pan.x, pan.y).scale(zoom)
    );

    // Disable double-click-to-zoom default to prevent collision with custom reset
    view.on('dblclick.zoom', null);

    return () => {
      view.on('.zoom', null);
    };
  }, []);

  // Keyboard binding for deleting selected node
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedNodeId && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Only delete if we are not typing in an input/textarea
        const activeElem = document.activeElement;
        if (activeElem && ['INPUT', 'TEXTAREA'].includes(activeElem.tagName)) {
          return;
        }
        deleteNode(selectedNodeId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, nodes, connections]);

  // Handle click on canvas background to deselect active items
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      onSelectNode(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (draggingNodeId) {
      // Scale drag displacement offsets by the inverse of scale zoom
      const clientX = e.clientX;
      const clientY = e.clientY;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const relativeX = (clientX - rect.left - pan.x) / zoom - dragOffset.current.x;
      const relativeY = (clientY - rect.top - pan.y) / zoom - dragOffset.current.y;

      // Restrict node translation alignment to 10px snap increments
      const snappedX = Math.round(relativeX / 10) * 10;
      const snappedY = Math.round(relativeY / 10) * 10;

      onUpdateNodes(
        nodes.map(n => n.id === draggingNodeId ? { ...n, position: { x: snappedX, y: snappedY } } : n)
      );

      if (onNodeDrag) {
        onNodeDrag(draggingNodeId, { x: snappedX, y: snappedY });
      }
    } else if (activeWire) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursorX = (e.clientX - rect.left - pan.x) / zoom;
      const cursorY = (e.clientY - rect.top - pan.y) / zoom;
      setActiveWire({ ...activeWire, currentX: cursorX, currentY: cursorY });
    }
  };

  const handleCanvasMouseUp = () => {
    if (draggingNodeId && onDragEnd) {
      onDragEnd();
    }
    setDraggingNodeId(null);
    setActiveWire(null);
  };

  // Dragging connection starts
  const handlePortMouseDown = (
    e: React.MouseEvent,
    nodeId: string,
    port: 'output' | 'true' | 'false' | 'routeA' | 'routeB' | 'routeC'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    let portX = node.position.x + NODE_WIDTH;
    let portY = node.position.y + NODE_HEIGHT / 2;

    if (node.type === 'aiFilter') {
      portY = port === 'true' ? node.position.y + 25 : node.position.y + NODE_HEIGHT - 25;
    } else if (node.type === 'transformRouter') {
      if (port === 'routeA') {
        portY = node.position.y + 20;
      } else if (port === 'routeB') {
        portY = node.position.y + 45;
      } else if (port === 'routeC') {
        portY = node.position.y + 70;
      }
    }

    setActiveWire({
      fromId: nodeId,
      fromPort: port,
      currentX: portX,
      currentY: portY
    });
  };

  // Connection releases over input port
  const handleInputPortMouseUp = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation();
    if (!activeWire) return;
    if (activeWire.fromId === targetNodeId) {
      setActiveWire(null);
      return;
    }

    // Check if duplicate connection exists
    const duplicate = connections.find(c => 
      c.fromId === activeWire.fromId && 
      c.fromPort === activeWire.fromPort && 
      c.toId === targetNodeId
    );

    if (!duplicate) {
      const newConnection: Connection = {
        id: `conn_${Date.now()}__${Math.random().toString(36).substr(2, 4)}`,
        fromId: activeWire.fromId,
        fromPort: activeWire.fromPort,
        toId: targetNodeId,
        toPort: 'input'
      };
      onUpdateConnections([...connections, newConnection]);
    }
    setActiveWire(null);
  };

  // Programmatically change zoom
  const handleZoomIn = () => {
    if (!canvasRef.current || !zoomBehaviorRef.current) return;
    const nextZoom = Math.min(1.5, zoom + 0.1);
    d3.select(canvasRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.scaleTo, nextZoom);
  };

  const handleZoomOut = () => {
    if (!canvasRef.current || !zoomBehaviorRef.current) return;
    const nextZoom = Math.max(0.6, zoom - 0.1);
    d3.select(canvasRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.scaleTo, nextZoom);
  };

  const handleZoomReset = () => {
    if (!canvasRef.current || !zoomBehaviorRef.current) return;
    d3.select(canvasRef.current)
      .transition()
      .duration(300)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity.translate(50, 50).scale(1)
      );
  };

  // Double click on canvas resets view
  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      handleZoomReset();
    }
  };

  // High-performance D3 Force-directed topological workflow alignment algorithm
  const runAutoLayout = () => {
    if (nodes.length === 0) return;

    // 1. Map adjacencies and in-degree scores
    const inDegree: { [id: string]: number } = {};
    const adjList: { [id: string]: string[] } = {};

    nodes.forEach(node => {
      inDegree[node.id] = 0;
      adjList[node.id] = [];
    });

    connections.forEach(conn => {
      if (adjList[conn.fromId]) {
        adjList[conn.fromId].push(conn.toId);
      }
      if (inDegree[conn.toId] !== undefined) {
        inDegree[conn.toId]++;
      }
    });

    const depths: { [id: string]: number } = {};
    const queue: string[] = [];

    // Identify roots/entry nodes starting at depth 0
    nodes.forEach(node => {
      if (inDegree[node.id] === 0 || node.category === 'trigger') {
        depths[node.id] = 0;
        queue.push(node.id);
      }
    });

    // BFS depth assignment to model layers topological sequential order
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currDepth = depths[currId] || 0;
      adjList[currId]?.forEach(targetId => {
        const nextDepth = currDepth + 1;
        if (depths[targetId] === undefined || nextDepth > depths[targetId]) {
          depths[targetId] = nextDepth;
          queue.push(targetId);
        }
      });
    }

    // Default depth for detached components or edge items
    nodes.forEach(node => {
      if (depths[node.id] === undefined) {
        depths[node.id] = 0;
      }
    });

    const layerNodes: { [depth: number]: string[] } = {};
    nodes.forEach(node => {
      const d = depths[node.id];
      if (!layerNodes[d]) layerNodes[d] = [];
      layerNodes[d].push(node.id);
    });

    // Instantiate temporary coordinates for D3 simulation
    const simNodes = nodes.map(node => {
      const depth = depths[node.id];
      const indexInLayer = layerNodes[depth].indexOf(node.id);
      return {
        id: node.id,
        x: depth * 280 + 100,
        y: indexInLayer * 140 + 100,
        nodeCopy: { ...node }
      };
    });

    // 2. Perform simultaneous force-directed physics iterations (stops overlapping and keeps flows orderly)
    const simulation = d3.forceSimulation<any>(simNodes)
      .force('charge', d3.forceManyBody().strength(-350))
      .force('collision', d3.forceCollide().radius(130))
      .force('y', d3.forceY().y((d: any) => {
        const depth = depths[d.id];
        const idxInLayer = layerNodes[depth].indexOf(d.id);
        const total = layerNodes[depth].length;
        return (idxInLayer - (total - 1) / 2) * 140 + 250;
      }).strength(0.85))
      .force('x', d3.forceX().x((d: any) => depths[d.id] * 300 + 100).strength(1.1))
      .stop();

    // Synchronously iterate graph physics ticks for immediate execution result rendering
    for (let i = 0; i < 160; i++) simulation.tick();

    // 3. Persist and align layout node coordinates
    const updatedNodes = simNodes.map(s => {
      const snapX = Math.max(50, Math.round(s.x / 10) * 10);
      const snapY = Math.max(50, Math.round(s.y / 10) * 10);
      return {
        ...s.nodeCopy,
        position: { x: snapX, y: snapY }
      };
    });

    onUpdateNodes(updatedNodes);

    // Transitions to comfortably center layout inside viewport
    if (canvasRef.current && zoomBehaviorRef.current) {
      d3.select(canvasRef.current)
        .transition()
        .duration(450)
        .ease(d3.easeCubicOut)
        .call(
          zoomBehaviorRef.current.transform,
          d3.zoomIdentity.translate(60, 60).scale(1)
        );
    }
  };

  const deleteNode = (id: string) => {
    onUpdateNodes(nodes.filter(n => n.id !== id));
    // Remove references inside connections
    onUpdateConnections(connections.filter(c => c.fromId !== id && c.toId !== id));
    if (selectedNodeId === id) {
      onSelectNode(null);
    }
  };

  const deleteConnection = (e: React.MouseEvent, connId: string) => {
    e.stopPropagation();
    onUpdateConnections(connections.filter(c => c.id !== connId));
  };

  // Calculate icon mapping
  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'webhook': return <Globe className="w-5 h-5 text-emerald-400" />;
      case 'interval': return <Activity className="w-5 h-5 text-emerald-400" />;
      case 'httpReq': return <Compass className="w-5 h-5 text-blue-400" />;
      case 'aiTransform': return <Cpu className="w-5 h-5 text-purple-400" />;
      case 'chatgptTransform': return <Sparkles className="w-5 h-5 text-pink-400" />;
      case 'copilotTransform': return <Bot className="w-5 h-5 text-sky-400" />;
      case 'ollamaTransform': return <Cpu className="w-5 h-5 text-emerald-400" />;
      case 'aiFilter': return <Settings className="w-5 h-5 text-purple-400" />;
      case 'transformRouter': return <GitBranch className="w-5 h-5 text-indigo-400" />;
      case 'openSwarm': return <Network className="w-5 h-5 text-teal-400" />;
      case 'hermesAgent': return <Flame className="w-5 h-5 text-amber-500 animate-pulse" />;
      case 'jsCode': return <Code className="w-5 h-5 text-amber-400" />;
      case 'customFetch': return <CloudDrizzle className="w-5 h-5 text-orange-400" />;
      case 'outputLog': return <BookOpen className="w-5 h-5 text-slate-300" />;
      case 'wsClient': return <Wifi className="w-5 h-5 text-cyan-400" />;
      case 'wsServer': return <Server className="w-5 h-5 text-indigo-400" />;
      default: return <Cpu className="w-5 h-5 text-slate-400" />;
    }
  };

  // Node header styles depending on Category
  const getHeaderStyle = (category: string) => {
    switch (category) {
      case 'trigger': return 'bg-emerald-500/20 border-emerald-500/30 text-emerald-200';
      case 'action': return 'bg-blue-500/20 border-blue-500/30 text-blue-200';
      case 'ai': return 'bg-purple-500/20 border-purple-500/30 text-purple-200';
      case 'utility': return 'bg-amber-500/20 border-amber-500/30 text-amber-200';
      default: return 'bg-white/10 border-white/15 text-slate-200';
    }
  };

  return (
    <div className="flex-1 relative bg-transparent overflow-hidden select-none border-r border-white/10" id="canvas-container">
      {/* Top Controls Overlay */}
      <div className="absolute top-4 left-4 z-10 flex gap-2 items-center" id="canvas-zoom-controls">
        <button 
          onClick={handleZoomIn}
          className="p-2 bg-white/5 text-white backdrop-blur-md rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 active:scale-95 cursor-pointer"
          title="Zoom In"
          id="btn-zoom-in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button 
          onClick={handleZoomOut}
          className="p-2 bg-white/5 text-white backdrop-blur-md rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 active:scale-95 cursor-pointer"
          title="Zoom Out"
          id="btn-zoom-out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button 
          onClick={handleZoomReset}
          className="px-3 py-1.5 bg-white/5 text-xs text-white backdrop-blur-md font-semibold rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 cursor-pointer"
          title="Reset View"
          id="btn-zoom-reset"
        >
          Reset ({Math.round(zoom * 100)}%)
        </button>

        <div className="w-[1px] h-6 bg-white/10 mx-1" />

        {/* Dynamic D3 Layout Trigger */}
        <button 
          onClick={runAutoLayout}
          className="px-3 py-1.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-200 hover:text-white backdrop-blur-md font-semibold text-xs rounded-lg shadow-lg border border-indigo-500/30 hover:border-indigo-400/50 hover:from-indigo-500/30 hover:to-purple-500/30 transition duration-150 flex items-center gap-1.5 cursor-pointer"
          title="Auto-Arrange Workflow with D3 Force Simulation"
          id="btn-auto-layout"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span>D3 Auto-Layout</span>
        </button>
      </div>

      {/* Navigation Instruction Hint */}
      <div className="absolute bottom-4 left-4 z-10 text-[10px] font-mono text-slate-400 pointer-events-none" id="canvas-hint">
        PAN: Left-Click & Drag Canvas background • SELECT: Click Node • DELETE: Click Node & press (Delete/Backspace)
      </div>

      {/* Actual Pan & Zoom viewport */}
      <div
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing relative"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onDoubleClick={handleCanvasDoubleClick}
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1.2px, transparent 1.2px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        id="canvas-viewport"
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className="absolute inset-0 pointer-events-none"
        >
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-[5000px] h-[5000px] overflow-visible pointer-events-none z-0">
            {/* Draw active connections */}
            {connections.map((conn) => {
              const fromNode = nodes.find(n => n.id === conn.fromId);
              const toNode = nodes.find(n => n.id === conn.toId);
              if (!fromNode || !toNode) return null;

              // Calculate exact coordinates
              let startX = fromNode.position.x + NODE_WIDTH;
              let startY = fromNode.position.y + NODE_HEIGHT / 2;

              if (fromNode.type === 'aiFilter') {
                startY = conn.fromPort === 'true' 
                  ? fromNode.position.y + 25 
                  : fromNode.position.y + NODE_HEIGHT - 25;
              } else if (fromNode.type === 'transformRouter') {
                if (conn.fromPort === 'routeA') {
                  startY = fromNode.position.y + 20;
                } else if (conn.fromPort === 'routeB') {
                  startY = fromNode.position.y + 45;
                } else if (conn.fromPort === 'routeC') {
                  startY = fromNode.position.y + 70;
                }
              }

              const endX = toNode.position.x;
              const endY = toNode.position.y + NODE_HEIGHT / 2;

              // Draw bezier curve using D3 link generator
              const linkGenerator = d3.linkHorizontal<any, [number, number]>()
                .x(d => d[0])
                .y(d => d[1]);
              const pathData = linkGenerator({
                source: [startX, startY],
                target: [endX, endY]
              }) || '';

              // Is this connection containing an active executor?
              const isActive = executionState.status === 'running' && 
                executionState.activeNodeId === fromNode.id;

              const isPassed = executionState.executedNodes[fromNode.id] === 'success';

              return (
                <g key={conn.id} className="pointer-events-auto group">
                  {/* Outer thicker hover path */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="10"
                    className="cursor-pointer"
                    onClick={(e) => deleteConnection(e, conn.id)}
                  />
                  {/* Display wire color */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={
                      isPassed 
                        ? '#34d399' // emerald-400
                        : isActive 
                        ? '#a78bfa' // purple-400
                        : 'rgba(255, 255, 255, 0.22)' // bright muted white
                    }
                    strokeWidth={isActive || isPassed ? "2.5" : "1.8"}
                    strokeDasharray={isActive ? "5, 5" : undefined}
                    className={`transition-colors duration-205 ${isActive ? 'animate-[dash_1s_linear_infinite]' : ''}`}
                  />
                  {/* Delete button handler hover */}
                  <circle
                    cx={(startX + endX) / 2}
                    cy={(startY + endY) / 2}
                    r="8"
                    fill="#ef4444"
                    className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity duration-150"
                    onClick={(e) => deleteConnection(e, conn.id)}
                  />
                  <line
                    x1={((startX + endX) / 2) - 3}
                    y1={(startY + endY) / 2}
                    x2={((startX + endX) / 2) + 3}
                    y2={(startY + endY) / 2}
                    stroke="white"
                    strokeWidth="2"
                    className="opacity-0 group-hover:opacity-100 pointer-events-none"
                  />
                </g>
              );
            })}

            {/* Draw current active wire being dragged */}
            {activeWire && (() => {
              const node = nodes.find(n => n.id === activeWire.fromId);
              if (!node) return null;

              let startX = node.position.x + NODE_WIDTH;
              let startY = node.position.y + NODE_HEIGHT / 2;

              if (node.type === 'aiFilter') {
                startY = activeWire.fromPort === 'true' 
                  ? node.position.y + 25 
                  : node.position.y + NODE_HEIGHT - 25;
              } else if (node.type === 'transformRouter') {
                if (activeWire.fromPort === 'routeA') {
                  startY = node.position.y + 20;
                } else if (activeWire.fromPort === 'routeB') {
                  startY = node.position.y + 45;
                } else if (activeWire.fromPort === 'routeC') {
                  startY = node.position.y + 70;
                }
              }

              const endX = activeWire.currentX;
              const endY = activeWire.currentY;

              const activeLinkGenerator = d3.linkHorizontal<any, [number, number]>()
                .x(d => d[0])
                .y(d => d[1]);
              const linkPath = activeLinkGenerator({
                source: [startX, startY],
                target: [endX, endY]
              }) || '';

              return (
                <path
                  d={linkPath}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="2"
                  strokeDasharray="4, 4"
                />
              );
            })()}
          </svg>

          {/* Draggable workflow cards */}
          {nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const executionStatus = executionState.executedNodes[node.id];
            const isActive = executionState.activeNodeId === node.id;

            // Compute unique mini summary text
            let summaryText: string = node.type;
            if (node.type === 'webhook') summaryText = "Receive payload triggers";
            if (node.type === 'interval') summaryText = `Runs every ${node.config.seconds || 10}s`;
            if (node.type === 'httpReq') summaryText = `${node.config.method || 'GET'} ${node.config.url ? node.config.url.replace(/^https?:\/\//, '').slice(0, 20) + (node.config.url.length > 20 ? '...' : '') : 'unconfigured'}`;
            if (node.type === 'aiTransform') summaryText = node.config.prompt ? node.config.prompt.slice(0, 26) + "..." : "Instruct Gemini AI Model";
            if (node.type === 'chatgptTransform') summaryText = node.config.prompt ? `ChatGPT: ${node.config.prompt.slice(0, 18)}...` : "Extract via Chat API";
            if (node.type === 'copilotTransform') summaryText = node.config.prompt ? `Copilot: ${node.config.prompt.slice(0, 18)}...` : "Refactor via Copilot";
            if (node.type === 'ollamaTransform') summaryText = node.config.prompt ? `Ollama: ${node.config.prompt.slice(0, 18)}...` : "Process via Local LLM";
            if (node.type === 'aiFilter') summaryText = node.config.condition ? `Evaluate: ${node.config.condition.slice(0, 20)}...` : "Verify True / False Path";
            if (node.type === 'transformRouter') summaryText = `Route to A/B/C (${node.config.routingMode === 'ai' ? 'AI' : 'Rules'})`;
            if (node.type === 'openSwarm') summaryText = `Multi-Agent Swarm (${node.config.swarmMaxTurns || 3} Turns)`;
            if (node.type === 'hermesAgent') summaryText = `Hermes (${node.config.hermesPersona || 'reasoning'} Agent)`;
            if (node.type === 'jsCode') summaryText = "Format & map JSON records";
            if (node.type === 'customFetch') summaryText = `Get live ${node.config.source || 'news'} data`;
            if (node.type === 'outputLog') summaryText = "Save workflow executions logs";
            if (node.type === 'wsClient') summaryText = `Client: ${node.config.operation || 'send'} to ${node.config.wsUrl ? node.config.wsUrl.replace(/^wss?:\/\//, '').slice(0, 18) : 'custom'}`;
            if (node.type === 'wsServer') summaryText = `Server: /ws/custom room (${node.config.operation || 'broadcast'})`;

            return (
              <div
                key={node.id}
                style={{
                  left: node.position.x,
                  top: node.position.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                }}
                className={`absolute bg-white/5 backdrop-blur-lg border text-white select-none cursor-grab pointer-events-auto z-10 transition-all duration-150 flex flex-col justify-between overflow-visible group ring-1 ring-white/10 shadow-2xl ${
                  isSelected 
                    ? 'border-indigo-400 ring-2 ring-indigo-500/30 scale-[1.02]' 
                    : isActive 
                    ? 'border-purple-400 ring-2 ring-purple-500/40' 
                    : executionStatus === 'success' 
                    ? 'border-emerald-500/60 shadow-lg shadow-emerald-500/5' 
                    : executionStatus === 'failed' 
                    ? 'border-red-500/60 shadow-lg shadow-red-500/5' 
                    : 'border-white/10 hover:border-white/25'
                }`}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('.port-handler') || (e.target as HTMLElement).closest('.delete-node-btn')) {
                    return;
                  }
                  setDraggingNodeId(node.id);
                  onSelectNode(node.id);
                  const rect = e.currentTarget.getBoundingClientRect();
                  dragOffset.current = {
                    x: (e.clientX - rect.left) / zoom,
                    y: (e.clientY - rect.top) / zoom
                  };
                  e.stopPropagation();
                }}
                id={`node-${node.id}`}
              >
                {/* Node Top Row Header */}
                <div className={`px-3 py-1.5 rounded-t-xl text-[10px] font-semibold tracking-wider flex items-center justify-between pointer-events-none font-mono uppercase ${getHeaderStyle(node.category)}`}>
                  <div className="flex items-center gap-1.5">
                    {getNodeIcon(node.type)}
                    <span className="truncate max-w-[140px] text-white font-medium">{node.name}</span>
                  </div>

                  {/* Right hand Execution Badges */}
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                      </span>
                    )}
                    {executionStatus === 'success' && (
                      <div className="bg-emerald-500/20 text-emerald-300 rounded-full p-0.5 border border-emerald-500/30" title="Execution successful">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                    )}
                    {executionStatus === 'failed' && (
                      <div className="bg-red-500/20 text-red-300 rounded-full p-0.5 border border-red-500/30 animate-pulse" title="Execution failed">
                        <AlertTriangle className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Node Core Body Copy */}
                <div className="px-3 py-2 flex flex-col justify-center flex-1 min-h-0">
                  <span className="text-xs font-semibold text-white truncate">
                    {node.name}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                    {summaryText}
                  </span>
                </div>

                {/* Left side node input connector port */}
                {node.type !== 'webhook' && node.type !== 'interval' && (
                  <div
                    onMouseUp={(e) => handleInputPortMouseUp(e, node.id)}
                    className="absolute -left-2 top-10.5 p-1 bg-slate-900 border border-white/30 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 hover:border-purple-400 group/port port-handler"
                    id={`port-in-${node.id}`}
                  >
                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full group-hover/port:bg-purple-400 pointer-events-none" />
                  </div>
                )}

                {/* Right side output ports */}
                {node.type !== 'outputLog' && (
                  node.type === 'aiFilter' ? (
                    // AI filters gets Two customized ports: True and False paths
                    <>
                      {/* True Port (Upper Right) */}
                      <div
                        onMouseDown={(e) => handlePortMouseDown(e, node.id, 'true')}
                        className="absolute -right-2 top-[24px] p-1 bg-slate-900 border border-emerald-500/40 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 group/portport port-handler flex items-center justify-center"
                        title="Route if TRUE"
                        id={`port-out-${node.id}-true`}
                      >
                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full pointer-events-none" />
                        <span className="absolute left-6 text-[8px] font-bold text-emerald-300 bg-slate-950/90 px-1 rounded border border-emerald-500/20 pointer-events-none">
                          TRUE
                        </span>
                      </div>
                      
                      {/* False Port (Lower Right) */}
                      <div
                        onMouseDown={(e) => handlePortMouseDown(e, node.id, 'false')}
                        className="absolute -right-2 top-[55px] p-1 bg-slate-900 border border-rose-500/40 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 group/portport port-handler flex items-center justify-center"
                        title="Route if FALSE"
                        id={`port-out-${node.id}-false`}
                      >
                        <div className="w-1.5 h-1.5 bg-rose-400 rounded-full pointer-events-none" />
                        <span className="absolute left-6 text-[8px] font-bold text-rose-300 bg-slate-950/90 px-1 rounded border border-rose-500/20 pointer-events-none">
                          FALSE
                        </span>
                      </div>
                    </>
                  ) : node.type === 'transformRouter' ? (
                    // Intelligent Transform Router gets Three customized ports: Route A, B, and C
                    <>
                      {/* Route A Port (Upper Right) */}
                      <div
                        onMouseDown={(e) => handlePortMouseDown(e, node.id, 'routeA')}
                        className="absolute -right-2 top-[19px] p-1 bg-slate-900 border border-emerald-500/40 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 group/portport port-handler flex items-center justify-center"
                        title="Route A Matcher Output"
                        id={`port-out-${node.id}-routeA`}
                      >
                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full pointer-events-none" />
                        <span className="absolute left-6 text-[8px] font-bold text-emerald-300 bg-slate-950/90 px-1.5 py-0.5 rounded border border-emerald-500/20 pointer-events-none whitespace-nowrap">
                          ROUTE A
                        </span>
                      </div>
                      
                      {/* Route B Port (Middle Right) */}
                      <div
                        onMouseDown={(e) => handlePortMouseDown(e, node.id, 'routeB')}
                        className="absolute -right-2 top-[44px] p-1 bg-slate-900 border border-sky-500/40 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 group/portport port-handler flex items-center justify-center"
                        title="Route B Matcher Output"
                        id={`port-out-${node.id}-routeB`}
                      >
                        <div className="w-1.5 h-1.5 bg-sky-400 rounded-full pointer-events-none" />
                        <span className="absolute left-6 text-[8px] font-bold text-sky-300 bg-slate-950/90 px-1.5 py-0.5 rounded border border-sky-500/20 pointer-events-none whitespace-nowrap">
                          ROUTE B
                        </span>
                      </div>

                      {/* Route C Port (Lower Right) */}
                      <div
                        onMouseDown={(e) => handlePortMouseDown(e, node.id, 'routeC')}
                        className="absolute -right-2 top-[69px] p-1 bg-slate-900 border border-amber-500/45 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 group/portport port-handler flex items-center justify-center"
                        title="Route C Matcher Output"
                        id={`port-out-${node.id}-routeC`}
                      >
                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full pointer-events-none" />
                        <span className="absolute left-6 text-[8px] font-bold text-amber-300 bg-slate-950/90 px-1.5 py-0.5 rounded border border-amber-500/20 pointer-events-none whitespace-nowrap">
                          ROUTE C
                        </span>
                      </div>
                    </>
                  ) : (
                    // Default single output port
                    <div
                      onMouseDown={(e) => handlePortMouseDown(e, node.id, 'output')}
                      className="absolute -right-2 top-10.5 p-1 bg-slate-900 border border-white/30 rounded-full cursor-crosshair hover:scale-125 transition duration-150 z-20 hover:border-indigo-400 group/port port-handler"
                      id={`port-out-${node.id}`}
                    >
                      <div className="w-1.5 h-1.5 bg-slate-400 rounded-full group-hover/port:bg-indigo-400 pointer-events-none" />
                    </div>
                  )
                )}

                {/* Delete button option */}
                <button
                  onClick={() => deleteNode(node.id)}
                  className="absolute -top-3 -right-3 p-1.5 bg-slate-900 rounded-full shadow-lg border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/30 transition opacity-0 group-hover:opacity-100 duration-150 cursor-pointer delete-node-btn"
                  title="Remove Node"
                  id={`delete-btn-${node.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
