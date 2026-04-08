import * as d3 from 'd3-force';
import dagre from 'dagre';

// 👇 A NOSSA FONTE DA VERDADE EXPORTADA 👇
export const D3_DEFAULTS = { 
    distance: 10, 
    charge: -40, 
    openWeight: 0.65,
    collide: 40
};

// =========================================================
// 1. MOTOR D3 FORCE (FÍSICA ORGÂNICA COM "BREATHING" ANNEALING E FORÇAS POR GRAU)
// =========================================================
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const dist = config.distance !== undefined ? config.distance : D3_DEFAULTS.distance;
    const targetCharge = config.charge !== undefined ? config.charge : D3_DEFAULTS.charge; 
    const col = config.collide !== undefined ? config.collide : D3_DEFAULTS.collide;
    const openWeight = config.openWeight !== undefined ? config.openWeight : D3_DEFAULTS.openWeight; 

    const currentPos = config.currentPos || null;

    // 1. MAPEAMENTO DE GRAU
    const nodeDegree = {};
    nodesArray.forEach(id => nodeDegree[id] = 0);
    branchesArray.forEach(b => {
        nodeDegree[b.from] = (nodeDegree[b.from] || 0) + 1;
        nodeDegree[b.to] = (nodeDegree[b.to] || 0) + 1;
    });

    const d3Nodes = nodesArray.map(id => {
        const nodeObj = { id: id.toString(), isSource: sourcesArray.includes(id), degree: nodeDegree[id] || 0 };
        if (currentPos && currentPos[id]) { nodeObj.x = currentPos[id].x; nodeObj.y = currentPos[id].y; }
        return nodeObj;
    });
    
    const d3Links = branchesArray.map(b => ({ source: b.from.toString(), target: b.to.toString(), isOpen: b.state === 0 }));

    const chargeForce = d3.forceManyBody()
        .strength(d => { const multiplier = 1 + (d.degree * 5); return targetCharge * multiplier; })
        .distanceMax(dist * 6);

    const linkForce = d3.forceLink(d3Links)
        .id(d => d.id)
        .distance(d => {
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            const degreeBonus = (degSource + degTarget) * 10; 
            const baseDist = d.isOpen ? dist * 1.5 : dist;
            return baseDist + degreeBonus;
        })
        .strength(d => {
            if (d.isOpen) return openWeight;
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            return (degSource <= 2 || degTarget <= 2) ? 1.5 : 1; 
        });

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", linkForce).force("charge", chargeForce)
        .force("center", d3.forceCenter(0, 0))
        .force("collide", d3.forceCollide().radius(col)).stop();

    const maxChargeMulti = 5; 
    const totalTicks = 900; 
    const phaseTicks = totalTicks / 3;

    for (let i = 0; i < totalTicks; ++i) {
        let currentAlpha = 1; let phaseMultiplier;
        if (i < phaseTicks) { phaseMultiplier = 1 + (maxChargeMulti - 1) * (i / phaseTicks); } 
        else if (i < phaseTicks * 2) { phaseMultiplier = maxChargeMulti; } 
        else {
            const progress = (i - phaseTicks * 2) / phaseTicks;
            phaseMultiplier = maxChargeMulti - (maxChargeMulti - 1) * progress;
            currentAlpha = 1 - progress; 
        }

        chargeForce.strength(d => { return targetCharge * (1 + (d.degree * 5)) * phaseMultiplier; });
        simulation.alpha(Math.max(0.01, currentAlpha)).tick(); 
    }

    const positions = {};
    d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
    return positions;
}

// =========================================================
// 2. MOTOR DAGRE (HIERÁRQUICO / ÁRVORE TOPOLÓGICA)
// =========================================================
export function calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const rankdir = config.rankdir || 'LR'; 
    const ranksep = config.ranksep || 120; 
    const nodesep = config.nodesep || 60;  
    const ranker = config.ranker || 'network-simplex'; 

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir, ranksep, nodesep, ranker });
    g.setDefaultEdgeLabel(() => ({}));

    nodesArray.forEach(id => g.setNode(id.toString(), { width: 40, height: 40 }));

    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.forEach(b => { adj[b.from].push(b.to); adj[b.to].push(b.from); });

    const depths = {}; const queue = [];
    sourcesArray.forEach(s => { depths[s] = 0; queue.push(s); });

    while(queue.length > 0) {
        const current = queue.shift();
        adj[current].forEach(neighbor => {
            if (depths[neighbor] === undefined) { depths[neighbor] = depths[current] + 1; queue.push(neighbor); }
        });
    }

    branchesArray.forEach(b => {
        const depthFrom = depths[b.from] !== undefined ? depths[b.from] : 999;
        const depthTo = depths[b.to] !== undefined ? depths[b.to] : 999;

        let sourceNode = b.from; let targetNode = b.to;
        if (depthFrom > depthTo) { sourceNode = b.to; targetNode = b.from; }

        const edgeWeight = b.state === 1 ? 10 : 0;
        g.setEdge(sourceNode.toString(), targetNode.toString(), { weight: edgeWeight });
    });

    dagre.layout(g);

    const positions = {};
    nodesArray.forEach(id => { const n = g.node(id.toString()); positions[id] = { x: n.x, y: n.y }; });
    return positions;
}

// =========================================================
// 3. MOTOR RADIAL (CONCÊNTRICO)
// =========================================================
export function calculateRadialLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const radiusStep = config.radius || 150;
    
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.filter(b => b.state === 1).forEach(b => { adj[b.from].push(b.to); adj[b.to].push(b.from); });

    const levels = {}; const queue = [];
    sourcesArray.forEach(s => { levels[s] = 0; queue.push(s); });
    
    const visited = new Set(sourcesArray);
    while(queue.length > 0) {
        const u = queue.shift();
        adj[u].forEach(v => { if(!visited.has(v)) { visited.add(v); levels[v] = levels[u] + 1; queue.push(v); } });
    }

    const byLevel = {};
    nodesArray.forEach(n => {
        const l = levels[n] !== undefined ? levels[n] : 0;
        if(!byLevel[l]) byLevel[l] = [];
        byLevel[l].push(n);
    });

    const positions = {};
    Object.keys(byLevel).forEach(lStr => {
        const l = parseInt(lStr); const nodesInLevel = byLevel[lStr]; const currentRadius = l * radiusStep;
        if (l === 0) { 
            nodesInLevel.forEach((n, i) => positions[n] = { x: (i * 80) - ((nodesInLevel.length-1)*40), y: 0 });
        } else { 
            const angleStep = (2 * Math.PI) / nodesInLevel.length;
            nodesInLevel.forEach((n, i) => { const angle = i * angleStep; positions[n] = { x: currentRadius * Math.cos(angle), y: currentRadius * Math.sin(angle) }; });
        }
    });
    return positions;
}

// =========================================================
// 4. MOTOR ORTOGONAL (GRID / MANHATTAN)
// =========================================================
export function calculateOrthogonalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const gridSize = config.gridSize || 120; 
    const targetCharge = config.charge || -500; 
    const openWeight = config.openWeight !== undefined ? config.openWeight : 1.0; 
    const currentPos = config.currentPos || null;
    const dist = config.distance || 50; 

    const basePos = calculateForceLayout(nodesArray, branchesArray, sourcesArray, { distance: dist, charge: targetCharge, openWeight: openWeight, currentPos: currentPos });
    
    const snappedPos = {}; const occupied = new Set();
    const getGridKey = (x, y) => `${x},${y}`;

    const sortedNodes = [...nodesArray].sort((a, b) => {
        const distA = Math.pow(basePos[a].x, 2) + Math.pow(basePos[a].y, 2);
        const distB = Math.pow(basePos[b].x, 2) + Math.pow(basePos[b].y, 2);
        return distA - distB;
    });

    sortedNodes.forEach(id => {
        let gridX = Math.round(basePos[id].x / gridSize); let gridY = Math.round(basePos[id].y / gridSize);
        let radius = 0; let placed = false;
        
        while (!placed) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) {
                        const testX = gridX + dx; const testY = gridY + dy;
                        const key = getGridKey(testX, testY);
                        if (!occupied.has(key)) { gridX = testX; gridY = testY; placed = true; break; }
                    }
                }
                if (placed) break;
            }
            radius++;
        }
        occupied.add(getGridKey(gridX, gridY));
        snappedPos[id] = { x: gridX * gridSize, y: gridY * gridSize };
    });

    return snappedPos;
}