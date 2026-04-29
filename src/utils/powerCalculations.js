import { solveLinearSystem } from './mathSolver';

// --- GERENCIADOR DE CACHE ---
export const CacheManager = {
    cache: new Map(),
    islandCache: new Map(), // memória isolada por ilhas. Cada ilha tem seu próprio cache de topologia reduzida e resultados.
    hashHistory: new Map(),
    getKey: (branches, faultNodes, method, sysData) => {
        const branchState = branches.map(b => `${b.id}:${b.state}:${b.currentTap || 0}`).join('|');
        const faultState = Array.from(faultNodes).sort().join(',');
        const shuntState = sysData && sysData.shunts ? Object.entries(sysData.shunts).map(([id, s]) => `${id}:${s.steps}`).join(',') : '';
        return `${method}-${branchState}-${faultState}-${shuntState}`;
    },
    get: function(branches, faultNodes, method, sysData) {
        return this.cache.get(this.getKey(branches, faultNodes, method, sysData));
    },
    set: function(branches, faultNodes, method, sysData, result) {
        const key = this.getKey(branches, faultNodes, method, sysData);
        if (this.cache.size > 20) this.cache.clear();
        this.cache.set(key, result);
    }
};

// 👇 0. O NOVO CÉREBRO: O Particionador de Ilhas (Block-Diagonalization) 👇
function partitionIntoIslands(branches, sources, faultNodes) {
    const activeBranches = branches.filter(b => b.state === 1);
    const adj = {};
    activeBranches.forEach(b => {
        if (!adj[b.from]) adj[b.from] = [];
        if (!adj[b.to]) adj[b.to] = [];
        adj[b.from].push({ node: b.to, branch: b });
        adj[b.to].push({ node: b.from, branch: b });
    });

    const islands = [];
    const visitedNodes = new Set(faultNodes); // Faltas bloqueiam a criação de ilhas
    const visitedBranches = new Set();
    const sourceSet = new Set(sources);

    sources.forEach(source => {
        if (faultNodes.has(source)) return;
        if (!adj[source]) return;

        // Cada ramo saindo da Subestação é um potencial Alimentador Independente
        adj[source].forEach(({ node: startNode, branch: startBranch }) => {
            if (faultNodes.has(startNode) || visitedBranches.has(startBranch.id)) return;

            // Inicia uma nova Ilha
            const island = {
                sources: new Set([source]),
                nodes: new Set([source]),
                branches: new Map()
            };

            const queue = [startNode];
            visitedNodes.add(startNode);
            island.nodes.add(startNode);
            island.branches.set(startBranch.id, startBranch);
            visitedBranches.add(startBranch.id);

            let head = 0;
            while (head < queue.length) {
                const u = queue[head++];
                if (!adj[u]) continue;

                adj[u].forEach(({ node: v, branch: b }) => {
                    if (faultNodes.has(v)) return;

                    if (!visitedBranches.has(b.id)) {
                        island.branches.set(b.id, b);
                        visitedBranches.add(b.id);
                    }

                    if (sourceSet.has(v)) {
                        island.sources.add(v);
                        island.nodes.add(v);
                    } else if (!visitedNodes.has(v)) {
                        visitedNodes.add(v);
                        island.nodes.add(v);
                        queue.push(v);
                    }
                });
            }
            
            islands.push({
                sources: Array.from(island.sources),
                nodes: island.nodes,
                branches: Array.from(island.branches.values())
            });
        });
    });

    return islands;
}

// --- FUNÇÃO PRINCIPAL DE FLUXO DE POTÊNCIA ---
export function runPowerFlow(branches, faultNodes, method = 'NR', sysData, eventNodes = new Set()){ 
    CacheManager.cache.clear();

    const { Vbase = 13.8, Sbase = 1000, sources = [] } = sysData || {};
    
    if (sources.length === 0) {
        console.warn("Nenhuma fonte definida no sistema!");
        return { nodes: {}, lines: {} };
    }

    // 👇 1. O PARTICIONADOR DIVIDE O MAPA EM PEDAÇOS 👇
    const islands = partitionIntoIslands(branches, sources, faultNodes);
    console.log(`🧩 Fatoração em Blocos: O sistema foi dividido em ${islands.length} ilha(s) eletricamente independente(s).`);

    const finalNodes = {};
    const finalLines = {};

    sources.forEach(s => {
        finalNodes[s] = { v: 1.0, angle: 0, p: 0, q: 0 };
    });

    islands.forEach((island, index) => {
        const islandSysData = { ...sysData, sources: island.sources };
        
        // ==============================================================
        // 🧠 INTELIGÊNCIA ARTIFICIAL: CACHE POR ILHA
        // ==============================================================
        const sortedBranches = [...island.branches].sort((a, b) => a.id - b.id);
        const islandBranchHash = sortedBranches.map(b => `${b.id}:${b.state}:${b.currentTap||0}`).join(',');
        
        const sortedNodes = Array.from(island.nodes).sort();
        const islandNodeHash = sortedNodes.map(n => {
            let h = `${n}`;
            if (faultNodes.has(n)) h += 'F';
            if (islandSysData.shunts[n]) h += `S${islandSysData.shunts[n].steps}`;
            if (islandSysData.loads[n]) h += `L${islandSysData.loads[n].p}-${islandSysData.loads[n].q}`;
            return h;
        }).join(',');
        
        const islandKey = `${method}-${Vbase}-${Sbase}|${islandBranchHash}|${islandNodeHash}`;

        if (CacheManager.islandCache.has(islandKey)) {
            console.log(`   ♻️ Ilha ${index + 1}: Recuperada do cache 🚀`);
            const cachedIsland = CacheManager.islandCache.get(islandKey);
            Object.assign(finalNodes, cachedIsland.nodes);
            Object.assign(finalLines, cachedIsland.lines);
            return; 
        }
        // ==============================================================

        // NOVO: Verifica se esta ilha possui algum BC ativo
        const hasActiveShunt = Array.from(island.nodes).some(id => 
            islandSysData.shunts[id] && islandSysData.shunts[id].steps > 0
        );
        

        // NOVO: Se tiver BC, blinda a ilha inteira. Se não, usa só o escudo de manobras normal.
        const currentShield = new Set(eventNodes);
        if (hasActiveShunt) {
            island.nodes.forEach(id => currentShield.add(id));
            console.log(`   ✨ Ilha ${index + 1} possui BC ativo. Redutor desativado para garantir fidelidade V².`);
        }

        // Passa o currentShield dinâmico para o redutor
        const { reducedBranches, reducedSysData, pruneHistory } = reduceSystemTopology(
            island.branches, 
            faultNodes, 
            islandSysData, 
            currentShield // 👈 Usa o escudo atualizado aqui
        );
        
        console.log(`   🔹 Ilha ${index + 1}: NR calculará ${reducedBranches.length} ramos (Original da ilha: ${island.branches.length})`);

        const islandNodesSet = new Set(island.sources);
        const adj = {};
        
        reducedBranches.forEach(b => {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        });

        const queue = [...island.sources];
        let head = 0;
        while(head < queue.length){
            const u = queue[head++];
            if(adj[u]){
                adj[u].forEach(v => {
                    if(!islandNodesSet.has(v)){
                        islandNodesSet.add(v);
                        queue.push(v);
                    }
                });
            }
        }

        const nodes = Array.from(islandNodesSet).sort((a,b) => a-b);
        const n = nodes.length;

        if (n === 0 || reducedBranches.length === 0) {
            const emptyResult = buildResult([], [], [], 1, reducedBranches, new Map(), new Set(), reducedSysData);
            const expanded = expandSystemResults(emptyResult, pruneHistory, islandSysData, island.branches);

            CacheManager.islandCache.set(islandKey, expanded);

            Object.assign(finalNodes, expanded.nodes);
            Object.assign(finalLines, expanded.lines);
            return; 
        }

        const nodeMap = new Map(nodes.map((id, idx) => [id, idx]));
        const Zbase = (Math.pow(Vbase, 2) * 1000) / Sbase;

        const G = Array(n).fill(0).map(() => Array(n).fill(0));
        const B = Array(n).fill(0).map(() => Array(n).fill(0));

        reducedBranches.forEach(branch => {
            if (!nodeMap.has(branch.from) || !nodeMap.has(branch.to)) return;
            
            const u = nodeMap.get(branch.from);
            const v = nodeMap.get(branch.to);
            
            const r_pu = branch.r / Zbase;
            const x_pu = branch.x / Zbase;
            const mag2 = r_pu**2 + x_pu**2;
            
            if (mag2 < 1e-20) return; 

            const g = r_pu / mag2;
            const b_line = -x_pu / mag2; 
            
            let a = 1.0;
            if (branch.isRegulator && branch.maxTaps > 0) {
                const regMaxPu = branch.regMax > 1 ? branch.regMax / 100 : (branch.regMax || 0.1); 
                a = 1.0 + (branch.currentTap * (regMaxPu / branch.maxTaps));
            }
            const a2 = a * a;
            
            G[u][v] -= g / a; 
            B[u][v] -= b_line / a;
            G[v][u] -= g / a; 
            B[v][u] -= b_line / a;
            
            G[u][u] += g / a2; 
            B[u][u] += b_line / a2;
            G[v][v] += g; 
            B[v][v] += b_line;
        });

        nodes.forEach((id, i) => {
            if (reducedSysData.shunts[id] && reducedSysData.shunts[id].steps > 0) {
                const b_shunt_pu = (reducedSysData.shunts[id].steps * reducedSysData.shunts[id].stepSize) / Sbase;
                B[i][i] += b_shunt_pu;
            }
        });

        let V = Array(n).fill(1.0);
        let Theta = Array(n).fill(0.0);
        const P_spec = Array(n).fill(0);
        const Q_spec = Array(n).fill(0);
        const busType = Array(n).fill(0); 

        nodes.forEach((id, i) => {
            if (island.sources.includes(id)) {
                busType[i] = 1; 
                V[i] = 1.0; 
                Theta[i] = 0.0;
            } else {
                const load = reducedSysData.loads[id]; 
                if (load) {
                    P_spec[i] = -(load.p / Sbase);
                    Q_spec[i] = -(load.q / Sbase);
                }
            }
        });

        if (method === 'GS') {
            solveGaussSeidel(n, busType, P_spec, Q_spec, G, B, V, Theta);
        } else {
            solveNewtonRaphson(n, busType, P_spec, Q_spec, G, B, V, Theta);
        }


        const pfResult = buildResult(nodes, V, Theta, Zbase, reducedBranches, nodeMap, islandNodesSet, reducedSysData);
        
        // Expande o resultado exclusivo desta ilha
        const expanded = expandSystemResults(pfResult, pruneHistory, islandSysData, island.branches);
        
        // 👇 SALVA O NOVO RESULTADO NO CACHE DA ILHA 👇
        if (CacheManager.islandCache.size > 500) CacheManager.islandCache.clear(); // Proteção de Memória RAM
        CacheManager.islandCache.set(islandKey, expanded);

        // "Cola" o pedaço finalizado no Mapa Geral
        Object.assign(finalNodes, expanded.nodes);
        Object.assign(finalLines, expanded.lines);
    });

    // 👇 3. TRAVA GLOBAL (Mantém a tela viva para o que não foi calculado) 👇
    branches.forEach(b => {
        if (!finalLines[b.id]) {
            const limitCurrent = b.Imax || b.imax || b.capacity || b.limit || 1000;
            finalLines[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent };
        }
        if (!finalNodes[b.from]) finalNodes[b.from] = { v: 0, angle: 0, p: 0, q: 0 };
        if (!finalNodes[b.to]) finalNodes[b.to] = { v: 0, angle: 0, p: 0, q: 0 };
    });

    return { nodes: finalNodes, lines: finalLines };
}

function solveGaussSeidel(n, busType, P_spec, Q_spec, G, B, V, Theta) {
    const maxIter = 1000;
    const tolerance = 1e-4;
    let e = Array(n).fill(1.0);
    let f = Array(n).fill(0.0);

    for(let i=0; i<n; i++) {
        e[i] = V[i] * Math.cos(Theta[i]);
        f[i] = V[i] * Math.sin(Theta[i]);
    }

    for(let iter=0; iter<maxIter; iter++) {
        let maxError = 0;
        for(let i=0; i<n; i++) {
            if(busType[i] === 1) continue; 

            let sumYV_real = 0;
            let sumYV_imag = 0;

            for(let j=0; j<n; j++) {
                if(i === j) continue;
                sumYV_real += (G[i][j]*e[j] - B[i][j]*f[j]);
                sumYV_imag += (G[i][j]*f[j] + B[i][j]*e[j]);
            }

            const den = e[i]**2 + f[i]**2;
            const current_real = (P_spec[i]*e[i] + Q_spec[i]*f[i]) / den;
            const current_imag = (P_spec[i]*(-f[i]) - Q_spec[i]*e[i]) / den;

            const y_mag2 = G[i][i]**2 + B[i][i]**2;
            const y_inv_real = G[i][i] / y_mag2;
            const y_inv_imag = -B[i][i] / y_mag2;

            const rhs_real = current_real - sumYV_real;
            const rhs_imag = current_imag - sumYV_imag;

            const e_new = y_inv_real*rhs_real - y_inv_imag*rhs_imag;
            const f_new = y_inv_real*rhs_imag + y_inv_imag*rhs_real;

            const e_acc = e[i] + 1.1 * (e_new - e[i]);
            const f_acc = f[i] + 1.1 * (f_new - f[i]);

            const diff = Math.sqrt((e_acc-e[i])**2 + (f_acc-f[i])**2);
            if(diff > maxError) maxError = diff;

            e[i] = e_acc;
            f[i] = f_acc;
        }
        if(maxError < tolerance) break;
    }
    
    for(let i=0; i<n; i++) {
        V[i] = Math.sqrt(e[i]**2 + f[i]**2);
        Theta[i] = Math.atan2(f[i], e[i]);
    }
}

function solveNewtonRaphson(n, busType, P_spec, Q_spec, G, B, V, Theta) {
    const maxIter = 20;
    const tolerance = 1e-4;
    
    const pqIndices = [];
    for(let i=0; i<n; i++) if(busType[i] === 0) pqIndices.push(i);
    
    if(pqIndices.length === 0) return;
    const dim = pqIndices.length;

    for (let iter = 0; iter < maxIter; iter++) {
        const dP = [];
        const dQ = [];
        let maxError = 0;
        
        const P_calc_arr = [];
        const Q_calc_arr = [];

        for (let i of pqIndices) {
            let Pc = 0, Qc = 0;
            for (let j = 0; j < n; j++) {
                const angle = Theta[i] - Theta[j];
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                Pc += V[j] * (G[i][j] * cos + B[i][j] * sin);
                Qc += V[j] * (G[i][j] * sin - B[i][j] * cos);
            }
            Pc *= V[i]; 
            Qc *= V[i];
            
            P_calc_arr[i] = Pc;
            Q_calc_arr[i] = Qc;

            const diffP = P_spec[i] - Pc;
            const diffQ = Q_spec[i] - Qc;
            dP.push(diffP); 
            dQ.push(diffQ);
            
            maxError = Math.max(maxError, Math.abs(diffP), Math.abs(diffQ));
        }

        if (maxError < tolerance) break;

        const J = Array(2 * dim).fill(0).map(() => Array(2 * dim).fill(0));

        for (let r = 0; r < dim; r++) {
            const i = pqIndices[r];
            
            for (let c = 0; c < dim; c++) {
                const j = pqIndices[c];
                let H, N, M, L;

                if (i !== j) { 
                    const angle = Theta[i] - Theta[j];
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    
                    H = V[i] * V[j] * (G[i][j] * sin - B[i][j] * cos);
                    N = V[i] * (G[i][j] * cos + B[i][j] * sin);
                    M = -V[i] * V[j] * (G[i][j] * cos + B[i][j] * sin);
                    L = V[i] * (G[i][j] * sin - B[i][j] * cos);
                } else { 
                    H = -Q_calc_arr[i] - B[i][i] * V[i]**2;
                    N = (P_calc_arr[i] + G[i][i] * V[i]**2) / V[i];
                    M = P_calc_arr[i] - G[i][i] * V[i]**2;
                    L = (Q_calc_arr[i] - B[i][i] * V[i]**2) / V[i];
                }

                J[r][c] = H; 
                J[r][c + dim] = N;
                J[r + dim][c] = M; 
                J[r + dim][c + dim] = L;
            }
        }

        const dx = solveLinearSystem(J, [...dP, ...dQ]);

        for (let r = 0; r < dim; r++) {
            Theta[pqIndices[r]] += dx[r];
            V[pqIndices[r]] += dx[r + dim];
        }
    }
}

function buildResult(nodes, V, Theta, Zbase, branches, nodeMap, energizedNodes, sysData) {
    const { Sbase = 1000, Vbase = 13.8 } = sysData || {}; 
    const nodeResults = {};
    const lineResults = {};

    nodes.forEach((id, i) => {
        nodeResults[id] = { v: V[i], angle: Theta[i] * (180 / Math.PI) };
    });

    branches.forEach(b => {
        // 👇 AGORA ELE SEMPRE LÊ O LIMITE PRIMEIRO 👇
        const limitCurrent = b.Imax || b.imax || b.capacity || b.limit || 1000;

        if (b.state === 0 || !energizedNodes.has(b.from) || !energizedNodes.has(b.to)) {
             lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent }; // 👈 Passando para a UI
             return;
        }
        
        const u = nodeMap.get(b.from);
        const v = nodeMap.get(b.to);
        
        if (u === undefined || v === undefined) {
             lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent }; // 👈 Passando para a UI
             return;
        }

        const r_pu = b.r / Zbase;
        const x_pu = b.x / Zbase;
        const mag2 = r_pu**2 + x_pu**2;
        if(mag2 < 1e-20) { lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent }; return; }

        const g = r_pu / mag2; 
        const bb = -x_pu / mag2;

        let a = 1.0;
        if (b.isRegulator && b.maxTaps > 0) {
            const regMaxPu = b.regMax > 1 ? b.regMax / 100 : (b.regMax || 0.1); 
            a = 1.0 + (b.currentTap * (regMaxPu / b.maxTaps));
        }
        const a2 = a * a;

        const ang = Theta[u] - Theta[v];
        
        const p_pu = (V[u]**2 * g / a2) - (V[u] * V[v] * (g * Math.cos(ang) + bb * Math.sin(ang)) / a);
        const q_pu = -(V[u]**2 * bb / a2) - (V[u] * V[v] * (g * Math.sin(ang) - bb * Math.cos(ang)) / a);
        
        const i_real = (Math.sqrt(p_pu**2 + q_pu**2) / V[u]) * (Sbase / (Math.sqrt(3) * Vbase));
        
        lineResults[b.id] = {
            current: i_real,
            percentage: (i_real / limitCurrent) * 100,
            pFlow: p_pu * Sbase,
            qFlow: q_pu * Sbase,
            limitCurrent // 👈 Passando o valor real mastigado para a UI
        };
    });
    return { nodes: nodeResults, lines: lineResults };
}

// 👇 PROPAGAÇÃO DE ENERGIA (Com Hierarquia e Barreiras Radiais) 👇
export function propagateFeeds(branches, faultNodes, sysData) {
    const nodeFeeds = {};
    const { sources = [], feeders = [] } = sysData || {};
    const activeBranches = branches.filter(b => b.state === 1);

    const adj = {};
    activeBranches.forEach(b => {
        if (!adj[b.from]) adj[b.from] = [];
        if (!adj[b.to]) adj[b.to] = [];
        adj[b.from].push(b.to);
        adj[b.to].push(b.from);
    });

    const allSources = [...sources, ...feeders];
    allSources.forEach(s => {
        if (!nodeFeeds[s]) nodeFeeds[s] = new Set();
        nodeFeeds[s].add(s);
    });

    // 1. A Transmissão (Fontes Principais): Propagam por TUDO
    sources.forEach(source => {
        if (faultNodes.has(source)) return;
        const queue = [source];
        const visited = new Set([source]);

        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            if (!adj[u]) continue;
            adj[u].forEach(v => {
                if (!visited.has(v) && !faultNodes.has(v)) {
                    visited.add(v);
                    if (!nodeFeeds[v]) nodeFeeds[v] = new Set();
                    nodeFeeds[v].add(source);
                    queue.push(v);
                }
            });
        }
    });

    // 2. A Distribuição (Alimentadores): Propagam apenas no seu ramal
    feeders.forEach(feeder => {
        if (faultNodes.has(feeder)) return;
        const queue = [feeder];
        const visited = new Set([feeder]);

        let head = 0;
        while (head < queue.length) {
            const u = queue[head++];
            if (!adj[u]) continue;
            adj[u].forEach(v => {
                if (!visited.has(v) && !faultNodes.has(v)) {
                    // 👇 A BARREIRA INVISÍVEL: Impede que o Alimentador invada a rede vizinha 👇
                    if (sources.includes(v) || feeders.includes(v)) return;

                    visited.add(v);
                    if (!nodeFeeds[v]) nodeFeeds[v] = new Set();
                    nodeFeeds[v].add(feeder);
                    queue.push(v);
                }
            });
        }
    });

    return nodeFeeds;
}

/**
 * Calcula zonas visuais para clustering.
 * Cada ramal que sai diretamente de uma source ou feeder define uma zona.
 * Barras sem zona (ilhas sem energia) recebem zona 'blackout'.
 */
export function computeVisualZones(branches, sources, feeders, faultNodes = new Set()) {
    const nodeZone = {};
    const activeBranches = branches.filter(b => b.state === 1);

    // Monta adjacência
    const adj = {};
    activeBranches.forEach(b => {
        if (!adj[b.from]) adj[b.from] = [];
        if (!adj[b.to]) adj[b.to] = [];
        adj[b.from].push({ neighbor: b.to, branchId: b.id });
        adj[b.to].push({ neighbor: b.from, branchId: b.id });
    });

    const allBoundary = new Set([...sources, ...feeders]);

    allBoundary.forEach(rootId => {
        if (faultNodes.has(rootId)) return;
        const neighbors = adj[rootId] || [];

        neighbors.forEach(({ neighbor, branchId }) => {
            if (allBoundary.has(neighbor)) return;
            if (faultNodes.has(neighbor)) return;

            const zoneId = `zone-${rootId}-branch-${branchId}`;

            const queue = [neighbor];
            const visited = new Set([rootId, neighbor]);
            nodeZone[neighbor] = zoneId;

            let head = 0;
            while (head < queue.length) {
                const u = queue[head++];
                (adj[u] || []).forEach(({ neighbor: v }) => {
                    if (visited.has(v) || faultNodes.has(v)) return;
                    if (allBoundary.has(v)) return;
                    visited.add(v);
                    if (!nodeZone[v]) nodeZone[v] = zoneId;
                    queue.push(v);
                });
            }
        });
    });

    return nodeZone;
}

// 👇 CÁLCULO DE CARGA (Com Contagem Hierárquica Múltipla) 👇
export function calculateLoads(nodeFeeds, faultNodes, sysData) {
    const subs = {};
    const { sources = [], feeders = [], loads = {}, shunts = {} } = sysData || {};
    
    // Inicializa os painéis (SUB e ALIM)
    const allSources = [...sources, ...feeders];
    allSources.forEach(s => {
        subs[s] = { p: 0, q: 0, nodes: 0 };
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if (!allSources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            
            if (feeds && feeds.size > 0) {
                // Calcula P e Q da barra uma única vez
                let nodeP = 0;
                let nodeQ = 0;
                
                if (loads[id]) {
                    nodeP += loads[id].p || 0;
                    nodeQ += loads[id].q || 0;
                }
                
                if (shunts[id] && shunts[id].steps > 0) {
                    nodeQ -= (shunts[id].steps * shunts[id].stepSize);
                }
                
                // 👇 A MÁGICA: Adiciona a barra em TODAS as fontes que a alimentam! 👇
                feeds.forEach(s => {
                    if (subs[s]) {
                        subs[s].nodes++; 
                        subs[s].p += nodeP;
                        subs[s].q += nodeQ;
                    }
                });
            }
        }
    });

    return subs;
}
// 👇 1. REDUTOR TOPOLÓGICO (Agora com Compensação de Perdas I²R) 👇
export function reduceSystemTopology(branches, faultNodes, sysData, eventNodes = new Set()) {
    const { sources = [], loads = {}, shunts = {}, Vbase = 13.8, Sbase = 1000 } = sysData;
    const Zbase = (Vbase * Vbase) / (Sbase / 1000);
    
    const reducedLoads = JSON.parse(JSON.stringify(loads));
    const activeBranches = branches.filter(b => b.state === 1);
    const branchMap = new Map(activeBranches.map(b => [b.id, { ...b }]));
    
    const adj = {}; const degree = {};
    activeBranches.forEach(b => {
        if (!adj[b.from]) { adj[b.from] = new Set(); degree[b.from] = 0; }
        if (!adj[b.to])   { adj[b.to]   = new Set(); degree[b.to]   = 0; }
        adj[b.from].add(b.id); adj[b.to].add(b.id);
        degree[b.from]++; degree[b.to]++;
    });

    const protectedNodes = new Set([...sources, ...Array.from(faultNodes), ...Array.from(eventNodes)]);
    
    // Protege as barras com BC ativo para que o Newton-Raphson calcule o V² exato
    Object.keys(sysData.shunts || {}).forEach(id => {
        if (sysData.shunts[id] && sysData.shunts[id].steps > 0) {
            protectedNodes.add(parseInt(id));
        }
    });

    const leavesQueue = [];
    Object.keys(degree).forEach(nodeStr => {
        const nodeId = parseInt(nodeStr);
        if (degree[nodeId] === 1 && !protectedNodes.has(nodeId)) leavesQueue.push(nodeId);
    });

    const pruneHistory = [];

    while (leavesQueue.length > 0) {
        const leafId = leavesQueue.shift();
        if (degree[leafId] !== 1 || protectedNodes.has(leafId)) continue;

        const branchId = Array.from(adj[leafId])[0];
        const branch = branchMap.get(branchId);
        if (!branch) continue;

        const parentId = branch.from === leafId ? branch.to : branch.from;

        let pLeaf = reducedLoads[leafId]?.p || 0;
        let qLeaf = reducedLoads[leafId]?.q || 0;
        if (shunts[leafId]) qLeaf -= (shunts[leafId].steps * shunts[leafId].stepSize);

        // 👇 A MÁGICA DA COMPENSAÇÃO DE PERDAS (I²R e I²X) 👇
        const Ppu = pLeaf / Sbase;
        const Qpu = qLeaf / Sbase;
        const Rpu = branch.r / Zbase;
        const Xpu = branch.x / Zbase;
        
        // Assumimos V ≈ 1.0 pu para estimar a perda de potência na linha apagada
        // Ploss = R * I^2 -> R * (S/V)^2. Se V=1, fica apenas R * S^2
        const Ploss_pu = Rpu * (Ppu * Ppu + Qpu * Qpu);
        const Qloss_pu = Xpu * (Ppu * Ppu + Qpu * Qpu);
        
        const pTotal = pLeaf + (Ploss_pu * Sbase);
        const qTotal = qLeaf + (Qloss_pu * Sbase);

        if (!reducedLoads[parentId]) reducedLoads[parentId] = { p: 0, q: 0 };
        // Transferimos a carga da ponta + a perda gerada na linha!
        reducedLoads[parentId].p += pTotal;
        reducedLoads[parentId].q += qTotal;

        pruneHistory.push({
            leafId, parentId, branch,
            pFlow: pTotal, qFlow: qTotal // A fita agora grava a carga total com perdas!
        });

        branchMap.delete(branchId);
        adj[parentId].delete(branchId);
        degree[parentId]--; degree[leafId] = 0;

        if (degree[parentId] === 1 && !protectedNodes.has(parentId)) leavesQueue.push(parentId);
    }

    const reducedBranches = Array.from(branchMap.values());
    const reducedSysData = { ...sysData, loads: reducedLoads };

    return { reducedBranches, reducedSysData, pruneHistory };
}


// 👇 2. O EXPANSOR (Agora com cálculo de Fase/Ângulo exato) 👇
export function expandSystemResults(pfResult, pruneHistory, sysData, originalBranches) {
    if (!pfResult) pfResult = { nodes: {}, lines: {} };
    if (!pfResult.nodes) pfResult.nodes = {};
    if (!pfResult.lines) pfResult.lines = {};

    const { Vbase = 13.8, Sbase = 1000, sources = [] } = sysData;
    const Zbase = (Vbase * Vbase) / (Sbase / 1000);

    // Garante as Fontes
    sources.forEach(s => {
        if (!pfResult.nodes[s]) pfResult.nodes[s] = { v: 1.0, angle: 0, p: 0, q: 0 };
    });

    // Rebobina a fita calculando Magnitude E Ângulo
    for (let i = pruneHistory.length - 1; i >= 0; i--) {
        const record = pruneHistory[i];
        
        const parentV = pfResult.nodes[record.parentId]?.v || 0;
        const parentAngle = pfResult.nodes[record.parentId]?.angle || 0; 

        if (parentV === 0) {
            pfResult.nodes[record.leafId] = { v: 0, angle: 0, p: 0, q: 0 };
            pfResult.lines[record.branch.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0 };
            continue;
        }

        const Rpu = record.branch.r / Zbase;
        const Xpu = record.branch.x / Zbase;
        const Ppu = record.pFlow / Sbase;
        const Qpu = record.qFlow / Sbase;

        // 1. Queda Longitudinal (Magnitude V)
        const vLeaf = parentV - ((Rpu * Ppu + Xpu * Qpu) / parentV);
        
        // 👇 2. Queda Transversal (Ângulo Theta) 👇
        // Fórmula: delta_theta = (X*P - R*Q) / V^2 (em radianos)
        const deltaThetaRad = (Xpu * Ppu - Rpu * Qpu) / (parentV * parentV);
        
        // Converte o shift para graus e subtrai do ângulo do pai
        const leafAngle = parentAngle - (deltaThetaRad * (180 / Math.PI));

        // 👇 ADICIONE ESTA CÂMERA DE SEGURANÇA AQUI 👇
        console.log(`📉 [Via Expressa Radial] Barra ${record.leafId}: Tensão calculada = ${vLeaf.toFixed(4)} pu | Ângulo = ${leafAngle.toFixed(4)}°`);

        pfResult.nodes[record.leafId] = { v: vLeaf, angle: leafAngle, p: record.pFlow, q: record.qFlow };

        const S_flow_pu = Math.sqrt(Math.pow(Ppu, 2) + Math.pow(Qpu, 2));
        const I_est = S_flow_pu * (Sbase / (Math.sqrt(3) * Vbase));
        const limit = record.branch.Imax || 5000;
        
        pfResult.lines[record.branch.id] = {
            current: I_est,
            percentage: (I_est / limit) * 100,
            pFlow: record.pFlow,
            qFlow: record.qFlow
        };
    }

    originalBranches.forEach(b => {
        if (!pfResult.lines[b.id]) {
            const limitCurrent = b.Imax || b.imax || b.capacity || b.limit || 1000;
            pfResult.lines[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent };
        }
        if (!pfResult.nodes[b.from]) pfResult.nodes[b.from] = { v: 0, angle: 0, p: 0, q: 0 };
        if (!pfResult.nodes[b.to]) pfResult.nodes[b.to] = { v: 0, angle: 0, p: 0, q: 0 };
    });

    return pfResult;
}
/*
// 👇 CÁLCULO DE CARGA ATUALIZADO PARA CONTAR TODAS AS BARRAS E ALIMENTADORES 👇
export function calculateLoads(nodeFeeds, faultNodes, sysData) {
    const subs = {};
    const { sources = [], feeders = [], loads = {}, shunts = {} } = sysData || {};
    
    // 1. Inicializa Subs Principais e Alimentadores
    const allSources = [...sources, ...feeders];
    allSources.forEach(s => {
        subs[s] = { p: 0, q: 0, nodes: 0 };
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if (!allSources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            if (feeds && feeds.size >= 1) {
                const s = Array.from(feeds)[0];
                if (subs[s]) {
                    let nodeP = 0;
                    let nodeQ = 0;
                    
                    // 👇 AQUI ESTÁ O SEGREDO: Conta a barra independente de ter carga ou não
                    subs[s].nodes++; 
                    
                    // Soma a carga normal
                    if (loads[id]) {
                        nodeP += loads[id].p || 0;
                        nodeQ += loads[id].q || 0;
                    }
                    
                    // Subtrai a carga reativa injetada pelos bancos de capacitores
                    if (shunts[id] && shunts[id].steps > 0) {
                        nodeQ -= (shunts[id].steps * shunts[id].stepSize);
                    }
                    
                    subs[s].p += nodeP;
                    subs[s].q += nodeQ;
                }
            }
        }
    });

    return subs;
} 
*/