import * as d3 from 'd3-force';
export { calculateHierarchicalLayout } from './hierarchicalLayout';

const D3_DEFAULTS = { distance: 10, charge: -40, openWeight: 0.65, collide: 40 };

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
    // Blindagem de Tipos
    nodesArray = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({ ...b, id: String(b.id), from: String(b.from), to: String(b.to) }));
    sourcesArray = sourcesArray.map(String);
    
    // Fator de Escala
    const escalaDivisor = 20; 
    const sizeFactor = Math.max(1, Math.sqrt(nodesArray.length / escalaDivisor));

    const distVal = (config.distance !== undefined ? config.distance : 40) * sizeFactor;
    const targetCharge = (config.charge !== undefined ? config.charge : -300) * sizeFactor; 
    const col = (config.collide !== undefined ? config.collide : 30) * sizeFactor;
    const openWeight = config.openWeight !== undefined ? config.openWeight : 0.65; 
    const currentPos = config.currentPos || null;

    const nodeDegree = {};
    nodesArray.forEach(id => nodeDegree[id] = 0);
    branchesArray.forEach(b => {
        nodeDegree[b.from] = (nodeDegree[b.from] || 0) + 1;
        nodeDegree[b.to] = (nodeDegree[b.to] || 0) + 1;
    });

    const d3Nodes = nodesArray.map(id => {
        // 👇 NOVO: crossingCount anota o "estresse" do nó
        const nodeObj = { id: id.toString(), isSource: sourcesArray.includes(id), degree: nodeDegree[id] || 0, crossingCount: 0 };
        if (currentPos && currentPos[id]) { nodeObj.x = currentPos[id].x; nodeObj.y = currentPos[id].y; }
        return nodeObj;
    });
    
    const d3Links = branchesArray.map(b => ({ 
        source: b.from.toString(), 
        target: b.to.toString(), 
        id: b.id,
        isOpen: String(b.state) === '0' || String(b.initialState) === '0',
        weight: b.__weight || 1,
        isCrossing: false // 👇 NOVO: Flag de alerta da linha
    }));

    // Forças Base
    const chargeForce = d3.forceManyBody()
        .strength(d => d.isSource ? targetCharge * 30 : targetCharge * (1 + (d.degree * 1.5)))
        .distanceMax(distVal * 15); 

    const linkForce = d3.forceLink(d3Links)
        .id(d => d.id)
        .distance(d => {
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            const baseDist = (d.isOpen ? distVal * 1.5 : distVal) + ((degSource + degTarget) * 5); 
            return baseDist * d.weight; 
        })
        .strength(d => d.isOpen ? openWeight : 1.5); 

    const collideForce = d3.forceCollide().radius(col);

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", linkForce).force("charge", chargeForce)
        .force("center", d3.forceCenter(0, 0))
        .force("collide", collideForce).stop();

    // ===============================================================
    // FASE 1: Assentamento Inicial (300 ciclos)
    // O sistema monta a geometria bruta.
    // ===============================================================
    for (let i = 0; i < 300; ++i) {
        simulation.tick(); 
    }

    // ===============================================================
    // FASE 2: O Radar de Cruzamentos (Geometria Analítica)
    // ===============================================================
    let crossingsCount = 0;
    
    // Zera contadores (segurança)
    d3Links.forEach(l => l.isCrossing = false);
    d3Nodes.forEach(n => n.crossingCount = 0);

    for (let i = 0; i < d3Links.length; i++) {
        const l1 = d3Links[i];
        for (let j = i + 1; j < d3Links.length; j++) {
            const l2 = d3Links[j];
            
            // Se as duas linhas dividem a mesma barra, formando um "V", não é cruzamento.
            if (l1.source === l2.source || l1.source === l2.target || l1.target === l2.source || l1.target === l2.target) continue;

            // segmentsIntersect verifica a colisão no plano cartesiano usando a posição final (x,y)
            if (segmentsIntersect(l1.source, l1.target, l2.source, l2.target)) {
                l1.isCrossing = true;
                l2.isCrossing = true;
                l1.source.crossingCount++;
                l1.target.crossingCount++;
                l2.source.crossingCount++;
                l2.target.crossingCount++;
                crossingsCount++;
            }
        }
    }

    console.log(`[Motor Force] Radar ativado: ${crossingsCount} cruzamentos detectados no esqueleto.`);

    // ===============================================================
    // FASE 3 e 4: Mutação e Desembaraço (Somente se houver cruzamentos)
    // ===============================================================
    if (crossingsCount > 0) {
        // Altera as regras da física!
        
        // 1. Injeta "bombas de repulsão" nos nós engavetados
        chargeForce.strength(d => {
            let base = d.isSource ? targetCharge * 30 : targetCharge * (1 + (d.degree * 1.5));
            if (d.crossingCount > 0) {
                // Multiplica a força de repulsão dependendo do nível de confusão do nó
                base *= (1 + (d.crossingCount * 3)); 
            }
            return base;
        });

        // 2. Transforma as linhas cruzadas em hastes gigantes para forçar espaço
        linkForce.distance(d => {
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            const baseDist = (d.isOpen ? distVal * 1.5 : distVal) + ((degSource + degTarget) * 5); 
            let finalDist = baseDist * d.weight;
            
            if (d.isCrossing) {
                finalDist *= 3.5; // Cabo cruzado exige quase 4x mais espaço!
            }
            return finalDist;
        });

        // Reaquece o motor (Aquece a "temperatura" da simulação)
        simulation.alpha(0.8);

        // Roda mais 300 ciclos com as novas leis atuando como alavancas
        for (let i = 0; i < 300; ++i) {
            simulation.tick();
        }
        
        console.log("[Motor Force] Operação de desembaraço concluída.");
    } else {
        console.log("[Motor Force] Grafo limpo na primeira passada!");
    }

    const positions = {};
    d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
    return positions;
}
// =========================================================
// FASE 4: SWAP GLOBAL INTELIGENTE
// =========================================================
function applySmartGlobalSwap(pos, nodesArray, branchesArray, sourcesArray, feederMap, getLocalCost, getSystemCost) {
    let improved = false;
    
    const levels = {};
    const adj = {};
    nodesArray.forEach(id => adj[id] = []);
    branchesArray.forEach(b => {
        if (b.state === 1) {
            if (adj[b.from]) adj[b.from].push(b.to);
            if (adj[b.to]) adj[b.to].push(b.from);
        }
    });
    
    const queue = [...sourcesArray].map(id => ({id, depth: 0}));
    const visited = new Set(sourcesArray);
    sourcesArray.forEach(id => levels[id] = 0);

    while(queue.length > 0) {
        const {id, depth} = queue.shift();
        if(adj[id]) {
            adj[id].forEach(nxt => {
                if(!visited.has(nxt)) {
                    visited.add(nxt);
                    levels[nxt] = depth + 1;
                    queue.push({id: nxt, depth: depth + 1});
                }
            });
        }
    }

    let evaluations = 0;
    let bestSystemCost = getSystemCost(pos);

    for (let i = 0; i < nodesArray.length; i++) {
        if (evaluations > 5000) break;
        
        for (let j = i + 1; j < nodesArray.length; j++) {
            if (evaluations > 5000) break;

            const idA = nodesArray[i];
            const idB = nodesArray[j];

            const sameLevel = levels[idA] !== undefined && levels[idA] === levels[idB];
            const sameFeeder = feederMap[idA] !== undefined && feederMap[idA] === feederMap[idB];

            if (sameLevel || sameFeeder) {
                evaluations++;
                
                const posA = pos[idA];
                const posB = pos[idB];

                const localCostBefore = getLocalCost(idA, posA.x, posA.y, pos) + getLocalCost(idB, posB.x, posB.y, pos);
                const localCostAfter = getLocalCost(idA, posB.x, posB.y, pos) + getLocalCost(idB, posA.x, posA.y, pos);

                if ((localCostAfter - localCostBefore) < 20000) {
                    pos[idA] = posB;
                    pos[idB] = posA;
                    
                    const newSystemCost = getSystemCost(pos);
                    
                    if (newSystemCost < bestSystemCost) {
                        bestSystemCost = newSystemCost;
                        improved = true;
                    } else {
                        pos[idA] = posA;
                        pos[idB] = posB;
                    }
                }
            }
        }
    }
    return improved;
}

// =============================================================================
// MOTOR DE INTELIGÊNCIA: ASSÍNCRONO & CUSTO LOCAL OTIMIZADO
// =============================================================================
async function applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, maxIter, onProgress, feederMap = {}) {
    const myEdgesMap = {};
    const otherEdgesMap = {};
    nodesArray.forEach(id => {
        myEdgesMap[id] = branchesArray.filter(b => b.from === id || b.to === id);
        otherEdgesMap[id] = branchesArray.filter(b => b.from !== id && b.to !== id);
    });

    const getLocalCost = (id, testX, testY, currentPos) => {
        let cost = 0;
        const testPos = { x: testX, y: testY };
        const myEdges = myEdgesMap[id];
        const otherEdges = otherEdgesMap[id];

        for (let i = 0; i < myEdges.length; i++) {
            const b = myEdges[i];
            const isFrom = b.from === id;
            const p1 = isFrom ? testPos : currentPos[b.from];
            const p2 = isFrom ? currentPos[b.to] : testPos;

            const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            cost += b.state === 1 ? distance * 4 : distance * 0.1;

            const dx = Math.abs(p1.x - p2.x); const dy = Math.abs(p1.y - p2.y);
            if (dx > 0.1 && dy > 0.1) cost += Math.abs(dx - dy) < 0.1 ? 2000 : 20000;

            for (let j = 0; j < nodesArray.length; j++) {
                const oId = nodesArray[j];
                if (oId !== b.from && oId !== b.to && getDistToSegment(currentPos[oId], p1, p2) < 5) {
                    cost += sourcesArray.includes(oId) ? 500000 : 200000;
                }
            }
            for (let k = 0; k < otherEdges.length; k++) {
                const ob = otherEdges[k];
                const p3 = currentPos[ob.from], p4 = currentPos[ob.to];
                if (p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                    let penalty = 10000; 
                    const isSourceInvolved = sourcesArray.includes(b.from) || sourcesArray.includes(b.to) || sourcesArray.includes(ob.from) || sourcesArray.includes(ob.to);
                    if (isSourceInvolved) {
                        penalty = 100000; 
                    } else if (feederMap[b.from] !== feederMap[ob.from]) {
                        penalty = 50000; 
                    }
                    cost += penalty;
                }
            }
        }

        for (let k = 0; k < otherEdges.length; k++) {
            const ob = otherEdges[k];
            const p3 = currentPos[ob.from], p4 = currentPos[ob.to];
            if (p3 && p4 && getDistToSegment(testPos, p3, p4) < 5) {
                cost += sourcesArray.includes(id) ? 500000 : 200000;
            }
        }
        return cost;
    };

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

        await new Promise(resolve => setTimeout(resolve, 0)); 
        if (onProgress) onProgress(passes, "Calculando Otimizações...", "Aguarde...");

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodesArray.forEach(id => {
            if (pos[id].x < minX) minX = pos[id].x; if (pos[id].x > maxX) maxX = pos[id].x;
            if (pos[id].y < minY) minY = pos[id].y; if (pos[id].y > maxY) maxY = pos[id].y;
        });

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

        const swapImproved = applySmartGlobalSwap(
            pos, nodesArray, branchesArray, sourcesArray, feederMap, 
            getLocalCost, getSystemCost
        );
        if (swapImproved) improved = true;

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
                        if (testCost < bestLocalCost - 5) {
                            bestLocalCost = testCost; bestPos = { x: tx, y: ty };
                        }
                    }
                }
            }
            if (bestPos) { pos[id] = bestPos; improved = true; }
        }

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

export async function calculateOrthogonalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
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
    return await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, radialStep, 8, config.onProgress, config.feederMap);
}

export async function calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
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
    const finalPos = await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, maxIter, config.onProgress, config.feederMap);
    if (config.onProgress) config.onProgress("Concluído", "Finalizado", "-");
    return finalPos;
}

export function classifyTopology(nodesArray, branchesArray) {
    // 1. Contagem Básica
    const nodesCount = nodesArray.length;
    const edgesCount = branchesArray.length;
    
    let openSwitches = 0;
    let closedEdges = 0;

    const adj = {};
    nodesArray.forEach(n => adj[String(n)] = []);
    
    // Filtramos para entender o que é o esqueleto (fechado) e o que são as tie-lines (abertas)
    branchesArray.forEach(b => {
        const isOpen = String(b.state) === '0' || String(b.initialState) === '0';
        if (isOpen) {
            openSwitches++;
        } else {
            closedEdges++;
            const u = String(b.from);
            const v = String(b.to);
            if (!adj[u]) adj[u] = [];
            if (!adj[v]) adj[v] = [];
            adj[u].push(v);
            adj[v].push(u);
        }
    });

    // 2. Análise de Ilhas (Componentes Elétricos / Alimentadores isolados)
    const visited = new Set();
    let components = 0;

    nodesArray.forEach(n => {
        const nodeId = String(n);
        if (!visited.has(nodeId)) {
            components++;
            const queue = [nodeId];
            visited.add(nodeId);
            while (queue.length > 0) {
                const curr = queue.shift();
                (adj[curr] || []).forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }
        }
    });

    // 3. Fórmula de Euler para Grafos (Calcula se existem anéis elétricos fechados)
    const electricalLoops = closedEdges - nodesCount + components;

    // =========================================================
    // 4. A ÁRVORE DE DECISÃO: Como um Engenheiro escolhe o Layout
    // =========================================================
    let recommendedEngine = 'force'; // Default: Nosso motor poderoso
    let typeName = "Desconhecida";

    if (electricalLoops > 0) {
        typeName = `Malhado (${electricalLoops} Anéis Fechados)`;
        // Sistemas de transmissão malhados. Precisam de física se forem grandes.
        recommendedEngine = nodesCount > 80 ? 'force' : 'vns';
        
    } else if (openSwitches > 0 || components > 1) {
        typeName = `Radial Interligado (${components} Alimentadores, ${openSwitches} Chaves Abertas)`;
        // O cenário clássico de Distribuição (IEEE 33, 69, 123...). 
        // O Force é OBRIGATÓRIO aqui para forçar os alimentadores a se afastarem!
        recommendedEngine = 'force';
        
    } else {
        typeName = "Radial Simples (Árvore Pura)";
        // Sem chaves abertas e apenas 1 raiz.
        if (nodesCount < 30) {
            recommendedEngine = 'orthogonal'; // Pequeno? Fica bonito como diagrama unifilar quadrado.
        } else if (nodesCount < 80) {
            recommendedEngine = 'vns';        // Médio? O VNS ajusta no grid sem esmagar.
        } else {
            recommendedEngine = 'force';      // Muito grande? Só a física resolve sem sobrepor.
        }
    }

    return { 
        type: typeName,
        electricalLoops, 
        components, 
        nodesCount, 
        edgesCount, 
        openSwitches,
        recommendedEngine 
    };
}

export function applyBarycenterSweep(positions, nodesArray, branchesArray, sourcesArray, gridSize = 100) {
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.forEach(b => {
        if (b.state === 1 || b.initialState === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });

    const levels = {};
    const nodeLevel = {};
    const visited = new Set();
    const queue = [];

    sourcesArray.forEach(s => {
        if (nodesArray.includes(s)) {
            visited.add(s);
            queue.push({ id: s, lvl: 0 });
            nodeLevel[s] = 0;
            if (!levels[0]) levels[0] = [];
            levels[0].push(s);
        }
    });

    nodesArray.forEach(n => {
        if (!visited.has(n) && queue.length === 0) {
            visited.add(n);
            queue.push({ id: n, lvl: 0 });
            nodeLevel[n] = 0;
            if (!levels[0]) levels[0] = [];
            levels[0].push(n);
        }
    });

    while (queue.length > 0) {
        const { id, lvl } = queue.shift();
        const nextLvl = lvl + 1;
        (adj[id] || []).forEach(neighbor => {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                nodeLevel[neighbor] = nextLvl;
                if (!levels[nextLvl]) levels[nextLvl] = [];
                levels[nextLvl].push(neighbor);
                queue.push({ id: neighbor, lvl: nextLvl });
            }
        });
    }

    const newPositions = JSON.parse(JSON.stringify(positions));
    const maxLvl = Math.max(...Object.keys(levels).map(Number));

    if (levels[0]) {
        const startX0 = -((levels[0].length - 1) * gridSize * 3) / 2;
        levels[0].forEach((subId, idx) => {
            if (newPositions[subId]) {
                newPositions[subId].x = startX0 + idx * (gridSize * 3);
                newPositions[subId].y = 0; 
            }
        });
    }

    for (let l = 1; l <= maxLvl; l++) {
        const currentLevelNodes = levels[l];
        if (!currentLevelNodes) continue;

        const barycenters = currentLevelNodes.map(nodeId => {
            const parents = (adj[nodeId] || []).filter(neighbor => nodeLevel[neighbor] === l - 1);
            if (parents.length === 0) {
                return { id: nodeId, barycenter: newPositions[nodeId]?.x || 0 }; 
            }
            const sumX = parents.reduce((sum, p) => sum + (newPositions[p]?.x || 0), 0);
            return { id: nodeId, barycenter: sumX / parents.length };
        });

        barycenters.sort((a, b) => a.barycenter - b.barycenter);

        const avgBarycenter = barycenters.reduce((sum, item) => sum + item.barycenter, 0) / (barycenters.length || 1);
        const startX = avgBarycenter - ((barycenters.length - 1) * gridSize) / 2;

        barycenters.forEach((item, index) => {
            if (newPositions[item.id]) {
                newPositions[item.id].x = startX + index * gridSize;
                newPositions[item.id].y = l * (gridSize * 1.5); 
            }
        });
    }

    return newPositions;
}

// =========================================================
// GRAPH COARSENING HÍBRIDO (PODA + CONTRAÇÃO DE CADEIAS)
// =========================================================

export function contractTopology(nodesArray, branchesArray, sourcesArray) {
    const adj = {};
    nodesArray.forEach(id => adj[String(id)] = new Set());
    
    branchesArray.forEach(b => {
        const u = String(b.from), v = String(b.to);
        if (adj[u] && adj[v]) {
            adj[u].add(v); adj[v].add(u);
        }
    });

    const sourceSet = new Set(sourcesArray.map(String));
    let activeNodes = new Set(nodesArray.map(String));

    // ==========================================
    // FASE 1: PODA DE RAMOS TERMINAIS (Folhas)
    // ==========================================
    const prunedMap = {};
    const leaves = [];
    activeNodes.forEach(id => {
        if (adj[id].size === 1 && !sourceSet.has(id)) leaves.push(id);
    });

    while (leaves.length > 0) {
        const leaf = leaves.shift();
        if (adj[leaf].size !== 1) continue;

        const parent = Array.from(adj[leaf])[0];
        
        // 👇 A MÁGICA ENTRA AQUI 👇
        // Se o pai for uma Fonte/Subestação, nós não engolimos esse nó!
        // Ele sobrevive no mapa e atua como o "toco" (âncora) para o ramal.
        if (sourceSet.has(parent)) {
            continue; 
        }
        // 👆 ======================= 👆

        activeNodes.delete(leaf);
        adj[leaf].delete(parent); 
        if (adj[parent]) adj[parent].delete(leaf);

        if (!prunedMap[parent]) prunedMap[parent] = { nodes: [] };
        prunedMap[parent].nodes.push(leaf);
        
        if (prunedMap[leaf]) {
            prunedMap[parent].nodes.push(...prunedMap[leaf].nodes);
            delete prunedMap[leaf];
        }

        if (adj[parent] && adj[parent].size === 1 && !sourceSet.has(parent)) leaves.push(parent);
    }

    // FASE 2: CONTRAÇÃO DE CADEIAS (Ligação Direta)
    const chainMap = {};
    let macroCounter = 1;
    const visited = new Set();
    const macroEdges = [];

    Array.from(activeNodes).forEach(startNode => {
        if (visited.has(startNode) || sourceSet.has(startNode) || adj[startNode].size !== 2) return;

        const chain = [];
        const queue = [startNode];
        visited.add(startNode);

        while (queue.length > 0) {
            const curr = queue.shift();
            chain.push(curr);
            adj[curr].forEach(neighbor => {
                if (adj[neighbor].size === 2 && !sourceSet.has(neighbor) && !visited.has(neighbor)) {
                    visited.add(neighbor); queue.push(neighbor);
                }
            });
        }

        const chainSet = new Set(chain);
        const anchors = new Set();
        chain.forEach(node => {
            adj[node].forEach(neighbor => { if (!chainSet.has(neighbor)) anchors.add(neighbor); });
        });

        if (chain.length > 0 && anchors.size > 0) {
            const macroId = `__CHAIN_${macroCounter++}`;
            
            chain.forEach(n => activeNodes.delete(n)); 
            
            const ancArray = Array.from(anchors);
            if (ancArray.length === 2) {
                macroEdges.push({ 
                    id: `__EDGE_${macroId}_DIRECT`, 
                    from: ancArray[0], 
                    to: ancArray[1], 
                    state: 1, 
                    __isMacroEdge: true,
                    // 👇 A MÁGICA: A aresta sabe quantos pedaços ela representa!
                    __weight: chain.length + 1 
                });
            }
            
            chainMap[macroId] = { chain: chain, anchors: ancArray };
        }
    });

    // ==========================================
    // FASE 3: A GUILHOTINA
    // ==========================================
    const finalBranches = branchesArray.filter(b => 
        activeNodes.has(String(b.from)) && activeNodes.has(String(b.to))
    );
    finalBranches.push(...macroEdges);

    // 👇 RESTAURADOR DE TIPAGEM PARA O REACT 👇
    // Converte os IDs numéricos de volta para Number para o React reconhecer as Subestações
    const restoreType = (val) => isNaN(val) ? val : Number(val);

    const safeNodes = Array.from(activeNodes).map(restoreType);
    const safeBranches = finalBranches.map(b => ({
        ...b,
        from: restoreType(b.from),
        to: restoreType(b.to)
    }));

    return {
        coarseNodesArray: safeNodes,
        coarseBranchesArray: safeBranches,
        coarseData: { prunedMap, chainMap }
    };
}

export function expandTopology(coarsePos, coarseData, originalPos) {
    const { prunedMap, chainMap } = coarseData;
    const finalPos = { ...coarsePos };

    if (chainMap) {
        Object.keys(chainMap).forEach(macroId => {
            const { chain, anchors } = chainMap[macroId];
            
            if (anchors.length === 2) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                const p2 = coarsePos[anchors[1]] || originalPos[anchors[1]];
                
                if (p1 && p2) {
                    const segments = chain.length + 1;
                    chain.forEach((nodeId, idx) => {
                        const t = (idx + 1) / segments;
                        finalPos[nodeId] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                    });
                }
            } else if (anchors.length === 1) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                if (p1) chain.forEach(nodeId => finalPos[nodeId] = { ...p1 });
            }
        });
    }

    if (prunedMap) {
        Object.keys(prunedMap).forEach(anchor => {
            const anchorNewPos = finalPos[anchor] || coarsePos[anchor];
            const anchorOldPos = originalPos[anchor];
            
            if (anchorNewPos && anchorOldPos) {
                const deltaX = anchorNewPos.x - anchorOldPos.x;
                const deltaY = anchorNewPos.y - anchorOldPos.y;
                prunedMap[anchor].nodes.forEach(nodeId => {
                    const oldP = originalPos[nodeId];
                    if (oldP) finalPos[nodeId] = { x: oldP.x + deltaX, y: oldP.y + deltaY };
                });
            }
        });
    }

    return finalPos;
}