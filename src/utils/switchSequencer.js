// Configuração de tempos de manobra (Unidade: Minutos)
// Você pode alterar esses valores para realizar análises de sensibilidade no doutorado.
const MANEUVER_TIMES = {
    SWITCH_OPEN: 1.0,      // Tempo para abrir uma chave (manual ou remota)
    SWITCH_CLOSE: 1.0,     // Tempo para fechar uma chave
    CHANGE_TAP: 0.5,       // Tempo para cada degrau de alteração de TAP
    SHUNT_STEP: 0.5,       // Tempo para alteração de estágio de banco de capacitores
    FAULT_PROTECTION: 0.01, // Atuação da proteção (quase instantânea)
    FAULT_RESTORE: 2.0      // Tempo para restauração física de uma barra
};

const BFS_LIMIT = 14;

// --- FUNÇÕES DE CÁLCULO ELÉTRICO ---

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

// --- LÓGICA DE SNAPSHOTS E TEMPO ---

export function applyStepToSnapshot(step, snapshot) {
    const { branches, faults, shunts = {} } = snapshot;

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

    if (step.type === 'shunt_step') {
        const newShunts = JSON.parse(JSON.stringify(shunts));
        if (newShunts[step.nodeId]) {
            newShunts[step.nodeId].steps = step.steps;
        }
        return { branches, faults, shunts: newShunts };
    }

    return snapshot;
}

/**
 * Constrói a linha do tempo de snapshots acumulando o tempo de manobra e a ENS (FO).
 */
export function buildSnapshots(initialSnapshot, steps, sources, systemLoads) {
    const snapshots = [];
    let current = { ...initialSnapshot };
    let accumulatedENS = 0; 
    let totalElapsedMinutes = 0;

    // Snapshot inicial (T=0)
    current.disconnectedP = calculateDisconnectedP(current.branches, current.faults, sources, systemLoads);
    current.accumulatedENS = 0;
    current.elapsedTime = 0;
    current.stepDescription = "Estado Inicial";
    snapshots.push(current);

    for (const step of steps) {
        // 1. Identifica o tempo que este passo consome
        let maneuverTime = 0;
        switch (step.type) {
            case 'open': maneuverTime = MANEUVER_TIMES.SWITCH_OPEN; break;
            case 'close': maneuverTime = MANEUVER_TIMES.SWITCH_CLOSE; break;
            case 'tap': maneuverTime = MANEUVER_TIMES.CHANGE_TAP; break;
            case 'shunt_step': maneuverTime = MANEUVER_TIMES.SHUNT_STEP; break;
            case 'fault_add': maneuverTime = MANEUVER_TIMES.FAULT_PROTECTION; break;
            case 'fault_remove': maneuverTime = MANEUVER_TIMES.FAULT_RESTORE; break;
            default: maneuverTime = 0;
        }

        // 2. Aplica a manobra
        const nextState = applyStepToSnapshot(step, current);
        
        // 3. Calcula a carga desligada NOVO estado
        const pLoss = calculateDisconnectedP(nextState.branches, nextState.faults, sources, systemLoads);
        
        // 4. Acumula os valores
        totalElapsedMinutes += maneuverTime;
        // ENS = P_desenergizada * tempo_em_que_ficou_desligada
        accumulatedENS += (pLoss * maneuverTime);

        // 5. Atualiza o objeto para o próximo passo
        current = {
            ...nextState,
            disconnectedP: pLoss,
            accumulatedENS: accumulatedENS,
            elapsedTime: totalElapsedMinutes,
            stepDescription: step.description
        };
        
        snapshots.push({...current});
    }
    return snapshots;
}

// --- GERAÇÃO DE SEQUÊNCIA (BFS / GREEDY) ---

function isStateValid(branches, faults, protectedNodes, sources) {
    const energized = getEnergizedNodes(branches, faults, sources);
    for (const n of protectedNodes) {
        if (!energized.has(n)) return false;
    }
    return true;
}

export function generateSequence(currentBranches, currentFaults, targetBranches, targetFaults, sources, systemLoads, providedSteps = null) {
    const steps = [];

    // Lógica de remoção de faltas
    for (const nodeId of currentFaults) {
        if (!targetFaults.has(nodeId)) {
            steps.push({ type: 'fault_remove', nodeId, description: `Restaurar barra ${nodeId}` });
        }
    }

    // Lógica de Proteção Automática (Adição de faltas)
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

    // Se houver passos manuais importados, processa-os com a nova lógica de tempo
    if (providedSteps && providedSteps.length > 0) {
        const initial = { branches: currentBranches, faults: currentFaults };
        return { 
            steps: providedSteps, 
            snapshots: buildSnapshots(initial, providedSteps, sources, systemLoads), 
            method: 'Sequência Importada/Manual' 
        };
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
    const lines = content.split(/\r\n|\n/);
    const updates = new Map();
    const newFaults = new Set();
    const providedSteps = [];
    let mode = null;

    // Mapa auxiliar para encontrar chaves pelos nós (i-j)
    const branchByEdge = new Map();
    currentBranches.forEach(b => {
        branchByEdge.set(`${b.from}-${b.to}`, b);
        branchByEdge.set(`${b.to}-${b.from}`, b);
    });

    for (const rawLine of lines) {
        const l = rawLine.trim();
        if (!l) continue;

        // Identificação de Modos
        if (l.includes('Circuitos Ativos')) { mode = 'active'; continue; }
        if (l.includes('Circuitos Desconectados')) { mode = 'disconnected'; continue; }
        if (/^Sequenciamento/i.test(l)) { mode = 'sequence'; continue; }

        // Processamento de Faltas do Cabeçalho (AMPL)
        if (/^set\s+BF\s*:=/.test(l)) {
            const match = l.match(/set\s+BF\s*:=\s*([\d\s]+);?/);
            if (match?.[1]) {
                match[1].trim().split(/\s+/).forEach(f => {
                    const id = parseInt(f);
                    if (!isNaN(id)) newFaults.add(id);
                });
            }
            continue;
        }

        // Modo de Sequenciamento de Comandos
        if (mode === 'sequence') {
            const parts = l.split(/\s+/).filter(p => p !== '');
            if (parts.length < 1) continue;
            const cmd = parts[0].toUpperCase();

            // Comandos de Chaveamento e TAP
            if ((cmd === 'FECHAR' || cmd === 'ABRIR') && parts.length >= 3) {
                const from = parseInt(parts[1]);
                const to = parseInt(parts[2]);
                const b = branchByEdge.get(`${from}-${to}`);
                if (b) {
                    providedSteps.push({
                        type: cmd === 'FECHAR' ? 'close' : 'open',
                        branchId: b.id,
                        fromNode: b.from,
                        toNode: b.to,
                        description: `${cmd === 'FECHAR' ? 'Fechar' : 'Abrir'} chave ${from}–${to}`
                    });
                }
                continue;
            }

            // Comandos de Proteção e Faltas (COM INTELIGÊNCIA)
            if (cmd === 'FALTA_ADICIONAR' && parts.length >= 2) {
                const nodeId = parseInt(parts[1]);
                if (!isNaN(nodeId)) {
                    // --- LÓGICA DE PROTEÇÃO EMBUTIDA NO PARSE ---
                    const branchesToOpen = [];
                    const visitedNodes = new Set([nodeId]);
                    const queue = [nodeId];
                    
                    while (queue.length > 0) {
                        const curr = queue.shift();
                        // Busca ramos energizados que tocam o setor da falta
                        currentBranches.filter(b => b.state === 1 && (b.from === curr || b.to === curr)).forEach(b => {
                            const neighbor = b.from === curr ? b.to : b.from;
                            if (!visitedNodes.has(neighbor)) {
                                if (b.hasSwitch) { 
                                    branchesToOpen.push(b.id); // Identifica a chave de proteção
                                } else { 
                                    visitedNodes.add(neighbor); 
                                    queue.push(neighbor); 
                                }
                            }
                        });
                    }

                    providedSteps.push({ 
                        type: 'fault_add', 
                        nodeId, 
                        openedBranches: branchesToOpen, // Agora o passo já carrega as chaves
                        description: `Falta na barra ${nodeId} e atuação da Proteção` 
                    });
                }
                continue;
            }

            if (cmd === 'FALTA_RESTAURAR' && parts.length >= 2) {
                const nodeId = parseInt(parts[1]);
                if (!isNaN(nodeId)) {
                    providedSteps.push({ type: 'fault_remove', nodeId, description: `Restaurar barra ${nodeId}` });
                }
                continue;
            }

            // Comandos de Shunt e Tap (mantidos)
            if (cmd === 'SHUNT_STEP' && parts.length >= 3) {
                const nodeId = parseInt(parts[1]);
                const steps = parseInt(parts[2]);
                if (!isNaN(nodeId) && !isNaN(steps)) {
                    providedSteps.push({ type: 'shunt_step', nodeId, steps, description: `Ajustar Capacitor ${nodeId} → Estágio ${steps}` });
                }
                continue;
            }
        }
    }
    return { updates, newFaults, providedSteps: providedSteps.length > 0 ? providedSteps : null };
}