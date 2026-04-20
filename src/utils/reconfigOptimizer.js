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

    // 👇 ADICIONE ESTE BLOCO DE LOG AQUI 👇
    console.log("\n==================================");
    console.log("📋 CHECKLIST INICIAL DE MANOBRAS");
    console.log("==================================");
    console.log(pendingMoves.map(m => `${m.targetState===1?'FECHAR':'ABRIR'} ${m.from}-${m.to}`).join('\n'));
    console.log("==================================\n");

    let justFormedLoop = false;
    let iterations = 0;
    
    // 2. Loop de Construção Gulosa
    while (pendingMoves.length > 0 && iterations < 50) {
        iterations++;
        let bestMove = null;
        let bestPLoss = Infinity;
        let bestMoveIsLoop = false;
        let bestStepObj = null;

        
        // 0. Espaço de busca total. A física e os desempates definem a ordem.
        let candidates = pendingMoves;
        const pendingOpens = pendingMoves.filter(m => m.targetState === 0);

        // A TRAVA DE SCADA: Se o passo anterior gerou loop, o foco agora é OBRIGATORIAMENTE abrir.
        if (justFormedLoop && pendingOpens.length > 0) {
            candidates = pendingOpens;
        }
        
        // 1. Descobre quem tem energia no momento (mantém normal...)
        const poweredNodes = getPoweredNodes(currentSnapshot.branches, sysData.sources, currentSnapshot.faults);

        console.log(`\n[DEBUG] --- Iteração ${iterations} ---`);
        console.log(`[DEBUG] Pendências ativas:`, candidates.map(m => `${m.targetState===1?'Fechar':'Abrir'} ${m.from}-${m.to}`).join(', '));
        
        for (const move of candidates) {
            const step = {
                type: move.targetState === 1 ? 'close' : 'open',
                branchId: move.id,
                fromNode: move.from,
                toNode: move.to,
                description: `${move.targetState === 1 ? 'Fechar' : 'Abrir'} chave ${move.from}–${move.to}`,
                duration: 1.0
            };

            // 1. REGRA DO NÓ VIVO
            if (move.targetState === 1) { 
                const fromPowered = poweredNodes.has(move.from);
                const toPowered = poweredNodes.has(move.to);
                if (!fromPowered && !toPowered) {
                    console.log(`❌ SKIP ${move.from}-${move.to}: Ambos os nós (${move.from} e ${move.to}) estão sem energia.`);
                    continue; 
                }
            }

            const testSnapshot = applyStepToSnapshot(step, currentSnapshot);
            const pLoss = calculateDisconnectedP(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData.loads);

            // 2. REGRA DE ENS (NÃO DERRUBAR CARGA)
            if (pLoss > currentPLoss + 0.001) {
                console.log(`❌ SKIP ${move.from}-${move.to}: Aumentaria a ENS de ${currentPLoss.toFixed(2)} para ${pLoss.toFixed(2)}`);
                continue; 
            }

            // 3. VALIDAÇÃO LINEAR (LINDISTFLOW) - O FILTRO RÁPIDO
            const ldf = linDistFlowScreening(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData);
            let valid = ldf.valid;
            let isLoop = false;

            if (!valid) {
                if (ldf.reason === "Loop detectado") {
                    const pfResult = runPowerFlow(testSnapshot.branches, testSnapshot.faults, 'NR', sysData);
                    if (!checkViolations(pfResult, testSnapshot.branches)) {
                        console.log(`⚠️ LOOP SEGURO (NR Aprovou): ${move.from}-${move.to}`);
                        valid = true;
                        isLoop = true;
                    } else {
                        console.log(`❌ NR REJEITOU LOOP: ${move.from}-${move.to} (Violação de Limites)`);
                    }
                } else {
                    console.log(`❌ LDF REJEITOU: ${move.from}-${move.to} (${ldf.reason})`);
                }
            } else {
                // 👇 A CORREÇÃO DO BUG OCULTO 👇
                // LDF aprovou manobra radial. Mas LDF é impreciso! Vamos rodar o NR para carimbar.
                const pfResult = runPowerFlow(testSnapshot.branches, testSnapshot.faults, 'NR', sysData);
                if (checkViolations(pfResult, testSnapshot.branches)) {
                    console.log(`❌ FALSO POSITIVO LDF! NR Rejeitou ${move.from}-${move.to} por violação oculta.`);
                    valid = false;
                } else {
                    console.log(`✅ LDF + NR APROVARAM: ${move.from}-${move.to}`);
                }
            }

            // SELEÇÃO DO MELHOR MOVIMENTO
            if (valid) {
                console.log(`✅ APROVADO: ${move.from}-${move.to} | ENS após manobra: ${pLoss.toFixed(2)}`);
                if (pLoss < bestPLoss) {
                    bestPLoss = pLoss;
                    bestMove = move;
                    bestMoveIsLoop = isLoop;
                    bestStepObj = step;
                } else if (Math.abs(pLoss - bestPLoss) < 0.001 && bestMove) {
                    if (move.targetState === 0 && bestMove.targetState === 1) {
                        bestMove = move;
                        bestMoveIsLoop = false;
                        bestStepObj = step;
                    }
                }
            }
        }
        
        if (bestMove) {
            console.log(`🏆 VENCEDOR DA ITERAÇÃO: ${bestMove.targetState===1?'Fechar':'Abrir'} ${bestMove.from}-${bestMove.to}`);
        } else {
            console.log(`💀 DEAD END: Nenhum movimento aprovado nesta iteração.`);
        }

        // Se não encontrou nenhum movimento válido pela Heurística Normal...
        // Se não encontrou nenhum movimento válido pela Heurística Normal...
        if (!bestMove) {
            if (justFormedLoop) {
                justFormedLoop = false; // Desativa a trava
                if (onProgress) onProgress("Abertura retida. Soltando trava e buscando novas rotas...");
                console.log("🔓 Trava solta. Reiniciando iteração para buscar fechamentos...");
                await yieldToMain();
                continue; 
            }

            // 👇 NOVA LÓGICA: Break-Before-Make (BBM) Oficial 👇
            // Se travamos por restrição de ENS e temos chaves OFICIAIS para abrir, forçamos a abertura!
            const pendingOpens = pendingMoves.filter(m => m.targetState === 0);
            let forcedOpen = null;
            
            for (const move of pendingOpens) {
                let testSnapshot = applyStepToSnapshot({ type: 'open', branchId: move.id, fromNode: move.from, toNode: move.to }, currentSnapshot);
                const ldf = linDistFlowScreening(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData);
                
                // Se for fisicamente seguro (ignora que a ENS aumentou)
                if (ldf.valid || ldf.reason === "Loop detectado") {
                    const pfResult = runPowerFlow(testSnapshot.branches, testSnapshot.faults, 'NR', sysData);
                    if (!checkViolations(pfResult, testSnapshot.branches)) {
                        forcedOpen = move;
                        break; // Pega a primeira abertura segura
                    }
                }
            }

            if (forcedOpen) {
                if (onProgress) onProgress(`Break-Before-Make ativado na chave ${forcedOpen.from}-${forcedOpen.to}...`);
                console.log(`⚠️ BBM ATIVADO: Forçando abertura de ${forcedOpen.from}-${forcedOpen.to} para aliviar o sistema.`);
                
                bestMove = forcedOpen;
                bestMoveIsLoop = false;
                bestPLoss = currentPLoss; 
                bestStepObj = {
                    type: 'open',
                    branchId: forcedOpen.id,
                    fromNode: forcedOpen.from,
                    toNode: forcedOpen.to,
                    description: `Abrir chave ${forcedOpen.from}-${forcedOpen.to} (Break-Before-Make)`,
                    targetState: 0,

                    isLoadShedding: true, 
                    alertMessage: `⚠️ Alívio de Carga: Abertura forçada da chave ${forcedOpen.from}-${forcedOpen.to} para prevenir sobrecarga no sistema.`
                };
            } else {
                // 👇 CORREÇÃO DA ALUCINAÇÃO DO SOS 👇
                if (onProgress) onProgress("Detonado limite de carga. Calculando fragmentação de ilha (SOS)...");
                await yieldToMain();

                // Garante que o SOS só vai tentar ajudar manobras de FECHAR
                const failedClosures = candidates.filter(m => m.targetState === 1);
                const sosResult = fragmentDeadIsland(failedClosures, currentSnapshot, sysData, targetBranches);
                
                if (sosResult) {
                    sequence.push(sosResult.immediateStep);
                    currentSnapshot = applyStepToSnapshot(sosResult.immediateStep, currentSnapshot);
                    
                    if (!pendingMoves.some(m => m.id === sosResult.debtMove.id)) {
                        pendingMoves.push(sosResult.debtMove);
                    }

                    pendingMoves.push({
                        id: sosResult.immediateStep.branchId,
                        from: sosResult.immediateStep.fromNode,
                        to: sosResult.immediateStep.toNode,
                        targetState: 1 
                    });
                    
                    if (onProgress) updateProgressText(sosResult.immediateStep, false, pendingMoves.length, onProgress);
                    await yieldToMain();
                    continue; 
                } else {
                    if (onProgress) onProgress("Busca encerrada: Carga excessiva e sem chaves para seccionamento.");
                    break; 
                }
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
        
        // 👇 5. ATUALIZANDO A MEMÓRIA 👇
        // (Note que a variável antiga 'loopActive' foi apagada daqui)
        justFormedLoop = bestMoveIsLoop;
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
    // Se o NR divergiu, é violação instantânea
    if (!pfResult || pfResult.converged === false) return true; 

    const V_MIN = 0.95; 
    const V_MAX = 1.05;
    
    let vViolation = false;
    if (pfResult.nodes) {
        vViolation = Object.values(pfResult.nodes).some(n => n.v < V_MIN || n.v > V_MAX);
    }

    let iViolation = false;
    if (pfResult.lines) {
        for (const b of branches) {
            if (b.state === 0) continue; // Ignora chaves abertas

            // Busca o valor bruto retornado pelo NR
            const rawVal = pfResult.lines[b.id] ?? pfResult.lines[`${b.from}-${b.to}`] ?? pfResult.lines[`${b.to}-${b.from}`];
            
            let iMag = 0;
            // Tenta extrair a corrente caso seja um objeto complexo
            if (typeof rawVal === 'object' && rawVal !== null) {
                iMag = rawVal.i ?? rawVal.current ?? rawVal.mag ?? rawVal.iMag ?? 0;
            } else if (typeof rawVal === 'number') {
                iMag = rawVal;
            }

            const limit = b.Imax || 5000;

            // 🕵️ O NOSSO DETETIVE PARA A LINHA 30-43
            if ((b.from === 30 && b.to === 43) || (b.from === 43 && b.to === 30)) {
                console.log(`[DEBUG NR 30-43] RAW:`, rawVal, `| IMAG EXTRAÍDO:`, iMag, `| IMAX:`, limit);
            }

            if (iMag > limit) {
                iViolation = true;
                break;
            }
        }
    }

    return vViolation || iViolation;
}

/**
 * MODO SOS: Identifica uma ilha desenergizada e abre uma chave interna
 * para fragmentar a carga e permitir a retomada (Cold Load Pick-up).
 */
// Função auxiliar para o First-Accept: Calcula a potência ativa isolada e ordena
function rankSwitchesByLostLoad(internalSwitches, currentBranches, sysData) {
    return internalSwitches.map(sw => {
        let isolatedLoadKW = 0;
        
        // Simula a abertura da chave no grafo puramente lógico (sem NR)
        const testGraph = currentBranches.map(b => b.id === sw.id ? { ...b, state: 0 } : b);
        
        // Busca em Largura (BFS) rápida para descobrir quem ficou ilhado
        // Partimos de um dos nós da chave (vamos testar o 'to', assumindo fluxo radial padrão)
        // Nota: O ideal é rodar pros dois lados e pegar o lado que não tem caminho para a fonte.
        const visited = new Set();
        const queue = [sw.to];
        visited.add(sw.to);
        visited.add(sw.from); // Evita cruzar a própria chave de volta

        while (queue.length > 0) {
            const current = queue.shift();
            // Soma a carga ativa deste nó
            if (sysData.loads && sysData.loads[current]) {
                isolatedLoadKW += sysData.loads[current].P || 0;
            }

            // Acha os vizinhos conectados por chaves fechadas
            const neighbors = testGraph.filter(b => b.state === 1 && (b.from === current || b.to === current));
            for (const n of neighbors) {
                const nextNode = n.from === current ? n.to : n.from;
                if (!visited.has(nextNode)) {
                    visited.add(nextNode);
                    queue.push(nextNode);
                }
            }
        }

        return { branch: sw, lostLoad: isolatedLoadKW };
    }).sort((a, b) => a.lostLoad - b.lostLoad); // ORDENAÇÃO CRESCENTE (Do menor corte para o maior)
}

function fragmentDeadIsland(failedClosures, currentSnapshot, sysData, targetBranches) {
    // 1. Identifica os nós sem energia no momento
    const poweredNodes = getPoweredNodes(currentSnapshot.branches, sysData.sources, currentSnapshot.faults);
    
    // 2. Mapeia as chaves "internas" (fechadas e dentro da área desenergizada)
    const internalSwitches = currentSnapshot.branches.filter(b => 
        b.state === 1 && !poweredNodes.has(b.from) && !poweredNodes.has(b.to)
    );

    if (internalSwitches.length === 0) return null;

    // 👇 3. APLICA A HEURÍSTICA DE ORDENAÇÃO (FIRST-ACCEPT) 👇
    const rankedSwitches = rankSwitchesByLostLoad(internalSwitches, currentSnapshot.branches, sysData);
    
    if (console) console.log("🔍 SOS: Testando chaves ranqueadas por menor perda de carga:", rankedSwitches.map(r => `${r.branch.from}-${r.branch.to} (${r.lostLoad.toFixed(1)}kW)`));

    // 4. A Busca com Antevisão (Lookahead)
    for (const candidate of rankedSwitches) {
        const switchToOpen = candidate.branch;

        for (const sourceMove of failedClosures) {
            // A Simulação Emparelhada: Abre a chave interna e tenta Fechar a fonte
            let testSnapshot = applyStepToSnapshot({ 
                type: 'open', branchId: switchToOpen.id, fromNode: switchToOpen.from, toNode: switchToOpen.to 
            }, currentSnapshot);
            
            testSnapshot = applyStepToSnapshot({ 
                type: 'close', branchId: sourceMove.id, fromNode: sourceMove.from, toNode: sourceMove.to 
            }, testSnapshot);

            // Validação linear preliminar
            const ldf = linDistFlowScreening(testSnapshot.branches, testSnapshot.faults, sysData.sources, sysData);

            // Se o LDF passar ou der loop (que sabemos que a interface resolve), carimbamos com o NR
            if (ldf.valid || ldf.reason === "Loop detectado") {
                const pfResult = runPowerFlow(testSnapshot.branches, testSnapshot.faults, 'NR', sysData);
                
                if (!checkViolations(pfResult, testSnapshot.branches)) {
                    // 🎉 BINGO! Primeira Aceitação ativada. Paramos a busca imediatamente.
                    console.log(`✅ SOS FIRST-ACCEPT APROVOU: Abrir ${switchToOpen.from}-${switchToOpen.to} viabiliza fechar ${sourceMove.from}-${sourceMove.to}`);
                    
                    return {
                        immediateStep: {
                            type: 'open',
                            branchId: switchToOpen.id,
                            fromNode: switchToOpen.from,
                            toNode: switchToOpen.to,
                            description: `[Alívio de Carga] Abertura prévia da chave ${switchToOpen.from}-${switchToOpen.to}`,
                            targetState: 0,

                            isLoadShedding: true,
                            alertMessage: `⚠️ Tomada de Carga a Frio: A chave ${switchToOpen.from}-${switchToOpen.to} foi aberta para permitir a energização segura do trecho principal.`
                        },
                        debtMove: {
                            id: sourceMove.id,
                            from: sourceMove.from,
                            to: sourceMove.to,
                            targetState: 1
                        }
                    };
                }
            }
        }
    }

    // Se varreu toda a lista e nada viabilizou o fechamento da fonte, a ilha está realmente travada.
    return null;
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