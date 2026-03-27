import * as d3 from 'd3-force';
import dagre from 'dagre';

// 1. MOTOR D3 FORCE (FÍSICA ORGÂNICA)
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const dist = config.distance || 80;
    const charge = config.charge || -400;
    const col = config.collide || 40;

    const d3Nodes = nodesArray.map(id => ({ id: id.toString(), isSource: sourcesArray.includes(id) }));
    // Apenas usa as linhas ativas (fechadas) para puxar as barras
    const d3Links = branchesArray.filter(b => b.state === 1).map(b => ({ source: b.from.toString(), target: b.to.toString() }));

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", d3.forceLink(d3Links).id(d => d.id).distance(dist))
        .force("charge", d3.forceManyBody().strength(charge))
        .force("center", d3.forceCenter(0, 0)) 
        .force("collide", d3.forceCollide().radius(col));

    // Roda a física instantaneamente no escuro
    for (let i = 0; i < 300; ++i) simulation.tick();

    const positions = {};
    d3Nodes.forEach(n => positions[Number(n.id)] = { x: n.x, y: n.y });
    return positions;
}

// 2. MOTOR DAGRE (HIERÁRQUICO / ÁRVORE)
export function calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    const rankdir = config.rankdir || 'LR'; // LR (Esq-Dir) ou TB (Cima-Baixo)
    const ranksep = config.ranksep || 120; // Distância entre os níveis
    const nodesep = config.nodesep || 60;  // Distância entre irmãos

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir, ranksep, nodesep });
    g.setDefaultEdgeLabel(() => ({}));

    nodesArray.forEach(id => g.setNode(id.toString(), { width: 40, height: 40 }));
    branchesArray.filter(b => b.state === 1).forEach(b => g.setEdge(b.from.toString(), b.to.toString()));

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