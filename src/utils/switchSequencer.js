// src/utils/switchSequencer.js

// Configuração de tempos de manobra (Unidade: Minutos)
export const MANEUVER_TIMES = {
    SWITCH_OPEN: 1.0,      
    SWITCH_CLOSE: 1.0,     
    CHANGE_TAP: 0.5,       
    SHUNT_STEP: 0.5,       
    FAULT_PROTECTION: 0.01, 
    FAULT_RESTORE: 2.0      
};

// --- FUNÇÕES DE CÁLCULO ELÉTRICO E TOPOLOGIA ---

export function getEnergizedNodes(branches, faultNodes, sources) {
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

export function calculateDisconnectedP(branches, faults, sources, systemLoads) {
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

// --- LÓGICA DE SNAPSHOTS E TEMPO (LOG) ---

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

export function buildSnapshots(initialSnapshot, steps, sources, systemLoads) {
    const snapshots = [];
    let current = { ...initialSnapshot };
    let accumulatedENS = 0; 
    let totalElapsedMinutes = 0;
    let eventLog = [];

    // T=0
    current.disconnectedP = calculateDisconnectedP(current.branches, current.faults, sources, systemLoads);
    current.accumulatedENS = 0;
    current.elapsedTime = 0;
    current.stepDescription = "Estado Inicial";
    
    eventLog.push({
        time: "0.00",
        event: "Início da Operação",
        impact: `${current.disconnectedP.toFixed(2)} kW`,
        ens: "0.00 kWh"
    });
    
    current.log = [...eventLog];
    snapshots.push(current);

    for (const step of steps) {
        let maneuverTime = step.duration !== undefined ? step.duration : 0;
        
        if (maneuverTime === 0) {
            switch (step.type) {
                case 'open': maneuverTime = MANEUVER_TIMES.SWITCH_OPEN; break;
                case 'close': maneuverTime = MANEUVER_TIMES.SWITCH_CLOSE; break;
                case 'tap': maneuverTime = MANEUVER_TIMES.CHANGE_TAP; break;
                case 'shunt_step': maneuverTime = MANEUVER_TIMES.SHUNT_STEP; break;
                case 'fault_add': maneuverTime = MANEUVER_TIMES.FAULT_PROTECTION; break;
                case 'fault_remove': maneuverTime = MANEUVER_TIMES.FAULT_RESTORE; break;
                default: maneuverTime = 0;
            }
        }

        const nextState = applyStepToSnapshot(step, current);
        const pLoss = calculateDisconnectedP(nextState.branches, nextState.faults, sources, systemLoads);
        
        totalElapsedMinutes += maneuverTime;
        accumulatedENS += (pLoss * (maneuverTime / 60)); // ENS em kWh (se P estiver em kW e tempo em min)

        eventLog.push({
            time: totalElapsedMinutes.toFixed(2),
            event: step.description,
            impact: `${pLoss.toFixed(2)} kW`,
            ens: `${accumulatedENS.toFixed(2)} kWh`
        });

        current = {
            ...nextState,
            disconnectedP: pLoss,
            accumulatedENS: accumulatedENS,
            elapsedTime: totalElapsedMinutes,
            stepDescription: step.description,
            log: [...eventLog]
        };
        
        snapshots.push({...current});
    }
    return snapshots;
}

// Função auxiliar para encontrar disjuntores/chaves adjacentes a uma falta
export function findProtectionSwitches(nodeId, branches) {
    const branchesToOpen = [];
    const visitedNodes = new Set([nodeId]);
    const queue = [nodeId];
    
    while (queue.length > 0) {
        const curr = queue.shift();
        branches.filter(b => b.state === 1 && (b.from === curr || b.to === curr)).forEach(b => {
            const neighbor = b.from === curr ? b.to : b.from;
            if (!visitedNodes.has(neighbor)) {
                if (b.hasSwitch) { 
                    branchesToOpen.push(b.id); 
                } else { 
                    visitedNodes.add(neighbor); 
                    queue.push(neighbor); 
                }
            }
        });
    }
    return branchesToOpen;
}
// --- PARSER DE ARQUIVOS (COM INTELIGÊNCIA DE PROTEÇÃO) ---

export function parseSequenceFile(content, currentBranches) {
    const lines = content.split(/\r\n|\n/);
    const updates = new Map();
    const newFaults = new Set();
    const providedSteps = [];
    let mode = null;

    const branchByEdge = new Map();
    currentBranches.forEach(b => {
        branchByEdge.set(`${b.from}-${b.to}`, b);
        branchByEdge.set(`${b.to}-${b.from}`, b);
    });

    for (const rawLine of lines) {
        const l = rawLine.trim();
        if (!l) continue;

        if (l.includes('Circuitos Ativos')) { mode = 'active'; continue; }
        if (l.includes('Circuitos Desconectados')) { mode = 'disconnected'; continue; }
        if (/^Sequenciamento/i.test(l)) { mode = 'sequence'; continue; }

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

        // 👇 INSIRA ESTE BLOCO DE VOLTA 👇
        if (mode === 'active' || mode === 'disconnected') {
            // Ignora linhas de controle e o artefato ""
            if (l.startsWith('i') || l.startsWith('set') || l.startsWith('[')) continue;
            
            const parts = l.split(/\s+/).filter(p => p !== '');
            if (parts.length >= 2) { 
                const from = parseInt(parts[0]); 
                const to = parseInt(parts[1]); 
                const state = mode === 'active' ? 1 : 0; 
                
                if (!isNaN(from) && !isNaN(to)) { 
                    updates.set(`${from}-${to}`, state); 
                    updates.set(`${to}-${from}`, state); 
                } 
            }
            continue;
        }
        // 👆 FIM DO BLOCO INSERIDO 👆

        if (mode === 'sequence') {
            const parts = l.split(/\s+/).filter(p => p !== '');
            if (parts.length < 1) continue;
            const cmd = parts[0].toUpperCase();

            // Lendo tempo opcional se existir (formato: COMANDO P1 P2 [TEMPO])
            let customTime = undefined;

            if ((cmd === 'FECHAR' || cmd === 'ABRIR') && parts.length >= 3) {
                const from = parseInt(parts[1]);
                const to = parseInt(parts[2]);
                if (parts.length >= 4) customTime = parseFloat(parts[3]);
                
                const b = branchByEdge.get(`${from}-${to}`);
                if (b) {
                    providedSteps.push({
                        type: cmd === 'FECHAR' ? 'close' : 'open',
                        branchId: b.id,
                        fromNode: b.from,
                        toNode: b.to,
                        duration: customTime,
                        description: `${cmd === 'FECHAR' ? 'Fechar' : 'Abrir'} chave ${from}–${to}`
                    });
                }
                continue;
            }

            if (cmd === 'FALTA_ADICIONAR' && parts.length >= 2) {
                const nodeId = parseInt(parts[1]);
                let customTime = parts.length >= 3 ? parseFloat(parts[2]) : undefined;
                
                if (!isNaN(nodeId)) {
                    // Usa a nova função centralizada
                    const branchesToOpen = findProtectionSwitches(nodeId, currentBranches);

                    providedSteps.push({ 
                        type: 'fault_add', 
                        nodeId, 
                        openedBranches: branchesToOpen,
                        duration: customTime,
                        description: `Falta na barra ${nodeId} e atuação da Proteção` 
                    });
                }
                continue;
            }

            if (cmd === 'FALTA_RESTAURAR' && parts.length >= 2) {
                const nodeId = parseInt(parts[1]);
                if (parts.length >= 3) customTime = parseFloat(parts[2]);
                
                if (!isNaN(nodeId)) {
                    providedSteps.push({ 
                        type: 'fault_remove', 
                        nodeId, 
                        duration: customTime,
                        description: `Restaurar barra ${nodeId}` 
                    });
                }
                continue;
            }

            if (cmd === 'SHUNT_STEP' && parts.length >= 3) {
                const nodeId = parseInt(parts[1]);
                const steps = parseInt(parts[2]);
                if (parts.length >= 4) customTime = parseFloat(parts[3]);
                
                if (!isNaN(nodeId) && !isNaN(steps)) {
                    providedSteps.push({ 
                        type: 'shunt_step', 
                        nodeId, 
                        steps, 
                        duration: customTime,
                        description: `Ajustar Capacitor ${nodeId} → Estágio ${steps}` 
                    });
                }
                continue;
            }
        }
    }
    return { updates, newFaults, providedSteps: providedSteps.length > 0 ? providedSteps : null };
}