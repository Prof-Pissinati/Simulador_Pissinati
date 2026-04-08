import { solveLinearSystem } from './mathSolver';

// --- GERENCIADOR DE CACHE ---
export const CacheManager = {
    cache: new Map(),
    getKey: (branches, faultNodes, method) => {
        const branchState = branches.map(b => `${b.id}:${b.state}:${b.currentTap || 0}`).join('|');
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
export function runPowerFlow(branches, faultNodes, method = 'NR', sysData){
    CacheManager.cache.clear();

    const { sources = [], loads = {}, Vbase = 13.8, Sbase = 1000, shunts = {} } = sysData || {};

    if (sources.length === 0) {
        console.warn("Nenhuma fonte definida no sistema!");
        return buildResult([], [], [], 1, branches, new Map(), new Set(), sysData);
    }

    const energizedNodes = new Set();
    const adj = {};
    
    branches.forEach(b => {
        if (b.state === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });

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

    const nodes = Array.from(energizedNodes).sort((a,b) => a-b);
    const n = nodes.length;
    
    if (n === 0) return buildResult([], [], [], 1, branches, new Map(), new Set(), sysData);

    const nodeMap = new Map(nodes.map((id, index) => [id, index]));
    const Zbase = (Math.pow(Vbase, 2) * 1000) / Sbase;

    const G = Array(n).fill(0).map(() => Array(n).fill(0));
    const B = Array(n).fill(0).map(() => Array(n).fill(0));

    branches.forEach(branch => {
        if (branch.state !== 1) return;
        if (!nodeMap.has(branch.from) || !nodeMap.has(branch.to)) return;
        
        const u = nodeMap.get(branch.from);
        const v = nodeMap.get(branch.to);
        
        const r_pu = branch.r / Zbase;
        const x_pu = branch.x / Zbase;
        const mag2 = r_pu**2 + x_pu**2;
        
        if (mag2 < 1e-20) return; 

        const g = r_pu / mag2;
        const b_line = -x_pu / mag2; 
        
        // CÁLCULO DO TAP (Relação de Transformação 'a')
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

    // INJEÇÃO DOS BANCOS DE CAPACITORES (SHUNTS)
    nodes.forEach((id, i) => {
        if (shunts[id]) {
            const b_shunt_pu = shunts[id] / Sbase;
            B[i][i] += b_shunt_pu;
        }
    });

    let V = Array(n).fill(1.0);
    let Theta = Array(n).fill(0.0);
    const P_spec = Array(n).fill(0);
    const Q_spec = Array(n).fill(0);
    const busType = Array(n).fill(0); 

    nodes.forEach((id, i) => {
        if (sources.includes(id)) {
            busType[i] = 1; 
            V[i] = 1.0; 
            Theta[i] = 0.0;
        } else {
            const load = loads[id]; 
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

    return buildResult(nodes, V, Theta, Zbase, branches, nodeMap, energizedNodes, sysData);
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
        if (b.state === 0 || !energizedNodes.has(b.from) || !energizedNodes.has(b.to)) {
             lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0 };
             return;
        }
        
        const u = nodeMap.get(b.from);
        const v = nodeMap.get(b.to);
        
        if (u === undefined || v === undefined) {
             lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0 };
             return;
        }

        const r_pu = b.r / Zbase;
        const x_pu = b.x / Zbase;
        const mag2 = r_pu**2 + x_pu**2;
        if(mag2 < 1e-20) { lineResults[b.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0 }; return; }

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
        const limitCurrent = b.Imax || b.imax || b.capacity || b.limit || 1000;
        
        lineResults[b.id] = {
            current: i_real,
            percentage: (i_real / limitCurrent) * 100,
            pFlow: p_pu * Sbase,
            qFlow: q_pu * Sbase
        };
    });
    return { nodes: nodeResults, lines: lineResults };
}

export function propagateFeeds(branches, faultNodes, sysData) {
    const { sources = [] } = sysData || {}; 
    const nodes = new Set();
    
    sources.forEach(s => nodes.add(s)); 
    branches.forEach(b => { nodes.add(b.from); nodes.add(b.to); });
    
    const nodeFeeds = {};
    Array.from(nodes).forEach(n => nodeFeeds[n] = new Set());
    
    sources.forEach(s => { 
        if (!faultNodes.has(s) && nodeFeeds[s]) nodeFeeds[s].add(s); 
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
                
                if (!nodeFeeds[u] || !nodeFeeds[v]) return; 

                const before = nodeFeeds[v].size;
                nodeFeeds[u].forEach(s => nodeFeeds[v].add(s));
                if(nodeFeeds[v].size > before) changed = true;
            });
        });
    }
    return nodeFeeds;
}

export function calculateLoads(nodeFeeds, faultNodes, sysData) {
    const subs = {};
    const { sources = [], loads = {} } = sysData || {};
    
    sources.forEach(s => {
        subs[s] = {p:0, q:0, nodes:0};
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if(!sources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            if(feeds && feeds.size >= 1) {
                const s = Array.from(feeds)[0];
                const l = loads[id]; 
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