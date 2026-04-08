import * as d3 from 'd3-force';
import dagre from 'dagre';

// 👇 A NOSSA FONTE DA VERDADE EXPORTADA 👇
export const D3_DEFAULTS = { distance: 10, charge: -40, openWeight: 0.65, collide: 40 };

// =========================================================
// 1. MOTOR D3 FORCE (FÍSICA ORGÂNICA COM "BREATHING" ANNEALING)
// =========================================================
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const dist = config.distance !== undefined ? config.distance : D3_DEFAULTS.distance;
    const targetCharge = config.charge !== undefined ? config.charge : D3_DEFAULTS.charge; 
    const col = config.collide !== undefined ? config.collide : D3_DEFAULTS.collide;
    const openWeight = config.openWeight !== undefined ? config.openWeight : D3_DEFAULTS.openWeight; 

    const currentPos = config.currentPos || null;

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
            return (d.isOpen ? dist * 1.5 : dist) + degreeBonus;
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

// =============================================================================
// 5. VNS LAYOUT — Variable Neighborhood Search (Otimizador Geométrico Padrão)
// =============================================================================

// --- PARÂMETROS E PESOS DA FUNÇÃO OBJETIVO ---
// O VNS funciona calculando um "Custo" para o estado atual da rede. O objetivo 
// do algoritmo é fazer movimentos que minimizem esse custo.
const W_CROSS       = 1000;  // PESO ALTO: Penalidade severa para linhas fechadas que se cruzam. O algoritmo tentará evitar isso a todo custo.
const W_CROSS_OPEN  = 150;   // PESO MÉDIO: Penalidade para cruzamento envolvendo chaves abertas. É tolerado, mas evitado se possível.
const W_DIST        = 1;     // PESO BAIXO: Age como um "elástico". Faz com que barras conectadas tentem ficar próximas para não termos linhas gigantes cortando o sistema.

const VNS_DEFAULT_GRID  = 100; // Tamanho padrão do "pulo" ao testar novas posições em volta de uma barra.

function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

function dist2(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }

function objectiveFunction(pos, allBranches, adj) {
    let cost = 0;
    // 1. Avalia penalidades por Cruzamentos (W_CROSS e W_CROSS_OPEN)
    for (let i = 0; i < allBranches.length - 1; i++) {
        for (let j = i + 1; j < allBranches.length; j++) {
            const a = allBranches[i], b = allBranches[j];
            if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
            const p1 = pos[a.from], p2 = pos[a.to], p3 = pos[b.from], p4 = pos[b.to];
            if (p1 && p2 && p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                const bothClosed = (a.state === 1) && (b.state === 1);
                cost += bothClosed ? W_CROSS : W_CROSS_OPEN;
            }
        }
    }
    // 2. Avalia penalidade pela distância entre os nós (W_DIST)
    let totalDist = 0, count = 0;
    Object.keys(adj).forEach(id => {
        const p = pos[Number(id)];
        if (!p) return;
        adj[id].forEach(nb => {
            const q = pos[nb];
            if (q) { totalDist += Math.sqrt(dist2(p, q)); count++; }
        });
    });
    const avgDist = count > 0 ? totalDist / count : 0;
    return cost + W_DIST * avgDist;
}

function objectiveFunctionFast(pos, allBranches, adj) { return objectiveFunction(pos, allBranches, adj); }

function clonePos(pos) { const c = {}; Object.keys(pos).forEach(k => { c[k] = { ...pos[k] }; }); return c; }
function swapNodes(pos, idA, idB) { const tmp = pos[idA]; pos[idA] = pos[idB]; pos[idB] = tmp; }

// --- VIZINHANÇAS DO VNS (Os 4 tipos de movimentos que ele tenta fazer) ---

// Vizinhança 1: Troca simples entre dois nós aleatórios
function perturbN1(pos, nodes) {
    const p = clonePos(pos); const i = Math.floor(Math.random() * nodes.length);
    let j = Math.floor(Math.random() * (nodes.length - 1));
    if (j >= i) j++;
    swapNodes(p, nodes[i], nodes[j]); return p;
}

// Vizinhança 2: Pega um nó e move ele solto pelo Grid (respeitando o VNS_DEFAULT_GRID)
function perturbN2(pos, nodes, gridSize, r, allBranches, adj, currentCost) {
    const occupied = new Set(nodes.map(id => `${pos[id].x},${pos[id].y}`));
    const id = nodes[Math.floor(Math.random() * nodes.length)];
    const cx = pos[id].x, cy = pos[id].y;
    let best = clonePos(pos); let bestCost = currentCost;
    for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx * gridSize, ny = cy + dy * gridSize, key = `${nx},${ny}`;
            if (occupied.has(key)) continue;          
            const candidate = clonePos(pos); candidate[id] = { x: nx, y: ny };
            const cost = objectiveFunctionFast(candidate, allBranches, adj);
            if (cost < bestCost) { bestCost = cost; best = candidate; }
        }
    }
    return best;
}

// Vizinhança 3: Pega o nó que tem MAIS cruzamentos e troca ele de lugar com um vizinho
function perturbN3(pos, nodes, allBranches, adj) {
    const nodeCross = {}; nodes.forEach(id => { nodeCross[id] = 0; });
    for (let i = 0; i < allBranches.length - 1; i++) {
        for (let j = i + 1; j < allBranches.length; j++) {
            const a = allBranches[i], b = allBranches[j];
            if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
            const p1 = pos[a.from], p2 = pos[a.to], p3 = pos[b.from], p4 = pos[b.to];
            if (p1 && p2 && p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                const w = (a.state === 1 && b.state === 1) ? W_CROSS : W_CROSS_OPEN;
                nodeCross[a.from] = (nodeCross[a.from] || 0) + w; nodeCross[a.to] = (nodeCross[a.to] || 0) + w;
                nodeCross[b.from] = (nodeCross[b.from] || 0) + w; nodeCross[b.to] = (nodeCross[b.to] || 0) + w;
            }
        }
    }
    const ranked = [...nodes].sort((a, b) => nodeCross[b] - nodeCross[a]);
    const worst = ranked[0];
    const p = clonePos(pos); const nbrs = adj[worst] || [];
    if (nbrs.length === 0) return perturbN1(pos, nodes); 
    const target = nbrs[Math.floor(Math.random() * nbrs.length)];
    swapNodes(p, worst, target); return p;
}

// Vizinhança 4: Pega um sub-grupo de nós conectados (cluster) e embaralha todos eles
function perturbN4(pos, nodes, adj, depth = 3) {
    const root = nodes[Math.floor(Math.random() * nodes.length)];
    const cluster = new Set([root]); let frontier = [root];
    for (let d = 0; d < depth; d++) {
        const next = [];
        frontier.forEach(n => { (adj[n] || []).forEach(nb => { if (!cluster.has(nb)) { cluster.add(nb); next.push(nb); } }); });
        frontier = next; if (frontier.length === 0) break;
    }
    const clusterArr = [...cluster];
    if (clusterArr.length < 2) return perturbN1(pos, nodes); 
    const savedPositions = clusterArr.map(id => ({ ...pos[id] }));
    for (let i = savedPositions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [savedPositions[i], savedPositions[j]] = [savedPositions[j], savedPositions[i]];
    }
    const p = clonePos(pos); clusterArr.forEach((id, idx) => { p[id] = savedPositions[idx]; }); return p;
}

function localSearch(pos, nodes, allBranches, adj, currentCost, sampleSize = 80) {
    let cost = currentCost; let improved = true;
    while (improved) {
        improved = false;
        for (let t = 0; t < sampleSize; t++) {
            const i = Math.floor(Math.random() * nodes.length);
            let j = Math.floor(Math.random() * (nodes.length - 1));
            if (j >= i) j++;                          
            const idA = nodes[i], idB = nodes[j];
            swapNodes(pos, idA, idB);
            const newCost = objectiveFunctionFast(pos, allBranches, adj);
            if (newCost < cost) { cost = newCost; improved = true; } 
            else { swapNodes(pos, idA, idB); }
        }
    }
    return cost;
}

export function calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const gridSize   = config.gridSize  ?? VNS_DEFAULT_GRID;
    const maxIter    = config.maxIter   ?? 120;
    const lsTrials   = config.lsTrials  ?? 80;
    const n2Radius   = config.n2Radius  ?? 4;
    const n4Depth    = config.n4Depth   ?? 3;
    const onProgress = config.onProgress || null;
    // 1. ESTADO INICIAL: "Snap to Grid" (Encaixe na Malha)
    // Pega a posição atual da tela e "trava" nos trilhos do gridSize definido.
    let initPos = {};
    const occupied = new Set();

    if (config.currentPos && Object.keys(config.currentPos).length > 0) {
        nodesArray.forEach(id => {
            const currX = config.currentPos[id]?.x || 0;
            const currY = config.currentPos[id]?.y || 0;
            
            // Arredonda a posição atual para o múltiplo do grid mais próximo
            let gridX = Math.round(currX / gridSize) * gridSize;
            let gridY = Math.round(currY / gridSize) * gridSize;
            
            // Algoritmo Anti-Colisão: Se a vaga já tem barra, procura em espiral ao redor
            let radius = 0; 
            let placed = false;
            while (!placed) {
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) {
                            const testX = gridX + (dx * gridSize);
                            const testY = gridY + (dy * gridSize);
                            const key = `${testX},${testY}`;
                            
                            if (!occupied.has(key)) {
                                occupied.add(key);
                                initPos[id] = { x: testX, y: testY };
                                placed = true;
                                break;
                            }
                        }
                    }
                    if (placed) break;
                }
                radius++;
            }
        });
    } else {
        // Fallback de segurança se o sistema não enviar posições iniciais
        nodesArray.forEach((id, i) => {
            initPos[id] = { x: (i % 10) * gridSize, y: Math.floor(i / 10) * gridSize };
        });
    }

    // 1. ESTADO INICIAL: "Snap to Grid" (Encaixe na Malha)
    // ... (seu código do initPos até o const adj = {}; está perfeito) ...

    const allBranches = branchesArray;
    const activeBranches = branchesArray.filter(b => b.state === 1);
        
    // Mapeia conexões ativas para cálculos de distância
    const adj = {};
    nodesArray.forEach(id => { adj[id] = []; });
    activeBranches.forEach(b => { adj[b.from].push(b.to); adj[b.to].push(b.from); });

    let bestPos = clonePos(initPos);
    let bestCost = objectiveFunction(bestPos, allBranches, adj);

    // Função auxiliar para UI saber quantos cruzamentos restam (Agora conta abertas e fechadas)
    const countAllCrossings = (pos) => {
        let c = 0;
        for (let i = 0; i < allBranches.length - 1; i++) {
            for (let j = i + 1; j < allBranches.length; j++) {
                const a = allBranches[i], b = allBranches[j];
                if (a.from===b.from||a.from===b.to||a.to===b.from||a.to===b.to) continue;
                const p1=pos[a.from],p2=pos[a.to],p3=pos[b.from],p4=pos[b.to];
                if (p1&&p2&&p3&&p4&&segmentsIntersect(p1,p2,p3,p4)) c++;
            }
        }
        return c;
    };

    // CORREÇÃO: Apenas UMA chamada no onProgress inicial
    if (onProgress) onProgress(0, bestCost, countAllCrossings(bestPos));

    const K_MAX = 4; let k = 1; let iter = 0;

    // Loop principal do VNS
    while (iter < maxIter) {
        iter++;
        let candidate;
        
        // Alterna entre as 4 estratégias de vizinhança
        switch (k) {
            case 1: candidate = perturbN1(bestPos, nodesArray); break;
            case 2: candidate = perturbN2(bestPos, nodesArray, gridSize, n2Radius, allBranches, adj, bestCost); break;
            case 3: candidate = perturbN3(bestPos, nodesArray, allBranches, adj); break;
            case 4: default: candidate = perturbN4(bestPos, nodesArray, adj, n4Depth); break;
        }

        const candidateCost = objectiveFunction(candidate, allBranches, adj);
        // Tenta melhorar o candidato fazendo pequenas trocas rápidas
        const localCost = localSearch(candidate, nodesArray, allBranches, adj, candidateCost, lsTrials);

        // CORREÇÃO: Usar countAllCrossings no loop
        if (onProgress) onProgress(iter, localCost, countAllCrossings(candidate));

        // Se o custo for menor (melhor), aceita a nova rede e volta para a estratégia 1
        if (localCost < bestCost) { 
            bestCost = localCost; 
            bestPos = clonePos(candidate); 
            k = 1; 
        } else { 
            // Se falhou, avança para uma estratégia de vizinhança mais agressiva
            k = (k % K_MAX) + 1; 
        }
    }

    // CORREÇÃO: Usar countAllCrossings no console.log
    console.log(`[VNS] Custo final: ${bestCost.toFixed(1)} | Cruzamentos: ${countAllCrossings(bestPos)}`);
    
    return bestPos;
}

// =========================================================
// 6. MOTOR ESTELAR (STARBURST / DAGRE RADIAL)
// =========================================================
export function calculateStarburstLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 1. Gera o layout hierárquico padrão (Árvore de cima para baixo)
    const basePos = calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, { ...config, rankdir: 'TB' });

    // 2. Encontra os limites do layout para normalização
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    nodesArray.forEach(id => {
        if (basePos[id].x < minX) minX = basePos[id].x;
        if (basePos[id].x > maxX) maxX = basePos[id].x;
        if (basePos[id].y < minY) minY = basePos[id].y;
        if (basePos[id].y > maxY) maxY = basePos[id].y;
    });

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    const positions = {};

    // 3. Converte as coordenadas (X, Y) do Dagre para Polares (Ângulo, Raio)
    nodesArray.forEach(id => {
        const p = basePos[id];

        // A profundidade da árvore (Y) vira o Raio (afastamento do centro)
        const normalizedY = height === 0 ? 0 : (p.y - minY) / height;
        const radius = (normalizedY * height) + (config.ranksep || 120);

        // A posição horizontal (X) vira o Ângulo ao redor do centro
        const normalizedX = width === 0 ? 0.5 : (p.x - minX) / width;
        
        // Usamos 1.8 * PI (ao invés de 2*PI completos) para deixar uma pequena "fresta" 
        // e evitar que os nós da extrema esquerda sobreponham os da extrema direita
        const angle = normalizedX * (1.8 * Math.PI) - (0.9 * Math.PI); 

        // Converte de polar de volta para Cartesiano (x, y) para o React renderizar
        positions[id] = {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle)
        };
    });

    return positions;
}