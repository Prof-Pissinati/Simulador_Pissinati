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
        const gdState = sysData && sysData.gd ? Object.entries(sysData.gd).map(([id, g]) => `${id}:${g.active ? `${g.pg}_${g.qg}` : 0}`).join(',') : '';
        return `${method}-${branchState}-${faultState}-${shuntState}-${gdState}`;
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
// 👇 Assinatura atualizada: remove eventNodes e insere previousNodeData 👇
export function runPowerFlow(branches, faultNodes, method = 'NR', sysData, previousNodeData = null){ 
    if (method !== 'SIMULATION') {
        CacheManager.cache.clear();
    }

    const { Vbase = 13.8, Sbase = 1000, sources = [] } = sysData || {};
    
    if (sources.length === 0) {
        console.warn("Nenhuma fonte definida no sistema!");
        return { nodes: {}, lines: {} };
    }

    const islands = partitionIntoIslands(branches, sources, faultNodes);
    if (method !== 'SIMULATION') {
        console.log(`🧩 Fatoração em Blocos: O sistema foi dividido em ${islands.length} ilha(s) eletricamente independente(s).`);
    }

    const finalNodes = {};
    const finalLines = {};

    sources.forEach(s => {
        finalNodes[s] = { v: 1.0, angle: 0, p: 0, q: 0 };
    });

    islands.forEach((island, index) => {
        const islandSysData = { ...sysData, sources: island.sources };
        
        // 1. Geração de chaves e checagem de Cache
        const sortedBranches = [...island.branches].sort((a, b) => a.id - b.id);
        const islandBranchHash = sortedBranches.map(b => `${b.id}:${b.state}:${b.currentTap||0}`).join(',');
        
        const sortedNodes = Array.from(island.nodes).sort();
        let islandNodeHash = sortedNodes.map(n => {
            let h = `${n}`;
            if (faultNodes.has(n)) h += 'F';
            if (islandSysData.shunts[n]) h += `S${islandSysData.shunts[n].steps}`;
            if (islandSysData.gd && islandSysData.gd[n]) {
                h += `G${islandSysData.gd[n].active ? `${islandSysData.gd[n].pg}_${islandSysData.gd[n].qg}` : 0}`;
            }
            return h;
        }).join(',');
        
        const islandKey = `${method}-${Vbase}-${Sbase}|${islandBranchHash}|${islandNodeHash}`;

        if (CacheManager.islandCache.has(islandKey)) {
            if (method !== 'SIMULATION') console.log(`   ♻️ Ilha ${index + 1}: Recuperada do cache 🚀`);
            const cachedIsland = CacheManager.islandCache.get(islandKey);
            Object.assign(finalNodes, cachedIsland.nodes);
            Object.assign(finalLines, cachedIsland.lines);
            return; 
        }

        // ============================================================================
        // 🌟 INÍCIO DO SUPER-HÍBRIDO: O LOOP PREDITOR-CORRETOR (O "Loop Maior")
        // ============================================================================
        let islandMaxError = 1.0;
        let iter = 0;
        const MAX_ITER = 15;      
        const TOLERANCIA = 1e-4;  
        
        let currentIterNodeData = previousNodeData || {}; 
        let finalExpandedNodes = {};
        let finalExpandedLines = {};

        console.log(`\n🚀 Iniciando Cálculo Híbrido da Ilha ${index + 1}...`);

        // ============================================================================
        // 🛠️ CHAVE DE DEPURAÇÃO: BYPASS DO REDUTOR TOPOLÓGICO
        // true  = Motor Híbrido (Redutor + NR no Núcleo)
        // false = NR Clássico Global (Matriz resolve 100% da rede)
        // ============================================================================
        const ENABLE_REDUCER = true; 

        while (islandMaxError > TOLERANCIA && iter < MAX_ITER) {
            console.log(`   🔄 [Ilha ${index + 1}] Rodando Iteração Global ${iter + 1}...`);

            let reducedBranches, reducedSysData, pruneHistory;

            // FASE 1: REDUÇÃO TOPOLÓGICA (O Pac-Man ou Bypass)
            if (ENABLE_REDUCER) {
                const reduced = reduceSystemTopology(
                    island.branches, faultNodes, islandSysData, currentIterNodeData
                );
                reducedBranches = reduced.reducedBranches;
                reducedSysData = reduced.reducedSysData;
                pruneHistory = reduced.pruneHistory;
            } else {
                // BYPASS ATIVADO: A ilha passa intacta para a matriz
                reducedBranches = island.branches;
                reducedSysData = islandSysData;
                pruneHistory = [];
            }

            // Preparação: Quais nós sobraram para o Núcleo (A Malha)
            const islandNodesSet = new Set(island.sources);
            const adj = {};
            reducedBranches.forEach(b => {
                if (b.state !== 1) return; // 👈 A TRAVA VITAL RESTAURADA AQUI
                
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
            
            let expandedResult;

            // FASE 2: RESOLUÇÃO DO NÚCLEO (Bypass ou Roteador de Motores)
            if (n === 0 || reducedBranches.length === 0) {
                // 🚀 BYPASS RADIAL PURO
                const coreNodes = {};
                island.sources.forEach(s => { coreNodes[s] = { v: 1.0, angle: 0, p: 0, q: 0 }; });
                const simulatedCoreResult = { nodes: coreNodes, lines: {} };
                
                expandedResult = expandSystemResults(simulatedCoreResult, pruneHistory, islandSysData, island.branches);
            
            } else {
                // 🧮 ROTEADOR DE MOTORES (Onde a mágica clean acontece!)
                let coreResult;
                const nodeMap = new Map(nodes.map((id, idx) => [id, idx]));
                
                if (method === 'CESPEDES') {
                    console.warn("Motor de Céspedes ainda não implementado! Fazendo fallback para Newton-Raphson.");
                    coreResult = setupAndSolveNR(nodes, reducedBranches, reducedSysData, currentIterNodeData, Sbase, Vbase, nodeMap, island.sources, method);
                } else {
                    // NR ou GS Clássico
                    coreResult = setupAndSolveNR(nodes, reducedBranches, reducedSysData, currentIterNodeData, Sbase, Vbase, nodeMap, island.sources, method);
                }

                // FASE 3: EXPANSÃO TOPOLÓGICA (A descida)
                expandedResult = expandSystemResults(coreResult, pruneHistory, islandSysData, island.branches);
            }

            // FASE 4: O JUIZ (Avaliador do Erro Global)
            islandMaxError = 0;
            for (let nodeId in expandedResult.nodes) {
                const oldV = currentIterNodeData[nodeId] ? currentIterNodeData[nodeId].v : 1.0;
                const newV = expandedResult.nodes[nodeId].v;
                const diff = Math.abs(newV - oldV);
                if (diff > islandMaxError) islandMaxError = diff;
            }

            console.log(`   ✅ Erro Máximo Global da Iteração ${iter + 1}: ${islandMaxError.toFixed(6)} pu`);

            currentIterNodeData = expandedResult.nodes;
            finalExpandedNodes = expandedResult.nodes;
            finalExpandedLines = expandedResult.lines;
            iter++;
        }

        console.log(`🏆 [Ilha ${index + 1}] Convergência alcançada em ${iter} iterações. (Erro final: ${islandMaxError.toFixed(6)} pu)`);

        const finalResult = { nodes: finalExpandedNodes, lines: finalExpandedLines };
        CacheManager.islandCache.set(islandKey, finalResult);
        
        Object.assign(finalNodes, finalExpandedNodes);
        Object.assign(finalLines, finalExpandedLines);
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

// --- MOTOR MATRICIAL: NEWTON-RAPHSON (VERSÃO COM DIAGNÓSTICO PROFUNDO) ---
function solveNewtonRaphson(n, busType, P_spec, Q_spec, G, B, V, Theta) {
    const maxIter = 20;
    const tolerance = 1e-4;
    
    const pqIndices = [];
    for(let i=0; i<n; i++) if(busType[i] === 0) pqIndices.push(i);
    
    // 👇 INÍCIO DO DIAGNÓSTICO DE ENTRADA 👇
    console.log(`\n======================================================`);
    console.log(`🛑 DIAGNÓSTICO NR: DADOS RECEBIDOS (Tamanho ${n}x${n})`);
    console.log(`======================================================`);
    console.log(`📍 Índices PQ (Malha):`, pqIndices);
    console.log(`🔌 Vetor busType (1=Swing, 0=PQ):`, busType);
    console.log(`⚡ Vetor P_spec:`, P_spec);
    console.log(`⚡ Vetor Q_spec:`, Q_spec);
    
    // O console.table desenha a matriz perfeitamente no Chrome/Edge
    console.log(`🧮 MATRIZ G (Condutância):`);
    console.table(G);
    console.log(`🧮 MATRIZ B (Susceptância):`);
    console.table(B);
    console.log(`======================================================\n`);
    // 👆 FIM DO DIAGNÓSTICO DE ENTRADA 👆

    console.log(`\n[NR MOTOR] 🔍 Iniciando NR. Tamanho da Matriz Nodal: ${n}x${n} | Barras PQ (Malha): ${pqIndices.length}`);
    
    if(pqIndices.length === 0) {
        console.log(`[NR MOTOR] ⚠️ Nenhuma barra PQ identificada. Abortando motor.`);
        return;
    }
    
    const dim = pqIndices.length;

    for (let iter = 0; iter < maxIter; iter++) {
        const dP = [];
        const dQ = [];
        let maxError = 0;
        let maxErrorBus = -1;
        
        const P_calc_arr = [];
        const Q_calc_arr = [];

        for (let r = 0; r < dim; r++) {
            const i = pqIndices[r];
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
            
            // 🚨 Sonda 1: Detecção imediata de corrupção nos deltas
            if (isNaN(diffP) || isNaN(diffQ)) {
                console.error(`[NR MOTOR] 💥 FALHA CRÍTICA na iteração ${iter}: NaN detectado no Delta da barra índice ${i}. V=${V[i]}, Pc=${Pc}, Qc=${Qc}`);
            }

            dP.push(diffP); 
            dQ.push(diffQ);
            
            const currentBusError = Math.max(Math.abs(diffP), Math.abs(diffQ));
            if (currentBusError > maxError) {
                maxError = currentBusError;
                maxErrorBus = i;
            }
        }

        console.log(`   [NR MOTOR] Iteração ${iter}: Max Mismatch = ${maxError.toFixed(6)} pu (Pior Barra: índice ${maxErrorBus})`);

        if (maxError < tolerance) {
            console.log(`   [NR MOTOR] ✅ Convergiu com sucesso na iteração ${iter}!`);
            break;
        }

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

        // 🚨 Sonda 2: Resolução do sistema linear (inversão da Jacobiana)
        const dx = solveLinearSystem(J, [...dP, ...dQ]);
        
        let hasNaN = false;
        let hasExplosion = false;

        for (let r = 0; r < dim; r++) {
            if (isNaN(dx[r]) || isNaN(dx[r + dim])) hasNaN = true;
            if (Math.abs(dx[r]) > 5 || Math.abs(dx[r + dim]) > 5) hasExplosion = true; // Delta V ou Theta absurdo
            
            Theta[pqIndices[r]] += dx[r];
            V[pqIndices[r]] += dx[r + dim];
        }

        if (hasNaN) {
            console.error(`[NR MOTOR] 💥 Jacobiana Singular! solveLinearSystem retornou NaN na iteração ${iter}. A matriz não é inversível.`);
            break;
        }
        if (hasExplosion) {
            console.warn(`[NR MOTOR] ⚠️ Divergência severa! O sistema linear calculou saltos absurdos (dx > 5) na iteração ${iter}.`);
        }
    }
}

// --- WRAPPER DOS MOTORES NODAIS (Monta a YBus para NR e GS) ---
function setupAndSolveNR(nodes, reducedBranches, reducedSysData, currentIterNodeData, Sbase, Vbase, nodeMap, sources, method) {
    const n = nodes.length;
    const Zbase = (Math.pow(Vbase, 2) * 1000) / Sbase;

    const G = Array(n).fill(0).map(() => Array(n).fill(0));
    const B = Array(n).fill(0).map(() => Array(n).fill(0));

    // Monta a matriz YBus
    reducedBranches.forEach(branch => {
        if (branch.state !== 1) return; // 👈 A TRAVA VITAL RESTAURADA AQUI TAMBÉM
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
        
        G[u][v] -= g / a; B[u][v] -= b_line / a;
        G[v][u] -= g / a; B[v][u] -= b_line / a;
        G[u][u] += g / a2; B[u][u] += b_line / a2;
        G[v][v] += g; B[v][v] += b_line;
    });

    // Adiciona Shunts na diagonal
    nodes.forEach((id, i) => {
        if (reducedSysData.shunts[id] && reducedSysData.shunts[id].steps > 0) {
            const b_shunt_pu = (reducedSysData.shunts[id].steps * reducedSysData.shunts[id].stepSize) / Sbase;
            B[i][i] += b_shunt_pu;
        }
        
        // 🚨 SONDA 3: Verifica se alguma barra ficou isolada na matriz
        if (G[i][i] === 0 && B[i][i] === 0) {
            console.error(`🚨 DIAGNÓSTICO: A barra ${id} ficou ISOLADA na YBus (G=0, B=0). Isso causará NaN!`);
        }
    });

    // Inicialização (Warm Start Seguro)
    let V = Array(n).fill(1.0);
    let Theta = Array(n).fill(0.0);
    const P_spec = Array(n).fill(0);
    const Q_spec = Array(n).fill(0);
    const busType = Array(n).fill(0); 

    nodes.forEach((id, i) => {
        // Verifica se a barra é fonte (Swing)
        if (sources.includes(id) || (sources.has && sources.has(id))) {
            busType[i] = 1; 
            V[i] = 1.0; 
            Theta[i] = 0.0;
        } else {
            // 🌟 IMPLEMENTAÇÃO DO WARM START COM ESCUDO DE PROTEÇÃO
            if (currentIterNodeData && currentIterNodeData[id]) {
                const prevV = currentIterNodeData[id].v;
                const prevAngleDeg = currentIterNodeData[id].angle || 0;

                // 🛡️ Proteção 1: Evita tensões nulas/críticas que quebram a Jacobiana (divisão por V)
                V[i] = prevV > 0.5 ? prevV : 1.0;
                
                // 🛡️ Proteção 2: Converte de GRAUS (UI/Output) para RADIANOS (Exigido pelo Motor NR)
                Theta[i] = prevAngleDeg * (Math.PI / 180);
            } else {
                // Fallback para Flat Start caso a barra seja nova ou não mapeada
                V[i] = 1.0;
                Theta[i] = 0.0;
            }
            
            const load = reducedSysData.loads[id]; 
            let pNet = load ? load.p : 0;
            let qNet = load ? load.q : 0;

            if (reducedSysData.gd && reducedSysData.gd[id] && reducedSysData.gd[id].active) {
                pNet -= reducedSysData.gd[id].pg;
                qNet -= reducedSysData.gd[id].qg;
            }

            P_spec[i] = -(pNet / Sbase);
            Q_spec[i] = -(qNet / Sbase);
        }
    });

    // Chama o motor matemático purista!
    if (method === 'GS') {
        solveGaussSeidel(n, busType, P_spec, Q_spec, G, B, V, Theta);
    } else {
        solveNewtonRaphson(n, busType, P_spec, Q_spec, G, B, V, Theta);
    }

    // Retorna o pacote pronto: O núcleo inteiro (nodes) está energizado!
    return buildResult(nodes, V, Theta, Zbase, reducedBranches, nodeMap, new Set(nodes), reducedSysData);
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

// 👇 O CÉREBRO UNIFICADO: Propagação com Dependência Hierárquica 👇
export function analyzeTopology(branches, faultNodes, sysData) {
    const { sources = [], feeders = [] } = sysData || {};
    const nZ = {}; const eZ = {};
    const loopN = new Set(); const loopE = new Set();
    const nodeFeeds = {}; 
    const colorRoots = [...sources, ...feeders]; // A paleta de cores continua precisando de todos

    // 1. A REVOLUÇÃO: O Big Bang começa APENAS nas Subestações
    let queue = [...sources];
    sources.forEach(s => {
        nodeFeeds[s] = new Set([s]);
        nZ[s] = s;
    });

    const adj = {};
    branches.forEach(b => {
        if (b.state === 1 && !faultNodes.has(b.from) && !faultNodes.has(b.to)) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push({ node: b.to, edgeId: b.id });
            adj[b.to].push({ node: b.from, edgeId: b.id });
        }
    });

    // 2. Busca em Largura (BFS) Unificada
    while(queue.length > 0) {
        const curr = queue.shift();
        
        let zonesToPropagate;
        
        // 👇 A MÁGICA DO PEDÁGIO 👇
        // Se a energia alcançou um Alimentador, ele assume a "paternidade" da onda daqui pra frente
        if (feeders.includes(curr)) {
            zonesToPropagate = new Set([curr]);
            nZ[curr] = curr; // O próprio alimentador assume sua cor característica
            nodeFeeds[curr].add(curr); 
        } else {
            zonesToPropagate = nodeFeeds[curr];
        }

        if (adj[curr]) {
            adj[curr].forEach(({ node: neighbor, edgeId }) => {
                if (sources.includes(neighbor)) return; // Nunca invade a Subestação Mãe de volta

                if (!nodeFeeds[neighbor]) {
                    // Energia nova chega na barra
                    nodeFeeds[neighbor] = new Set(zonesToPropagate);
                    nZ[neighbor] = Array.from(zonesToPropagate)[0];
                    eZ[edgeId] = nZ[neighbor];
                    queue.push(neighbor);
                } else {
                    // VÁLVULA DE RETENÇÃO (Efeito Salmão)
                    const neighborHasSource = Array.from(nodeFeeds[neighbor]).some(s => sources.includes(s));
                    const tryingToPropagateFeeder = Array.from(zonesToPropagate).some(f => feeders.includes(f));
                    
                    if (tryingToPropagateFeeder && neighborHasSource) {
                        return; // Barreira topológica acionada!
                    }

                    let isNewConflict = false;
                    zonesToPropagate.forEach(z => {
                        if (!nodeFeeds[neighbor].has(z)) {
                            nodeFeeds[neighbor].add(z);
                            isNewConflict = true;
                        }
                    });
                    if (isNewConflict) queue.push(neighbor);
                }
            });
        }
    }

    // 3. Determinar Nós em Loop
    Object.keys(nodeFeeds).forEach(nStr => {
        const node = Number(nStr);
        const zones = Array.from(nodeFeeds[node]);

        let sourceCount = 0; let feederCount = 0;
        zones.forEach(z => {
            if (sources.includes(z)) sourceCount++;
            if (feeders.includes(z)) feederCount++;
        });

        // Loop Topológico Verdadeiro: 2 fontes principais OU 2 alimentadores.
        if (sourceCount >= 2 || feederCount >= 2) {
            loopN.add(node);
            
            // Retroalimentação: puxa as raízes que causaram o choque para o amarelo também
            zones.forEach(z => loopN.add(z)); 
        }
    });

    // 4. Determinar Arestas em Loop
    branches.forEach(b => {
        if (b.state === 1) {
            if (loopN.has(b.from) && loopN.has(b.to)) {
                loopE.add(b.id);
            } else {
                const zF = Array.from(nodeFeeds[b.from] || []);
                const zT = Array.from(nodeFeeds[b.to] || []);
                
                if (zF.length > 0 && zT.length > 0 && zF[0] !== zT[0]) {
                    const isSourceF = sources.includes(zF[0]);
                    const isSourceT = sources.includes(zT[0]);
                    const isFeederF = feeders.includes(zF[0]);
                    const isFeederT = feeders.includes(zT[0]);

                    if ((isSourceF && isSourceT) || (isFeederF && isFeederT)) {
                        loopE.add(b.id); loopN.add(b.from); loopN.add(b.to);
                    }
                }
            }
        }
    });

    return { nodeFeeds, nodeZones: nZ, edgeZones: eZ, loopNodes: loopN, loopEdges: loopE, colorRoots };
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

                // 👇 A GD ABATE A CARGA EM kW ANTES DE SOMAR NO ALIMENTADOR 👇
                if (sysData.gd && sysData.gd[id] && sysData.gd[id].active) {
                    nodeP -= sysData.gd[id].pg;
                    nodeQ -= sysData.gd[id].qg;
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
// 👇 1. REDUTOR TOPOLÓGICO (Limpo e com Warm Start) 👇
export function reduceSystemTopology(branches, faultNodes, sysData, previousNodeData = null) {
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

    // 🛡️ ESCUDO MINIMALISTA: Apenas as Fontes (Subestações) são protegidas da poda
    const protectedNodes = new Set([...sources]);
    
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

        // 🌡️ WARM START: Resgata a tensão do frame anterior (ou assume 1.0)
        let v_leaf = (previousNodeData && previousNodeData[leafId]) ? previousNodeData[leafId].v : 1.0;
        
        // 🚨 TRAVA DE SEGURANÇA: Se a barra estava "morta" na rodada anterior 
        // (ex: religamento ou falta limpa), V será quase zero. 
        // Forçamos 1.0 para evitar divisão por zero no cálculo das perdas.
        if (v_leaf < 0.2) v_leaf = 1.0; 

        const v_leaf_sq = v_leaf * v_leaf;

        // ⚡ INJEÇÃO EXATA DO SHUNT USANDO V²
        let q_shunt_injected = 0;
        if (shunts[leafId] && shunts[leafId].steps > 0) {
            const b_shunt = (shunts[leafId].steps * shunts[leafId].stepSize) / Sbase; // em pu
            q_shunt_injected = b_shunt * v_leaf_sq * Sbase; // Volta para kVAr para abater da carga
        }
        qLeaf -= q_shunt_injected;

        if (sysData.gd && sysData.gd[leafId] && sysData.gd[leafId].active && !faultNodes.has(leafId)) {
            pLeaf -= sysData.gd[leafId].pg;
            qLeaf -= sysData.gd[leafId].qg;
        }

        const Ppu = pLeaf / Sbase;
        const Qpu = qLeaf / Sbase;
        const Rpu = branch.r / Zbase;
        const Xpu = branch.x / Zbase;
        
        // 📉 PERDAS FÍSICAS REAIS DIVIDIDAS POR V²
        const Ploss_pu = Rpu * ((Ppu * Ppu + Qpu * Qpu) / v_leaf_sq);
        const Qloss_pu = Xpu * ((Ppu * Ppu + Qpu * Qpu) / v_leaf_sq);
        
        const pTotal = pLeaf + (Ploss_pu * Sbase);
        const qTotal = qLeaf + (Qloss_pu * Sbase);

        if (!reducedLoads[parentId]) reducedLoads[parentId] = { p: 0, q: 0 };
        reducedLoads[parentId].p += pTotal;
        reducedLoads[parentId].q += qTotal;

        pruneHistory.push({
            leafId, parentId, branch,
            pFlow: pTotal, qFlow: qTotal
        });

        branchMap.delete(branchId);
        adj[parentId].delete(branchId);
        degree[parentId]--; degree[leafId] = 0;

        if (degree[parentId] === 1 && !protectedNodes.has(parentId)) leavesQueue.push(parentId);
    }

    const reducedBranches = Array.from(branchMap.values());
    const prunedNodeIds = new Set(pruneHistory.map(r => r.leafId));
    const reducedGD = {};
    Object.entries(sysData.gd || {}).forEach(([id, gd]) => {
        if (!prunedNodeIds.has(parseInt(id))) reducedGD[id] = gd;
    });
    const reducedSysData = { ...sysData, loads: reducedLoads, gd: reducedGD };

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

        // Queda de tensão fasorial exata (assumindo ângulo do pai como referência local 0)
        const v_real = parentV - ((Rpu * Ppu + Xpu * Qpu) / parentV);
        const v_imag = -((Xpu * Ppu - Rpu * Qpu) / parentV);

        // 1. Magnitude Exata (Pitágoras da parte real e imaginária)
        const vLeaf = Math.sqrt(v_real * v_real + v_imag * v_imag);
        
        // 2. Defasagem Angular Exata (Arco Tangente)
        const deltaThetaRad = Math.atan2(v_imag, v_real);
        
        // Soma o deslocamento angular (em graus) ao ângulo absoluto do pai
        const leafAngle = parentAngle + (deltaThetaRad * (180 / Math.PI));

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