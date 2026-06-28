#!/usr/bin/env python3
"""Graph topology analysis for tour design."""
import json, sys, os
from collections import defaultdict, deque

def main():
    if len(sys.argv) != 3:
        print("Usage: analyze.py <input.json> <output.json>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path) as f:
        data = json.load(f)

    nodes = data["nodes"]
    edges = data["edges"]
    layers = data.get("layers", [])

    # Build lookup maps
    node_map = {n["id"]: n for n in nodes}
    node_ids = {n["id"] for n in nodes}

    # Filter to only "real" edges for fan-in/out (skip contains/exports which are file→member)
    real_edges = [e for e in edges if e["type"] not in ("contains", "exports")]
    # Also collect all edges for BFS
    import_edges = [e for e in edges if e["type"] == "imports"]

    # --- A. Fan-In ---
    fan_in = defaultdict(int)
    for e in real_edges:
        if e["target"] in node_ids:
            fan_in[e["target"]] += 1
    fan_in_ranking = sorted(
        [{"id": nid, "fanIn": cnt, "name": node_map[nid]["name"]}
         for nid, cnt in fan_in.items()],
        key=lambda x: -x["fanIn"]
    )[:20]

    # --- B. Fan-Out ---
    fan_out = defaultdict(int)
    for e in real_edges:
        if e["source"] in node_ids:
            fan_out[e["source"]] += 1
    fan_out_ranking = sorted(
        [{"id": nid, "fanOut": cnt, "name": node_map[nid]["name"]}
         for nid, cnt in fan_out.items()],
        key=lambda x: -x["fanOut"]
    )[:20]

    # --- C. Entry Point Candidates ---
    def score_entry(n):
        nid = n["id"]
        score = 0
        ntype = n.get("type", "")
        name = n.get("name", "")
        fpath = n.get("filePath", "")

        # Code files
        entry_names = {"index.ts","index.js","main.ts","main.js","app.ts","app.js",
                       "server.ts","server.js","main.py","app.py","wsgi.py","asgi.py",
                       "run.py","__main__.py"}
        if name in entry_names:
            score += 3

        # File at root or one level deep
        depth = fpath.count("/") if fpath else 99
        if depth <= 1:
            score += 1

        # High fan-out top 10%
        fo = fan_out.get(nid, 0)
        if fo > 0:
            max_fo = max(fan_out.values()) if fan_out else 0
            if fo >= max_fo * 0.5:
                score += 1

        # Low fan-in bottom 25%
        fi = fan_in.get(nid, 0)
        all_fi = [fan_in.get(x["id"], 0) for x in nodes]
        if all_fi:
            sorted_fi = sorted(all_fi)
            p25 = sorted_fi[len(sorted_fi)//4]
            if fi <= p25:
                score += 1

        # README at root
        if ntype == "document" and name == "README.md" and fpath == "README.md":
            score += 5
        elif ntype == "document" and name.endswith(".md") and depth <= 1:
            score += 2

        return score

    entry_scores = [(n, score_entry(n)) for n in nodes]
    entry_scores.sort(key=lambda x: -x[1])
    entry_candidates = [
        {"id": n["id"], "score": s, "name": n["name"], "summary": n.get("summary","")}
        for n, s in entry_scores[:5]
    ]

    # --- D. BFS Traversal ---
    # Find top code entry (skip docs)
    code_entry = None
    for n, s in entry_scores:
        if n.get("type") in ("file", "service") and s > 0:
            code_entry = n["id"]
            break
    if not code_entry:
        code_entry = "file:app.py"

    # Build adjacency for imports only
    adj = defaultdict(list)
    for e in import_edges:
        if e["source"] in node_ids and e["target"] in node_ids:
            if e["source"] not in adj[e["target"]]:  # prevent dupes
                adj[e["source"]].append(e["target"])

    bfs_order = []
    bfs_depth = {}
    visited = set()
    q = deque()
    q.append((code_entry, 0))
    visited.add(code_entry)
    while q:
        cid, depth = q.popleft()
        bfs_order.append(cid)
        bfs_depth[cid] = depth
        for neighbor in adj.get(cid, []):
            if neighbor not in visited and neighbor in node_ids:
                visited.add(neighbor)
                q.append((neighbor, depth + 1))

    by_depth = defaultdict(list)
    for nid, d in bfs_depth.items():
        by_depth[d].append(nid)

    bfs_traversal = {
        "startNode": code_entry,
        "order": bfs_order,
        "depthMap": bfs_depth,
        "byDepth": {str(k): v for k, v in sorted(by_depth.items())}
    }

    # --- E. Non-Code File Inventory ---
    non_code = {"documentation": [], "infrastructure": [], "data": [], "config": []}
    for n in nodes:
        t = n["type"]
        entry = {"id": n["id"], "name": n["name"], "summary": n.get("summary","")}
        if t == "document":
            non_code["documentation"].append(entry)
        elif t in ("service", "pipeline", "resource"):
            non_code["infrastructure"].append(entry)
        elif t in ("table", "schema", "endpoint"):
            non_code["data"].append(entry)
        elif t == "config":
            non_code["config"].append(entry)

    # --- F. Tightly Coupled Clusters ---
    # Build bidir adjacency
    bidir_adj = defaultdict(set)
    for e in real_edges:
        if e["source"] in node_ids and e["target"] in node_ids:
            bidir_adj[e["source"]].add(e["target"])
            bidir_adj[e["target"]].add(e["source"])

    # Find triangles/cliques
    clusters = []
    used = set()
    # Sort by degree for better clustering
    node_list = sorted(bidir_adj.keys(), key=lambda x: -len(bidir_adj[x]))
    for nid in node_list:
        if nid in used:
            continue
        neighbors = bidir_adj[nid] - used
        if len(neighbors) < 2:
            continue
        # Find a cluster of 2-5 nodes
        cluster = {nid}
        candidates = sorted(neighbors, key=lambda x: -len(bidir_adj[x] & neighbors))
        for c in candidates:
            if len(cluster) >= 5:
                break
            # Check if c connects to at least 2 existing cluster members
            connections = len(bidir_adj[c] & cluster)
            if connections >= 2 or len(cluster) == 1:
                cluster.add(c)
        if len(cluster) >= 2:
            # Count edges within cluster
            edge_count = sum(1 for e in real_edges
                           if e["source"] in cluster and e["target"] in cluster)
            clusters.append({"nodes": list(cluster), "edgeCount": edge_count})
            used.update(cluster)

    # Sort by edge count
    clusters.sort(key=lambda x: -x["edgeCount"])
    clusters = clusters[:10]

    # --- G. Layer List ---
    layer_info = {
        "count": len(layers),
        "list": [{"id": l["id"], "name": l["name"], "description": l["description"]}
                 for l in layers]
    }

    # --- H. Node Summary Index ---
    node_summary_index = {}
    for n in nodes:
        node_summary_index[n["id"]] = {
            "name": n["name"],
            "type": n["type"],
            "summary": n.get("summary", ""),
            "filePath": n.get("filePath", "")
        }

    # --- Write output ---
    result = {
        "scriptCompleted": True,
        "entryPointCandidates": entry_candidates,
        "fanInRanking": fan_in_ranking,
        "fanOutRanking": fan_out_ranking,
        "bfsTraversal": bfs_traversal,
        "nonCodeFiles": non_code,
        "clusters": clusters,
        "layers": layer_info,
        "nodeSummaryIndex": node_summary_index,
        "totalNodes": len(nodes),
        "totalEdges": len(edges)
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Analysis complete. Wrote {output_path}")
    sys.exit(0)

if __name__ == "__main__":
    main()
