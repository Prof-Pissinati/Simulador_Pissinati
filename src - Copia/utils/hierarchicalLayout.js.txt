/**
 * hierarchicalLayout.js
 * Motor de layout hierárquico para redes de distribuição elétrica.
 *
 * Pipeline:
 *   Fase 1 — Contração de grau-2 (series reduction)
 *   Fase 2 — Spanning tree por alimentador (BFS)
 *   Fase 3 — Reingold-Tilford adaptado (layout de árvore sem cruzamentos)
 *   Fase 4 — Inserção das arestas de malha com minimização local de cruzamentos
 *   Fase 5 — Expansão dos nós contraídos + snap para grade
 *
 * Integração: adicione como motor 'hierarchical' no layoutWorker.js e
 * exporte calculateHierarchicalLayout de autoLayout.js importando deste arquivo,
 * ou cole diretamente no autoLayout.js.
 *
 * Interface de saída: { [nodeId]: { x: Number, y: Number } }
 * — idêntica à dos outros motores, compatível com lockLayoutCenter.
 */

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/** Verifica se dois segmentos se cruzam (sem compartilhar extremidade). */
function _segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

/** Conta cruzamentos que uma aresta (u→v) cria contra um conjunto de arestas já posicionadas. */
function _countCrossingsForEdge(u, v, placedEdges, pos) {
    if (!pos[u] || !pos[v]) return 0;
    let count = 0;
    for (const e of placedEdges) {
        if (!pos[e.from] || !pos[e.to]) continue;
        if (e.from === u || e.to === u || e.from === v || e.to === v) continue;
        if (_segmentsIntersect(pos[u], pos[v], pos[e.from], pos[e.to])) count++;
    }
    return count;
}

/** Distância topológica (BFS) entre dois nós na árvore spanning. */
function _bfsDistance(start, end, adjTree) {
    if (start === end) return 0;
    const dist = { [start]: 0 };
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        for (const nb of (adjTree[cur] || [])) {
            if (dist[nb] === undefined) {
                dist[nb] = dist[cur] + 1;
                if (nb === end) return dist[nb];
                queue.push(nb);
            }
        }
    }
    return Infinity; // desconectado
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — CONTRAÇÃO DE GRAU-2 (Series Reduction)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contrai cadeias de nós com grau exatamente 2 em super-arestas.
 * Nós de subestação (sourcesArray) nunca são contraídos, mesmo que grau=2.
 *
 * @returns {Object} {
 *   reducedNodes   — array de IDs de nós no grafo reduzido
 *   reducedBranches — array de ramos (pode incluir super-arestas)
 *   expansionMap   — { superEdgeId: [nó1, nó2, ...] } nós intermediários na ordem
 *   originalDegree — { nodeId: grau }
 * }
 */
function contractDegree2(nodesArray, branchesArray, sourcesArray) {
    // Monta adjacência completa (arestas abertas e fechadas para grau topológico)
    const degree = {};
    const adj = {};
    nodesArray.forEach(id => { degree[id] = 0; adj[id] = []; });
    branchesArray.forEach(b => {
        degree[b.from] = (degree[b.from] || 0) + 1;
        degree[b.to]   = (degree[b.to]   || 0) + 1;
        adj[b.from].push({ neighbor: b.to,   branch: b });
        adj[b.to  ].push({ neighbor: b.from, branch: b });
    });

    const sourceSet   = new Set(sourcesArray);
    const contracted  = new Set(); // nós que foram absorvidos
    const superEdges  = [];        // { id, from, to, state, intermediaries, originalBranches }
    const keptBranches = [];       // ramos que sobreviveram sem contração
    let   superIdCounter = 1;

    // Para cada nó com grau 2 que não é fonte, tenta propagar a cadeia
    const visited = new Set();

    nodesArray.forEach(startNode => {
        // Só entra em cadeias a partir de uma "âncora" (grau≠2 ou fonte)
        if (visited.has(startNode)) return;
        if (degree[startNode] === 2 && !sourceSet.has(startNode)) return;

        // BFS a partir de âncoras para detectar cadeias saindo delas
        adj[startNode].forEach(({ neighbor: next, branch: firstBranch }) => {
            if (visited.has(next)) return;
            if (degree[next] !== 2 || sourceSet.has(next)) return;

            // Seguir a cadeia
            const chain       = [startNode, next]; // nós na cadeia
            const chainBranches = [firstBranch];
            visited.add(next);

            let current = next;
            let prev    = startNode;

            while (true) {
                const neighbors = adj[current].filter(e => e.neighbor !== prev);
                if (neighbors.length !== 1) break; // ramificação ou folha

                const { neighbor: nx, branch: nb } = neighbors[0];
                if (degree[nx] !== 2 || sourceSet.has(nx) || visited.has(nx)) {
                    // Fim da cadeia: nx é âncora
                    chain.push(nx);
                    chainBranches.push(nb);
                    break;
                }
                visited.add(nx);
                chain.push(nx);
                chainBranches.push(nb);
                prev    = current;
                current = nx;
            }

            // Só contrai se a cadeia tem pelo menos 1 nó intermediário
            if (chain.length < 3) return;

            const from = chain[0];
            const to   = chain[chain.length - 1];
            const intermediaries = chain.slice(1, -1);

            // Estado da super-aresta = estado do primeiro ramo (heurística)
            const superState = chainBranches[0].state;

            const superId = `__super_${superIdCounter++}`;
            superEdges.push({
                id:               superId,
                from:             from,
                to:               to,
                state:            superState,
                r:                chainBranches.reduce((s, b) => s + (b.r || 0), 0),
                x:                chainBranches.reduce((s, b) => s + (b.x || 0), 0),
                hasSwitch:        chainBranches.some(b => b.hasSwitch),
                isRegulator:      false,
                intermediaries:   intermediaries,
                originalBranches: chainBranches,
                __isSuper:        true,
            });

            intermediaries.forEach(id => contracted.add(id));
        });
    });

    // Ramos que não fazem parte de nenhuma super-aresta
    const superBranchIds = new Set(
        superEdges.flatMap(se => se.originalBranches.map(b => b.id))
    );
    branchesArray.forEach(b => {
        if (!superBranchIds.has(b.id)) keptBranches.push(b);
    });

    const reducedNodes    = nodesArray.filter(id => !contracted.has(id));
    const reducedBranches = [...keptBranches, ...superEdges];

    // Mapa de expansão: superEdgeId → lista de nós intermediários
    const expansionMap = {};
    superEdges.forEach(se => { expansionMap[se.id] = se.intermediaries; });

    return { reducedNodes, reducedBranches, expansionMap, originalDegree: degree };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — SPANNING TREE + SEPARAÇÃO DAS ARESTAS DE MALHA
// ─────────────────────────────────────────────────────────────────────────────

function buildSpanningTree(reducedNodes, reducedBranches, sourcesArray) {
    const sourceSet = new Set(sourcesArray.map(String));

    // Adjacência (Considerando chaves fechadas ou estado inicial padrão)
    const adjClosed = {};
    reducedNodes.forEach(id => { adjClosed[id] = []; });
    reducedBranches.forEach(b => {
        // Blindagem: Garante que chaves com state indefinido sejam consideradas fechadas se for o padrão
        const isClosed = b.state === 1 || b.state === '1' || b.initialState === 1 || b.initialState === '1' || (b.state === undefined && b.initialState === undefined);
        if (isClosed) {
            if (!adjClosed[b.from]) adjClosed[b.from] = [];
            if (!adjClosed[b.to])   adjClosed[b.to]   = [];
            adjClosed[b.from].push({ to: b.to,   branch: b });
            adjClosed[b.to  ].push({ to: b.from, branch: b });
        }
    });

    const visited  = new Set();
    const parent   = {};
    const depth    = {};
    const feederOf = {};
    const treeEdgeIds = new Set();

    const queue = [];
    let head = 0;

    // 1. Semeia as Subestações primeiro
    sourcesArray.forEach(s => {
        const sid = String(s);
        if (!visited.has(sid) && reducedNodes.includes(sid)) {
            visited.add(sid);
            parent[sid]   = null;
            depth[sid]    = 0;
            feederOf[sid] = sid;
            queue.push(sid);
        }
    });

    // 2. Roda a Busca (BFS) PRINCIPAL a partir das fontes (Isso estava no lugar errado antes!)
    while (head < queue.length) {
        const cur = queue[head++];
        for (const { to: nb, branch } of (adjClosed[cur] || [])) {
            if (!visited.has(nb)) {
                visited.add(nb);
                parent[nb]   = cur;
                depth[nb]    = (depth[cur] || 0) + 1;
                feederOf[nb] = feederOf[cur];
                treeEdgeIds.add(branch.id);
                queue.push(nb);
            }
        }
    }

    // 3. Fallback APENAS para os nós que sobraram (Ilhas que estão com chaves abertas)
    reducedNodes.forEach(id => {
        if (!visited.has(id)) {
            visited.add(id);
            parent[id]   = null;
            depth[id]    = 0;
            feederOf[id] = id;
            queue.push(id);

            // Roda o BFS para o resto da ilha isolada
            while (head < queue.length) {
                const cur = queue[head++];
                for (const { to: nb, branch } of (adjClosed[cur] || [])) {
                    if (!visited.has(nb)) {
                        visited.add(nb);
                        parent[nb]   = cur;
                        depth[nb]    = (depth[cur] || 0) + 1;
                        feederOf[nb] = feederOf[cur];
                        treeEdgeIds.add(branch.id);
                        queue.push(nb);
                    }
                }
            }
        }
    });

    const treeEdges = reducedBranches.filter(b => treeEdgeIds.has(b.id));
    const meshEdges = reducedBranches.filter(b => !treeEdgeIds.has(b.id));

    return { treeEdges, meshEdges, parent, depth, feederOf };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — REINGOLD-TILFORD ADAPTADO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o layout de uma árvore enraizada sem cruzamentos.
 * Algoritmo: Reingold-Tilford simplificado com contorno (contour).
 *
 * Orientação: raiz no topo, filhos abaixo (Y cresce para baixo).
 *
 * @param {String}  root       — nó raiz
 * @param {Object}  children   — { nodeId: [childId, ...] }
 * @param {Number}  gridSize   — espaçamento da grade (px)
 * @returns {Object}           — { [nodeId]: { x, y } } relativo à raiz em (0, 0)
 */
function reingoldTilford(root, children, gridSize) {
    const G = gridSize;
    const pos = {};

    // --- Passo 1: Calcula subtree widths (bottom-up) ---
    const subtreeWidth = {};
    const order = []; // ordem topológica (post-order)

    function postOrder(node) {
        const kids = children[node] || [];
        kids.forEach(c => postOrder(c));
        order.push(node);
        if (kids.length === 0) {
            subtreeWidth[node] = G;
        } else {
            // Largura = soma das larguras dos filhos + gaps entre eles
            subtreeWidth[node] = kids.reduce((s, c) => s + subtreeWidth[c], 0)
                + Math.max(0, kids.length - 1) * G * 0.3;
        }
    }
    postOrder(root);

    // --- Passo 2: Posicionamento (top-down) ---
    // Usa a técnica de "walker" simplificada: cada nó é centralizado sobre seus filhos.
    function placeNode(node, centerX, depthY) {
        pos[node] = { x: centerX, y: depthY };

        const kids = children[node] || [];
        if (kids.length === 0) return;

        const totalKidsWidth = kids.reduce((s, c) => s + subtreeWidth[c], 0)
            + Math.max(0, kids.length - 1) * G * 0.3;

        let curX = centerX - totalKidsWidth / 2;
        kids.forEach(kid => {
            placeNode(kid, curX + subtreeWidth[kid] / 2, depthY + G * 1.4);
            curX += subtreeWidth[kid] + G * 0.3;
        });
    }
    placeNode(root, 0, 0);

    // --- Passo 3: Ordenação de filhos por subtreeWidth para compactar ---
    // Filhos mais estreitos no centro, mais largos nas bordas (reduz sobreposição visual)
    // Re-ordenamos e recalculamos
    function reorderChildren(node) {
        const kids = (children[node] || []).slice();
        if (kids.length < 2) return;

        // Separa em dois grupos: metade menor no centro, maior nas pontas
        kids.sort((a, b) => subtreeWidth[a] - subtreeWidth[b]);
        const reordered = [];
        let left = 0, right = kids.length - 1;
        let toggle = true;
        while (left <= right) {
            if (toggle) reordered.unshift(kids[right--]);
            else        reordered.push(kids[left++]);
            toggle = !toggle;
        }
        children[node] = reordered;
        reordered.forEach(c => reorderChildren(c));
    }
    reorderChildren(root);

    // Recalcula com a nova ordem
    const pos2 = {};
    function placeNode2(node, centerX, depthY) {
        pos2[node] = { x: centerX, y: depthY };
        const kids = children[node] || [];
        if (kids.length === 0) return;
        const totalKidsWidth = kids.reduce((s, c) => s + subtreeWidth[c], 0)
            + Math.max(0, kids.length - 1) * G * 0.3;
        let curX = centerX - totalKidsWidth / 2;
        kids.forEach(kid => {
            placeNode2(kid, curX + subtreeWidth[kid] / 2, depthY + G * 1.4);
            curX += subtreeWidth[kid] + G * 0.3;
        });
    }
    placeNode2(root, 0, 0);

    return pos2;
}

/**
 * Constrói o dicionário children[] a partir da spanning tree e do mapa parent[].
 */
function buildChildrenMap(reducedNodes, parent) {
    const children = {};
    reducedNodes.forEach(id => { children[id] = []; });
    reducedNodes.forEach(id => {
        if (parent[id] !== null && parent[id] !== undefined) {
            if (!children[parent[id]]) children[parent[id]] = [];
            children[parent[id]].push(id);
        }
    });
    return children;
}

/**
 * Compõe as árvores de cada alimentador lado a lado no canvas.
 * Fonte (subestação) fica no topo de cada região.
 *
 * @returns {Object} { [nodeId]: { x, y } }
 */
function composeFeeders(sourcesArray, reducedNodes, parent, feederOf, gridSize) {
    // Raízes: fontes + nós sem pai (ilhas desconectadas)
    const roots = [];
    sourcesArray.forEach(s => {
        if (reducedNodes.includes(String(s))) roots.push(String(s));
    });
    reducedNodes.forEach(id => {
        if (parent[id] === null || parent[id] === undefined) {
            if (!roots.includes(id)) roots.push(id);
        }
    });

    const allPos = {};

    // Calcula layout individual de cada árvore
    const treeLayouts = roots.map(root => {
        const children = buildChildrenMap(reducedNodes, parent);
        // Filtra para incluir apenas nós desta árvore (feederOf === root)
        const treeNodes = reducedNodes.filter(id => feederOf[id] === root || id === root);

        // Children filtrado para esta sub-árvore
        const treeChildren = {};
        treeNodes.forEach(id => {
            treeChildren[id] = (children[id] || []).filter(c => treeNodes.includes(c));
        });

        const localPos = reingoldTilford(root, treeChildren, gridSize);

        // Bounding box local
        const xs = Object.values(localPos).map(p => p.x);
        const ys = Object.values(localPos).map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width  = maxX - minX + gridSize;
        const height = maxY - minY + gridSize;

        return { root, treeNodes, localPos, minX, maxX, minY, maxY, width, height };
    });

    // Ordena alimentadores por número de nós (maior à esquerda) para layout balanceado
    treeLayouts.sort((a, b) => b.treeNodes.length - a.treeNodes.length);

    // Posiciona as regiões lado a lado com gap
    const GAP = gridSize * 2;
    let cursorX = 0;

    treeLayouts.forEach(tree => {
        const offsetX = cursorX - tree.minX;
        const offsetY = -tree.minY; // Raiz no topo (y=0)

        tree.treeNodes.forEach(id => {
            if (tree.localPos[id]) {
                allPos[id] = {
                    x: tree.localPos[id].x + offsetX,
                    y: tree.localPos[id].y + offsetY,
                };
            }
        });

        cursorX += tree.width + GAP;
    });

    return allPos;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 4 — INSERÇÃO DAS ARESTAS DE MALHA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Para cada aresta de malha, tenta melhorar o layout trocando a ordem dos
 * filhos do LCA (ancestral comum mais baixo) para minimizar cruzamentos.
 * Estratégia leve e determinística — O(M × filhos²) onde M = |meshEdges|.
 */
function insertMeshEdges(meshEdges, pos, reducedNodes, treeEdges, parent, children) {
    if (meshEdges.length === 0) return pos;

    // Adjacência da árvore (para BFS de distância)
    const adjTree = {};
    reducedNodes.forEach(id => { adjTree[id] = []; });
    treeEdges.forEach(b => {
        if (!adjTree[b.from]) adjTree[b.from] = [];
        if (!adjTree[b.to])   adjTree[b.to]   = [];
        adjTree[b.from].push(b.to);
        adjTree[b.to  ].push(b.from);
    });

    // Ordena meshEdges por distância topológica (mais curtas primeiro = mais locais)
    const withDist = meshEdges.map(e => ({
        edge: e,
        dist: _bfsDistance(String(e.from), String(e.to), adjTree),
    }));
    withDist.sort((a, b) => a.dist - b.dist);

    const placedEdges = [...treeEdges];

    withDist.forEach(({ edge }) => {
        const u = String(edge.from);
        const v = String(edge.to);
        if (!pos[u] || !pos[v]) { placedEdges.push(edge); return; }

        // Tenta trocar a ordem dos filhos dos nós u e v para reduzir cruzamentos
        const uParent = parent[u];
        const vParent = parent[v];

        [uParent, vParent].forEach(pNode => {
            if (!pNode || !children[pNode] || children[pNode].length < 2) return;

            const kids = children[pNode];
            let bestCross = _countCrossingsForEdge(u, v, placedEdges, pos);

            // Tenta todas as permutações de pares de filhos adjacentes (bubble sort step)
            for (let i = 0; i < kids.length - 1; i++) {
                const a = kids[i], b = kids[i + 1];

                // Swap provisório (apenas as posições X)
                const tmpX = pos[a].x;
                pos[a] = { ...pos[a], x: pos[b].x };
                pos[b] = { ...pos[b], x: tmpX };
                kids[i] = b; kids[i + 1] = a;

                const newCross = _countCrossingsForEdge(u, v, placedEdges, pos);
                if (newCross < bestCross) {
                    bestCross = newCross;
                } else {
                    // Reverte
                    const tmpX2 = pos[a].x;
                    pos[a] = { ...pos[a], x: pos[b].x };
                    pos[b] = { ...pos[b], x: tmpX2 };
                    kids[i] = a; kids[i + 1] = b;
                }
            }
        });

        placedEdges.push(edge);
    });

    return pos;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 5 — EXPANSÃO DOS NÓS CONTRAÍDOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reinsere os nós intermediários que foram contraídos na Fase 1.
 * Cada nó é interpolado linearmente entre os endpoints da super-aresta.
 */
function expandContractedNodes(pos, reducedBranches, expansionMap, gridSize) {
    const finalPos = { ...pos };

    reducedBranches.forEach(b => {
        if (!b.__isSuper) return;
        const intermediaries = expansionMap[b.id];
        if (!intermediaries || intermediaries.length === 0) return;

        const pFrom = pos[String(b.from)];
        const pTo   = pos[String(b.to)];
        if (!pFrom || !pTo) return;

        const n = intermediaries.length + 1; // segmentos
        intermediaries.forEach((nodeId, i) => {
            const t = (i + 1) / n;
            finalPos[String(nodeId)] = {
                x: pFrom.x + (pTo.x - pFrom.x) * t,
                y: pFrom.y + (pTo.y - pFrom.y) * t,
            };
        });
    });

    return finalPos;
}

// ─────────────────────────────────────────────────────────────────────────────
// PÓS-PROCESSAMENTO — SNAP PARA GRADE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encaixa todas as posições na grade mais próxima.
 * Resolve colisões empurrando o nó para a célula vizinha mais próxima.
 */
function snapToGrid(pos, nodesArray, gridSize) {
    const G = gridSize;
    const snapped = {};
    const occupied = new Set();

    // Ordena: fontes e nós de alta conectividade primeiro (posição mais estável)
    const order = [...nodesArray];

    order.forEach(id => {
        const p = pos[id];
        if (!p) { snapped[id] = { x: 0, y: 0 }; return; }

        let baseX = Math.round(p.x / G) * G;
        let baseY = Math.round(p.y / G) * G;

        // Procura célula livre em espiral
        let ring = 0;
        let placed = false;
        while (!placed) {
            for (let dx = -ring; dx <= ring && !placed; dx++) {
                for (let dy = -ring; dy <= ring && !placed; dy++) {
                    if (Math.abs(dx) === ring || Math.abs(dy) === ring) {
                        const cx = baseX + dx * G;
                        const cy = baseY + dy * G;
                        const key = `${cx},${cy}`;
                        if (!occupied.has(key)) {
                            occupied.add(key);
                            snapped[id] = { x: cx, y: cy };
                            placed = true;
                        }
                    }
                }
            }
            ring++;
        }
    });

    return snapped;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateHierarchicalLayout
 *
 * Motor principal — pipeline completo das 5 fases.
 *
 * @param {String[]} nodesArray     — IDs de todos os nós (strings)
 * @param {Object[]} branchesArray  — ramos { id, from, to, state, ... }
 * @param {String[]} sourcesArray   — IDs das subestações/fontes
 * @param {Object}   config         — { gridSize?, onProgress?, feederMap? }
 * @returns {Object}                — { [nodeId]: { x, y } }
 */
export function calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // ── Normalização de tipos ──────────────────────────────────────────────
    nodesArray     = nodesArray.map(String);
    branchesArray  = branchesArray.map(b => ({
        ...b,
        id:   String(b.id),
        from: String(b.from),
        to:   String(b.to),
    }));
    sourcesArray   = sourcesArray.map(String);

    const G          = config.gridSize || 100;
    const onProgress = config.onProgress || (() => {});

    onProgress(1, 'Hierárquico', 'Contraindo cadeias...');

    // ── Fase 1: Contração de grau-2 ───────────────────────────────────────
    const {
        reducedNodes,
        reducedBranches,
        expansionMap,
    } = contractDegree2(nodesArray, branchesArray, sourcesArray);

    onProgress(2, 'Hierárquico', 'Construindo árvore...');

    // ── Fase 2: Spanning tree ──────────────────────────────────────────────
    const {
        treeEdges,
        meshEdges,
        parent,
        feederOf,
    } = buildSpanningTree(reducedNodes, reducedBranches, sourcesArray);

    onProgress(3, 'Hierárquico', 'Posicionando árvore (RT)...');

    // ── Fase 3: Reingold-Tilford + composição ─────────────────────────────
    let pos = composeFeeders(sourcesArray, reducedNodes, parent, feederOf, G);

    // ── Fase 4: Inserção das arestas de malha ─────────────────────────────
    onProgress(4, 'Hierárquico', 'Inserindo arestas de malha...');

    const children = buildChildrenMap(reducedNodes, parent);
    pos = insertMeshEdges(meshEdges, pos, reducedNodes, treeEdges, parent, children);

    // ── Fase 5: Expansão dos nós contraídos ──────────────────────────────
    onProgress(5, 'Hierárquico', 'Expandindo nós...');

    let finalPos = expandContractedNodes(pos, reducedBranches, expansionMap, G);

    // ── Snap para grade ────────────────────────────────────────────────────
    finalPos = snapToGrid(finalPos, nodesArray, G);

    onProgress('Concluído', 'Hierárquico', 'Pronto!');

    // Garante que todos os nós têm posição
    nodesArray.forEach(id => {
        if (!finalPos[id]) finalPos[id] = { x: 0, y: 0 };
    });

    return finalPos;
}
