// src/utils/amplParser.js

export function parseAMPLDat(text) {
    const lines = text.split('\n').map(l => l.trim());
    
    let parsingNodes = false;
    let parsingBranches = false;
    
    let nHeaders = []; 
    let lHeaders = []; 
    
    const nodes = new Set();
    const loads = {};
    const branches = [];
    
    // Nossas Listas de Hierarquia
    let sources = [];
    let feeders = []; // 👈 NOVA LISTA
    
    let baseKV = 13.8;
    let sBase = 1000;
    let sefNode = null;
    let qbc = 0;        
    let bfSet = [];     

    const shunts = {};  
    const dgs = {};     
    const oltcs = {};   
    const sses = {};    
    const nodeTypes = {}; // 👈 NOVO DICIONÁRIO DE TIPOS UNIVERSAL

    // --- PRIMEIRA PASSADA: Coleta as Variáveis Globais ---
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
            if (match) qbc = parseFloat(match[0]); 
        }
        if (line.startsWith('set BF :=')) {
            const parts = line.replace('set BF :=', '').replace(';', '').trim().split(/\s+/);
            bfSet = parts.map(Number).filter(n => !isNaN(n));
        }
        
        // 👇 O PARSER LÊ A FONTE PRINCIPAL DIRETO DO ARQUIVO 👇
        if (line.match(/^set\s+S\s*:=/)) {
            const parts = line.replace(/^set\s+S\s*:=/, '').replace(';', '').trim().split(/\s+/);
            const sSet = parts.map(Number).filter(n => !isNaN(n));
            sources = [...new Set([...sources, ...sSet])];
        }
        
        if (line.startsWith('param: N:')) nHeaders = line.replace('param:', '').replace('N:', '').replace(':=', '').trim().split(/\s+/);
        if (line.startsWith('param: L:')) lHeaders = line.replace('param:', '').replace('L:', '').replace(':=', '').trim().split(/\s+/);
    }

    // --- SEGUNDA PASSADA: Leitura das Tabelas ---
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

                    const nmax = getVal('nmax');
                    if (nmax > 0 && qbc > 0) shunts[id] = nmax * qbc; 

                    const pgd = getVal('Pgdini');
                    const qgd = getVal('Qgdini');
                    const sgd = getVal('Sgd');
                    if (sgd > 0 || pgd > 0 || qgd > 0) dgs[id] = { p: pgd, q: qgd, s: sgd };

                    const reg = getVal('reg_oltc');
                    const ntap = getVal('ntap_oltc');
                    if (ntap > 0) oltcs[id] = { reg, ntap };

                    // 👇 CLASSIFICAÇÃO HIERÁRQUICA 👇
                    const sseVal = getVal('SSE');
                    if (sseVal > 0) {
                        sses[id] = sseVal;
                        // Se tem limite SSE mas NÃO está na lista de Fontes do arquivo, é Alimentador!
                        if (!sources.includes(id)) {
                            if (!feeders.includes(id)) feeders.push(id);
                        }
                    }

                    if (!sources.includes(id) && !feeders.includes(id)) {
                        loads[id] = { p: pd, q: qd };
                    }
                    
                    // 👇 CRIANDO O DICIONÁRIO DE TIPOS PARA O FUTURO 👇
                    if (sources.includes(id)) nodeTypes[id] = 'slack';
                    else if (feeders.includes(id)) nodeTypes[id] = 'feeder';
                    else if (shunts[id]) nodeTypes[id] = 'shunt';
                    else if (dgs[id]) nodeTypes[id] = 'gd';
                    else if (pd === 0 && qd === 0) nodeTypes[id] = 'pass-through';
                    else nodeTypes[id] = 'load';

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
                    if (r === 0 && x === 0) { r = 0.0001; x = 0.0001; }
                    
                    const cap = getVal('Imax', 1000);
                    const state = getVal('State', 1);
                    const sw = getVal('sw', 1) === 1;
                    const ntap = getVal('ntap', 0);
                    const reg = getVal('reg', 0);

                    branches.push({ 
                        from, to, r, x, 
                        capacity: cap, limit: cap, Imax: cap, state: state, hasSwitch: sw,
                        isRegulator: ntap > 0, maxTaps: ntap, regMax: reg, currentTap: 0 
                    });
                    nodes.add(from); nodes.add(to);
                }
            }
        }
    }

    // Limpeza de Fictícias (Garante que a SEF 200 não suje a lista)
    if (sefNode !== null) {
        sources = sources.filter(id => id !== sefNode);
        feeders = feeders.filter(id => id !== sefNode);
    }

    if (sources.length === 0 && branches.length > 0) sources = [branches[0].from];

    const positions = {};
    const nodeArray = Array.from(nodes);
    const cols = Math.ceil(Math.sqrt(nodeArray.length));
    nodeArray.forEach((node, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        positions[node] = { x: col * 120, y: row * 120 }; 
    });

    const finalBranches = branches.map((b, idx) => ({ ...b, id: idx }));

    console.log("🛠️ Fontes (Slack):", sources);
    console.log("⚡ Alimentadores:", feeders);
    console.log("📊 Tipos de Nós:", nodeTypes);

    return { 
        baseKV, sBase, sefNode, 
        sources, 
        feeders,     // 👈 Entregando mastigado para o App.jsx
        nodeTypes,   // 👈 Entregando mastigado para o futuro
        loads, shunts, dgs, oltcs, bfSet, sses,
        branches: finalBranches, faults: [], layout: { positions, waypoints: {} } 
    };
}