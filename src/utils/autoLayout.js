import * as d3 from 'd3-force';

// =========================================================
// FASE 1: CLASSIFICADOR TOPOLÓGICO
// Analisa a rede para definir o motor de layout ideal
// =========================================================
export function classifyTopology(nodesArray, branchesArray, config = {}) {
    const nodeCount = nodesArray.length;
    const edgeCount = branchesArray.length;
    
    // L = E - V + 1 (Assumindo 1 componente conexo principal)
    const loops = Math.max(0, edgeCount - nodeCount + 1);
    const avgDegree = nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0;

    const sources = config.sources || [];
    const adj = {};
    nodesArray.forEach(id => adj[id] = []);
    branchesArray.forEach(b => {
        if (adj[b.from]) adj[b.from].push(b.to);
        if (adj[b.to]) adj[b.to].push(b.from);
    });

    // BFS para descobrir profundidade máxima
    let maxDepth = 0;
    const visited = new Set(sources);
    const queue = sources.map(id => ({ id, depth: 0 }));

    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth > maxDepth) maxDepth = depth;

        if (adj[id]) {
            adj[id].forEach(neighbor => {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ id: neighbor, depth: depth + 1 });
                }
            });
        }
    }

    // Regras de Decisão de Motor
    let type = 'large';
    let suggestedEngine = 'force';

    if (nodeCount >= 250 || loops > 10) {
        type = 'large';
        suggestedEngine = 'force';
    } else if (loops === 0) {
        type = 'radial';
        suggestedEngine = 'orthogonal';
    } else {
        type = 'weakly_meshed';
        suggestedEngine = 'vns';
    }

    return {
        type,
        suggestedEngine,
        metrics: { loops, maxDepth, avgDegree, nodeCount }
    };
}

// =========================================================
// FASE 2: BARYCENTER SWEEP (Ordenação Hierárquica)
// Reduz cruzamentos alinhando barras por profundidade elétrica
// =========================================================
export function applyBarycenterSweep(positions, nodesArray, branchesArray, sourcesArray, gridSize = 100) {
    if (!positions || Object.keys(positions).length === 0) return positions;
    const newPos = JSON.parse(JSON.stringify(positions));

    // 1. Mapa de Adjacência (Apenas chaves fechadas)
    const adj = {};
    nodesArray.forEach(id => adj[id] = []);
    branchesArray.forEach(b => {
        if (b.state === 1) { 
            if (adj[b.from]) adj[b.from].push(b.to);
            if (adj[b.to]) adj[b.to].push(b.from);
        }
    });

    // 2. BFS para calcular níveis (Profundidade)
    const levels = {};
    const nodesByLevel = {};
    const visited = new Set(sourcesArray);
    const queue = sourcesArray.map(id => ({ id, depth: 0 }));

    sourcesArray.forEach(id => {
        levels[id] = 0;
        if (!nodesByLevel[0]) nodesByLevel[0] = [];
        nodesByLevel[0].push(id);
    });

    let maxLevel = 0;
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (adj[id]) {
            adj[id].forEach(neighbor => {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    const nextDepth = depth + 1;
                    levels[neighbor] = nextDepth;
                    if (!nodesByLevel[nextDepth]) nodesByLevel[nextDepth] = [];
                    nodesByLevel[nextDepth].push(neighbor);
                    queue.push({ id: neighbor, depth: nextDepth });
                    if (nextDepth > maxLevel) maxLevel = nextDepth;
                }
            });
        }
    }

    // 3. Varredura de Baricentro (Barycenter Sweep) - Top-Down
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
        const currentNodes = nodesByLevel[lvl];
        if (!currentNodes || currentNodes.length <= 1) continue;

        const nodeStats = currentNodes.map(nodeId => {
            // Encontra os pais deste nó (vizinhos que estão no nível anterior)
            const parents = adj[nodeId].filter(neighbor => levels[neighbor] === lvl - 1);
            
            let barycenterX = 0;
            if (parents.length > 0) {
                const sumX = parents.reduce((sum, parentId) => sum + (newPos[parentId]?.x || 0), 0);
                barycenterX = sumX / parents.length;
            } else {
                barycenterX = newPos[nodeId]?.x || 0;
            }
            return { id: nodeId, barycenterX };
        });

        // 4. Ordene os nós pela atração gravitacional dos pais
        nodeStats.sort((a, b) => a.barycenterX - b.barycenterX);

        // 5. Pega o grid/espaço que estava ocupado por esse nível e repassa na nova ordem
        const availableXCoords = currentNodes.map(id => newPos[id]?.x || 0).sort((a, b) => a - b);

        nodeStats.forEach((stat, index) => {
            if (newPos[stat.id]) {
                newPos[stat.id].x = availableXCoords[index];
            }
        });
    }

    return newPos;
}

export const D3_DEFAULTS = { distance: 10, charge: -40, openWeight: 0.65, collide: 40 };

export function getDistToSegment(p, a, b) {
    if (!p || !a || !b) return Infinity;
    const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.y - a.y, 2));
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t)); 
    const projX = a.x + t * (b.x - a.x);
    const projY = a.y + t * (b.y - a.y);
    return Math.sqrt(Math.pow(p.x - projX, 2) + Math.pow(p.y - projY, 2));
}

const segmentsIntersect = (p1, p2, p3, p4) => {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
};

const dist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

function applyProportionalScaling(nodesArray, branchesArray, actualPositions, targetGridSize) {
    if (!actualPositions || Object.keys(actualPositions).length === 0) return actualPositions;
    let edgeLengths = [];
    branchesArray.forEach(b => {
        const p1 = actualPositions[b.from], p2 = actualPositions[b.to];
        if (p1 && p2) edgeLengths.push(dist(p1, p2));
    });
    edgeLengths.sort((a, b) => a - b);
    let currentGrid = edgeLengths.length > 0 ? edgeLengths[Math.floor(edgeLengths.length / 2)] : targetGridSize;
    if (currentGrid < 10) currentGrid = targetGridSize;
    const rawScale = targetGridSize / currentGrid;
    const scale = Math.min(Math.max(rawScale, 0.2), 3.0);
    let cx = 0, cy = 0;
    nodesArray.forEach(id => { cx += actualPositions[id]?.x || 0; cy += actualPositions[id]?.y || 0; });
    cx /= nodesArray.length || 1; cy /= nodesArray.length || 1;
    const scaledPos = {};
    nodesArray.forEach(id => {
        scaledPos[id] = { x: cx + ((actualPositions[id]?.x || 0) - cx) * scale, y: cy + ((actualPositions[id]?.y || 0) - cy) * scale };
    });
    return scaledPos;
}

export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 👇 BLINDAGEM DE TIPOS (Garante que todos os IDs sejam Strings estritas) 👇
    nodesArray = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({ ...b, id: String(b.id), from: String(b.from), to: String(b.to) }));
    sourcesArray = sourcesArray.map(String);
    
    const distVal = config.distance !== undefined ? config.distance : D3_DEFAULTS.distance;
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
        .strength(d => targetCharge * (1 + (d.degree * 5)))
        .distanceMax(distVal * 6);

    const linkForce = d3.forceLink(d3Links)
        .id(d => d.id)
        .distance(d => {
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            return (d.isOpen ? distVal * 1.5 : distVal) + ((degSource + degTarget) * 10);
        })
        .strength(d => d.isOpen ? openWeight : ((nodeDegree[d.source.id] <= 2 || nodeDegree[d.target.id] <= 2) ? 1.5 : 1));

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", linkForce).force("charge", chargeForce)
        .force("center", d3.forceCenter(0, 0))
        .force("collide", d3.forceCollide().radius(col)).stop();

    const maxChargeMulti = 5; 
    const totalTicks = 500; // Reduzido de 900 para otimizar velocidade em sistemas de 400 barras
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
        chargeForce.strength(d => targetCharge * (1 + (d.degree * 5)) * phaseMultiplier);
        simulation.alpha(Math.max(0.01, currentAlpha)).tick(); 
    }

    const positions = {};
    d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
    return positions;
}

// =============================================================================
// MOTOR DE INTELIGÊNCIA: ASSÍNCRONO & CUSTO LOCAL OTIMIZADO (100x mais rápido)
// =============================================================================
async function applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, maxIter, onProgress, feederMap = {}) {
    // PRÉ-CALCULO: Mapeia as conexões para avaliação super-rápida (Custo Local)
    const myEdgesMap = {};
    const otherEdgesMap = {};
    nodesArray.forEach(id => {
        myEdgesMap[id] = branchesArray.filter(b => b.from === id || b.to === id);
        otherEdgesMap[id] = branchesArray.filter(b => b.from !== id && b.to !== id);
    });

    // Função ultra-rápida: Só calcula o custo do que está ligado à barra sendo testada
    const getLocalCost = (id, testX, testY, currentPos) => {
        let cost = 0;
        const testPos = { x: testX, y: testY };
        const myEdges = myEdgesMap[id];
        const otherEdges = otherEdgesMap[id];

        // 1. Minhas Linhas
        for (let i = 0; i < myEdges.length; i++) {
            const b = myEdges[i];
            const isFrom = b.from === id;
            const p1 = isFrom ? testPos : currentPos[b.from];
            const p2 = isFrom ? currentPos[b.to] : testPos;

            const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            cost += b.state === 1 ? distance * 4 : distance * 0.1;

            const dx = Math.abs(p1.x - p2.x); const dy = Math.abs(p1.y - p2.y);
            if (dx > 0.1 && dy > 0.1) cost += Math.abs(dx - dy) < 0.1 ? 2000 : 20000;

            // Meu cabo atropela alguém?
            for (let j = 0; j < nodesArray.length; j++) {
                const oId = nodesArray[j];
                if (oId !== b.from && oId !== b.to && getDistToSegment(currentPos[oId], p1, p2) < 5) {
                    cost += sourcesArray.includes(oId) ? 500000 : 200000;
                }
            }
            // Meu cabo cruza outra linha?
            for (let k = 0; k < otherEdges.length; k++) {
                const ob = otherEdges[k];
                const p3 = currentPos[ob.from], p4 = currentPos[ob.to];
                if (p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                    // 👇 AI-PENALTY: Penalização inteligente de cruzamentos
                    let penalty = 10000; // Padrão: Mesmo alimentador
                    
                    const isSourceInvolved = sourcesArray.includes(b.from) || sourcesArray.includes(b.to) || sourcesArray.includes(ob.from) || sourcesArray.includes(ob.to);
                    
                    if (isSourceInvolved) {
                        penalty = 100000; // Máxima prioridade: Não cruzar ramais-fonte
                    } else if (feederMap[b.from] !== feederMap[ob.from]) {
                        penalty = 50000; // Alimentadores diferentes se cruzando
                    }
                    cost += penalty;
                }
            }
        }

        // 2. Cabos dos outros me atropelam?
        for (let k = 0; k < otherEdges.length; k++) {
            const ob = otherEdges[k];
            const p3 = currentPos[ob.from], p4 = currentPos[ob.to];
            if (p3 && p4 && getDistToSegment(testPos, p3, p4) < 5) {
                cost += sourcesArray.includes(id) ? 500000 : 200000;
            }
        }
        return cost;
    };

    // Função pesada (Custo Global) usada apenas na Guilhotina
    const getSystemCost = (currentPos) => {
        let cost = 0;
        branchesArray.forEach(b => {
            const p1 = currentPos[b.from], p2 = currentPos[b.to];
            if (!p1 || !p2) return;
            const distance = dist(p1, p2); cost += b.state === 1 ? distance * 4 : distance * 0.1;
            const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
            if (dx > 0.1 && dy > 0.1) cost += Math.abs(dx - dy) < 0.1 ? 2000 : 20000;
            for (const id of nodesArray) {
                if (id !== b.from && id !== b.to && getDistToSegment(currentPos[id], p1, p2) < 5) cost += sourcesArray.includes(id) ? 500000 : 200000;
            }
        });
        for (let i = 0; i < branchesArray.length - 1; i++) {
            const a = branchesArray[i], p1 = currentPos[a.from], p2 = currentPos[a.to];
            if (!p1 || !p2) continue;
            for (let j = i + 1; j < branchesArray.length; j++) {
                const b = branchesArray[j];
                if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
                const p3 = currentPos[b.from], p4 = currentPos[b.to];
                if (p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                    // 👇 AI-PENALTY: Penalização global
                    let penalty = 10000; 
                    if (sourcesArray.includes(a.from) || sourcesArray.includes(a.to) || sourcesArray.includes(b.from) || sourcesArray.includes(b.to)) {
                        penalty = 100000;
                    } else if (feederMap[a.from] !== feederMap[b.from]) {
                        penalty = 50000;
                    }
                    cost += penalty;
                }
            }
        }
        return cost;
    };

    let passes = 0;
    let improved = true;
    const isOccupied = (tx, ty, currentPos) => nodesArray.some(n => currentPos[n].x === tx && currentPos[n].y === ty);

    while (improved && passes < maxIter) {
        improved = false;
        passes++;

        // A MÁGICA DE INTERFACE: Isso pausa a thread por 0ms, permitindo que a barra de progresso carregue!
        await new Promise(resolve => setTimeout(resolve, 0)); 
        if (onProgress) onProgress(passes, "Calculando Otimizações...", "Aguarde...");

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodesArray.forEach(id => {
            if (pos[id].x < minX) minX = pos[id].x; if (pos[id].x > maxX) maxX = pos[id].x;
            if (pos[id].y < minY) minY = pos[id].y; if (pos[id].y > maxY) maxY = pos[id].y;
        });

        // NÍVEL 1.5: TSM Magnético (Usando custo Local)
        for (const b of branchesArray) {
            if (b.state === 0) continue;
            const p1 = pos[b.from], p2 = pos[b.to];
            if (!p1 || !p2) continue;
            const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
            if (dx < 0.1 || dy < 0.1) continue;

            if (dx > dy) {
                if (!isOccupied(p1.x, p2.y, pos)) {
                    const costBefore = getLocalCost(b.from, pos[b.from].x, pos[b.from].y, pos);
                    const costAfter = getLocalCost(b.from, p1.x, p2.y, pos);
                    if (costAfter < costBefore) { pos[b.from] = { x: p1.x, y: p2.y }; improved = true; continue; }
                }
            } else {
                if (!isOccupied(p1.x, p2.y, pos)) { 
                    const costBefore = getLocalCost(b.to, pos[b.to].x, pos[b.to].y, pos);
                    const costAfter = getLocalCost(b.to, p1.x, p2.y, pos);
                    if (costAfter < costBefore) { pos[b.to] = { x: p1.x, y: p2.y }; improved = true; continue; }
                }
            }
        }

        // NÍVEL 1: Swaps Globais (TRAVA DE SEGURANÇA: Desativa se houver mais de 150 barras)
        if (nodesArray.length <= 150) {
            let bestSystemCost = getSystemCost(pos);
            for (let i = 0; i < nodesArray.length; i++) {
                for (let j = i + 1; j < nodesArray.length; j++) {
                    const idA = nodesArray[i], idB = nodesArray[j];
                    const tmp = pos[idA]; pos[idA] = pos[idB]; pos[idB] = tmp;
                    const cost = getSystemCost(pos);
                    if (cost < bestSystemCost) { bestSystemCost = cost; improved = true; }
                    else { pos[idB] = pos[idA]; pos[idA] = tmp; }
                }
            }
        }

        // NÍVEL 2 e 3: Fuga e Micro-Ajustes (Agora 100x mais rápido usando Custo Local)
        for (const id of nodesArray) {
            const orig = { ...pos[id] };
            const currentMyCost = getLocalCost(id, orig.x, orig.y, pos);
            let bestLocalCost = currentMyCost;
            let bestPos = null;

            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const tx = orig.x + dx * gridSize, ty = orig.y + dy * gridSize;
                    if (tx < minX || tx > maxX || ty < minY || ty > maxY) continue;
                    
                    if (!isOccupied(tx, ty, pos)) {
                        const testCost = getLocalCost(id, tx, ty, pos);
                        if (testCost < bestLocalCost - 5) { // Precisa melhorar pelo menos 5 pontos
                            bestLocalCost = testCost; bestPos = { x: tx, y: ty };
                        }
                    }
                }
            }
            if (bestPos) { pos[id] = bestPos; improved = true; }
        }

        // NÍVEL 4: A PRENSA (Guilhotina Final)
        let currentSystemCost = getSystemCost(pos);
        for (let slice = maxX; slice > minX; slice -= gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].x >= slice) candidatePos[id].x -= gridSize; });
            const cost = getSystemCost(candidatePos); if (cost < currentSystemCost - 1) { currentSystemCost = cost; Object.assign(pos, candidatePos); improved = true; }
        }
        for (let slice = minX; slice < maxX; slice += gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].x <= slice) candidatePos[id].x += gridSize; });
            const cost = getSystemCost(candidatePos); if (cost < currentSystemCost - 1) { currentSystemCost = cost; Object.assign(pos, candidatePos); improved = true; }
        }
        for (let slice = maxY; slice > minY; slice -= gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].y >= slice) candidatePos[id].y -= gridSize; });
            const cost = getSystemCost(candidatePos); if (cost < currentSystemCost - 1) { currentSystemCost = cost; Object.assign(pos, candidatePos); improved = true; }
        }
        for (let slice = minY; slice < maxY; slice += gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].y <= slice) candidatePos[id].y += gridSize; });
            const cost = getSystemCost(candidatePos); if (cost < currentSystemCost - 1) { currentSystemCost = cost; Object.assign(pos, candidatePos); improved = true; }
        }
    }
    return pos;
}

// =========================================================
// AS FUNÇÕES EXPORTADAS AGORA SÃO ASYNC!
// =========================================================
export async function calculateOrthogonalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 👇 BLINDAGEM DE TIPOS (Garante que todos os IDs sejam Strings estritas) 👇
    nodesArray = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({ ...b, id: String(b.id), from: String(b.from), to: String(b.to) }));
    sourcesArray = sourcesArray.map(String);

    const radialStep = config.gridSize || 100;
    const basePos = calculateForceLayout(nodesArray, branchesArray, sourcesArray, {
        distance: radialStep * 0.8, charge: -500, openWeight: config.openWeight, currentPos: config.currentPos
    });
    let pos = {}; const occupied = new Set();
    let cx = 0, cy = 0; nodesArray.forEach(id => { cx += basePos[id]?.x || 0; cy += basePos[id]?.y || 0; });
    cx /= nodesArray.length || 1; cy /= nodesArray.length || 1;
    const sortedIds = [...nodesArray].sort((a, b) => { return (Math.pow((basePos[a]?.x||0)-cx, 2)+Math.pow((basePos[a]?.y||0)-cy, 2)) - (Math.pow((basePos[b]?.x||0)-cx, 2)+Math.pow((basePos[b]?.y||0)-cy, 2)); });
    
    sortedIds.forEach(id => {
        let baseX = Math.round((basePos[id]?.x || 0) / radialStep) * radialStep, baseY = Math.round((basePos[id]?.y || 0) / radialStep) * radialStep;
        let ring = 0; let found = false;
        while (!found) {
            for (let dx = -ring; dx <= ring && !found; dx++) {
                for (let dy = -ring; dy <= ring && !found; dy++) {
                    if (Math.abs(dx) === ring || Math.abs(dy) === ring) {
                        let checkX = baseX + (dx * radialStep), checkY = baseY + (dy * radialStep), key = `${checkX},${checkY}`;
                        if (!occupied.has(key)) { occupied.add(key); pos[id] = { x: checkX, y: checkY }; found = true; }
                    }
                }
            } ring++;
        }
    });
    pos = applyBarycenterSweep(pos, nodesArray, branchesArray, sourcesArray, radialStep);
    return await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, radialStep, 8, config.onProgress, config.feederMap);
}

export async function calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 👇 BLINDAGEM DE TIPOS (Garante que todos os IDs sejam Strings estritas) 👇
    nodesArray = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({ ...b, id: String(b.id), from: String(b.from), to: String(b.to) }));
    sourcesArray = sourcesArray.map(String);
    
    const gridSize = config.gridSize || 100;
    const maxIter = config.maxIter || 30; 
    let pos = {}; const occupied = new Set();
    const scaledPositions = applyProportionalScaling(nodesArray, branchesArray, config.currentPos, gridSize);

    nodesArray.forEach(id => {
        let baseX = Math.round((scaledPositions[id]?.x || 0) / gridSize) * gridSize, baseY = Math.round((scaledPositions[id]?.y || 0) / gridSize) * gridSize;
        let ring = 0, found = false;
        while (!found) {
            for (let dx = -ring; dx <= ring && !found; dx++) {
                for (let dy = -ring; dy <= ring && !found; dy++) {
                    if (Math.abs(dx) === ring || Math.abs(dy) === ring) {
                        let checkX = baseX + dx * gridSize, checkY = baseY + dy * gridSize, key = `${checkX},${checkY}`;
                        if (!occupied.has(key)) { occupied.add(key); pos[id] = { x: checkX, y: checkY }; found = true; }
                    }
                }
            } ring++;
        }
    });

    if (config.onProgress) config.onProgress(1, "Iniciando...", "Aguarde...");
    pos = applyBarycenterSweep(pos, nodesArray, branchesArray, sourcesArray, gridSize);
    const finalPos = await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, maxIter, config.onProgress, config.feederMap);
    if (config.onProgress) config.onProgress("Concluído", "Finalizado", "-");
    return finalPos;
}