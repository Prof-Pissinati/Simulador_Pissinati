import { SYSTEM_DATA } from '../data/systemData';
import { solveLinearSystem } from './mathSolver';

// --- GERENCIADOR DE CACHE ---
// Evita recalcular se nada mudou na topologia
export const CacheManager = {
    cache: new Map(),
    getKey: (branches, faultNodes, method) => {
        const branchState = branches.map(b => `${b.id}:${b.state}`).join('|');
        const faultState = Array.from(faultNodes).sort().join(',');
        return `${method}-${branchState}-${faultState}`;
    },
    get: function(branches, faultNodes, method) {
        return this.cache.get(this.getKey(branches, faultNodes, method));
    },
    set: function(branches, faultNodes, method, result) {
        const key = this.getKey(branches, faultNodes, method);
        if (this.cache.size > 20) this.cache.clear();
        this.cache.set(key, result);
    }
};

// --- FUNÇÃO PRINCIPAL DE FLUXO DE POTÊNCIA ---
export function runPowerFlow(branches, faultNodes, method = 'NR') {
    // 1. OBTER FONTES (Dinamicamente do arquivo de dados)
    const sources = SYSTEM_DATA.sources || [];
    
    // Se não houver fontes definidas no systemData, não há energia.
    if (sources.length === 0) {
        console.warn("Nenhuma fonte definida em SYSTEM_DATA.sources!");
        return buildResult([], [], [], 1, branches, new Map(), new Set());
    }

    // 2. FILTRO DE CONECTIVIDADE (BFS)
    // Descobre quais nós estão realmente conectados a uma fonte ativa.
    const energizedNodes = new Set();
    const adj = {};
    
    // Monta o grafo apenas com ramos FECHADOS (state === 1)
    branches.forEach(b => {
        if (b.state === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });

    // Busca em Largura a partir das fontes
    const queue = [];
    sources.forEach(s => {
        if (!faultNodes.has(s)) {
            energizedNodes.add(s);
            queue.push(s);
        }
    });

    let head = 0;
    while(head < queue.length){
        const u = queue[head++];
        if(adj[u]){
            adj[u].forEach(v => {
                if(!energizedNodes.has(v) && !faultNodes.has(v)){
                    energizedNodes.add(v);
                    queue.push(v);
                }
            });
        }
    }

    // 3. PREPARAÇÃO DO SISTEMA LINEAR (Matriz Ybus)
    // Apenas nós energizados entram no cálculo para evitar matrizes singulares.
    const nodes = Array.from(energizedNodes).sort((a,b) => a-b);
    const n = nodes.length;
    
    // Se nada estiver energizado, retorna zerado
    if (n === 0) return buildResult([], [], [], 1, branches, new Map(), new Set());

    const nodeMap = new Map(nodes.map((id, index) => [id, index]));
    const Zbase = (Math.pow(SYSTEM_DATA.Vbase, 2) * 1000) / SYSTEM_DATA.Sbase;

    const G = Array(n).fill(0).map(() => Array(n).fill(0));
    const B = Array(n).fill(0).map(() => Array(n).fill(0));

    branches.forEach(branch => {
        if (branch.state !== 1) return;
        if (!nodeMap.has(branch.from) || !nodeMap.has(branch.to)) return;
        
        const u = nodeMap.get(branch.from);
        const v = nodeMap.get(branch.to);
        
        // Conversão para PU
        const r_pu = branch.r / Zbase;
        const x_pu = branch.x / Zbase;
        const mag2 = r_pu**2 + x_pu**2;
        
        if (mag2 < 1e-9) return; 

        const g = r_pu / mag2;
        const b = -x_pu / mag2; 
        
        G[u][v] -= g; G[v][u] -= g;
        B[u][v] -= b; B[v][u] -= b;
        G[u][u] += g; G[v][v] += g;
        B[u][u] += b; B[v][v] += b;
    });

    // 4. INICIALIZAÇÃO (Flat Start)
    let V = Array(n).fill(1.0);
    let Theta = Array(n).fill(0.0);
    const P_spec = Array(n).fill(0);
    const Q_spec = Array(n).fill(0);
    const busType = Array(n).fill(0); // 0=PQ, 1=Slack

    nodes.forEach((id, i) => {
        if (sources.includes(id)) {
            busType[i] = 1; // Slack/Fonte
            V[i] = 1.0; 
            Theta[i] = 0.0;
        } else {
            const load = SYSTEM_DATA.loads[id];
            if (load) {
                P_spec[i] = -(load.p / SYSTEM_DATA.Sbase);
                Q_spec[i] = -(load.q / SYSTEM_DATA.Sbase);
            }
        }
    });

    // 5. EXECUÇÃO DO MÉTODO NUMÉRICO
    if (method === 'GS') {
        solveGaussSeidel(n, busType, P_spec, Q_spec, G, B, V, Theta);
    } else {
        solveNewtonRaphson(n, busType, P_spec, Q_spec, G, B, V, Theta);
    }

    return buildResult(nodes, V, Theta, Zbase, branches, nodeMap, energizedNodes);
}

// --- SOLVER GAUSS-SEIDEL (Versão Completa) ---
function solveGaussSeidel(n, busType, P_spec, Q_spec, G, B, V, Theta) {
    const maxIter = 1000;
    const tolerance = 1e-4;
    let e = Array(n).fill(1.0);
    let f = Array(n).fill(0.0);

    // Inicializa e/f baseado no V/Theta inicial
    for(let i=0; i<n; i++) {
        e[i] = V[i] * Math.cos(Theta[i]);
        f[i] = V[i] * Math.sin(Theta[i]);
    }

    for(let iter=0; iter<maxIter; iter++) {
        let maxError = 0;
        for(let i=0; i<n; i++) {
            if(busType[i] === 1) continue; // Pula Slack

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

            // Fator de Aceleração (1.1)
            const e_acc = e[i] + 1.1 * (e_new - e[i]);
            const f_acc = f[i] + 1.1 * (f_new - f[i]);

            const diff = Math.sqrt((e_acc-e[i])**2 + (f_acc-f[i])**2);
            if(diff > maxError) maxError = diff;

            e[i] = e_acc;
            f[i] = f_acc;
        }
        if(maxError < tolerance) break;
    }
    
    // Converte retangular para polar
    for(let i=0; i<n; i++) {
        V[i] = Math.sqrt(e[i]**2 + f[i]**2);
        Theta[i] = Math.atan2(f[i], e[i]);
    }
}

// --- SOLVER NEWTON-RAPHSON (Versão Completa) ---
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

        // 1. Calcula Mismatches (Erros de Potência)
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

        // 2. Monta Matriz Jacobiana
        const J = Array(2 * dim).fill(0).map(() => Array(2 * dim).fill(0));

        for (let r = 0; r < dim; r++) {
            const i = pqIndices[r];
            
            for (let c = 0; c < dim; c++) {
                const j = pqIndices[c];
                let H, N, M, L;

                if (i !== j) { // Fora da diagonal
                    const angle = Theta[i] - Theta[j];
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    
                    H = V[i] * V[j] * (G[i][j] * sin - B[i][j] * cos);
                    N = V[i] * (G[i][j] * cos + B[i][j] * sin);
                    M = -V[i] * V[j] * (G[i][j] * cos + B[i][j] * sin);
                    L = V[i] * (G[i][j] * sin - B[i][j] * cos);
                } else { // Diagonal
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

        // 3. Resolve Sistema Linear (Jacobiana * dx = Mismatch)
        const dx = solveLinearSystem(J, [...dP, ...dQ]);

        // 4. Atualiza V e Theta
        for (let r = 0; r < dim; r++) {
            Theta[pqIndices[r]] += dx[r];
            V[pqIndices[r]] += dx[r + dim];
        }
    }
}

// --- CONSTRUTOR DE RESULTADOS ---
function buildResult(nodes, V, Theta, Zbase, branches, nodeMap, energizedNodes) {
    const nodeResults = {};
    const lineResults = {};

    nodes.forEach((id, i) => {
        nodeResults[id] = { v: V[i], angle: Theta[i] * (180 / Math.PI) };
    });

    branches.forEach(b => {
        // Se a linha estiver aberta OU um dos nós não estiver energizado
        if (b.state === 0 || !energizedNodes.has(b.from) || !energizedNodes.has(b.to)) {
             lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0 };
             return;
        }
        
        const u = nodeMap.get(b.from);
        const v = nodeMap.get(b.to);
        
        if (u === undefined || v === undefined) {
             lineResults[b.id] = { current: 0, percentage: 0 };
             return;
        }

        const r_pu = b.r / Zbase;
        const x_pu = b.x / Zbase;
        const mag2 = r_pu**2 + x_pu**2;
        if(mag2 < 1e-9) { lineResults[b.id] = { current: 0, percentage: 0 }; return; }

        const g = r_pu / mag2; 
        const bb = -x_pu / mag2;

        const ang = Theta[u] - Theta[v];
        const p_pu = (V[u]**2 * g) - (V[u] * V[v] * (g * Math.cos(ang) + bb * Math.sin(ang)));
        const q_pu = -(V[u]**2 * bb) - (V[u] * V[v] * (g * Math.sin(ang) - bb * Math.cos(ang)));
        
        const i_real = (Math.sqrt(p_pu**2 + q_pu**2) / V[u]) * (SYSTEM_DATA.Sbase / (Math.sqrt(3) * SYSTEM_DATA.Vbase));
        
        lineResults[b.id] = {
            current: i_real,
            percentage: (i_real / b.imax) * 100,
            pFlow: p_pu * SYSTEM_DATA.Sbase,
            qFlow: q_pu * SYSTEM_DATA.Sbase
        };
    });
    return { nodes: nodeResults, lines: lineResults };
}

// --- FUNÇÕES DE PROPAGAÇÃO VISUAL ---
export function propagateFeeds(branches, faultNodes) {
    // Usa SYSTEM_DATA.sources
    const sources = SYSTEM_DATA.sources || []; 
    const nodes = new Set();
    branches.forEach(b => { nodes.add(b.from); nodes.add(b.to); });
    
    const nodeFeeds = {};
    Array.from(nodes).forEach(n => nodeFeeds[n] = new Set());
    
    sources.forEach(s => { 
        if (!faultNodes.has(s)) nodeFeeds[s].add(s); 
    });
    
    const adj = {};
    branches.forEach(b => {
        if (b.state === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });
    
    let changed = true;
    for(let i=0; i<100 && changed; i++) {
        changed = false;
        Object.keys(adj).forEach(u => {
            const uInt = parseInt(u);
            if(faultNodes.has(uInt)) return;
            adj[u].forEach(v => {
                if(faultNodes.has(v)) return;
                const before = nodeFeeds[v].size;
                nodeFeeds[u].forEach(s => nodeFeeds[v].add(s));
                if(nodeFeeds[v].size > before) changed = true;
            });
        });
    }
    return nodeFeeds;
}

export function calculateLoads(nodeFeeds, faultNodes) {
    const subs = {};
    const sources = SYSTEM_DATA.sources || [];
    
    sources.forEach(s => {
        subs[s] = {p:0, q:0, nodes:0};
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if(!sources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            if(feeds.size >= 1) {
                const s = Array.from(feeds)[0];
                const l = SYSTEM_DATA.loads[id];
                if(l && subs[s]) {
                    subs[s].p += l.p;
                    subs[s].q += l.q;
                    subs[s].nodes++;
                }
            }
        }
    });
    return subs;
}