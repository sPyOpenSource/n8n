const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
  process.exit(1);
}

let input;
try {
  input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
} catch (e) {
  console.error('Failed to read/parse input:', e.message);
  process.exit(1);
}

const { fileNodes, importEdges, allEdges } = input;

// ---- A. Directory Grouping ----
// Compute common path prefix
const filePaths = fileNodes.map(n => n.filePath);
const commonPrefix = (() => {
  if (filePaths.length === 0) return '';
  // If there's no common directory prefix, return ''
  const parts = filePaths.map(p => p.split('/'));
  const minLen = Math.min(...parts.map(p => p.length));
  let common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = parts[0][i];
    if (parts.every(p => p[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  if (common.length <= 1) return '';
  return common.slice(0, -1).join('/');
})();

const directoryGroups = {};
fileNodes.forEach(n => {
  const path = n.filePath;
  let group;
  if (commonPrefix && path.startsWith(commonPrefix + '/')) {
    const rest = path.slice(commonPrefix.length + 1);
    const seg = rest.split('/')[0];
    group = seg || 'root';
  } else if (path.includes('/')) {
    group = path.split('/')[0];
  } else {
    group = 'root';
  }
  if (!directoryGroups[group]) directoryGroups[group] = [];
  directoryGroups[group].push(n.id);
});

// ---- B. Node Type Grouping ----
const nodeTypeGroups = {};
fileNodes.forEach(n => {
  const t = n.type || 'file';
  if (!nodeTypeGroups[t]) nodeTypeGroups[t] = [];
  nodeTypeGroups[t].push(n.id);
});

// Build file lookup
const fileById = {};
fileNodes.forEach(n => { fileById[n.id] = n; });

// ---- C. Import Adjacency Matrix ----
const fanOut = {};
const fanIn = {};
fileNodes.forEach(n => {
  fanOut[n.id] = 0;
  fanIn[n.id] = 0;
});
importEdges.forEach(e => {
  if (fanOut[e.source] !== undefined) fanOut[e.source]++;
  if (fanIn[e.target] !== undefined) fanIn[e.target]++;
});

// ---- D. Cross-Category Dependency Analysis ----
const crossCategoryEdges = {};
allEdges.forEach(e => {
  const srcType = (fileById[e.source] && fileById[e.source].type) || 'unknown';
  const tgtType = (fileById[e.target] && fileById[e.target].type) || 'unknown';
  if (srcType !== tgtType) {
    const key = `${srcType}->${tgtType}:${e.type}`;
    if (!crossCategoryEdges[key]) crossCategoryEdges[key] = 0;
    crossCategoryEdges[key]++;
  }
});

// ---- E. Inter-Group Import Frequency ----
const interGroupImports = {};
importEdges.forEach(e => {
  const srcNode = fileById[e.source];
  const tgtNode = fileById[e.target];
  if (!srcNode || !tgtNode) return;
  const srcPath = srcNode.filePath;
  const tgtPath = tgtNode.filePath;
  const srcGroup = Object.keys(directoryGroups).find(g => directoryGroups[g].includes(e.source)) || 'unknown';
  const tgtGroup = Object.keys(directoryGroups).find(g => directoryGroups[g].includes(e.target)) || 'unknown';
  if (srcGroup !== tgtGroup) {
    const key = `${srcGroup}->${tgtGroup}`;
    if (!interGroupImports[key]) interGroupImports[key] = 0;
    interGroupImports[key]++;
  }
});

// ---- F. Intra-Group Import Density ----
const intraGroupDensity = {};
Object.keys(directoryGroups).forEach(group => {
  const ids = directoryGroups[group];
  const idSet = new Set(ids);
  let internalEdges = 0;
  let totalEdges = 0;
  importEdges.forEach(e => {
    if (idSet.has(e.source) || idSet.has(e.target)) {
      totalEdges++;
      if (idSet.has(e.source) && idSet.has(e.target)) {
        internalEdges++;
      }
    }
  });
  intraGroupDensity[group] = {
    internalEdges,
    totalEdges,
    density: totalEdges > 0 ? internalEdges / totalEdges : 0
  };
});

// ---- G. Directory Pattern Matching ----
const patternMap = {
  'routes': 'api', 'api': 'api', 'controllers': 'api', 'endpoints': 'api', 'handlers': 'api',
  'services': 'service', 'core': 'service', 'lib': 'service', 'domain': 'service', 'logic': 'service',
  'models': 'data', 'db': 'data', 'data': 'data', 'persistence': 'data', 'repository': 'data', 'entities': 'data',
  'components': 'ui', 'views': 'ui', 'pages': 'ui', 'ui': 'ui', 'layouts': 'ui', 'screens': 'ui',
  'middleware': 'middleware', 'plugins': 'middleware', 'interceptors': 'middleware', 'guards': 'middleware',
  'utils': 'utility', 'helpers': 'utility', 'common': 'utility', 'shared': 'utility', 'tools': 'utility',
  'config': 'config', 'constants': 'config', 'env': 'config', 'settings': 'config',
  'tests': 'test', 'test': 'test', 'spec': 'test', 'specs': 'test', '__tests__': 'test',
  'types': 'types', 'interfaces': 'types', 'schemas': 'types', 'contracts': 'types', 'dtos': 'types',
  'hooks': 'hooks',
  'store': 'state', 'state': 'state', 'reducers': 'state', 'actions': 'state', 'slices': 'state',
  'assets': 'assets', 'static': 'assets', 'public': 'assets',
  'docs': 'documentation', 'documentation': 'documentation', 'wiki': 'documentation',
  'deploy': 'infrastructure', 'infra': 'infrastructure', 'infrastructure': 'infrastructure',
  'docker': 'infrastructure',
  'migrations': 'data',
  'examples': 'example',
  'lessons': 'education',
  'server': 'api',
  'copilot': 'service',
};

const patternMatches = {};
Object.keys(directoryGroups).forEach(group => {
  patternMatches[group] = patternMap[group] || 'other';
});

// Also check file-level patterns
const filePatternMatches = {};
fileNodes.forEach(n => {
  const name = n.name || '';
  const path = n.filePath || '';
  if (name === '__init__.py' && path.split('/').length >= 2) {
    filePatternMatches[n.id] = 'entry';
  } else if (name === '__main__.py') {
    filePatternMatches[n.id] = 'entry';
  } else if (name === 'app.py' && !path.includes('/')) {
    filePatternMatches[n.id] = 'entry';
  } else if (name === 'Dockerfile' || name.startsWith('docker-compose') || name === '.dockerignore') {
    filePatternMatches[n.id] = 'infrastructure';
  } else if (name.endsWith('.md')) {
    filePatternMatches[n.id] = 'documentation';
  } else if (name === 'requirements.txt') {
    filePatternMatches[n.id] = 'config';
  } else if (name.startsWith('test_') || name.endsWith('_test.py') || name.endsWith('test.py') || name.endsWith('_spec.py')) {
    filePatternMatches[n.id] = 'test';
  }
});

// ---- H. Deployment Topology ----
const deploymentTopology = {
  hasDockerfile: fileNodes.some(n => n.name === 'Dockerfile'),
  hasCompose: fileNodes.some(n => n.name && n.name.startsWith('docker-compose')),
  hasK8s: false,
  hasTerraform: false,
  hasCI: false,
  infraFiles: fileNodes.filter(n => n.name === 'Dockerfile' || (n.name && n.name.startsWith('docker-compose')) || n.name === '.dockerignore').map(n => n.filePath)
};

// ---- I. Data Pipeline ----
const dataPipeline = {
  schemaFiles: [],
  migrationFiles: [],
  dataModelFiles: fileNodes.filter(n => n.tags && n.tags.includes('data-model')).map(n => n.id),
  apiHandlerFiles: fileNodes.filter(n => n.tags && n.tags.includes('api-handler')).map(n => n.id)
};

// ---- J. Documentation Coverage ----
const groupsWithReadme = {};
fileNodes.forEach(n => {
  if (n.name === 'README.md') {
    const dir = n.filePath.split('/').slice(0, -1).join('/');
    groupsWithReadme[dir] = true;
  }
});
const docCoverage = {
  groupsWithDocs: 0,
  totalGroups: Object.keys(directoryGroups).length,
  coverageRatio: 0,
  undocumentedGroups: []
};
Object.keys(directoryGroups).forEach(group => {
  const hasDoc = fileNodes.some(n => directoryGroups[group].includes(n.id) && n.name === 'README.md');
  if (hasDoc) docCoverage.groupsWithDocs++;
  else docCoverage.undocumentedGroups.push(group);
});
docCoverage.coverageRatio = docCoverage.totalGroups > 0 ? docCoverage.groupsWithDocs / docCoverage.totalGroups : 0;

// ---- K. Dependency Direction ----
const depDirMap = {};
importEdges.forEach(e => {
  const srcGroup = Object.keys(directoryGroups).find(g => directoryGroups[g].includes(e.source));
  const tgtGroup = Object.keys(directoryGroups).find(g => directoryGroups[g].includes(e.target));
  if (srcGroup && tgtGroup && srcGroup !== tgtGroup) {
    const key = `${srcGroup}->${tgtGroup}`;
    if (!depDirMap[key]) depDirMap[key] = { forward: 0, backward: 0 };
    depDirMap[key].forward++;
  }
});
const dependencyDirection = {};
Object.keys(depDirMap).forEach(key => {
  const [from, to] = key.split('->');
  depDirMap[key].backward = depDirMap[`${to}->${from}`] ? depDirMap[`${to}->${from}`].forward : 0;
  const net = depDirMap[key].forward - depDirMap[key].backward;
  if (net > 0) {
    dependencyDirection[key] = `${from} depends on ${to}`;
  }
  // Remove the reverse entry so we don't double count
  const revKey = `${to}->${from}`;
  delete depDirMap[revKey];
});

// ---- Stats ----
const filesPerGroup = {};
Object.keys(directoryGroups).forEach(g => { filesPerGroup[g] = directoryGroups[g].length; });
const nodeTypeCounts = {};
Object.keys(nodeTypeGroups).forEach(t => { nodeTypeCounts[t] = nodeTypeGroups[t].length; });

// ---- Write Output ----
const output = {
  scriptCompleted: true,
  directoryGroups,
  nodeTypeGroups,
  crossCategoryEdges: Object.entries(crossCategoryEdges).map(([k, v]) => {
    const [fromTo, edgeType] = k.split(':');
    const [fromType, toType] = fromTo.split('->');
    return { fromType, toType, edgeType, count: v };
  }),
  interGroupImports: Object.entries(interGroupImports).map(([k, v]) => {
    const [from, to] = k.split('->');
    return { from, to, count: v };
  }),
  intraGroupDensity,
  patternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection: Object.entries(dependencyDirection).map(([k, v]) => {
    const [dependent, dependsOn] = k.split('->');
    return { dependent, dependsOn };
  }),
  fileStats: {
    totalFileNodes: fileNodes.length,
    filesPerGroup,
    nodeTypeCounts
  },
  fanIn,
  fanOut
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log('Analysis complete.');
process.exit(0);
