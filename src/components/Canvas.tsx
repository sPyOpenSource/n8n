import React, { useState, useRef, useEffect } from 'react';
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
  ZoomOut
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
  // Canvas viewing coordinates (pan and zoom)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Active drag states
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [activeWire, setActiveWire] = useState<{
    fromId: string;
    fromPort: 'output' | 'true' | 'false';
    currentX: number;
    currentY: number;
  } | null>(null);

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

  // Handle mouse canvas pan events
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 0 && e.target === canvasRef.current) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.preventDefault();
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      });
    } else if (draggingNodeId) {
      // Scale offsets by zoom
      const clientX = e.clientX;
      const clientY = e.clientY;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const relativeX = (clientX - rect.left - pan.x) / zoom - dragOffset.current.x;
      const relativeY = (clientY - rect.top - pan.y) / zoom - dragOffset.current.y;

      // Restrict node to grid increments of 10px
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
    setIsPanning(false);
    setDraggingNodeId(null);
    setActiveWire(null);
  };

  // Dragging connection starts
  const handlePortMouseDown = (
    e: React.MouseEvent,
    nodeId: string,
    port: 'output' | 'true' | 'false'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    let portX = node.position.x + NODE_WIDTH;
    let portY = node.position.y + NODE_HEIGHT / 2;

    if (node.type === 'aiFilter') {
      portY = port === 'true' ? node.position.y + 25 : node.position.y + NODE_HEIGHT - 25;
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

  // Double click on canvas resets view
  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      setPan({ x: 50, y: 50 });
      setZoom(1);
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
      case 'aiFilter': return <Settings className="w-5 h-5 text-purple-400" />;
      case 'jsCode': return <Code className="w-5 h-5 text-amber-400" />;
      case 'customFetch': return <CloudDrizzle className="w-5 h-5 text-orange-400" />;
      case 'outputLog': return <BookOpen className="w-5 h-5 text-slate-300" />;
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
      <div className="absolute top-4 left-4 z-10 flex gap-2" id="canvas-zoom-controls">
        <button 
          onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
          className="p-2 bg-white/5 text-white backdrop-blur-md rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 active:scale-95 cursor-pointer"
          title="Zoom In"
          id="btn-zoom-in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button 
          onClick={() => setZoom(Math.max(0.6, zoom - 0.1))}
          className="p-2 bg-white/5 text-white backdrop-blur-md rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 active:scale-95 cursor-pointer"
          title="Zoom Out"
          id="btn-zoom-out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button 
          onClick={() => { setZoom(1); setPan({ x: 50, y: 50 }); }}
          className="px-3 py-1.5 bg-white/5 text-xs text-white backdrop-blur-md font-semibold rounded-lg shadow-lg border border-white/20 hover:bg-white/10 transition duration-150 cursor-pointer"
          title="Reset View"
          id="btn-zoom-reset"
        >
          Reset ({Math.round(zoom * 100)}%)
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
              }

              const endX = toNode.position.x;
              const endY = toNode.position.y + NODE_HEIGHT / 2;

              // Draw bezier curve
              const controlDist = Math.max(80, Math.abs(endX - startX) / 1.6);
              const pathData = `M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`;

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
              }

              const endX = activeWire.currentX;
              const endY = activeWire.currentY;
              const controlDist = Math.abs(endX - startX) / 1.8;

              return (
                <path
                  d={`M ${startX} ${startY} C ${startX + controlDist} ${startY}, ${endX - controlDist} ${endY}, ${endX} ${endY}`}
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
            if (node.type === 'aiFilter') summaryText = node.config.condition ? `Evaluate: ${node.config.condition.slice(0, 20)}...` : "Verify True / False Path";
            if (node.type === 'jsCode') summaryText = "Format & map JSON records";
            if (node.type === 'customFetch') summaryText = `Get live ${node.config.source || 'news'} data`;
            if (node.type === 'outputLog') summaryText = "Save workflow executions logs";

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
