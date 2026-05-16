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
// MOTOR DE INTELIGÊNCIA: VNS RESTRITO (O GATEKEEPER DE CRUZAMENTOS)
// =============================================================================

/**
 * Conta apenas atropelamentos (barra sobre linha) — separado dos cruzamentos X.
 * Usado como restrição DURA: qualquer movimento que aumente esse número é vetado.
 */
function countNodeOverlaps(positions, branches, nodeIds) {
    let count = 0;
    const ids = nodeIds || Object.keys(positions);
    for (const b of branches) {
        const A = positions[b.from];
        const B = positions[b.to];
        if (!A || !B) continue;
        for (const nId of ids) {
            if (String(nId) === String(b.from) || String(nId) === String(b.to)) continue;
            const P = positions[nId];
            if (!P) continue;
            if (getDistToSegment(P, A, B) < 5) count++;
        }
    }
    return count;
}

export async function applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, maxIter, onProgress, feederMap = {}, initialCrossings = Infinity) {
    let allowedCrossings = initialCrossings;

    // Restrição dura inicial: atropelamentos presentes no estado de entrada
    // Nenhum movimento pode aumentar esse número
    let hardOverlapLimit = countNodeOverlaps(pos, branchesArray, nodesArray);

    // Função de custo estritamente focada em distâncias e estética ortogonal
    const getSystemCost = (currentPos) => {
        let cost = 0;
        branchesArray.forEach(b => {
            const p1 = currentPos[b.from], p2 = currentPos[b.to];
            if (!p1 || !p2) return;
            const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
            cost += b.state === 1 ? distance * 4 : distance * 0.1;
            
            const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
            if (dx > 0.1 && dy > 0.1) cost += Math.abs(dx - dy) < 0.1 ? 2000 : 20000;
        });
        return cost;
    };

    const isOccupied = (tx, ty, currentPos) => nodesArray.some(n => currentPos[n].x === tx && currentPos[n].y === ty);

    let currentSystemCost = getSystemCost(pos);
    let passes = 0;
    let improved = true;

    while (improved && passes < maxIter) {
        improved = false;
        passes++;

        await new Promise(resolve => setTimeout(resolve, 0)); 
        if (onProgress) onProgress(passes, "Compactando Sistema...", `Tolerância Máxima: ${allowedCrossings} Cruzamentos`);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodesArray.forEach(id => {
            if (pos[id].x < minX) minX = pos[id].x; if (pos[id].x > maxX) maxX = pos[id].x;
            if (pos[id].y < minY) minY = pos[id].y; if (pos[id].y > maxY) maxY = pos[id].y;
        });

        // 1. MOVIMENTOS LOCAIS (Ajustes de Grid)
        for (const id of nodesArray) {
            const orig = { ...pos[id] };
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    
                    const tx = orig.x + dx * gridSize, ty = orig.y + dy * gridSize;
                    if (tx < minX || tx > maxX || ty < minY || ty > maxY) continue;
                    
                    if (!isOccupied(tx, ty, pos)) {
                        const testPos = { ...pos, [id]: { x: tx, y: ty } };
                        
                        // Restrição DURA: vetado se introduz ou aumenta atropelamentos
                        const newOverlaps = countNodeOverlaps(testPos, branchesArray, nodesArray);
                        if (newOverlaps > hardOverlapLimit) continue;

                        // Gatekeeper de cruzamentos X (restrição suave)
                        const c = findIntersections(testPos, branchesArray).length;
                        
                        if (c <= allowedCrossings) {
                            const cost = getSystemCost(testPos);
                            if (cost < currentSystemCost - 5) {
                                pos[id] = { x: tx, y: ty };
                                currentSystemCost = cost;
                                allowedCrossings = c;
                                hardOverlapLimit = newOverlaps; // aperta o cinto também nos atropelamentos
                                improved = true;
                            }
                        }
                    }
                }
            }
        }

        // 2. A GUILHOTINA BLINDADA (Fatiamento de Tela)
        const trySlice = (testPos) => {
            // Verifica se a guilhotina não esmagou dois nós na mesma coordenada
            const uniqueSpots = new Set(Object.values(testPos).map(p => `${p.x},${p.y}`));
            if (uniqueSpots.size !== nodesArray.length) return false;

            // Restrição DURA: vetado se introduz ou aumenta atropelamentos
            const newOverlaps = countNodeOverlaps(testPos, branchesArray, nodesArray);
            if (newOverlaps > hardOverlapLimit) return false;

            // Gatekeeper de cruzamentos X
            const c = findIntersections(testPos, branchesArray).length;
            if (c <= allowedCrossings) {
                const cost = getSystemCost(testPos);
                if (cost < currentSystemCost - 1) {
                    currentSystemCost = cost;
                    allowedCrossings = c;
                    hardOverlapLimit = newOverlaps;
                    Object.assign(pos, testPos);
                    return true;
                }
            }
            return false;
        };

        for (let slice = maxX; slice > minX; slice -= gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].x >= slice) candidatePos[id].x -= gridSize; });
            if(trySlice(candidatePos)) improved = true;
        }
        for (let slice = minX; slice < maxX; slice += gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].x <= slice) candidatePos[id].x += gridSize; });
            if(trySlice(candidatePos)) improved = true;
        }
        for (let slice = maxY; slice > minY; slice -= gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].y >= slice) candidatePos[id].y -= gridSize; });
            if(trySlice(candidatePos)) improved = true;
        }
        for (let slice = minY; slice < maxY; slice += gridSize) {
            const candidatePos = {}; nodesArray.forEach(id => { candidatePos[id] = { ...pos[id] }; if (candidatePos[id].y <= slice) candidatePos[id].y += gridSize; });
            if(trySlice(candidatePos)) improved = true;
        }
    }
    return pos;
}

// =============================================================================
// NOVO MOTOR ORTOGONAL DISCRETO
// EXPAND → ALIGN → COMPACT
// =============================================================================
export async function calculateOrthogonalLayout(
    nodesArray,
    branchesArray,
    sourcesArray,
    config = {}
) {
    nodesArray = nodesArray.map(String);

    branchesArray = branchesArray.map(b => ({
        ...b,
        id: String(b.id),
        from: String(b.from),
        to: String(b.to)
    }));

    const gridSize = config.gridSize || 100;
    const onProgress = config.onProgress || null;

    // =========================================================
    // BASE INICIAL
    // =========================================================
    let pos = {};

    if (config.currentPos && Object.keys(config.currentPos).length > 0) {
        nodesArray.forEach(id => {
            const p = config.currentPos[id];
            pos[id] = {
                x: Math.round((p?.x || 0) / gridSize) * gridSize,
                y: Math.round((p?.y || 0) / gridSize) * gridSize
            };
        });
    } else {
        // Seed simples em grade
        nodesArray.forEach((id, idx) => {
            pos[id] = {
                x: (idx % 10) * gridSize,
                y: Math.floor(idx / 10) * gridSize
            };
        });
    }

    // =========================================================
    // FUNÇÕES AUXILIARES
    // =========================================================

    const distSq = (a, b) => {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    };

    const centerOfMass = () => {
        let cx = 0, cy = 0;

        nodesArray.forEach(id => {
            cx += pos[id].x;
            cy += pos[id].y;
        });

        return {
            x: cx / nodesArray.length,
            y: cy / nodesArray.length
        };
    };

    const occupiedMap = () => {
        const map = new Set();

        nodesArray.forEach(id => {
            map.add(`${pos[id].x},${pos[id].y}`);
        });

        return map;
    };

    const isOccupied = (x, y, ignoreId = null) => {
        for (const id of nodesArray) {
            if (id === ignoreId) continue;

            if (
                pos[id].x === x &&
                pos[id].y === y
            ) return true;
        }

        return false;
    };

    const countCrossings = () => {
        return findIntersections(pos, branchesArray).length;
    };

    // =========================================================
    // FASE 1 — EXPANSÃO LOCAL
    // =========================================================
    if (onProgress) {
        onProgress(1, "Ortogonal", "Expandindo barras...");
    }

    let expanded = true;
    let safety = 0;

    while (expanded && safety < 20) {
        expanded = false;
        safety++;

        for (let i = 0; i < nodesArray.length; i++) {
            for (let j = i + 1; j < nodesArray.length; j++) {

                const idA = nodesArray[i];
                const idB = nodesArray[j];

                const pA = pos[idA];
                const pB = pos[idB];

                const dx = pB.x - pA.x;
                const dy = pB.y - pA.y;

                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < gridSize * 0.95) {

                    expanded = true;

                    const moveX =
                        Math.abs(dx) >= Math.abs(dy)
                            ? (dx >= 0 ? gridSize : -gridSize)
                            : 0;

                    const moveY =
                        Math.abs(dy) > Math.abs(dx)
                            ? (dy >= 0 ? gridSize : -gridSize)
                            : 0;

                    const nx = pB.x + moveX;
                    const ny = pB.y + moveY;

                    if (!isOccupied(nx, ny, idB)) {
                        pos[idB] = { x: nx, y: ny };
                    }
                }
            }
        }
    }

// =========================================================
// FASE 2 — ORTOGONALIZAÇÃO COM RESTRIÇÃO DE CRUZAMENTOS
// =========================================================
if (onProgress) {
    onProgress(2, "Ortogonal", "Otimizando eixos...");
}

let currentCrossings = countCrossings();

let currentOverlaps =
    countNodeOverlaps(
        pos,
        branchesArray,
        nodesArray
    );

const orthogonalityScore = () => {

    let score = 0;

    branchesArray.forEach(b => {

        const p1 = pos[b.from];
        const p2 = pos[b.to];

        if (!p1 || !p2) return;

        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);

        // perfeitamente ortogonal
        if (dx === 0 || dy === 0) {

            score += 1000;

        }
        // penaliza diagonal
        else {

            score -= Math.min(dx, dy) * 25;
        }
    });

    return score;
};

let currentScore = orthogonalityScore();

for (let pass = 0; pass < 30; pass++) {

    let improved = false;

    for (const id of nodesArray) {

        const original = { ...pos[id] };

        const moves = [
            [ gridSize, 0 ],
            [-gridSize, 0 ],
            [0, gridSize],
            [0,-gridSize]
        ];

        for (const [mx, my] of moves) {

            const tx = original.x + mx;
            const ty = original.y + my;

            if (isOccupied(tx, ty, id)) {
                continue;
            }

            // aplica movimento candidato
            pos[id] = { x: tx, y: ty };

            const crossings = countCrossings();

            const overlaps =
                countNodeOverlaps(
                    pos,
                    branchesArray,
                    nodesArray
                );

            const score = orthogonalityScore();

            // =====================================================
            // HARD CONSTRAINTS
            // =====================================================

            // nunca piora cruzamentos
            if (crossings > currentCrossings) {
                pos[id] = original;
                continue;
            }

            // nunca aceita barra em cima de linha
            if (overlaps > currentOverlaps) {
                pos[id] = original;
                continue;
            }

            // =====================================================
            // CRITÉRIO DE ACEITAÇÃO
            // =====================================================

            const moveImproved =

                // crossing melhorou
                (crossings < currentCrossings) ||

                // crossing igual → melhora ortogonalidade
                (
                    crossings === currentCrossings &&
                    overlaps === currentOverlaps &&
                    score > currentScore
                );

            if (moveImproved) {

                currentScore = score;
                currentCrossings = crossings;
                currentOverlaps = overlaps;

                improved = true;

                break;

            } else {

                pos[id] = original;
            }
        }
    }

    if (!improved) {
        break;
    }
}

    // =========================================================
    // FASE 3 — RESOLUÇÃO DE CRUZAMENTOS
    // =========================================================
    if (onProgress) {
        onProgress(3, "Ortogonal", "Resolvendo cruzamentos...");
    }

    for (let iter = 0; iter < 20; iter++) {

        let improved = false;

        for (const id of nodesArray) {

            const original = { ...pos[id] };

            const moves = [
                [ gridSize, 0 ],
                [-gridSize, 0 ],
                [0,  gridSize],
                [0, -gridSize]
            ];

            for (const [mx, my] of moves) {

                const tx = original.x + mx;
                const ty = original.y + my;

                if (isOccupied(tx, ty, id)) continue;

                pos[id] = { x: tx, y: ty };

                const crossings = countCrossings();
                const overlaps = countNodeOverlaps(
                    pos,
                    branchesArray,
                    nodesArray
                );


                if (crossings < currentCrossings) {

                    currentCrossings = crossings;
                    improved = true;
                    break;

                } else {
                    pos[id] = original;
                }
            }
        }

        if (!improved) break;
    }

    // =========================================================
    // FASE 4 — COMPACTAÇÃO CENTRÍPETA
    // =========================================================
    if (onProgress) {
        onProgress(4, "Ortogonal", "Compactando sistema...");
    }

    currentCrossings = countCrossings();

    for (let pass = 0; pass < 50; pass++) {

        let moved = false;

        const center = centerOfMass();

        for (const id of nodesArray) {

            const p = pos[id];

            const dx = center.x - p.x;
            const dy = center.y - p.y;

            const stepX =
                Math.abs(dx) > Math.abs(dy)
                    ? (dx > 0 ? gridSize : -gridSize)
                    : 0;

            const stepY =
                Math.abs(dy) >= Math.abs(dx)
                    ? (dy > 0 ? gridSize : -gridSize)
                    : 0;

            const tx = p.x + stepX;
            const ty = p.y + stepY;

            if (isOccupied(tx, ty, id)) continue;

            const original = { ...p };

            pos[id] = { x: tx, y: ty };

            const crossings = countCrossings();
            const overlaps = countNodeOverlaps(
                pos,
                branchesArray,
                nodesArray
            );


            const score = orthogonalityScore();

            if (
                crossings <= currentCrossings &&
                overlaps <= currentOverlaps &&
                score >= currentScore
            ) {

                currentScore = score;
                currentOverlaps = overlaps;
                currentCrossings = crossings;
                moved = true;

            } else {
                pos[id] = original;
            }
        }

        if (!moved) break;
    }

    // =========================================================
    // FASE 5 — QUANTIZAÇÃO FINAL ABSOLUTA
    // =========================================================
    if (onProgress) {
        onProgress(5, "Ortogonal", "Finalizando grid...");
    }

    const occupied = new Set();

    nodesArray.forEach(id => {

        let x =
            Math.round(pos[id].x / gridSize) * gridSize;

        let y =
            Math.round(pos[id].y / gridSize) * gridSize;

        let ring = 0;

        while (occupied.has(`${x},${y}`)) {

            ring++;

            x += gridSize * ring;
            y += gridSize * ring;
        }

        occupied.add(`${x},${y}`);

        pos[id] = { x, y };
    });

    if (onProgress) {
        onProgress("Concluído", "Ortogonal", "Layout finalizado.");
    }

    return pos;
}

// =============================================================================
// VND — Variable Neighborhood Descent para redes de distribuição
// Opera no grafo COMPLETO usando a estrutura topológica como vizinhanças.
// Nunca retorna resultado pior que o layout original.
// =============================================================================

/**
 * Extrai a estrutura de vizinhança do grafo sem remover nenhum nó.
 * Reutiliza a lógica do contractTopology mas apenas para análise.
 */
function analyzeTopology(nodesArray, branchesArray, sourcesArray) {
    const adj = {};
    nodesArray.forEach(id => { adj[id] = new Set(); });
    branchesArray.forEach(b => {
        if (b.state !== 1) return;
        const u = String(b.from), v = String(b.to);
        if (adj[u] && adj[v]) { adj[u].add(v); adj[v].add(u); }
    });

    const sourceSet = new Set(sourcesArray.map(String));

    // Âncoras: fontes, feeders, e nós com grau ≠ 2
    const anchors = new Set();
    nodesArray.forEach(id => {
        if (sourceSet.has(id) || adj[id].size !== 2) anchors.add(id);
    });

    // Cadeias: sequências de nós com grau 2 entre duas âncoras
    const chains = [];
    const inChain = new Set();
    const visited = new Set();

    nodesArray.forEach(startId => {
        if (visited.has(startId) || anchors.has(startId) || adj[startId].size !== 2) return;

        // Rastreia a cadeia nos dois sentidos a partir do startId
        const buildChain = (start) => {
            const chain = [];
            let prev = null, curr = start;
            while (curr && !anchors.has(curr) && !visited.has(curr)) {
                visited.add(curr);
                chain.push(curr);
                const neighbors = [...adj[curr]].filter(n => n !== prev);
                prev = curr;
                curr = neighbors.length === 1 ? neighbors[0] : null;
            }
            return { chain, endAnchor: curr };
        };

        // Encontra as duas âncoras da cadeia percorrendo nos dois sentidos
        const neighbors = [...adj[startId]];
        if (neighbors.length !== 2) return;

        // Percorre para o lado 0
        const side0 = [];
        let prev0 = startId, curr0 = neighbors[0];
        while (curr0 && !anchors.has(curr0) && !visited.has(curr0)) {
            side0.push(curr0);
            const nbs = [...adj[curr0]].filter(n => n !== prev0);
            prev0 = curr0;
            curr0 = nbs.length === 1 ? nbs[0] : null;
        }
        const anchor0 = curr0;

        // Percorre para o lado 1
        const side1 = [];
        let prev1 = startId, curr1 = neighbors[1];
        while (curr1 && !anchors.has(curr1) && !visited.has(curr1)) {
            side1.push(curr1);
            const nbs = [...adj[curr1]].filter(n => n !== prev1);
            prev1 = curr1;
            curr1 = nbs.length === 1 ? nbs[0] : null;
        }
        const anchor1 = curr1;

        if (!anchor0 || !anchor1) return;

        // Monta a cadeia completa: anchor0 → side0(reversed) → startId → side1 → anchor1
        const fullChain = [...side0.reverse(), startId, ...side1];
        fullChain.forEach(n => { visited.add(n); inChain.add(n); });

        chains.push({ chain: fullChain, anchors: [anchor0, anchor1] });
    });

    // Folhas: nós com grau 1 que não são fontes
    const leaves = [];
    nodesArray.forEach(id => {
        if (adj[id].size === 1 && !sourceSet.has(id)) {
            const anchor = [...adj[id]][0];
            leaves.push({ leaf: id, anchor });
        }
    });

    return { chains, leaves, anchors, adj };
}

/**
 * Coleta os IDs dos nós envolvidos nos cruzamentos detectados.
 * Usado para focar N4 apenas em âncoras relevantes.
 */
function getCrossingNodes(intersections) {
    const nodes = new Set();
    intersections.forEach(ix => {
        // ix.b1 e ix.b2 têm formato "from-to" ou "Barra X"
        [ix.b1, ix.b2].forEach(ref => {
            if (!ref) return;
            if (ref.startsWith('Barra ')) {
                nodes.add(ref.replace('Barra ', ''));
            } else {
                const parts = ref.split('-');
                if (parts.length >= 2) { nodes.add(parts[0]); nodes.add(parts[1]); }
            }
        });
    });
    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIZINHANÇAS DO VND
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES DO NOVO VND MULTIOBJETIVO
// ─────────────────────────────────────────────────────────────────────────────

function expandCandidates(seedNodes, adj, nodesArray, hops) {
    const candidates = new Set(seedNodes);
    let frontier = new Set(seedNodes);
    for (let h = 0; h < hops; h++) {
        const next = new Set();
        frontier.forEach(id => {
            (adj[id] || new Set()).forEach(nb => {
                if (!candidates.has(nb)) { candidates.add(nb); next.add(nb); }
            });
        });
        frontier = next;
    }
    const nodeSet = new Set(nodesArray);
    return [...candidates].filter(id => nodeSet.has(id));
}

// Garante que o Euclidean spacing respeite o gridSize!
function isPositionOccupied(tx, ty, pos, ignoreIds, minDist) {
    const minSq = (minDist * 0.9) ** 2; // Tolerância de 10% do grid
    for (const [id, p] of Object.entries(pos)) {
        if (ignoreIds.has(id)) continue;
        const distSq = (p.x - tx) ** 2 + (p.y - ty) ** 2;
        if (distSq < minSq) return true;
    }
    return false;
}

// O Otimizador de Distância e Estética (O Peso do Centroide agora está FORTE!)
function getLayoutCost(pos, branchesArray, centroidWeight = 0.20) { // 👈 Aumentado para 20%
    let cost = 0;
    let cx = 0, cy = 0, count = 0;
    Object.values(pos).forEach(p => { cx += p.x; cy += p.y; count++; });
    if (count > 0) { cx /= count; cy /= count; }

    branchesArray.forEach(b => {
        const p1 = pos[b.from], p2 = pos[b.to];
        if (p1 && p2) {
            const dx = Math.abs(p1.x - p2.x);
            const dy = Math.abs(p1.y - p2.y);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Dá bônus de 15% de desconto se a linha for perfeitamente horizontal ou vertical!
            const orthoBonus = (dx < 1 || dy < 1) ? 0.85 : 1.0; 
            cost += dist * orthoBonus;
        }
    });

    // Puxa a rede toda para o centro de gravidade com força
    Object.values(pos).forEach(p => {
        cost += Math.sqrt((p.x - cx)**2 + (p.y - cy)**2) * centroidWeight;
    });

    // Penaliza bounding box (zoomExtents) — recompensa layouts compactos
    // Usa 10% do custo médio por unidade de área normalizada
    const vals = Object.values(pos);
    if (vals.length > 1) {
        const xs = vals.map(p => p.x), ys = vals.map(p => p.y);
        const bboxW = Math.max(...xs) - Math.min(...xs);
        const bboxH = Math.max(...ys) - Math.min(...ys);
        // Normaliza pelo número de nós para ser independente do tamanho do sistema
        cost += (bboxW + bboxH) / vals.length * 0.10;
    }

    return cost;
}

function evaluateMove(testPos, branchesArray, nodesArray, currentCrossings, currentCost, currentOverlaps) {
    const newOverlaps = countNodeOverlaps(testPos, branchesArray, nodesArray);
    if (newOverlaps > currentOverlaps) return { accept: false }; // Hard Constraint

    const c = findIntersections(testPos, branchesArray).length;
    if (c > currentCrossings) return { accept: false }; // Hard Constraint

    const cost = getLayoutCost(testPos, branchesArray);

    // Aceita se reduziu os erros, OU se manteve os erros zerados mas melhorou a distância/estética!
    if (c < currentCrossings || (c === currentCrossings && cost < currentCost - 1)) {
        return { accept: true, crossings: c, cost: cost, overlaps: newOverlaps };
    }
    return { accept: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// VIZINHANÇAS DO VND ATUALIZADAS
// ─────────────────────────────────────────────────────────────────────────────

function applyN1(pos, nodesArray, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, radius, adj, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const candidates = expandCandidates(crossingNodes, adj, nodesArray, 1);
    // Se não há cruzamentos, otimiza TODOS os nós buscando aproximar do centro e endireitar!
    const nodesToTest = candidates.length > 0 ? candidates : nodesArray; 

    for (const id of nodesToTest) {
        if (!pos[id]) continue;
        const orig = pos[id];

        // 👇 A MÁGICA DO GRID: A âncora de teste agora é a Malha Absoluta, e não a flutuante! 👇
        const snapX = Math.round(orig.x / gridSize) * gridSize;
        const snapY = Math.round(orig.y / gridSize) * gridSize;

        // Testa todas as células no grid absoluto ao redor do nó
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                
                const tx = snapX + dx * gridSize; 
                const ty = snapY + dy * gridSize;

                // Se a posição de teste for EXATAMENTE a que o nó já está, pula.
                // Mas se o nó estiver fora do grid, dx=0 e dy=0 vai forçar ele a entrar no grid!
                if (Math.abs(tx - orig.x) < 1 && Math.abs(ty - orig.y) < 1) continue;

                // Respeita o distanciamento da grade (Euclidiano)
                if (isPositionOccupied(tx, ty, pos, new Set([id]), gridSize)) continue;

                const testPos = { ...pos, [id]: { x: tx, y: ty } };
                const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

                if (ev.accept) {
                    bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                    pos[id] = { x: tx, y: ty };
                    improved = true;
                }
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN2(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, maxSteps, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const directions = [];
    for (let s = 1; s <= maxSteps; s++) directions.push([s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, s], [s, -s], [-s, -s]);

    for (const { chain, anchors } of chains) {
        if (anchors.length !== 2) continue;
        const [a0, a1] = anchors;
        if (!pos[a0] || !pos[a1]) continue;

        const relevant = [...chain, a0, a1].some(id => crossingNodes.has(id));
        if (crossingNodes.size > 0 && !relevant) continue; // Pula se houver cruzamentos em outro lugar

        for (const [ddx, ddy] of directions) {
            const ox = ddx * gridSize, oy = ddy * gridSize;
            const newPositions = {}; let collision = false; const chainSet = new Set(chain);

            chain.forEach(id => {
                const np = { x: (pos[id]?.x || 0) + ox, y: (pos[id]?.y || 0) + oy };
                if (isPositionOccupied(np.x, np.y, pos, chainSet, gridSize)) collision = true;
                else newPositions[id] = np;
            });
            if (collision) continue;

            const testPos = { ...pos, ...newPositions };
            const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

            if (ev.accept) {
                bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                Object.assign(pos, newPositions);
                improved = true; break;
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN3(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    for (const { chain, anchors } of chains) {
        if (anchors.length !== 2 || chain.length < 2) continue;
        const [a0, a1] = anchors;
        if (!pos[a0] || !pos[a1]) continue;

        const p0 = pos[a0], p1 = pos[a1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;

        const reflected = {};
        chain.forEach(id => {
            const p = pos[id]; if (!p) return;
            const t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2;
            const projX = p0.x + t * dx, projY = p0.y + t * dy;
            reflected[id] = { x: 2 * projX - p.x, y: 2 * projY - p.y };
        });

        const chainSet = new Set(chain);
        let collision = false;
        for (const np of Object.values(reflected)) {
            if (isPositionOccupied(np.x, np.y, pos, chainSet, gridSize)) { collision = true; break; }
        }
        if (collision) continue;

        const testPos = { ...pos, ...reflected };
        const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

        if (ev.accept) {
            bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
            Object.assign(pos, reflected);
            improved = true;
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN4(pos, nodesArray, branchesArray, currentCrossings, currentCost, currentOverlaps, crossingNodes, adj) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const candidates = expandCandidates(crossingNodes, adj, nodesArray, 1);
    const nodesToTest = candidates.length > 1 ? candidates : nodesArray; 

    for (let i = 0; i < nodesToTest.length; i++) {
        for (let j = i + 1; j < nodesToTest.length; j++) {
            const idA = nodesToTest[i], idB = nodesToTest[j];
            if (!pos[idA] || !pos[idB]) continue;

            const testPos = { ...pos, [idA]: pos[idB], [idB]: pos[idA] };
            const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

            if (ev.accept) {
                bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                const tmp = pos[idA]; pos[idA] = pos[idB]; pos[idB] = tmp;
                improved = true;
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}


// ─────────────────────────────────────────────────────────────────────────────
// MOTOR PRINCIPAL VND
// ─────────────────────────────────────────────────────────────────────────────
export async function calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    nodesArray    = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({
        ...b, id: String(b.id), from: String(b.from), to: String(b.to)
    }));
    sourcesArray = sourcesArray.map(String);

    const gridSize   = config.gridSize || 100;
    const maxIter    = config.maxIter  || 50;
    const onProgress = config.onProgress || null;

    const originalPos = config.currentPos
        ? Object.fromEntries(Object.entries(config.currentPos).map(([k, v]) => [k, { ...v }]))
        : null;
        
    let pos = originalPos ? Object.fromEntries(Object.entries(originalPos).map(([k, v]) => [k, { ...v }])) : {};

    const { chains, leaves, anchors, adj } = analyzeTopology(nodesArray, branchesArray, sourcesArray);

    let currentCrossings = originalPos ? findIntersections(originalPos, branchesArray).length : Infinity;
    let currentCost = getLayoutCost(pos, branchesArray);
    let currentOverlaps = countNodeOverlaps(pos, branchesArray, nodesArray);

    if (onProgress) onProgress(1, 'VND', `Iniciando: ${currentCrossings} Cruzamentos`);

    let k = 1;           
    let iter = 0;
    let n1Radius = 2;    

    while (k <= 4 && iter < maxIter) {
        iter++;
        await new Promise(resolve => setTimeout(resolve, 0)); 

        const intersections  = findIntersections(pos, branchesArray);
        const crossingNodes  = getCrossingNodes(intersections);

        if (onProgress) onProgress(iter, `VND N${k}`, `${currentCrossings} cruzamento(s) | Custo: ${Math.round(currentCost)}`);

        let result;
        if (k === 1) {
            result = applyN1(pos, nodesArray, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, n1Radius, adj, crossingNodes);
        } else if (k === 2) {
            result = applyN2(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, 3, crossingNodes);
        } else if (k === 3) {
            result = applyN3(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, crossingNodes);
        } else {
            result = applyN4(pos, nodesArray, branchesArray, currentCrossings, currentCost, currentOverlaps, crossingNodes, adj);
        }

        if (result.improved) {
            currentCrossings = result.crossings;
            currentCost = result.cost;
            currentOverlaps = result.overlaps;
            k = 1;          
            n1Radius = 2;   
        } else {
            if (k === 1 && n1Radius < 5) n1Radius++;
            else { k++; n1Radius = 2; }
        }
    }

    if (onProgress) onProgress('Concluído', 'VND', `Custo final alcançado.`);
    return pos;
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
    const finalPos = { ...coarsePos };
    if (!coarseData) return finalPos; 
    
    const { prunedMap, chainMap } = coarseData;

    // 1. Expansão Linear Simples (O Trilho)
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
                        // Matemática Pura: Alinha perfeitamente sem erros!
                        finalPos[nodeId] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                    });
                }
            } else if (anchors.length === 1) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                if (p1) chain.forEach(nodeId => finalPos[nodeId] = { ...p1 });
            }
        });
    }

    // 2. Expansão das Folhas (Poda)
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

// =========================================================
// RELAXAMENTO FÍSICO COM EIXOS RESTRITOS (A Sua Ideia!)
// =========================================================
export function relaxExpandedNodes(expandedPositions, skeletonNodeIds, allNodesArray, branchesArray, coarseData) {
    const skeletonSet = new Set(skeletonNodeIds.map(String));

    // 1. Prepara a inteligência das Sanfonas (O Trilho Base e a Normal)
    const chainNodesInfo = {};
    if (coarseData && coarseData.chainMap) {
        Object.values(coarseData.chainMap).forEach(macro => {
            const { chain, anchors } = macro;
            if (anchors.length === 2) {
                const p1 = expandedPositions[anchors[0]];
                const p2 = expandedPositions[anchors[1]];
                if (p1 && p2) {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nx = -dy / len; // Eixo Transversal X (Normal)
                    const ny = dx / len;  // Eixo Transversal Y (Normal)
                    const segments = chain.length + 1;

                    chain.forEach((nodeId, idx) => {
                        const t = (idx + 1) / segments;
                        // Guarda a regra imutável para cada barra da sanfona
                        chainNodesInfo[String(nodeId)] = { p1, p2, t, nx, ny };
                    });
                }
            }
        });
    }

    // 2. Prepara os nós para o motor físico
    const d3Nodes = allNodesArray.map(id => {
        const strId = String(id);
        const pos = expandedPositions[id] || expandedPositions[strId] || { x: 0, y: 0 };
        const isFixed = skeletonSet.has(strId);

        return {
            id: strId,
            x: pos.x, y: pos.y,
            fx: isFixed ? pos.x : null,
            fy: isFixed ? pos.y : null,
            chainInfo: chainNodesInfo[strId] // Anexa as regras ao nó!
        };
    });

    const d3Links = branchesArray
        .filter(b => b.state === 1 || b.initialState === 1)
        .map(b => ({ source: String(b.from), target: String(b.to) }));

    // 3. Configura o motor físico (Repulsão forte!)
    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", d3.forceLink(d3Links).id(d => d.id).distance(30).strength(0.8))
        .force("charge", d3.forceManyBody().strength(-250)) // Afasta nós sobrepostos
        .force("collide", d3.forceCollide().radius(25));

    // 👇 4. A MÁGICA: FORÇA CUSTOMIZADA TRANSVERSAL 👇
    // A cada milissegundo, essa força intercepta o cálculo da física:
    simulation.force("transversal", () => {
        for (let i = 0; i < d3Nodes.length; i++) {
            const node = d3Nodes[i];
            if (node.chainInfo) {
                const { p1, p2, t, nx, ny } = node.chainInfo;

                // A posição longitudinal imutável no trilho
                const baseX = p1.x + (p2.x - p1.x) * t;
                const baseY = p1.y + (p2.y - p1.y) * t;

                // O quanto a física tentou empurrar o nó para longe
                const vx = node.x - baseX;
                const vy = node.y - baseY;

                // Captura APENAS a força que atuou para os lados (Produto Escalar na Normal)
                const distTransversal = vx * nx + vy * ny;

                // Limita a "barriga" a no máximo 100 pixels para não voar para fora da tela
                const clampedDist = Math.max(-100, Math.min(100, distTransversal));

                // Sobrescreve a posição final: Anula zigue-zagues!
                node.x = baseX + clampedDist * nx;
                node.y = baseY + clampedDist * ny;
                
                // Reduz inércia para o nó não tremer na tela
                node.vx *= 0.1;
                node.vy *= 0.1;
            }
        }
    });

    simulation.stop();

    // 5. Roda a física instantaneamente
    for (let i = 0; i < 150; ++i) {
        simulation.tick();
    }

    // 6. Devolve posições perfeitas
    const relaxedPositions = {};
    d3Nodes.forEach(n => {
        const originalId = isNaN(n.id) ? n.id : Number(n.id);
        relaxedPositions[originalId] = { x: n.x, y: n.y };
    });

    return relaxedPositions;
}

// =========================================================
// FERRAMENTAS DE POLIMENTO (CRUZAMENTOS E COMPACTAÇÃO)
// =========================================================

// =========================================================
// 1. Detecta cruzamentos e atropelamentos (Aresta-Nó)
// =========================================================
export function findIntersections(positions, branches) {
    const intersections = [];
    const activeBranches = branches;
    const nodeIds = Object.keys(positions);

    for (let i = 0; i < activeBranches.length; i++) {
        const b1 = activeBranches[i];
        const A = positions[b1.from]; 
        const B = positions[b1.to];

        if (!A || !B) continue;

        // 👇 1. NOVO RASTREIO: Detecta Linha passando por cima de Barra (ou linhas colineares) 👇
        for (let k = 0; k < nodeIds.length; k++) {
            const nId = nodeIds[k];
            
            // Ignora as pontas da própria linha (onde ela nasce e morre)
            if (nId === String(b1.from) || nId === String(b1.to)) continue;

            const P = positions[nId];
            if (!P) continue;

            // Se uma barra de terceiros estiver a menos de 5 pixels da linha, é um atropelamento!
            if (getDistToSegment(P, A, B) < 5) {
                intersections.push({
                    x: P.x,
                    y: P.y,
                    b1: `${b1.from}-${b1.to}`,
                    b2: `Barra ${nId}` // O Tooltip vai avisar quem atropelou quem!
                });
            }
        }

        // 👇 2. RASTREIO CLÁSSICO: Cruzamento de duas linhas em "X" 👇
        for (let j = i + 1; j < activeBranches.length; j++) {
            const b2 = activeBranches[j];

            // Se compartilham o mesmo nó, não formam um X. 
            // Se fossem sobrepostas (colineares), o rastreio 1 já teria pegado!
            if (b1.from === b2.from || b1.from === b2.to || b1.to === b2.from || b1.to === b2.to) continue;

            const C = positions[b2.from]; const D = positions[b2.to];
            if (!C || !D) continue;

            // Fórmula de Interseção de Linhas de Bézier/Planares
            const den = (A.x - B.x) * (C.y - D.y) - (A.y - B.y) * (C.x - D.x);
            if (den === 0) continue; // Linhas paralelas

            const t = ((A.x - C.x) * (C.y - D.y) - (A.y - C.y) * (C.x - D.x)) / den;
            const u = -((A.x - B.x) * (A.y - C.y) - (A.y - B.y) * (A.x - C.x)) / den;

            // Se t e u estão entre 0 e 1 (exclusivo), houve cruzamento real no meio do trecho!
            if (t > 0 && t < 1 && u > 0 && u < 1) {
                intersections.push({
                    x: A.x + t * (B.x - A.x),
                    y: A.y + t * (B.y - A.y),
                    b1: `${b1.from}-${b1.to}`,
                    b2: `${b2.from}-${b2.to}`
                });
            }
        }
    }
    
    // 👇 FILTRO DE SEGURANÇA: Remove alvos duplicados no mesmo pixel
    const uniqueIntersections = [];
    const seen = new Set();
    intersections.forEach(pt => {
        const key = `${Math.round(pt.x)},${Math.round(pt.y)}-${pt.b1}-${pt.b2}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueIntersections.push(pt);
        }
    });

    return uniqueIntersections;
}

// 2. Aproxima os nós do centro (Mantém o formato exato, apenas reduz o tamanho geral)
export function compactPositions(positions, factor = 0.90) { // 0.90 = reduz 10% do tamanho
    let cx = 0, cy = 0, count = 0;
    
    // Calcula o Centro de Massa (Centroide)
    Object.values(positions).forEach(p => {
        cx += p.x; cy += p.y; count++;
    });
    if (count === 0) return positions;
    cx /= count; cy /= count;

    // Escala cada nó em direção ao centro
    const newPos = {};
    Object.keys(positions).forEach(id => {
        newPos[id] = {
            x: cx + (positions[id].x - cx) * factor,
            y: cy + (positions[id].y - cy) * factor
        };
    });
    
    return newPos;
}

function countNodeEdgeOverlaps(pos, branchesArray, nodesArray) {

    let overlaps = 0;

    for (const nodeId of nodesArray) {

        const p = pos[nodeId];
        if (!p) continue;

        for (const b of branchesArray) {

            // ignora endpoints legítimos
            if (
                b.from === nodeId ||
                b.to === nodeId
            ) continue;

            const a = pos[b.from];
            const c = pos[b.to];

            if (!a || !c) continue;

            // linha vertical
            if (a.x === c.x) {

                if (
                    p.x === a.x &&
                    p.y > Math.min(a.y, c.y) &&
                    p.y < Math.max(a.y, c.y)
                ) {
                    overlaps++;
                }
            }

            // linha horizontal
            else if (a.y === c.y) {

                if (
                    p.y === a.y &&
                    p.x > Math.min(a.x, c.x) &&
                    p.x < Math.max(a.x, c.x)
                ) {
                    overlaps++;
                }
            }
        }
    }

    return overlaps;
}