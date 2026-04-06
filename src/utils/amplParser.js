// src/utils/amplParser.js

export function parseAMPLDat(text) {
    const lines = text.split('\n').map(l => l.trim());
    
    let parsingNodes = false;
    let parsingBranches = false;
    
    let nHeaders = []; // Guardará os títulos das colunas das barras
    let lHeaders = []; // Guardará os títulos das colunas das linhas
    
    const nodes = new Set();
    const loads = {};
    const branches = [];
    let sources = [];
    
    // Novas variáveis globais extraídas do dicionário
    let baseKV = 13.8;
    let sBase = 1000;
    let sefNode = null;
    let qbc = 0;        // Valor base do módulo de capacitor em kVAr
    let bfSet = [];     // Guarda as seções/nós sob falta

    // Novos dicionários de equipamentos
    const shunts = {};  // Bancos de Capacitores (kVAr)
    const dgs = {};     // Geração Distribuída
    const oltcs = {};   // Reguladores de Tensão com Tap (OLTC)
    const sses = {};    // Limite de Potência Aparente das Subestações (kVA)

    // --- PRIMEIRA PASSADA: Coleta as Variáveis Globais e Lê os Cabeçalhos ---
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('#')) line = line.split('#')[0].trim();
        if (!line) continue;

        if (line.startsWith('param Vbase')) {
            const match = line.match(/[\d.]+/);
            if (match) baseKV = parseFloat(match[0]);
        }
        if (line.startsWith('param Sbase')) {
            const match = line.match(/[\d.]+/);
            if (match) sBase = parseFloat(match[0]);
        }
        if (line.startsWith('param SEF :=')) {
            const match = line.match(/\d+/);
            if (match) sefNode = parseInt(match[0]);
        }
        if (line.startsWith('param Qbc')) {
            const match = line.match(/[\d.]+/);
            if (match) qbc = parseFloat(match[0]); // Pega o tamanho do banco (ex: 300)
        }
        if (line.startsWith('set SR :=')) {
            const parts = line.replace('set SR :=', '').replace(';', '').trim().split(/\s+/);
            sources = [...new Set([...sources, ...parts.map(Number).filter(n => !isNaN(n))])];
        }
        if (line.startsWith('set BF :=')) {
            const parts = line.replace('set BF :=', '').replace(';', '').trim().split(/\s+/);
            bfSet = parts.map(Number).filter(n => !isNaN(n));
        }
        
        // LEITURA DINÂMICA DE CABEÇALHOS
        if (line.startsWith('param: N:')) {
            nHeaders = line.replace('param:', '').replace('N:', '').replace(':=', '').trim().split(/\s+/);
        }
        if (line.startsWith('param: L:')) {
            lHeaders = line.replace('param:', '').replace('L:', '').replace(':=', '').trim().split(/\s+/);
        }
    }

    // --- SEGUNDA PASSADA: Leitura das Tabelas Adaptável ---
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('#')) line = line.split('#')[0].trim();
        if (!line) continue;

        if (line.startsWith('param: N:')) { parsingNodes = true; parsingBranches = false; continue; }
        if (line.startsWith('param: L:')) { parsingBranches = true; parsingNodes = false; continue; }
        if (line === ';') { parsingNodes = false; parsingBranches = false; continue; }

        if (parsingNodes) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                const id = parseInt(parts[0]);

                if (!isNaN(id) && id !== sefNode) {
                    const getVal = (col, fallback = 0) => {
                        const idx = nHeaders.indexOf(col);
                        return idx !== -1 ? parseFloat(parts[idx + 1]) : fallback;
                    };

                    const pd = getVal('Pd');
                    const qd = getVal('Qd');

                    // ⚡ EXTRAÇÃO DOS NOVOS EQUIPAMENTOS ⚡
                    
                    // 1. Bancos de Capacitores (Módulos x Valor Base)
                    const nmax = getVal('nmax');
                    if (nmax > 0 && qbc > 0) {
                        shunts[id] = nmax * qbc; // Ex: 2 módulos de 300 = 600 kVAr
                    }

                    // 2. Geração Distribuída
                    const pgd = getVal('Pgdini');
                    const qgd = getVal('Qgdini');
                    const sgd = getVal('Sgd');
                    if (sgd > 0 || pgd > 0 || qgd > 0) {
                        dgs[id] = { p: pgd, q: qgd, s: sgd };
                    }

                    // 2.5 Limite da Subestação (SSE)
                    const sseVal = getVal('SSE');
                    if (sseVal > 0) {
                        sses[id] = sseVal;
                    }

                    // 3. Reguladores de Tensão (Tap)
                    const reg = getVal('reg_oltc');
                    const ntap = getVal('ntap_oltc');
                    if (ntap > 0) {
                        oltcs[id] = { reg, ntap };
                    }

                    // Lógica de Fontes blindada
                    let isSource = false;
                    const typeIdx = nHeaders.indexOf('Type');
                    
                    if (typeIdx !== -1) {
                        if (parseInt(parts[typeIdx + 1]) === 1) isSource = true;
                    } else {
                        // Evita que barras apenas de passagem ou capacitores sejam lidas como Fonte
                        if (pd === 0 && qd === 0 && !shunts[id] && !dgs[id]) isSource = true;
                    }

                    if (isSource) {
                        if (!sources.includes(id)) sources.push(id);
                    } else {
                        loads[id] = { p: pd, q: qd };
                    }
                    nodes.add(id);
                }
            }
        }

        if (parsingBranches) {
            const parts = line.split(/\s+/);
            if (parts.length >= 4) { 
                const from = parseInt(parts[0]);
                const to = parseInt(parts[1]);

                if (!isNaN(from) && !isNaN(to) && from !== sefNode && to !== sefNode) {
                    const getVal = (col, fallback) => {
                        const idx = lHeaders.indexOf(col);
                        if (idx !== -1) {
                            const val = parseFloat(parts[idx + 2]);
                            return isNaN(val) ? fallback : val;
                        }
                        return fallback;
                    };

                    let r = getVal('R', 0.001);
                    let x = getVal('X', 0.001);
                    
                    // TRAVA ANTI-NAN 1
                    if (r === 0 && x === 0) {
                        r = 0.0001;
                        x = 0.0001;
                    }
                    const cap = getVal('Imax', 1000);
                    const state = getVal('State', 1);
                    const sw = getVal('sw', 1) === 1;

                    branches.push({ 
                        from, to, r, x, 
                        capacity: cap, 
                        limit: cap, 
                        Imax: cap, 
                        state: state, 
                        hasSwitch: sw 
                    });
                    nodes.add(from); nodes.add(to);
                }
            }
        }
    }

    if (sources.length === 0 && branches.length > 0) {
        sources = [branches[0].from];
    }

    const positions = {};
    const nodeArray = Array.from(nodes);
    const cols = Math.ceil(Math.sqrt(nodeArray.length));
    nodeArray.forEach((node, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        positions[node] = { x: col * 120, y: row * 120 }; 
    });

    const finalBranches = branches.map((b, idx) => ({ ...b, id: idx }));

    console.log("🛠️ Fontes detectadas:", sources);
    console.log("⚡ Capacitores detectados:", shunts);
    console.log("☀️ Geração Distribuída:", dgs);

    // Agora o JSON devolve tudo mastigado para o sistema!
    return { 
        baseKV, 
        sBase, 
        sefNode, 
        sources, 
        loads, 
        shunts, // <-- NOVO
        dgs,    // <-- NOVO
        oltcs,  // <-- NOVO
        bfSet,  // <-- NOVO
        sses,
        branches: finalBranches, 
        faults: [], 
        layout: { positions, waypoints: {} } 
    };
}