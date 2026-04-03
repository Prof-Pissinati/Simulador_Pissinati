import * as d3 from 'd3-force';
import dagre from 'dagre';

// // =========================================================
// // 1. MOTOR D3 FORCE (FÍSICA ORGÂNICA COM "BREATHING" ANNEALING)
// // =========================================================
// export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
//     const dist = config.distance || 80;
//     const targetCharge = config.charge || -400; 
//     const col = config.collide || 40;
    
//     // O peso varia de 0.0 (ignorada) a 1.0 (força total).
//     const openWeight = config.openWeight !== undefined ? config.openWeight : 1.0; 

//     const d3Nodes = nodesArray.map(id => ({ id: id.toString(), isSource: sourcesArray.includes(id) }));
    
//     // Devolvemos TODAS as linhas para a simulação, mas marcamos quais estão abertas
//     const d3Links = branchesArray.map(b => ({ 
//         source: b.from.toString(), 
//         target: b.to.toString(),
//         isOpen: b.state === 0 
//     }));

//     const chargeForce = d3.forceManyBody().strength(targetCharge);

//     // A MÁGICA: Configuramos molas diferentes para linhas diferentes!
//     const linkForce = d3.forceLink(d3Links)
//         .id(d => d.id)
//         .distance(d => d.isOpen ? dist * 1.5 : dist) // A mola aberta cede um pouco mais de distância (1.5x)
//         .strength(d => d.isOpen ? openWeight : 1);   // A mola aberta usa o peso reduzido

//     const simulation = d3.forceSimulation(d3Nodes)
//         .force("link", linkForce)
//         .force("charge", chargeForce)
//         .force("center", d3.forceCenter(0, 0)) 
//         .force("collide", d3.forceCollide().radius(col))
//         .stop();

//     // A mágica que você descobriu: Expandir para ~10x o tamanho e depois encolher
//     const maxCharge = targetCharge * 1000; // Aumenta a força para desembaraçar as barras e depois contrai até o ponto desejado
    
//     // Aumentamos os "ticks" (quadros de física) para dar tempo da expansão ser suave
//     const totalTicks = 900; 
//     const phaseTicks = totalTicks / 3;

//     for (let i = 0; i < totalTicks; ++i) {
//         let currentCharge;
//         let currentAlpha = 1; // "Alpha" é a temperatura do D3. 1 = Quente/Agitado, 0 = Frio/Parado

//         if (i < phaseTicks) {
//             // FASE 1: AQUECIMENTO E EXPANSÃO (Como você fez aumentando de 50 em 50)
//             const progress = i / phaseTicks;
//             currentCharge = targetCharge + (maxCharge - targetCharge) * progress;
//         } else if (i < phaseTicks * 2) {
//             // FASE 2: MANUTENÇÃO (Segura a repulsão no máximo para garantir o desembaraço)
//             currentCharge = maxCharge;
//         } else {
//             // FASE 3: RESFRIAMENTO E CONTRAÇÃO (Como você fez voltando pro valor original)
//             const progress = (i - phaseTicks * 2) / phaseTicks;
//             currentCharge = maxCharge + (targetCharge - maxCharge) * progress;
//             // Aqui nós deixamos a física "esfriar" junto para as barras não ficarem tremendo
//             currentAlpha = 1 - progress; 
//         }

//         chargeForce.strength(currentCharge);
//         // O Math.max evita que a temperatura zere antes de acabar, garantindo movimento até o fim
//         simulation.alpha(Math.max(0.01, currentAlpha)).tick(); 
//     }

//     const positions = {};
//     d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
//     return positions;
// }

// =========================================================
// 1. MOTOR D3 FORCE (FÍSICA ORGÂNICA COM "BREATHING" ANNEALING E FORÇAS POR GRAU)
// =========================================================
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const dist = config.distance || 80;
    const targetCharge = config.charge || -400; 
    const col = config.collide || 40;
    const openWeight = config.openWeight !== undefined ? config.openWeight : 1.0; 

    const currentPos = config.currentPos || null;

    // 1. MAPEAMENTO DE GRAU (Conta quantas conexões cada barra tem)
    const nodeDegree = {};
    nodesArray.forEach(id => nodeDegree[id] = 0);
    branchesArray.forEach(b => {
        nodeDegree[b.from] = (nodeDegree[b.from] || 0) + 1;
        nodeDegree[b.to] = (nodeDegree[b.to] || 0) + 1;
    });

    const d3Nodes = nodesArray.map(id => {
        const nodeObj = { 
            id: id.toString(), 
            isSource: sourcesArray.includes(id),
            degree: nodeDegree[id] || 0 
        };
        
        // Se a barra já tem uma posição no seu projeto, ela começa o D3 exatamente dali
        if (currentPos && currentPos[id]) {
            nodeObj.x = currentPos[id].x;
            nodeObj.y = currentPos[id].y;
        }
        
        return nodeObj;
    });
    
    const d3Links = branchesArray.map(b => ({ 
        source: b.from.toString(), 
        target: b.to.toString(),
        isOpen: b.state === 0 
    }));

    // 2. ÍMÃ INTELIGENTE E MÍOPE (O SEGREDO PARA SISTEMAS GIGANTES)
    const chargeForce = d3.forceManyBody()
        .strength(d => {
            const multiplier = 1 + (d.degree * 5); 
            return targetCharge * multiplier;
        })
        .distanceMax(dist * 6); // <-- A MÁGICA AQUI! O ímã para de funcionar depois de 6 "saltos" de distância.

    // 3. MOLA INTELIGENTE: Aumenta a distância da linha se conectar barras muito cheias
    const linkForce = d3.forceLink(d3Links)
        .id(d => d.id)
        .distance(d => {
            // Lê quantas conexões tem na barra de origem e na de destino
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            
            // Cada conexão extra na dupla empurra a linha 8 pixels para mais longe
            const degreeBonus = (degSource + degTarget) * 10; 
            
            const baseDist = d.isOpen ? dist * 1.5 : dist;
            return baseDist + degreeBonus;
        })
        .strength(d => {
            if (d.isOpen) return openWeight;
            const degSource = nodeDegree[d.source.id || d.source] || 0;
            const degTarget = nodeDegree[d.target.id || d.target] || 0;
            // Se as pontas tiverem grau baixo, o cabo fica 50% mais rígido
            return (degSource <= 2 || degTarget <= 2) ? 1.5 : 1; 
        });

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", linkForce)
        .force("charge", chargeForce)
        .force("center", d3.forceCenter(0, 0)) 
        .force("collide", d3.forceCollide().radius(col))
        .stop();

    const maxChargeMulti = 5; 
    const totalTicks = 900; 
    const phaseTicks = totalTicks / 3;

    for (let i = 0; i < totalTicks; ++i) {
        let currentAlpha = 1; 
        let phaseMultiplier;

        // Calcula a força do "Breathing" baseada na fase
        if (i < phaseTicks) {
            phaseMultiplier = 1 + (maxChargeMulti - 1) * (i / phaseTicks);
        } else if (i < phaseTicks * 2) {
            phaseMultiplier = maxChargeMulti;
        } else {
            const progress = (i - phaseTicks * 2) / phaseTicks;
            phaseMultiplier = maxChargeMulti - (maxChargeMulti - 1) * progress;
            currentAlpha = 1 - progress; 
        }

        // Aplica o fôlego dinâmico multiplicando pela força individual de cada nó
        chargeForce.strength(d => {
            const baseNodeCharge = targetCharge * (1 + (d.degree * 5));
            return baseNodeCharge * phaseMultiplier;
        });

        simulation.alpha(Math.max(0.01, currentAlpha)).tick(); 
    }

    const positions = {};
    d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
    return positions;
}

// 2. MOTOR DAGRE (HIERÁRQUICO / ÁRVORE TOPOLÓGICA)
export function calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const rankdir = config.rankdir || 'LR'; 
    const ranksep = config.ranksep || 120; // Distância entre os níveis
    const nodesep = config.nodesep || 60;  // Distância entre as barras (irmãos)
    const ranker = config.ranker || 'network-simplex'; // O Algoritmo de roteamento interno!

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir, ranksep, nodesep, ranker });
    g.setDefaultEdgeLabel(() => ({}));

    nodesArray.forEach(id => g.setNode(id.toString(), { width: 40, height: 40 }));

    // PASSO A: GPS Topológico (Busca em Largura - BFS)
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.forEach(b => {
        adj[b.from].push(b.to);
        adj[b.to].push(b.from);
    });

    const depths = {};
    const queue = [];
    sourcesArray.forEach(s => { depths[s] = 0; queue.push(s); });

    while(queue.length > 0) {
        const current = queue.shift();
        adj[current].forEach(neighbor => {
            if (depths[neighbor] === undefined) {
                depths[neighbor] = depths[current] + 1;
                queue.push(neighbor);
            }
        });
    }

    // PASSO B: Inserção de Linhas
    branchesArray.forEach(b => {
        const depthFrom = depths[b.from] !== undefined ? depths[b.from] : 999;
        const depthTo = depths[b.to] !== undefined ? depths[b.to] : 999;

        let sourceNode = b.from;
        let targetNode = b.to;

        if (depthFrom > depthTo) {
            sourceNode = b.to;
            targetNode = b.from;
        }

        // MUDANÇA CRÍTICA: Linhas abertas agora têm peso ZERO absoluto.
        const edgeWeight = b.state === 1 ? 10 : 0;
        g.setEdge(sourceNode.toString(), targetNode.toString(), { weight: edgeWeight });
    });

    dagre.layout(g);

    const positions = {};
    nodesArray.forEach(id => {
        const n = g.node(id.toString());
        positions[id] = { x: n.x, y: n.y };
    });
    return positions;
}

// 3. MOTOR RADIAL (CONCÊNTRICO BASEADO EM BFS)
export function calculateRadialLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const radiusStep = config.radius || 150;
    
    // Mapeia quem está conectado a quem
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.filter(b => b.state === 1).forEach(b => {
        adj[b.from].push(b.to); adj[b.to].push(b.from);
    });

    // Descobre a distância (nível) de cada barra até a subestação
    const levels = {};
    const queue = [];
    sourcesArray.forEach(s => { levels[s] = 0; queue.push(s); });
    
    const visited = new Set(sourcesArray);
    while(queue.length > 0) {
        const u = queue.shift();
        adj[u].forEach(v => {
            if(!visited.has(v)) { visited.add(v); levels[v] = levels[u] + 1; queue.push(v); }
        });
    }

    // Agrupa por nível para desenhar os anéis
    const byLevel = {};
    nodesArray.forEach(n => {
        const l = levels[n] !== undefined ? levels[n] : 0;
        if(!byLevel[l]) byLevel[l] = [];
        byLevel[l].push(n);
    });

    const positions = {};
    Object.keys(byLevel).forEach(lStr => {
        const l = parseInt(lStr);
        const nodesInLevel = byLevel[lStr];
        const currentRadius = l * radiusStep;
        
        if (l === 0) { // Subestações no centro
            nodesInLevel.forEach((n, i) => positions[n] = { x: (i * 80) - ((nodesInLevel.length-1)*40), y: 0 });
        } else { // Barras distribuídas no anel
            const angleStep = (2 * Math.PI) / nodesInLevel.length;
            nodesInLevel.forEach((n, i) => {
                const angle = i * angleStep;
                positions[n] = { x: currentRadius * Math.cos(angle), y: currentRadius * Math.sin(angle) };
            });
        }
    });
    return positions;
}
//* GEMINI
// =========================================================
// FUNÇÕES AUXILIARES DA META-HEURÍSTICA (VNS)
// =========================================================

// Verifica se dois segmentos de reta (p1-p2 e p3-p4) se cruzam na tela
function doLinesIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

// Função Objetivo: Conta o total de cruzamentos no sistema inteiro
function calculateCrossingCost(positions, branches) {
    let crossings = 0;
    for (let i = 0; i < branches.length; i++) {
        for (let j = i + 1; j < branches.length; j++) {
            const b1 = branches[i];
            const b2 = branches[j];
            // Ignora linhas que nascem ou morrem no mesmo nó (elas se tocam nas pontas, não cruzam)
            if (b1.from === b2.from || b1.from === b2.to || b1.to === b2.from || b1.to === b2.to) continue;

            const p1 = positions[b1.from], p2 = positions[b1.to];
            const p3 = positions[b2.from], p4 = positions[b2.to];
            
            if (p1 && p2 && p3 && p4 && doLinesIntersect(p1, p2, p3, p4)) crossings++;
        }
    }
    return crossings;
}

// =========================================================
// 4. MOTOR STARBURST COM META-HEURÍSTICA VNS
// =========================================================
export function calculateStarburstLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const ranksep = config.ranksep || 120;
    const nodesep = config.nodesep || 60;
    const explosionRadius = 50; // Seu ajuste perfeito!

    // 1. Mapeia as ilhas (GPS Topológico)
    const nodeToSource = {};
    const depths = {};
    sourcesArray.forEach(s => { nodeToSource[s] = s; depths[s] = 0; });

    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.filter(b => b.state === 1).forEach(b => {
        adj[b.from].push(b.to); adj[b.to].push(b.from);
    });

    const queue = [...sourcesArray];
    while(queue.length > 0) {
        const curr = queue.shift();
        adj[curr].forEach(neighbor => {
            if (nodeToSource[neighbor] === undefined) {
                nodeToSource[neighbor] = nodeToSource[curr];
                depths[neighbor] = depths[curr] + 1;
                queue.push(neighbor);
            }
        });
    }
    nodesArray.forEach(n => {
        if (nodeToSource[n] === undefined) { nodeToSource[n] = sourcesArray[0]; depths[n] = 999; }
    });

    // 2. Extrai as coordenadas "Cruas" do Dagre para cada ilha (Sem girar ainda)
    const rawIslands = sourcesArray.map(source => {
        const islandNodes = nodesArray.filter(n => nodeToSource[n] === source);
        const islandBranches = branchesArray.filter(b => b.state === 1 && nodeToSource[b.from] === source && nodeToSource[b.to] === source);

        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', ranksep: ranksep, nodesep: nodesep, ranker: 'network-simplex' });
        g.setDefaultEdgeLabel(() => ({}));

        islandNodes.forEach(id => g.setNode(id.toString(), { width: 40, height: 40 }));
        islandBranches.forEach(b => {
            let sNode = b.from, tNode = b.to;
            if (depths[b.from] > depths[b.to]) { sNode = b.to; tNode = b.from; }
            g.setEdge(sNode.toString(), tNode.toString());
        });

        dagre.layout(g);

        const sourceNodeDagre = g.node(source.toString());
        const offsetX = sourceNodeDagre.x;
        const offsetY = sourceNodeDagre.y;

        const rawCoords = {};
        islandNodes.forEach(id => {
            const n = g.node(id.toString());
            rawCoords[id] = { x: (n.x - offsetX) + explosionRadius, y: n.y - offsetY };
        });
        return { source, nodes: rawCoords };
    });

    // 3. Função que aplica os ângulos e monta o sistema global
    const buildGlobalPositions = (angles) => {
        const pos = {};
        rawIslands.forEach((island, index) => {
            const angle = angles[index];
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            
            Object.keys(island.nodes).forEach(id => {
                const rawX = island.nodes[id].x;
                const rawY = island.nodes[id].y;
                pos[id] = { x: rawX * cosA - rawY * sinA, y: rawX * sinA + rawY * cosA };
            });
        });
        return pos;
    };

    // =========================================================
    // 4. A MÁGICA: OTIMIZADOR DE VIZINHANÇA (VNS LOCAL SEARCH)
    // =========================================================
    
    // Configuração Inicial: Ângulos perfeitamente divididos (0, 120, 240...)
    let bestAngles = sourcesArray.map((_, i) => i * (2 * Math.PI) / sourcesArray.length);
    let bestPositions = buildGlobalPositions(bestAngles);
    let bestCost = calculateCrossingCost(bestPositions, branchesArray);
    
    console.log(`[VNS] Cruzamentos Iniciais: ${bestCost}`);

    const MAX_ITER = 50; // Número de tentativas de melhoria
    const stepSize = (5 * Math.PI) / 180; // Gira de 5 em 5 graus

    for (let iter = 0; iter < MAX_ITER; iter++) {
        let improved = false;

        // Tenta girar cada ilha para a esquerda ou direita
        for (let i = 0; i < sourcesArray.length; i++) {
            for (let direction of [1, -1]) {
                const testAngles = [...bestAngles];
                testAngles[i] += direction * stepSize;

                const testPositions = buildGlobalPositions(testAngles);
                const testCost = calculateCrossingCost(testPositions, branchesArray);

                // Se o giro diminuiu os cruzamentos de cabos, adota como novo padrão!
                if (testCost < bestCost) {
                    bestCost = testCost;
                    bestAngles = testAngles;
                    improved = true;
                }
            }
        }
        
        // Se girar mais ninguém ajudou, atingimos o ótimo local. Fim da heurística.
        if (!improved) break; 
    }

    console.log(`[VNS] Cruzamentos Finais Otimizados: ${bestCost}`);

    return buildGlobalPositions(bestAngles);
}
//*/

// =========================================================
// 5. MOTOR ORTOGONAL (GRID / MANHATTAN)
// =========================================================
export function calculateOrthogonalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const gridSize = config.gridSize || 120; 
    const targetCharge = config.charge || -500; 
    const openWeight = config.openWeight !== undefined ? config.openWeight : 1.0; 
    const currentPos = config.currentPos || null;
    
    // ESTA É A LINHA QUE O JAVASCRIPT NÃO ESTAVA ACHANDO:
    const dist = config.distance || 50; 

    // 1. Roda o motor de força com o resfriamento simulado (Simulated Annealing)
    const basePos = calculateForceLayout(nodesArray, branchesArray, sourcesArray, { 
        distance: dist, 
        charge: targetCharge, 
        openWeight: openWeight,
        currentPos: currentPos 
    });
    
    const snappedPos = {};
    const occupied = new Set();
    const getGridKey = (x, y) => `${x},${y}`;

    // Ordena as barras da mais próxima ao centro (0,0) para a mais distante
    // Isso garante que as subestações escolham os melhores lugares no grid primeiro
    const sortedNodes = [...nodesArray].sort((a, b) => {
        const distA = Math.pow(basePos[a].x, 2) + Math.pow(basePos[a].y, 2);
        const distB = Math.pow(basePos[b].x, 2) + Math.pow(basePos[b].y, 2);
        return distA - distB;
    });

    sortedNodes.forEach(id => {
        // Encontra o quadrado da malha mais próximo do ponto ideal da barra
        let gridX = Math.round(basePos[id].x / gridSize);
        let gridY = Math.round(basePos[id].y / gridSize);

        // 2. BUSCA EM ESPIRAL (Se o quadrado já estiver ocupado)
        let radius = 0;
        let placed = false;
        
        while (!placed) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    // Checa apenas a "borda" do raio atual da espiral
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) {
                        const testX = gridX + dx;
                        const testY = gridY + dy;
                        const key = getGridKey(testX, testY);
                        
                        if (!occupied.has(key)) {
                            gridX = testX;
                            gridY = testY;
                            placed = true;
                            break;
                        }
                    }
                }
                if (placed) break;
            }
            radius++;
        }

        // Marca o quadrado como ocupado e salva a coordenada exata
        occupied.add(getGridKey(gridX, gridY));
        snappedPos[id] = { x: gridX * gridSize, y: gridY * gridSize };
    });

    return snappedPos;
}

/* KIMI AI
// 4. MOTOR STARBURST MULTI-HIERÁRQUICO COM OTIMIZAÇÃO GLOBAL ANTI-CRUZAMENTO
export function calculateStarburstLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const ranksep = config.ranksep || 120;
    const nodesep = config.nodesep || 60;
    const explosionRadius = config.explosionRadius || 200; // Aumentado para dar mais espaço
    const optimizationIterations = config.optimizationIterations || 300;
    
    // ========== 1. MAPEAMENTO DE CONECTIVIDADE ==========
    const nodeToSource = {};
    const depths = {};
    sourcesArray.forEach(s => { 
        nodeToSource[s] = s; 
        depths[s] = 0; 
    });

    // Grafo de adjacência completo
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    const allBranches = branchesArray.filter(b => b.state === 1);
    
    allBranches.forEach(b => {
        adj[b.from].push(b.to);
        adj[b.to].push(b.from);
    });

    // BFS para determinar propriedade e profundidade
    const queue = [...sourcesArray];
    while(queue.length > 0) {
        const curr = queue.shift();
        adj[curr].forEach(neighbor => {
            if (nodeToSource[neighbor] === undefined) {
                nodeToSource[neighbor] = nodeToSource[curr];
                depths[neighbor] = depths[curr] + 1;
                queue.push(neighbor);
            }
        });
    }

    // Fallback para nós isolados
    nodesArray.forEach(n => {
        if (nodeToSource[n] === undefined) {
            nodeToSource[n] = sourcesArray[0];
            depths[n] = 999;
        }
    });

    // ========== 2. IDENTIFICAR CONEXÕES ENTRE SUBESTAÇÕES ==========
    const interConnections = []; // Ligações que cruzam ilhas
    const intraConnections = []; // Ligações dentro da mesma ilha
    
    allBranches.forEach(b => {
        if (nodeToSource[b.from] !== nodeToSource[b.to]) {
            interConnections.push({
                from: b.from,
                to: b.to,
                fromSource: nodeToSource[b.from],
                toSource: nodeToSource[b.to]
            });
        } else {
            intraConnections.push(b);
        }
    });

    // ========== 3. LAYOUT INDIVIDUAL COM DAGRE ==========
    const islandLayouts = {}; // Guarda layout relativo de cada ilha
    const angleStep = (2 * Math.PI) / sourcesArray.length;

    sourcesArray.forEach((source, index) => {
        const islandNodes = nodesArray.filter(n => nodeToSource[n] === source);
        const islandBranches = intraConnections.filter(b => 
            nodeToSource[b.from] === source
        );

        const g = new dagre.graphlib.Graph();
        g.setGraph({ 
            rankdir: 'LR', 
            ranksep: ranksep, 
            nodesep: nodesep, 
            ranker: 'network-simplex' 
        });
        g.setDefaultEdgeLabel(() => ({}));

        islandNodes.forEach(id => g.setNode(id.toString(), { width: 40, height: 40 }));
        
        islandBranches.forEach(b => {
            let sNode = b.from, tNode = b.to;
            if (depths[b.from] > depths[b.to]) {
                [sNode, tNode] = [tNode, sNode];
            }
            g.setEdge(sNode.toString(), tNode.toString());
        });

        dagre.layout(g);

        // Guarda posições relativas (antes de rotacionar)
        const sourceNode = g.node(source.toString());
        islandLayouts[source] = {
            nodes: {},
            sourceRel: { x: sourceNode.x, y: sourceNode.y },
            angle: index * angleStep
        };

        islandNodes.forEach(id => {
            const n = g.node(id.toString());
            islandLayouts[source].nodes[id] = {
                x: n.x - sourceNode.x, // Relativo à subestação
                y: n.y - sourceNode.y,
                depth: depths[id]
            };
        });
    });

    // ========== 4. OTIMIZAÇÃO GLOBAL DE ÂNGULOS ==========
    // Calcula "tensão" entre ilhas baseada nas conexões inter-subestação
    function calculateStress(angles) {
        let stress = 0;
        
        interConnections.forEach(conn => {
            const layout1 = islandLayouts[conn.fromSource];
            const layout2 = islandLayouts[conn.toSource];
            
            const angle1 = angles[conn.fromSource];
            const angle2 = angles[conn.toSource];
            
            // Posição global do nó de origem
            const node1 = layout1.nodes[conn.from];
            const r1 = explosionRadius + node1.x; // x é a profundidade no dagre
            const theta1 = angle1 + Math.atan2(node1.y, r1);
            const global1 = {
                x: r1 * Math.cos(theta1),
                y: r1 * Math.sin(theta1)
            };
            
            // Posição global do nó de destino
            const node2 = layout2.nodes[conn.to];
            const r2 = explosionRadius + node2.x;
            const theta2 = angle2 + Math.atan2(node2.y, r2);
            const global2 = {
                x: r2 * Math.cos(theta2),
                y: r2 * Math.sin(theta2)
            };
            
            // Distância ideal: preferimos conexões curtas e diretas
            const dist = Math.hypot(global2.x - global1.x, global2.y - global1.y);
            stress += dist;
            
            // Penalidade adicional para linhas que cruzam o centro
            const midX = (global1.x + global2.x) / 2;
            const midY = (global1.y + global2.y) / 2;
            const distFromCenter = Math.hypot(midX, midY);
            if (distFromCenter < explosionRadius * 0.5) {
                stress += 1000; // Penalidade pesada para cruzar o centro
            }
        });
        
        return stress;
    }

    // Otimização por simulated annealing simples
    let bestAngles = {};
    sourcesArray.forEach(s => bestAngles[s] = islandLayouts[s].angle);
    let bestStress = calculateStress(bestAngles);
    
    const temperature = 1.0;
    const cooling = 0.995;
    
    for (let iter = 0; iter < optimizationIterations; iter++) {
        const temp = temperature * Math.pow(cooling, iter);
        
        // Tenta perturbar um ângulo aleatório
        const sourceToMutate = sourcesArray[Math.floor(Math.random() * sourcesArray.length)];
        const oldAngle = bestAngles[sourceToMutate];
        const newAngle = oldAngle + (Math.random() - 0.5) * temp * Math.PI;
        
        const testAngles = { ...bestAngles, [sourceToMutate]: newAngle };
        const stress = calculateStress(testAngles);
        
        // Aceita se melhor, ou com probabilidade se pior (simulated annealing)
        if (stress < bestStress || Math.random() < Math.exp((bestStress - stress) / temp)) {
            bestAngles = testAngles;
            bestStress = stress;
        }
    }

    // ========== 5. APLICAR POSIÇÕES FINAIS ==========
    const positions = {};

    sourcesArray.forEach(source => {
        const layout = islandLayouts[source];
        const angle = bestAngles[source];
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        Object.entries(layout.nodes).forEach(([id, node]) => {
            // Coordenadas polares: raio aumenta com a profundidade na árvore
            const r = explosionRadius + node.x;
            const theta = Math.atan2(node.y, r); // Ajuste angular baseado no y
            
            // Rotação global
            const finalAngle = angle + theta;
            const finalR = Math.sqrt(r * r + node.y * node.y);
            
            positions[id] = {
                x: finalR * Math.cos(finalAngle),
                y: finalR * Math.sin(finalAngle)
            };
        });
    });

    return positions;
}
*/