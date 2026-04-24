import { runPowerFlow } from './powerCalculations';
import { applyStepToSnapshot, calculateDisconnectedP, MANEUVER_TIMES } from './switchSequencer';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Heurística Gulosa Construtiva com Make-Before-Break (Anel Fechado)
 * Atualizada com Tagueador de Pacotes para o motor VNS
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
    
    // RASTREADORES DE BLOCO PARA O VNS
    let isSosMode = false;
    let currentBbmId = null;
    let pendingPreps = []; // 👈 NOVA SALA DE ESPERA

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
        if (!bestMove) {
            if (justFormedLoop) {
                justFormedLoop = false; // Desativa a trava
                currentBbmId = null; // Failsafe para limpar o rastreador
                if (onProgress) onProgress("Abertura retida. Soltando trava e buscando novas rotas...");
                console.log("🔓 Trava solta. Reiniciando iteração para buscar fechamentos...");
                await yieldToMain();
                continue; 
            }

            // 👇 O SISTEMA BATEU NA PAREDE. ATIVA MODO SOS GLOBAL! 👇
            isSosMode = true; 

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
                    // 👇 MARCA O PASSO IMEDIATO DO SOS COM A TAG 👇
                    sosResult.immediateStep.groupId = 'SOS_BLOCK';
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

        // 👇 A MÁGICA DO TAGUEAMENTO DO VNS 👇
        if (bestStepObj) {
            if (isSosMode) {
                // Modo Exceção: Engessa num blocão só
                bestStepObj.groupId = 'SOS_BLOCK';
            } else if (justFormedLoop) {
                // Fechamento de BBM
                bestStepObj.groupId = currentBbmId;
                currentBbmId = null; 
            } else if (bestMoveIsLoop) {
                // Abertura de BBM
                currentBbmId = 'BBM-' + iterations;
                bestStepObj.groupId = currentBbmId;
            } else if (bestStepObj.type === 'open') {
                // Abertura solta preparatória -> Vai para a sala de espera
                bestStepObj.groupId = 'PREP-' + iterations; 
                pendingPreps.push(bestStepObj); // 👈 GUARDA AQUI
            } else {
                // Fechamento radial puro e limpo
                const restoreId = 'RESTORE-' + iterations;
                bestStepObj.groupId = restoreId;
                
                // 👇 O PULO DO GATO: O Restore adota as preparações órfãs 👇
                pendingPreps.forEach(prepStep => {
                    prepStep.groupId = restoreId; // Muda a etiqueta para formar o par!
                });
                pendingPreps = []; // Limpa a sala de espera
            }
        }

        // Aplica o movimento vencedor
        sequence.push(bestStepObj);
        currentSnapshot = applyStepToSnapshot(bestStepObj, currentSnapshot);
        currentPLoss = bestPLoss;
        
        // Remove da lista de pendências
        pendingMoves = pendingMoves.filter(m => m.id !== bestMove.id);
        
        // 👇 5. ATUALIZANDO A MEMÓRIA 👇
        justFormedLoop = bestMoveIsLoop;
    }

    // 👇 ADICIONE ESTE BLOCO FINAL DE LOG 👇
    console.log("\n========================================================");
    console.log("🎉 OTIMIZAÇÃO CONCLUÍDA!");
    console.log("========================================================");
    console.log("Resumo das Macro-manobras (Pacotes VNS gerados):");
    
    // Imprime uma tabela bem formatada no console do navegador
    console.table(sequence.map((s, index) => {
        const isFault = s.type.includes('fault');
        return {
            Ordem: index + 1,
            Ação: isFault ? 'FALTA/PROTEÇÃO' : (s.type === 'close' ? 'FECHAR' : 'ABRIR'),
            Alvo: isFault ? `Barra ${s.nodeId}` : `${s.fromNode}-${s.toNode}`,
            Pacote_VNS: s.groupId || 'COND_INICIAL',
            SOS_Alívio: s.isLoadShedding ? 'SIM' : '-'
        };
    }));
    console.log("========================================================\n");

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
/**
 * MODO SOS: Identifica uma ilha desenergizada e abre uma chave interna
 * para fragmentar a carga e permitir a retomada (Cold Load Pick-up).
 */
function rankSwitchesByLostLoad(internalSwitches, currentBranches, sysData) {
    return internalSwitches.map(sw => {
        // 1. Conta a carga do fragmento do lado FROM
        let loadFrom = 0;
        let visitedFrom = new Set([sw.from]);
        let queueFrom = [sw.from];
        while (queueFrom.length > 0) {
            let curr = queueFrom.shift();
            // 👇 CORREÇÃO DO BUG: Buscando 'p' minúsculo e 'P' maiúsculo por segurança
            loadFrom += (sysData.loads[curr]?.p || sysData.loads[curr]?.P || 0);
            const neighbors = currentBranches.filter(b => b.state === 1 && b.id !== sw.id && (b.from === curr || b.to === curr));
            for (const n of neighbors) {
                const next = n.from === curr ? n.to : n.from;
                if (!visitedFrom.has(next)) { visitedFrom.add(next); queueFrom.push(next); }
            }
        }

        // 2. Conta a carga do fragmento do lado TO
        let loadTo = 0;
        let visitedTo = new Set([sw.to]);
        let queueTo = [sw.to];
        while (queueTo.length > 0) {
            let curr = queueTo.shift();
            loadTo += (sysData.loads[curr]?.p || sysData.loads[curr]?.P || 0);
            const neighbors = currentBranches.filter(b => b.state === 1 && b.id !== sw.id && (b.from === curr || b.to === curr));
            for (const n of neighbors) {
                const next = n.from === curr ? n.to : n.from;
                if (!visitedTo.has(next)) { visitedTo.add(next); queueTo.push(next); }
            }
        }

        // A carga que será potencialmente "aliviada" é a menor fatia
        const shedLoad = Math.min(loadFrom, loadTo);
        
        return { branch: sw, shedLoad: shedLoad };
    })
    // 👇 O FILTRO DE PODA: Remove sumariamente chaves que não aliviam nada (Zero kW) 👇
    .filter(item => item.shedLoad > 0.001)
    // 👇 ORDENAÇÃO: Tenta os menores cortes primeiro (Salva mais carga) 👇
    .sort((a, b) => a.shedLoad - b.shedLoad);
}

function fragmentDeadIsland(failedClosures, currentSnapshot, sysData, targetBranches) {
    // 1. Identifica quem tem energia AGORA
    const currentPoweredNodes = getPoweredNodes(currentSnapshot.branches, sysData.sources, currentSnapshot.faults);
    
    // 2. Identifica quem terá energia NO FINAL (Zona Alvo)
    const targetPoweredNodes = getPoweredNodes(targetBranches, sysData.sources, currentSnapshot.faults);
    
    // 3. Mapeia as chaves "internas" (Poda Alvo)
    const internalSwitches = currentSnapshot.branches.filter(b => 
        b.state === 1 && 
        !currentPoweredNodes.has(b.from) && 
        !currentPoweredNodes.has(b.to) &&
        (targetPoweredNodes.has(b.from) || targetPoweredNodes.has(b.to))
    );

    if (internalSwitches.length === 0) return null;

    // 4. Aplica o ranqueamento
    const rankedSwitches = rankSwitchesByLostLoad(internalSwitches, currentSnapshot.branches, sysData);
    if (console) console.log("🔍 SOS: Testando chaves ranqueadas (PÓS-PODA ALVO):", rankedSwitches.map(r => `${r.branch.from}-${r.branch.to} (${r.shedLoad.toFixed(1)}kW)`));

    // 👇 5. A NOVA LÓGICA BEST-ACCEPT OTIMIZADA (Pré-Ordenação Topológica) 👇
    const candidatePairs = [];

    // 5.1 PREPARAÇÃO: Gera todos os pares e calcula a carga topológica (Rápido, sem NR)
    for (const sourceMove of failedClosures) {
        for (const candidate of rankedSwitches) {
            const switchToOpen = candidate.branch;

            if (switchToOpen.id === sourceMove.id) continue;

            // Aplica os movimentos apenas no grafo
            let testSnapshot = applyStepToSnapshot({ type: 'open', branchId: switchToOpen.id, fromNode: switchToOpen.from, toNode: switchToOpen.to }, currentSnapshot);
            testSnapshot = applyStepToSnapshot({ type: 'close', branchId: sourceMove.id, fromNode: sourceMove.from, toNode: sourceMove.to }, testSnapshot);

            // Mede a carga topológica (sem perdas elétricas, só soma de potência)
            const poweredNodes = getPoweredNodes(testSnapshot.branches, sysData.sources, testSnapshot.faults);
            let energizedLoad = 0;
            for (const node of poweredNodes) {
                energizedLoad += (sysData.loads[node]?.p || sysData.loads[node]?.P || 0);
            }
            
            candidatePairs.push({
                openMove: switchToOpen,
                closeMove: sourceMove,
                energizedLoad: energizedLoad,
                testSnapshot: testSnapshot // Guarda o estado para testar a física depois
            });
        }
    }

    // 5.2 ORDENAÇÃO: Coloca as manobras que salvam mais carga no topo da fila
    candidatePairs.sort((a, b) => b.energizedLoad - a.energizedLoad);
    
    if (console) {
        console.log("\n========================================================");
        console.log("📊 [FILA DE PRIORIDADE SOS] (Ordenada por Topologia):");
        console.table(candidatePairs.map((p, i) => ({
            "Fila": i + 1,
            "Fechar (Fonte)": `${p.closeMove.from}-${p.closeMove.to}`,
            "Abrir (Alívio)": `${p.openMove.from}-${p.openMove.to}`,
            "Carga Alvo (kW)": p.energizedLoad.toFixed(2)
        })));
        console.log("========================================================\n");
    }

    // 5.3 O TESTE FÍSICO (First-Accept na fila inteligente)
    for (const pair of candidatePairs) {
        // 1º Escudo: LDF (Rápido)
        const ldf = linDistFlowScreening(pair.testSnapshot.branches, pair.testSnapshot.faults, sysData.sources, sysData);
        
        if (ldf.valid) {
            // 2º Escudo: Newton-Raphson (Pesado)
            const pfResult = runPowerFlow(pair.testSnapshot.branches, pair.testSnapshot.faults, 'NR', sysData);
            
            if (!checkViolations(pfResult, pair.testSnapshot.branches)) {
                // 🎉 BINGO! O primeiro que passa é o melhor, pois a fila já está ordenada!
                console.log(`🏆 SOS BEST-ACCEPT APROVOU: Abrir ${pair.openMove.from}-${pair.openMove.to} para fechar a ${pair.closeMove.from}-${pair.closeMove.to} (Mantém ${pair.energizedLoad.toFixed(1)}kW vivos)`);
                
                // Mapeia alternativas para o VNS N3 varrendo as chaves abaixo do vencedor na fila
                const alternativeIds = candidatePairs
                    .filter(p => p.closeMove.id === pair.closeMove.id && p.openMove.id !== pair.openMove.id)
                    .map(p => p.openMove.id);

                return {
                    immediateStep: {
                        type: 'open',
                        branchId: pair.openMove.id,
                        fromNode: pair.openMove.from,
                        toNode: pair.openMove.to,
                        description: `[Alívio de Carga] Abertura prévia da chave ${pair.openMove.from}-${pair.openMove.to}`,
                        targetState: 0,
                        isLoadShedding: true,
                        alertMessage: `⚠️ Tomada de Carga a Frio: A chave ${pair.openMove.from}-${pair.openMove.to} foi aberta para permitir a energização segura do trecho principal.`,
                        alternatives: alternativeIds
                    },
                    debtMove: {
                        id: pair.closeMove.id,
                        from: pair.closeMove.from,
                        to: pair.closeMove.to,
                        targetState: 1
                    }
                };
            } else {
                 console.log(`❌ Rejeitado no NR (Violou limites): Abrir ${pair.openMove.from}-${pair.openMove.to}`);
            }
        } else {
             // console.log(`🚫 Rejeitado no LDF (Sobrecarga bruta): Abrir ${pair.openMove.from}-${pair.openMove.to}`);
        }
    }

    return null; // Nenhum par da lista sobreviveu à física.
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