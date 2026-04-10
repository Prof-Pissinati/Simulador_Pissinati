const BFS_LIMIT = 14;

function getEnergizedNodes(branches, faultNodes, sources) {
    const adj = {};
    branches.forEach(b => {
        if (b.state !== 1) return;
        if (!adj[b.from]) adj[b.from] = [];
        if (!adj[b.to])   adj[b.to]   = [];
        adj[b.from].push(b.to);
        adj[b.to].push(b.from);
    });

    const energized = new Set();
    const queue     = [];

    sources.forEach(s => {
        if (!faultNodes.has(s)) { energized.add(s); queue.push(s); }
    });

    while (queue.length > 0) {
        const curr = queue.shift();
        (adj[curr] || []).forEach(nb => {
            if (!faultNodes.has(nb) && !energized.has(nb)) {
                energized.add(nb);
                queue.push(nb);
            }
        });
    }
    return energized;
}

function getProtectedNodes(initialBranches, initialFaults, sources) {
    return getEnergizedNodes(initialBranches, initialFaults, sources);
}

function isStateValid(branches, faults, protectedNodes, sources) {
    const energized = getEnergizedNodes(branches, faults, sources);
    for (const n of protectedNodes) {
        if (!energized.has(n)) return false;
    }
    return true;
}

function calculateDisconnectedP(branches, faults, sources, systemLoads) {
    if (!systemLoads) return 0;
    const energized = getEnergizedNodes(branches, faults, sources);
    let totalP = 0;
    Object.keys(systemLoads).forEach(nodeId => {
        const id = Number(nodeId);
        if (!energized.has(id) && !faults.has(id)) {
            totalP += systemLoads[id].p || 0;
        }
    });
    return totalP;
}

export function applyStepToSnapshot(step, snapshot) {
    // 👇 1. Agora extraímos os shunts do snapshot
    const { branches, faults, shunts = {} } = snapshot;

    // Em todos os retornos, passamos o 'shunts' adiante para ele não se perder na linha do tempo
    if (step.type === 'open') return { branches: branches.map(b => b.id === step.branchId ? { ...b, state: 0 } : b), faults, shunts };
    if (step.type === 'close') return { branches: branches.map(b => b.id === step.branchId ? { ...b, state: 1 } : b), faults, shunts };
    if (step.type === 'tap') return { branches: branches.map(b => b.id === step.branchId ? { ...b, currentTap: step.tapValue } : b), faults, shunts };
    
    if (step.type === 'fault_add') {
        const newFaults = new Set(faults);
        newFaults.add(step.nodeId);
        
        let newBranches = [...branches];
        if (step.openedBranches && step.openedBranches.length > 0) {
            const toOpen = new Set(step.openedBranches);
            newBranches = newBranches.map(b => toOpen.has(b.id) ? { ...b, state: 0 } : b);
        }
        return { branches: newBranches, faults: newFaults, shunts };
    }
    
    if (step.type === 'fault_remove') {
        const newFaults = new Set(faults);
        newFaults.delete(step.nodeId);
        return { branches, faults: newFaults, shunts };
    }

    // 👇 2. O NOVO COMANDO DOS CAPACITORES 👇
    if (step.type === 'shunt_step') {
        const newShunts = JSON.parse(JSON.stringify(shunts)); // Cópia profunda segura
        if (newShunts[step.nodeId]) {
            newShunts[step.nodeId].steps = step.steps;
        }
        return { branches, faults, shunts: newShunts };
    }

    return snapshot;
}

export function buildSnapshots(initialSnapshot, steps, sources, systemLoads) {
    const snapshots = [];
    let current = initialSnapshot;
    let accumulatedENS = 0; 

    current.disconnectedP = calculateDisconnectedP(current.branches, current.faults, sources, systemLoads);
    current.accumulatedENS = accumulatedENS;
    snapshots.push(current);

    for (const step of steps) {
        current = applyStepToSnapshot(step, current);
        current.disconnectedP = calculateDisconnectedP(current.branches, current.faults, sources, systemLoads);
        
        accumulatedENS += current.disconnectedP;
        current.accumulatedENS = accumulatedENS;
        
        snapshots.push(current);
    }
    return snapshots;
}

function describeStep(step, branches) {
    if (step.type === 'open') {
        const b = branches.find(br => br.id === step.branchId);
        return `Abrir chave ${b ? `${b.from}–${b.to}` : `#${step.branchId}`}`;
    }
    if (step.type === 'close') {
        const b = branches.find(br => br.id === step.branchId);
        return `Fechar chave ${b ? `${b.from}–${b.to}` : `#${step.branchId}`}`;
    }
    if (step.type === 'tap') {
        const b = branches.find(br => br.id === step.branchId);
        return `Ajustar TAP ${b ? `${b.from}–${b.to}` : `#${step.branchId}`} → ${step.tapValue > 0 ? '+' : ''}${step.tapValue}`;
    }
    if (step.type === 'fault_add')    return `Falta na barra ${step.nodeId} e Proteção`;
    if (step.type === 'fault_remove') return `Restaurar barra ${step.nodeId}`;
    // 👇 O TEXTO PARA A MANOBRA DO CAPACITOR 👇
    if (step.type === 'shunt_step')   return `Ajustar Capacitor ${step.nodeId} → Estágio ${step.steps}`;
    return 'Passo desconhecido';
}

function generateSequenceBFS(startBranches, targetBranches, faults, protectedNodes, sources) {
    const variableIds = [];
    targetBranches.forEach(tb => {
        const sb = startBranches.find(b => b.id === tb.id);
        if (sb && sb.state !== tb.state) variableIds.push(tb.id);
    });
    if (variableIds.length === 0) return [];

    const targetCode = variableIds.map(id => targetBranches.find(br => br.id === id)?.state || 0).join('');
    const startCode  = variableIds.map(id => startBranches.find(br => br.id === id)?.state || 0).join('');
    if (startCode === targetCode) return [];

    const queue   = [{ branches: startBranches, path: [] }];
    const visited = new Map([[startCode, []]]);

    while (queue.length > 0) {
        const { branches, path } = queue.shift();
        for (const id of variableIds) {
            const branch    = branches.find(b => b.id === id);
            if (!branch) continue;
            const newState  = branch.state === 1 ? 0 : 1;
            const newBranches = branches.map(b => b.id === id ? { ...b, state: newState } : b);

            if (!isStateValid(newBranches, faults, protectedNodes, sources)) continue;

            const code = variableIds.map(vid => newBranches.find(br => br.id === vid)?.state || 0).join('');
            if (visited.has(code)) continue;

            const step = { type: newState === 0 ? 'open' : 'close', branchId: id, fromNode: branch.from, toNode: branch.to, description: '' };
            const newPath = [...path, step];

            if (code === targetCode) return newPath.map(s => ({ ...s, description: describeStep(s, startBranches) }));

            visited.set(code, newPath);
            queue.push({ branches: newBranches, path: newPath });
        }
    }
    return null; 
}

function generateSequenceGreedy(startBranches, targetBranches, faults, protectedNodes, sources) {
    const toClose = []; const toOpen  = [];
    targetBranches.forEach(tb => {
        const sb = startBranches.find(b => b.id === tb.id);
        if (!sb) return;
        if (sb.state === 0 && tb.state === 1) toClose.push({ ...tb });
        if (sb.state === 1 && tb.state === 0) toOpen.push({ ...tb });
    });

    const steps = []; let simState = startBranches.map(b => ({ ...b }));

    for (const tb of toClose) {
        steps.push({ type: 'close', branchId: tb.id, fromNode: tb.from, toNode: tb.to, description: describeStep({ type: 'close', branchId: tb.id }, startBranches) });
        simState = simState.map(b => b.id === tb.id ? { ...b, state: 1 } : b);
    }

    const remaining = [...toOpen];
    let maxPasses = remaining.length * remaining.length + 5; 

    while (remaining.length > 0 && maxPasses-- > 0) {
        let opened = false;
        for (let i = 0; i < remaining.length; i++) {
            const tb = remaining[i];
            const testState = simState.map(b => b.id === tb.id ? { ...b, state: 0 } : b);
            if (isStateValid(testState, faults, protectedNodes, sources)) {
                steps.push({ type: 'open', branchId: tb.id, fromNode: tb.from, toNode: tb.to, description: describeStep({ type: 'open', branchId: tb.id }, startBranches) });
                simState = testState; remaining.splice(i, 1); opened = true; break; 
            }
        }
        if (!opened) {
            const tb = remaining.shift();
            steps.push({ type: 'open', branchId: tb.id, fromNode: tb.from, toNode: tb.to, description: `⚠️ ${describeStep({ type: 'open', branchId: tb.id }, startBranches)} (manobra forçada)` });
            simState = simState.map(b => b.id === tb.id ? { ...b, state: 0 } : b);
        }
    }
    return steps;
}

export function generateSequence(currentBranches, currentFaults, targetBranches, targetFaults, sources, systemLoads, providedSteps = null) {
    const steps = [];

    for (const nodeId of currentFaults) {
        if (!targetFaults.has(nodeId)) {
            steps.push({ type: 'fault_remove', nodeId, description: `Restaurar barra ${nodeId}` });
        }
    }

    for (const nodeId of targetFaults) {
        if (!currentFaults.has(nodeId)) {
            const branchesToOpen = [];
            const visitedNodes = new Set([nodeId]);
            const queue = [nodeId];
            
            while (queue.length > 0) {
                const curr = queue.shift();
                currentBranches.filter(b => b.state === 1 && (b.from === curr || b.to === curr)).forEach(b => {
                    const neighbor = b.from === curr ? b.to : b.from;
                    if (!visitedNodes.has(neighbor)) {
                        if (b.hasSwitch) { 
                            branchesToOpen.push(b.id); 
                        } else if (sources.includes(neighbor)) {
                            // 👇 BARREIRA INTRANSPONÍVEL: Bateu em uma subestação/fonte, para a busca aqui! 👇
                            visitedNodes.add(neighbor);
                        } else { 
                            visitedNodes.add(neighbor); 
                            queue.push(neighbor); 
                        }
                    }
                });
            }
            steps.push({ type: 'fault_add', nodeId, openedBranches: branchesToOpen, description: `Falta na barra ${nodeId} e atuação da Proteção` });
        }
    }

    if (providedSteps && providedSteps.length > 0) {
        const initial = { branches: currentBranches, faults: currentFaults };
        return { steps: providedSteps, snapshots: buildSnapshots(initial, providedSteps, sources, systemLoads), method: 'Gravado Manualmente' };
    }

    const tapSteps = [];
    targetBranches.forEach(tb => {
        const sb = currentBranches.find(b => b.id === tb.id);
        if (sb && tb.isRegulator && sb.currentTap !== tb.currentTap) {
            tapSteps.push({ type: 'tap', branchId: tb.id, tapValue: tb.currentTap, fromNode: tb.from, toNode: tb.to, description: `Ajustar TAP ${tb.from}–${tb.to} → ${tb.currentTap > 0 ? '+' : ''}${tb.currentTap}` });
        }
    });

    let postFaultBranches = currentBranches.map(b => ({...b}));
    const faultsAfterFaultSteps = new Set(currentFaults);

    for (const s of steps) {
        const snap = applyStepToSnapshot(s, { branches: postFaultBranches, faults: faultsAfterFaultSteps });
        postFaultBranches = snap.branches;
        snap.faults.forEach(f => faultsAfterFaultSteps.add(f));
    }

    const protectedNodes = getProtectedNodes(postFaultBranches, faultsAfterFaultSteps, sources);
    const diffCount = targetBranches.filter(tb => { const sb = postFaultBranches.find(b => b.id === tb.id); return sb && sb.state !== tb.state; }).length;

    let switchSteps; let method;
    if (diffCount <= BFS_LIMIT) {
        const bfsResult = generateSequenceBFS(postFaultBranches, targetBranches, faultsAfterFaultSteps, protectedNodes, sources);
        if (bfsResult !== null) { switchSteps = bfsResult; method = `BFS exato (${diffCount} chaves)`; } 
        else { switchSteps = generateSequenceGreedy(postFaultBranches, targetBranches, faultsAfterFaultSteps, protectedNodes, sources); method = `Greedy fallback (${diffCount} chaves)`; }
    } else {
        switchSteps = generateSequenceGreedy(postFaultBranches, targetBranches, faultsAfterFaultSteps, protectedNodes, sources);
        method = `Greedy (${diffCount} chaves)`;
    }

    const allSteps = [...steps, ...switchSteps, ...tapSteps];
    const initial = { branches: currentBranches, faults: currentFaults };
    return { steps: allSteps, snapshots: buildSnapshots(initial, allSteps, sources, systemLoads), method };
}

export function parseSequenceFile(content, currentBranches) {
    const lines = content.split(/\r\n|\n/); const updates = new Map(); const newFaults = new Set(); const providedSteps = [];
    let mode = null;
    const branchByEdge = new Map();
    currentBranches.forEach(b => { branchByEdge.set(`${b.from}-${b.to}`, b); branchByEdge.set(`${b.to}-${b.from}`, b); });

    for (const rawLine of lines) {
        const l = rawLine.trim(); if (!l) continue;
        if (/^set\s+BF\s*:=/.test(l)) { const match = l.match(/set\s+BF\s*:=\s*([\d\s]+);?/); if (match?.[1]) { match[1].trim().split(/\s+/).forEach(f => { const id = parseInt(f); if (!isNaN(id)) newFaults.add(id); }); } continue; }
        if (l.includes('Circuitos Ativos')) { mode = 'active'; continue; }
        if (l.includes('Circuitos Desconectados')) { mode = 'disconnected'; continue; }
        if (/^Sequenciamento/i.test(l)) { mode = 'sequence'; continue; }

        if (mode === 'active' || mode === 'disconnected') {
            if (l.startsWith('i') || l.startsWith('set') || isNaN(parseInt(l[0]))) continue;
            const parts = l.split(/\s+/).filter(p => p !== '');
            if (parts.length >= 2) { const from = parseInt(parts[0]); const to = parseInt(parts[1]); const state = mode === 'active' ? 1 : 0; if (!isNaN(from) && !isNaN(to)) { updates.set(`${from}-${to}`, state); updates.set(`${to}-${from}`, state); } }
            continue;
        }

        if (mode === 'sequence') {
            const parts = l.split(/\s+/).filter(p => p !== ''); if (parts.length < 1) continue;
            const cmd = parts[0].toUpperCase();
            if ((cmd === 'FECHAR' || cmd === 'ABRIR') && parts.length >= 3) {
                const from = parseInt(parts[1]); const to = parseInt(parts[2]); const b = branchByEdge.get(`${from}-${to}`);
                if (b) { providedSteps.push({ type: cmd === 'FECHAR' ? 'close' : 'open', branchId: b.id, fromNode: b.from, toNode: b.to, description: `${cmd === 'FECHAR' ? 'Fechar' : 'Abrir'} chave ${from}–${to}` }); }
                continue;
            }
            if (cmd === 'TAP' && parts.length >= 4) {
                const from = parseInt(parts[1]); const to = parseInt(parts[2]); const value = parseFloat(parts[3]); const b = branchByEdge.get(`${from}-${to}`);
                if (b && !isNaN(value)) { providedSteps.push({ type: 'tap', branchId: b.id, tapValue: value, fromNode: b.from, toNode: b.to, description: `Ajustar TAP ${from}–${to} → ${value > 0 ? '+' : ''}${value}` }); }
                continue;
            }
            // 👇 ADICIONE ESTE BLOCO LOGO ABAIXO DO CÓDIGO DO "TAP" 👇
            if (cmd === 'SHUNT_STEP' && parts.length >= 3) {
                const nodeId = parseInt(parts[1]); 
                const steps = parseInt(parts[2]);
                if (!isNaN(nodeId) && !isNaN(steps)) { 
                    providedSteps.push({ 
                        type: 'shunt_step', 
                        nodeId, 
                        steps, 
                        description: `Ajustar Capacitor ${nodeId} → Estágio ${steps}` 
                    }); 
                }
                continue;
            }
            if (cmd === 'FALTA_RESTAURAR' && parts.length >= 2) { const nodeId = parseInt(parts[1]); if (!isNaN(nodeId)) { providedSteps.push({ type: 'fault_remove', nodeId, description: `Restaurar barra ${nodeId}` }); } continue; }
            if (cmd === 'FALTA_ADICIONAR' && parts.length >= 2) { const nodeId = parseInt(parts[1]); if (!isNaN(nodeId)) { providedSteps.push({ type: 'fault_add', nodeId, description: `Aplicar falta na barra ${nodeId}` }); } continue; }
        }
    }
    return { updates, newFaults, providedSteps: providedSteps.length > 0 ? providedSteps : null };
}