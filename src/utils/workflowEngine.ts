import { Connection, Workflow, WorkflowNode, LogEntry, ExecutionState } from '../types/workflow';

// Helper to interpolate strings using double mustache tags like {{key}} or {{node.sub_key}}
export function interpolateTemplate(template: string, inputData: Record<string, any>): string {
  if (!template) return "";
  let interpolated = template;
  
  const flatObj: Record<string, any> = {};
  
  const flatten = (obj: any, prefix = "") => {
    if (obj === null || obj === undefined) return;
    
    if (Array.isArray(obj)) {
      flatObj[prefix.slice(0, -1)] = obj;
      return;
    }
    
    if (typeof obj === 'object') {
      flatObj[prefix.slice(0, -1)] = obj; // store full object
      Object.keys(obj).forEach(k => {
        flatten(obj[k], prefix + k + ".");
      });
      return;
    }
    
    flatObj[prefix.slice(0, -1)] = obj;
  };

  // Flatten outputs of all nodes
  Object.entries(inputData).forEach(([nodeId, val]) => {
    flatObj[nodeId] = val;
    flatten(val, nodeId + ".");
    
    // Also flatten immediate predecessor fields into root namespace for convenience
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.entries(val).forEach(([k, subVal]) => {
        flatObj[k] = subVal;
        flatten(subVal, k + ".");
      });
    }
  });

  // Replace double mustaches
  interpolated = interpolated.replace(/{{\s*([a-zA-Z0-9_\-.]+)\s*}}/g, (match, expression) => {
    if (flatObj[expression] !== undefined) {
      const value = flatObj[expression];
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    return match;
  });

  return interpolated;
}

// Executes a single node via the server API proxy
export async function executeNodeOnServer(
  node: WorkflowNode,
  allOutputs: Record<string, any>
): Promise<any> {
  // Pre-process configuration properties by interpolating template strings
  const configCopy = { ...node.config };
  
  if (configCopy.prompt) {
    configCopy.prompt = interpolateTemplate(configCopy.prompt, allOutputs);
  }
  if (configCopy.body) {
    configCopy.body = interpolateTemplate(configCopy.body, allOutputs);
  }
  if (configCopy.url) {
    configCopy.url = interpolateTemplate(configCopy.url, allOutputs);
  }

  // Create input data context: we aggregate outputs of upstream connected nodes
  const flattenedContext: Record<string, any> = {};
  Object.entries(allOutputs).forEach(([nodeId, val]) => {
    flattenedContext[nodeId] = val;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(flattenedContext, val);
    }
  });

  const response = await fetch('/api/node/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: node.type,
      config: configCopy,
      inputData: flattenedContext
    })
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(errorBody.error || `Node execution failed with status ${response.status}`);
  }

  const result = await response.json();
  return result.output;
}
