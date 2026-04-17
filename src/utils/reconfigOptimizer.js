import { runPowerFlow } from './powerCalculations';
import { applyStepToSnapshot, calculateDisconnectedP, MANEUVER_TIMES } from './switchSequencer';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Heurística Gulosa Construtiva com Make-Before-Break (Anel Fechado)
 */
export async function runOptimizer(initialSequence, initialState, targetBranches, sysData, onProgress) {
    if (onProgress) onProgress("Iniciando Otimização Gulosa...");

    let sequence = [...initialSequence];
    let currentSnapshot = { ...initialState };
    
    // Calcula a ENS base (pós-falta)
    let currentPLoss = calculateDisconnectedP(currentSnapshot.branches, currentSnapshot.faults, sysData.sources, sysData.loads);

    // 1. Identificar Conjunto de Diferenças (Movimentos Pendentes)
    let pendingMoves = targetBranches.filter(tb => {
        const sb = currentSnapshot.branches.find(b => b.id === tb.id);
        return sb && sb.state !== tb.state;
    }).map(b => ({
        id: b.id,
        from: b.from,
        to: b.to,
        targetState: b.state
    }));

    let loopActive = false;
    let iterations = 0;

    // 2. Loop de Construção Gulosa
    while (pendingMoves.length > 0 && iterations < 50) {
        iterations++;
        let bestMove = null;
        let bestPLoss = Infinity;
        let bestMoveIsLoop = false;
        let bestStepObj = null;

        // 0. Define o espaço de busca (Tratamento focado no Loop)
        let candidates = pendingMoves;
        
        if (loopActive) {
            const pendingOpens = pendingMoves.filter(m => m.targetState === 0);
            const loopBreakers = [];

            // Testa quais aberturas pendentes realmente desfazem o loop atual
            for (const openMove of pendingOpens) {
                const testStep = { type: 'open', branchId: openMove.id, fromNode: openMove.from, toNode: openMove.to };
                const testSnap = applyStepToSnapshot(testStep, currentSnapshot);
                const ldfCheck = linDistFlowScreening(testSnap.branches, testSnap.faults, sysData.sources, sysData);
                
                // Se a rede parou de acusar "Loop detectado", essa chave quebra o loop!
                if (ldfCheck.reason !== "Loop detectado") {
                    loopBreakers.push(openMove);
                }
            }

            // A SUA REGRA: Se houver chaves que desfazem ESTE loop, trava a busca nelas.
            // Se não houver (loopBreakers vazio), ignora a restrição e segue em frente!
            if (loopBreakers.length > 0) {
                candidates = loopBreakers;
            }
        }

        // 👇 1. Descobre quem tem energia no momento
        const poweredNodes = getPoweredNodes(currentSnapshot.branches, sysData.sources, currentSnapshot.faults);

        for (const move of candidates) {
            
            // 👇 2. A REGRA DE OURO DA RESTAURAÇÃO
            // Evita reconstruir ilhas mortas e desfazer o Modo SOS prematuramente
            if (move.targetState === 1) { 
                const fromPowered = poweredNodes.has(move.from);
                const toPowered = poweredNodes.has(move.to);
                if (!fromPowered && !toPowered) continue; // Ambos mortos? Pula!
            }

            const step = {
                type: move.targetState === 1 ? 'close' : 'open',
                branchId: move.id,
                fromNode: move.from,
                toNode: move.to,
                description: `${move.targetState === 1 ? 'Fechar' : 'Abrir'} chave ${move.from}–${move.to}`,
                duration: move.targetState === 1 ? MANEUVER_TIMES.SWITCH_CLOSE : MANEUVER_TIMES.SWITCH_OPEN
            };

            const testSnapshot = applyStepToSnapshot(step, currentSnapshot);
            const pLoss = calculateDisconnectedP(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData.loads);

            // REGRA DE OURO: Proibido desenergizar carga (Monotonicidade)
            if (pLoss > currentPLoss + 0.001) continue; 

            // Validação Linear
            const ldf = linDistFlowScreening(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData);
            let valid = ldf.valid;
            let isLoop = false;

            // Tratamento de Loop (Make-Before-Break)
            if (!valid && ldf.reason === "Loop detectado" && move.targetState === 1) {
                // Roda Newton-Raphson para validar o loop temporário
                const pfResult = runPowerFlow(testSnapshot.branches, testSnapshot.faults, 'NR', sysData);
                if (!checkViolations(pfResult, testSnapshot.branches)) {
                    valid = true;
                    isLoop = true;
                }
            }

            // Seleção Gulosa
            if (valid) {
                if (pLoss < bestPLoss) {
                    bestPLoss = pLoss;
                    bestMove = move;
                    bestMoveIsLoop = isLoop;
                    bestStepObj = step;
                } else if (Math.abs(pLoss - bestPLoss) < 0.001 && bestMove) {
                    // Desempate: Se a ENS for igual, prefere "ABRIR" chaves para evitar loops prolongados
                    if (move.targetState === 0 && bestMove.targetState === 1) {
                        bestMove = move;
                        bestMoveIsLoop = false;
                        bestStepObj = step;
                    }
                }
            }
        }

        // Se não encontrou nenhum movimento válido pela Heurística Normal...
        if (!bestMove) {
            if (onProgress) onProgress("Detonado limite de carga. Calculando fragmentação de ilha...");
            await yieldToMain();

            // Ativa o Modo SOS enviando a lista de manobras que acabaram de falhar (candidates)
            const sosResult = fragmentDeadIsland(candidates, currentSnapshot, sysData, targetBranches);
            
            if (sosResult) {
                // Aplica a abertura de fragmentação na sequência imediatamente
                sequence.push(sosResult.immediateStep);
                currentSnapshot = applyStepToSnapshot(sosResult.immediateStep, currentSnapshot);
                
                // ADICIONA O FECHAMENTO À LISTA DE PENDÊNCIAS
                pendingMoves.push(sosResult.debtMove);
                
                if (onProgress) updateProgressText(sosResult.immediateStep, false, pendingMoves.length, onProgress);
                await yieldToMain();
                
                // Volta para o começo do `while` para tentar a heurística gulosa de novo com a rede mais leve
                continue; 
            } else {
                // Se o SOS retornar null, significa que a ilha não tem mais chaves para abrir. Aí sim é um Dead End.
                if (onProgress) onProgress("Busca encerrada: Carga excessiva e sem chaves para seccionamento.");
                break; 
            }
        }

        if (onProgress) updateProgressText(bestStepObj, bestMoveIsLoop, pendingMoves.length, onProgress);
        await yieldToMain();

        // Aplica o movimento vencedor
        sequence.push(bestStepObj);
        currentSnapshot = applyStepToSnapshot(bestStepObj, currentSnapshot);
        currentPLoss = bestPLoss;
        
        // Remove da lista de pendências
        pendingMoves = pendingMoves.filter(m => m.id !== bestMove.id);
        
        // Atualiza a trava de loop
        loopActive = bestMoveIsLoop;
    }

    if (onProgress) onProgress(pendingMoves.length === 0 ? "Otimização Concluída com Sucesso!" : "Otimização Parcial (Restrições impediram o estado alvo).");
    return { steps: sequence, method: `Heurística Gulosa (${sequence.length} manobras)` };
}

function updateProgressText(step, isLoop, remain, onProgress) {
    const action = step.type === 'close' ? 'Fechando' : 'Abrindo';
    const loopAlert = isLoop ? ' [LOOP TEMPORÁRIO]' : '';
    onProgress(`Passo aceito: ${action} ${step.fromNode}-${step.toNode}${loopAlert}. Faltam ${remain - 1}...`);
}

function checkViolations(pfResult, branches) {
    const V_MIN = 0.95; const V_MAX = 1.05;
    const vViolation = Object.values(pfResult.nodes).some(n => n.v < V_MIN || n.v > V_MAX);
    const iViolation = branches.some(b => {
        const iMag = pfResult.lines[b.id] || 0;
        return iMag > b.Imax;
    });
    return vViolation || iViolation;
}

/**
 * MODO SOS: Identifica uma ilha desenergizada e abre uma chave interna
 * para fragmentar a carga e permitir a retomada (Cold Load Pick-up).
 */
function fragmentDeadIsland(failedMoves, currentSnapshot, sysData, targetBranches) {
    const { branches } = currentSnapshot;

    // 1. Pega o primeiro fechamento que tentamos e falhou
    const firstFailedClose = failedMoves.find(m => m.targetState === 1);
    if (!firstFailedClose) return null;

    // Função auxiliar (BFS) para mapear todos os nós conectados a um ponto de partida
    const getIslandNodes = (startNode) => {
        const visited = new Set([startNode]);
        const queue = [startNode];
        while (queue.length > 0) {
            const curr = queue.shift();
            // Viaja apenas por chaves/linhas atualmente FECHADAS
            const neighbors = branches.filter(b => b.state === 1 && (b.from === curr || b.to === curr));
            for (const b of neighbors) {
                const next = b.from === curr ? b.to : b.from;
                if (!visited.has(next)) {
                    visited.add(next);
                    queue.push(next);
                }
            }
        }
        return visited;
    };

    // Mapeia os nós dos dois lados da chave que tentamos fechar
    const islandA = getIslandNodes(firstFailedClose.from);
    const islandB = getIslandNodes(firstFailedClose.to);

    // A "Ilha Morta" é aquela que não tem conexão com nenhuma subestação (fonte)
    const sources = new Set(sysData.sources);
    const hasSource = (island) => Array.from(island).some(node => sources.has(node));
    
    let deadIsland = null;
    if (!hasSource(islandA)) deadIsland = islandA;
    else if (!hasSource(islandB)) deadIsland = islandB;

    if (!deadIsland) return null; // Prevenção de erro se não achar a ilha

    // 2. Procurar chaves manobráveis DENTRO dessa ilha morta
    // Precisa ser uma chave operável (estar em targetBranches) e estar FECHADA agora.
    const internalSwitches = branches.filter(b => 
        b.state === 1 && 
        deadIsland.has(b.from) && 
        deadIsland.has(b.to) &&
        targetBranches.some(tb => tb.id === b.id)
    );

    if (internalSwitches.length === 0) return null; // Não há como fragmentar mais

    // 3. Escolhe qual abrir. 
    // Para simplificar o MVP, pegamos a primeira chave da lista. Como a ilha é radial,
    // qualquer chave aberta vai dividir a carga e ajudar no fechamento posterior.
    const switchToOpen = internalSwitches[0];

    return {
        // Passo a ser executado agora
        immediateStep: {
            type: 'open',
            branchId: switchToOpen.id,
            fromNode: switchToOpen.from,
            toNode: switchToOpen.to,
            description: `[ALÍVIO] Abrir chave ${switchToOpen.from}–${switchToOpen.to} para dividir a carga`,
            duration: 1.0 // Usa 1 minuto padrão para abertura
        },
        // Passo a ser adicionado nas pendências (O "empréstimo")
        debtMove: {
            id: switchToOpen.id,
            from: switchToOpen.from,
            to: switchToOpen.to,
            targetState: 1 // Terá que ser fechada de novo lá na frente
        }
    };
}

// O FILTRO DE VIABILIDADE LINEAR (Mantido idêntico)
export function linDistFlowScreening(activeBranches, faultNodes, sources, sysData) {
    const { loads, shunts, Sbase = 1000, Vbase = 13.8 } = sysData;
    const Zbase = (Vbase * Vbase) / (Sbase / 1000); 

    const adj = {}; const branchMap = {};
    activeBranches.forEach(b => {
        if (b.state !== 1) return;
        if (!adj[b.from]) adj[b.from] = []; if (!adj[b.to]) adj[b.to] = [];
        adj[b.from].push(b.to); adj[b.to].push(b.from);
        branchMap[`${b.from}-${b.to}`] = b; branchMap[`${b.to}-${b.from}`] = b;
    });

    const parents = {}; const order = []; const visited = new Set();
    const queue = [...sources.filter(s => !faultNodes.has(s))];
    queue.forEach(s => visited.add(s));

    while (queue.length > 0) {
        const curr = queue.shift(); order.push(curr);
        for (const n of (adj[curr] || [])) {
            if (faultNodes.has(n)) continue;
            if (!visited.has(n)) { visited.add(n); parents[n] = curr; queue.push(n); } 
            else if (parents[curr] !== n) return { valid: false, reason: "Loop detectado" }; 
        }
    }

    const P_flow = {}; const Q_flow = {}; const V_nodes = {};
    sources.forEach(s => { V_nodes[s] = 1.0; }); 

    for (let i = order.length - 1; i >= 0; i--) {
        const node = order[i];
        let pNode = loads[node] ? (loads[node].p / Sbase) : 0;
        let qNode = loads[node] ? (loads[node].q / Sbase) : 0;
        if (shunts[node]) qNode -= ((shunts[node].steps * shunts[node].stepSize) / Sbase);

        P_flow[node] = pNode; Q_flow[node] = qNode;
        for (const child of (adj[node] || [])) {
            if (parents[child] === node) { P_flow[node] += P_flow[child]; Q_flow[node] += Q_flow[child]; }
        }
    }

    let minV = 1.0;
    for (let i = 0; i < order.length; i++) {
        const node = order[i]; const p = parents[node];
        if (p !== undefined) {
            const branch = branchMap[`${p}-${node}`];
            const Rpu = branch.r / Zbase; const Xpu = branch.x / Zbase;
            
            V_nodes[node] = V_nodes[p] - (Rpu * P_flow[node] + Xpu * Q_flow[node]);
            if (V_nodes[node] < minV) minV = V_nodes[node];
            
            const S_flow_pu = Math.sqrt(Math.pow(P_flow[node], 2) + Math.pow(Q_flow[node], 2));
            const I_est = S_flow_pu * (Sbase / (Math.sqrt(3) * Vbase));
            if (I_est > (branch.Imax || 1000)) return { valid: false, reason: "Sobrecarga" };
        }
    }

    if (minV < 0.95) return { valid: false, reason: "Subtensão" };
    return { valid: true };
}
function getPoweredNodes(branches, sources, faultNodes = new Set()) {
    const powered = new Set();
    const queue = [...sources.filter(s => !faultNodes.has(s))];
    queue.forEach(s => powered.add(s));

    const adj = {};
    branches.forEach(b => {
        if (b.state === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });

    while (queue.length > 0) {
        const curr = queue.shift();
        for (const neighbor of (adj[curr] || [])) {
            if (!powered.has(neighbor) && !faultNodes.has(neighbor)) {
                powered.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return powered;
}