// ================================================================
// GERADOR DE LAYOUTS AUTOMÁTICOS
// Cria posicionamento inicial das barras no diagrama
// ================================================================

import * as d3 from 'd3';

/**
 * Gera layout baseado no tipo escolhido
 * @param {Object} systemData - Dados do sistema
 * @param {string} layoutType - 'organic' | 'radial' | 'hierarchical'
 * @param {Object} options - Opções de configuração
 * @returns {Object} Positions { nodeId: {x, y} }
 */
export function generateLayout(systemData, layoutType = 'organic', options = {}) {
    const generators = {
        organic: generateOrganicLayout,
        radial: generateRadialLayout,
        hierarchical: generateHierarchicalLayout
    };
    
    const generator = generators[layoutType];
    if (!generator) {
        throw new Error(`Tipo de layout inválido: ${layoutType}`);
    }
    
    return generator(systemData, options);
}

// ================================================================
// LAYOUT ORGÂNICO (Force-Directed)
// ================================================================
/**
 * Gera layout usando simulação de forças (D3.js)
 * Resultado: distribuição natural e equilibrada
 */
export function generateOrganicLayout(systemData, options = {}) {
    const {
        width = 900,
        height = 650,
        iterations = 300,
        repulsion = -250,
        attraction = 60,
        centerForce = 0.1
    } = options;
    
    // 1. Prepara nodes
    const allNodeIds = [
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ];
    
    const nodes = allNodeIds.map(id => ({
        id: id,
        x: width / 2 + (Math.random() - 0.5) * 100,
        y: height / 2 + (Math.random() - 0.5) * 100,
        isSource: systemData.sources.includes(id)
    }));
    
    // 2. Prepara links
    const links = systemData.branches.map(b => ({
        source: b.from,
        target: b.to,
        strength: b.state === 1 ? 1 : 0.3  // Linhas abertas têm menos força
    }));
    
    // 3. Cria simulação
    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links)
            .id(d => d.id)
            .distance(attraction)
            .strength(d => d.strength))
        .force("charge", d3.forceManyBody()
            .strength(repulsion))
        .force("center", d3.forceCenter(width / 2, height / 2)
            .strength(centerForce))
        .force("collide", d3.forceCollide()
            .radius(30))
        .force("x", d3.forceX(width / 2)
            .strength(0.05))
        .force("y", d3.forceY(height / 2)
            .strength(0.05));
    
    // 4. Executa simulação completa
    simulation.stop();
    for (let i = 0; i < iterations; i++) {
        simulation.tick();
    }
    
    // 5. Converte para objeto positions
    const positions = {};
    nodes.forEach(node => {
        positions[node.id] = {
            x: Math.max(50, Math.min(width - 50, node.x)),
            y: Math.max(50, Math.min(height - 50, node.y))
        };
    });
    
    return positions;
}

// ================================================================
// LAYOUT RADIAL (Subestações no Centro)
// ================================================================
/**
 * Gera layout radial com subestações no centro
 * Barras organizadas em círculos concêntricos por nível
 */
export function generateRadialLayout(systemData, options = {}) {
    const {
        centerX = 450,
        centerY = 325,
        radiusStep = 80,
        sourceRadius = 50
    } = options;
    
    const positions = {};
    
    // 1. Calcula níveis (distância das subestações)
    const levels = calculateLevels(systemData);
    
    // 2. Agrupa nodes por nível
    const nodesByLevel = {};
    Object.keys(levels).forEach(nodeId => {
        const level = levels[nodeId];
        if (!nodesByLevel[level]) {
            nodesByLevel[level] = [];
        }
        nodesByLevel[level].push(parseInt(nodeId));
    });
    
    // 3. Posiciona subestações no centro (nível 0)
    if (nodesByLevel[0]) {
        const sources = nodesByLevel[0];
        const angleStep = (2 * Math.PI) / sources.length;
        
        sources.forEach((id, index) => {
            const angle = index * angleStep - Math.PI / 2;  // Começa no topo
            positions[id] = {
                x: centerX + sourceRadius * Math.cos(angle),
                y: centerY + sourceRadius * Math.sin(angle)
            };
        });
    }
    
    // 4. Posiciona demais níveis em círculos
    const maxLevel = Math.max(...Object.keys(nodesByLevel).map(l => parseInt(l)));
    
    for (let level = 1; level <= maxLevel; level++) {
        const nodesInLevel = nodesByLevel[level];
        if (!nodesInLevel || nodesInLevel.length === 0) continue;
        
        const radius = level * radiusStep;
        const angleStep = (2 * Math.PI) / nodesInLevel.length;
        
        // Ordena nodes por conectividade para melhor distribuição
        const sorted = sortByConnectivity(nodesInLevel, systemData.branches);
        
        sorted.forEach((id, index) => {
            const angle = index * angleStep - Math.PI / 2;
            positions[id] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        });
    }
    
    return positions;
}

// ================================================================
// LAYOUT HIERÁRQUICO (Níveis BFS)
// ================================================================
/**
 * Gera layout hierárquico em níveis horizontais
 * Subestações no topo, demais níveis abaixo
 */
export function generateHierarchicalLayout(systemData, options = {}) {
    const {
        startX = 50,
        startY = 50,
        levelSpacing = 120,
        nodeSpacing = 60,
        width = 900
    } = options;
    
    const positions = {};
    
    // 1. Calcula níveis
    const levels = calculateLevels(systemData);
    
    // 2. Agrupa por nível
    const nodesByLevel = {};
    Object.keys(levels).forEach(nodeId => {
        const level = levels[nodeId];
        if (!nodesByLevel[level]) {
            nodesByLevel[level] = [];
        }
        nodesByLevel[level].push(parseInt(nodeId));
    });
    
    // 3. Posiciona nível por nível
    const sortedLevels = Object.keys(nodesByLevel).sort((a, b) => parseInt(a) - parseInt(b));
    
    sortedLevels.forEach(level => {
        const nodesInLevel = nodesByLevel[level];
        const numNodes = nodesInLevel.length;
        
        // Calcula espaçamento para centralizar
        const totalWidth = (numNodes - 1) * nodeSpacing;
        const startXLevel = Math.max(startX, (width - totalWidth) / 2);
        
        // Ordena nodes para melhor visualização
        const sorted = sortByConnectivity(nodesInLevel, systemData.branches);
        
        sorted.forEach((id, index) => {
            positions[id] = {
                x: startXLevel + index * nodeSpacing,
                y: startY + parseInt(level) * levelSpacing
            };
        });
    });
    
    return positions;
}

// ================================================================
// HELPER: Calcula níveis via BFS
// ================================================================
/**
 * Calcula distância de cada nó até as subestações (BFS)
 * @param {Object} systemData - Dados do sistema
 * @returns {Object} Níveis { nodeId: level }
 */
function calculateLevels(systemData) {
    const levels = {};
    const visited = new Set();
    const queue = [];
    
    // 1. Inicializa com subestações (nível 0)
    systemData.sources.forEach(id => {
        levels[id] = 0;
        visited.add(id);
        queue.push({ id, level: 0 });
    });
    
    // 2. Monta grafo de adjacências
    const adj = {};
    systemData.branches.forEach(b => {
        if (!adj[b.from]) adj[b.from] = [];
        if (!adj[b.to]) adj[b.to] = [];
        adj[b.from].push(b.to);
        adj[b.to].push(b.from);
    });
    
    // 3. BFS
    let head = 0;
    while (head < queue.length) {
        const { id, level } = queue[head++];
        
        if (adj[id]) {
            adj[id].forEach(neighbor => {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    levels[neighbor] = level + 1;
                    queue.push({ id: neighbor, level: level + 1 });
                }
            });
        }
    }
    
    // 4. Nodes sem nível (desconectados) vão para último nível
    const allNodeIds = [
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ];
    
    const maxLevel = Math.max(...Object.values(levels));
    
    allNodeIds.forEach(id => {
        if (levels[id] === undefined) {
            levels[id] = maxLevel + 1;
        }
    });
    
    return levels;
}

// ================================================================
// HELPER: Ordena nodes por conectividade
// ================================================================
/**
 * Ordena nodes para melhor distribuição visual
 * Nodes com mais conexões ficam mais centralizados
 */
function sortByConnectivity(nodeIds, branches) {
    // Conta conexões de cada node
    const connectivity = {};
    nodeIds.forEach(id => {
        connectivity[id] = 0;
    });
    
    branches.forEach(b => {
        if (connectivity[b.from] !== undefined) connectivity[b.from]++;
        if (connectivity[b.to] !== undefined) connectivity[b.to]++;
    });
    
    // Ordena por conectividade (maior primeiro)
    return nodeIds.sort((a, b) => connectivity[b] - connectivity[a]);
}

// ================================================================
// OTIMIZAÇÃO DE LAYOUT (Reduz cruzamentos)
// ================================================================
/**
 * Otimiza layout existente reduzindo cruzamentos de linhas
 * @param {Object} positions - Posições atuais
 * @param {Object} systemData - Dados do sistema
 * @param {number} iterations - Número de iterações
 * @returns {Object} Posições otimizadas
 */
export function optimizeLayout(positions, systemData, iterations = 100) {
    const optimized = JSON.parse(JSON.stringify(positions));
    
    for (let iter = 0; iter < iterations; iter++) {
        const crossings = countCrossings(optimized, systemData.branches);
        
        // Tenta pequenos ajustes
        Object.keys(optimized).forEach(nodeId => {
            const original = { ...optimized[nodeId] };
            
            // Testa 4 direções
            const deltas = [
                { dx: 5, dy: 0 },
                { dx: -5, dy: 0 },
                { dx: 0, dy: 5 },
                { dx: 0, dy: -5 }
            ];
            
            let bestPos = original;
            let bestCrossings = crossings;
            
            deltas.forEach(delta => {
                optimized[nodeId] = {
                    x: original.x + delta.dx,
                    y: original.y + delta.dy
                };
                
                const newCrossings = countCrossings(optimized, systemData.branches);
                if (newCrossings < bestCrossings) {
                    bestPos = { ...optimized[nodeId] };
                    bestCrossings = newCrossings;
                }
            });
            
            optimized[nodeId] = bestPos;
        });
    }
    
    return optimized;
}

// ================================================================
// HELPER: Conta cruzamentos de linhas
// ================================================================
function countCrossings(positions, branches) {
    let count = 0;
    
    for (let i = 0; i < branches.length; i++) {
        for (let j = i + 1; j < branches.length; j++) {
            const b1 = branches[i];
            const b2 = branches[j];
            
            if (!positions[b1.from] || !positions[b1.to] || 
                !positions[b2.from] || !positions[b2.to]) continue;
            
            if (linesIntersect(
                positions[b1.from], positions[b1.to],
                positions[b2.from], positions[b2.to]
            )) {
                count++;
            }
        }
    }
    
    return count;
}

// ================================================================
// HELPER: Verifica se duas linhas se cruzam
// ================================================================
function linesIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => {
        return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    };
    
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
           ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

// ================================================================
// EXPORTAÇÃO DE LAYOUT
// ================================================================
/**
 * Prepara layout para exportação JSON
 * @param {Object} positions - Posições atuais
 * @param {Object} waypoints - Waypoints atuais
 * @param {Object} metadata - Metadados do sistema
 * @returns {Object} Layout para export
 */
export function exportLayoutToJSON(positions, waypoints, metadata) {
    return {
        systemName: metadata.name,
        sourceFile: metadata.sourceFile,
        layoutVersion: "1.0",
        exportDate: new Date().toISOString().split('T')[0],
        positions: positions,
        waypoints: waypoints || {}
    };
}

// ================================================================
// IMPORTAÇÃO DE LAYOUT
// ================================================================
/**
 * Valida e importa layout de JSON
 * @param {Object} layoutJSON - Layout importado
 * @param {Object} systemData - Sistema atual
 * @returns {Object} { valid, positions, waypoints, warnings }
 */
export function importLayoutFromJSON(layoutJSON, systemData) {
    const warnings = [];
    
    // Valida estrutura básica
    if (!layoutJSON.positions) {
        throw new Error('Layout inválido: campo "positions" ausente');
    }
    
    // Verifica compatibilidade
    const systemNodes = new Set([
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ]);
    
    const layoutNodes = new Set(
        Object.keys(layoutJSON.positions).map(id => parseInt(id))
    );
    
    // Nodes faltando no layout
    const missing = [...systemNodes].filter(id => !layoutNodes.has(id));
    if (missing.length > 0) {
        warnings.push(`${missing.length} barras sem posição no layout: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
    }
    
    // Nodes extras no layout
    const extra = [...layoutNodes].filter(id => !systemNodes.has(id));
    if (extra.length > 0) {
        warnings.push(`${extra.length} barras no layout não existem no sistema: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '...' : ''}`);
    }
    
    // Filtra apenas nodes válidos
    const filteredPositions = {};
    Object.keys(layoutJSON.positions).forEach(nodeId => {
        const id = parseInt(nodeId);
        if (systemNodes.has(id)) {
            filteredPositions[id] = layoutJSON.positions[nodeId];
        }
    });
    
    return {
        valid: true,
        positions: filteredPositions,
        waypoints: layoutJSON.waypoints || {},
        warnings
    };
}
