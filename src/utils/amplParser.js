// src/utils/amplParser.js

export function parseAMPLDat(text) {
    const lines = text.split('\n').map(l => l.trim());
    let parsingNodes = false; let parsingBranches = false;
    let nHeaders = []; let lHeaders = [];
    const nodes = new Set(); const loads = {}; const branches = [];
    
    let sources = []; let feeders = [];
    let baseKV = 13.8; let sBase = 1000; let sefNode = null; let qbc = 0; let bfSet = [];
    const shunts = {}; const dgs = {}; const oltcs = {}; const sses = {}; const nodeTypes = {};

    // --- PRIMEIRA PASSADA ---
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('#')) line = line.split('#')[0].trim();
        if (!line) continue;

        if (line.startsWith('param Vbase')) { const m = line.match(/[\d.]+/); if (m) baseKV = parseFloat(m[0]); }
        if (line.startsWith('param Sbase')) { const m = line.match(/[\d.]+/); if (m) sBase = parseFloat(m[0]); }
        if (line.startsWith('param SEF :=')) { const m = line.match(/\d+/); if (m) sefNode = parseInt(m[0]); }
        if (line.startsWith('param Qbc')) { const m = line.match(/[\d.]+/); if (m) qbc = parseFloat(m[0]); }
        if (line.startsWith('set BF :=')) { bfSet = line.replace('set BF :=', '').replace(';', '').trim().split(/\s+/).map(Number).filter(n => !isNaN(n)); }

        if (line.match(/^set\s+S\s*:=/)) {
            const parts = line.replace(/^set\s+S\s*:=/, '').replace(';', '').trim().split(/\s+/);
            sources = [...new Set([...sources, ...parts.map(Number).filter(n => !isNaN(n))])];
        }

        if (line.startsWith('param: N:')) nHeaders = line.replace('param:', '').replace('N:', '').replace(':=', '').trim().split(/\s+/);
        if (line.startsWith('param: L:')) lHeaders = line.replace('param:', '').replace('L:', '').replace(':=', '').trim().split(/\s+/);
    }

    // --- SEGUNDA PASSADA ---
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
                        const idx = nHeaders.indexOf(col); return idx !== -1 ? parseFloat(parts[idx + 1]) : fallback;
                    };

                    const pd = getVal('Pd'); const qd = getVal('Qd');
                    const nmax = getVal('nmax'); if (nmax > 0 && qbc > 0) shunts[id] = nmax * qbc;

                    const pgd = getVal('Pgdini'); const qgd = getVal('Qgdini'); const sgd = getVal('Sgd');
                    if (sgd > 0 || pgd > 0 || qgd > 0) dgs[id] = { p: pgd, q: qgd, s: sgd };

                    const reg = getVal('reg_oltc'); const ntap = getVal('ntap_oltc');
                    if (ntap > 0) oltcs[id] = { reg, ntap };

                    const sseVal = getVal('SSE');
                    if (sseVal > 0) {
                        sses[id] = sseVal;
                        if (!sources.includes(id) && !feeders.includes(id)) feeders.push(id);
                    }

                    if (!sources.includes(id) && !feeders.includes(id)) loads[id] = { p: pd, q: qd };

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
                const from = parseInt(parts[0]); const to = parseInt(parts[1]);
                if (!isNaN(from) && !isNaN(to) && from !== sefNode && to !== sefNode) {
                    
                    const getVal = (col, fallback) => {
                        const idx = lHeaders.indexOf(col);
                        return idx !== -1 ? (isNaN(parseFloat(parts[idx + 2])) ? fallback : parseFloat(parts[idx + 2])) : fallback;
                    };

                    const getValMatch = (subStr, fallback) => {
                        const idx = lHeaders.findIndex(h => h.toLowerCase().includes(subStr.toLowerCase()));
                        return idx !== -1 && !isNaN(parseFloat(parts[idx + 2])) ? parseFloat(parts[idx + 2]) : fallback;
                    };

                    let r = getVal('R', 0.001); 
                    let x = getVal('X', 0.001);
                    if (r === 0 && x === 0) { r = 0.0001; x = 0.0001; }
                    
                    const cap = getVal('Imax', 1000); 
                    const state = getVal('State', 1); 
                    const sw = getVal('sw', 1) === 1;

                    // Busca Dupla de TAP
                    const lineNtap = getValMatch('tap', 0);
                    const lineReg = getValMatch('reg', 0);
                    const nodeOltc = oltcs[from] || oltcs[to]; 

                    const finalNtap = lineNtap > 0 ? lineNtap : (nodeOltc ? nodeOltc.ntap : 0);
                    const finalReg = lineReg > 0 ? lineReg : (nodeOltc ? nodeOltc.reg : 0);

                    branches.push({
                        from, to, r, x, capacity: cap, limit: cap, Imax: cap, state: state, hasSwitch: sw,
                        isRegulator: finalNtap > 0, 
                        maxTaps: finalNtap, 
                        regMax: finalReg, 
                        currentTap: 0
                    });
                    nodes.add(from); nodes.add(to);
                }
            }
        }
    }

    if (sefNode !== null) { sources = sources.filter(id => id !== sefNode); feeders = feeders.filter(id => id !== sefNode); }
    if (sources.length === 0 && branches.length > 0) sources = [branches[0].from];

    const positions = {}; const nodeArray = Array.from(nodes); const cols = Math.ceil(Math.sqrt(nodeArray.length));
    nodeArray.forEach((node, index) => {
        const row = Math.floor(index / cols); const col = index % cols;
        positions[node] = { x: col * 120, y: row * 120 };
    });

    return {
        baseKV, sBase, sefNode, sources, feeders, nodeTypes, loads, shunts, dgs, oltcs, bfSet, sses,
        branches: branches.map((b, idx) => ({ ...b, id: idx })),
        faults: [], layout: { positions, waypoints: {} }
    };
}