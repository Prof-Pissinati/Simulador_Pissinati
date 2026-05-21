import { applyStepToSnapshot, calculateDisconnectedP } from './switchSequencer';
import { linDistFlowScreening } from './reconfigOptimizer';
import { runPowerFlow } from './powerCalculations';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

// O cão de guarda físico definitivo
function checkViolations(pfResult, branches, sysData) { // 👈 sysData adicionado
    if (!pfResult || pfResult.converged === false) return true; 
    const V_MIN = sysData?.vMin ?? 0.95; // 👈 Leitura dinâmica
    const V_MAX = sysData?.vMax ?? 1.05; // 👈 Leitura dinâmica
    let vViolation = false;
    if (pfResult.nodes) vViolation = Object.values(pfResult.nodes).some(n => n.v < V_MIN || n.v > V_MAX);
    let iViolation = false;
    if (pfResult.lines) {
        for (const b of branches) {
            if (b.state === 0) continue;
            const rawVal = pfResult.lines[b.id] ?? pfResult.lines[`${b.from}-${b.to}`] ?? pfResult.lines[`${b.to}-${b.from}`];
            let iMag = 0;
            if (typeof rawVal === 'object' && rawVal !== null) iMag = rawVal.i ?? rawVal.current ?? rawVal.mag ?? rawVal.iMag ?? 0;
            else if (typeof rawVal === 'number') iMag = rawVal;
            const limit = b.Imax || 5000;
            if (iMag > limit) { iViolation = true; break; }
        }
    }
    return vViolation || iViolation;
}

/**
 * 1. AVALIAÇÃO RÁPIDA (Filtro de Massa)
 * Usa apenas topologia de grafos (ENS) e LDF linear. Super rápido.
 */
function evaluateSequenceFast(sequence, initialState, sysData) {
    let currentSnapshot = { ...initialState };
    let totalENS = 0;
    let isValid = true;

    for (const step of sequence) {
        if (step.type.includes('fault')) {
            currentSnapshot = applyStepToSnapshot(step, currentSnapshot);
            continue;
        }

        currentSnapshot = applyStepToSnapshot(step, currentSnapshot);

        // Validação Linear (Custa quase 0ms)
        const ldf = linDistFlowScreening(currentSnapshot.branches, currentSnapshot.faults, sysData.sources, sysData);
        if (!ldf.valid && ldf.reason !== "Loop detectado") {
            isValid = false; break; 
        }

        const stepENS = calculateDisconnectedP(currentSnapshot.branches, currentSnapshot.faults, sysData.sources, sysData.loads);
        totalENS += stepENS;
    }

    return { isValid, totalENS };
}

/**
 * 2. AVALIAÇÃO PROFUNDA (O Cão de Guarda)
 * Só é chamada se a avaliação rápida achar uma solução incrivelmente boa.
 * Garante que não há afundamento de tensão ou sobrecarga real em nenhum passo.
 */
function verifySequenceNR(sequence, initialState, sysData) {
    let currentSnapshot = { ...initialState };
    for (const step of sequence) {
        if (step.type.includes('fault')) {
            currentSnapshot = applyStepToSnapshot(step, currentSnapshot);
            continue;
        }

        currentSnapshot = applyStepToSnapshot(step, currentSnapshot);

        const pfResult = runPowerFlow(currentSnapshot.branches, currentSnapshot.faults, 'NR', sysData);
        if (checkViolations(pfResult, currentSnapshot.branches, sysData)) { // 👈 sysData adicionado
            return false; // NR detectou violação oculta!
        }
    }
    return true; // Passou em todos os passos!
}

/**
 * Motor Principal da Meta-Heurística VNS
 */
export async function runVNS(greedySequence, initialState, sysData, onProgress) {
    if (onProgress) onProgress("Iniciando Otimização VNS (Reordenamento de Blocos)...");

    const initialBlocks = [];
    const finalBlocks = [];
    const movableGroups = {};

    greedySequence.forEach((step, index) => {
        const isFault = step.type.includes('fault');
        const gid = isFault ? 'COND_INICIAL' : (step.groupId || 'SEM_TAG');

        if (gid === 'COND_INICIAL') {
            initialBlocks.push(step);
        } else if (gid === 'SOS_BLOCK') {
            finalBlocks.push(step);
        } else {
            if (!movableGroups[gid]) movableGroups[gid] = [];
            movableGroups[gid].push({ ...step, _origIdx: index });
        }
    });

    // Ordenação correta pelo desfecho (último passo da manobra)
    const movableKeys = Object.keys(movableGroups).sort((a, b) => {
        const maxA = Math.max(...movableGroups[a].map(s => s._origIdx));
        const maxB = Math.max(...movableGroups[b].map(s => s._origIdx));
        return maxA - maxB;
    });

    movableKeys.forEach(key => {
        movableGroups[key] = movableGroups[key].map(s => {
            const cleanStep = { ...s };
            delete cleanStep._origIdx;
            return cleanStep;
        });
    });
    
    console.log("\n========================================================");
    console.log("🧩 VNS: BLOCOS EXTRAÍDOS PARA PERMUTAÇÃO");
    console.log(`Fixos no Início: ${initialBlocks.length} passos`);
    console.log(`Pacotes Móveis: ${movableKeys.length} pacotes (${movableKeys.join(', ')})`);
    console.log(`Fixos no Final: ${finalBlocks.length} passos`);
    console.log("========================================================\n");

    if (movableKeys.length < 2) {
        if (onProgress) onProgress("VNS: Sequência curta demais para otimização. Mantendo original.");
        return greedySequence;
    }

    const baseSequence = [...initialBlocks];
    movableKeys.forEach(key => baseSequence.push(...movableGroups[key]));
    baseSequence.push(...finalBlocks);

    // A Solução Base do Guloso já passou no NR lá atrás, então assumimos validade.
    const baseEval = evaluateSequenceFast(baseSequence, initialState, sysData);
    let bestSequence = baseSequence;
    let bestENS = baseEval.isValid ? baseEval.totalENS : Infinity;

    console.log(`[VNS] Custo da Solução Base (Gulosa): ${bestENS === Infinity ? 'INFACTÍVEL' : bestENS.toFixed(2) + ' kWh_eq'}`);

    let iteration = 0;
    
    for (let i = 0; i < movableKeys.length - 1; i++) {
        for (let j = i + 1; j < movableKeys.length; j++) {
            iteration++;
            
            const candidateKeys = [...movableKeys];
            const temp = candidateKeys[i];
            candidateKeys[i] = candidateKeys[j];
            candidateKeys[j] = temp;

            const candidateSequence = [...initialBlocks];
            candidateKeys.forEach(key => {
                candidateSequence.push(...movableGroups[key]);
            });
            candidateSequence.push(...finalBlocks);

            if (onProgress) onProgress(`VNS Testando Swap ${movableKeys[i]} <-> ${movableKeys[j]}...`);
            await yieldToMain(); 

            // 👇 1. FILTRO ULTRARRÁPIDO 👇
            const candidateEval = evaluateSequenceFast(candidateSequence, initialState, sysData);

            if (candidateEval.isValid) {
                const diff = bestENS - candidateEval.totalENS;
                
                // Apenas se o LDF achar que a ENS melhorou, nós acionamos a "Cavalaria"
                if (diff > 0.001) {
                    console.log(`🔍 Swap ${movableKeys[i]} <-> ${movableKeys[j]} reduziu ENS. Acionando NR para validação final...`);
                    
                    // 👇 2. CÃO DE GUARDA DO NR 👇
                    const nrValid = verifySequenceNR(candidateSequence, initialState, sysData);
                    
                    if (nrValid) {
                        console.log(`🌟 VNS MELHOROU A SOLUÇÃO! Swap: ${movableKeys[i]} <-> ${movableKeys[j]}`);
                        console.log(`📉 ENS caiu de ${bestENS.toFixed(2)} para ${candidateEval.totalENS.toFixed(2)}`);
                        
                        bestENS = candidateEval.totalENS;
                        bestSequence = candidateSequence;
                    } else {
                        console.log(`❌ Swap: ${movableKeys[i]} <-> ${movableKeys[j]} | Falso Positivo LDF (NR detectou violação)`);
                    }
                } else {
                    console.log(`❌ Swap: ${movableKeys[i]} <-> ${movableKeys[j]} | Válido fisicamente, mas ENS pior/igual: ${candidateEval.totalENS.toFixed(2)}`);
                }
            } else {
                console.log(`🚫 Swap: ${movableKeys[i]} <-> ${movableKeys[j]} | Infactível no Filtro Rápido (LDF)`);
            }
        }
    }
    // ========================================================================
    // 5. VIZINHANÇA N_3: SUBSTITUIÇÃO DE CHAVES DE ALÍVIO (Best-Accept Global)
    // ========================================================================
    if (onProgress) onProgress("VNS: Iniciando Vizinhança N3 (Substituição de Chaves de Alívio)...");

    let n3Iteration = 0;
    
    // Varre a melhor sequência atual em busca de chaves que têm "Post-its" (alternativas)
    for (let i = 0; i < bestSequence.length; i++) {
        const step = bestSequence[i];
        
        if (step.isLoadShedding && step.alternatives && step.alternatives.length > 0) {
            console.log(`\n========================================================`);
            console.log(`🔄 VNS N3: AVALIANDO ALTERNATIVAS PARA ABERTURA ${step.fromNode}-${step.toNode}`);
            console.log(`Alternativas mapeadas pelo Guloso: ${step.alternatives.length}`);
            console.log(`========================================================\n`);

            // Para cada chave que o guloso descartou, o VNS tenta reconstruir a história
            for (const altBranchId of step.alternatives) {
                n3Iteration++;
                
                // Busca os dados físicos da chave alternativa no snapshot original
                const altBranch = initialState.branches.find(b => b.id === altBranchId);
                if (!altBranch) continue;

                // Monta a nova linha do tempo, trocando APENAS a chave desta etapa
                const candidateSequence = [...bestSequence];
                candidateSequence[i] = {
                    ...step,
                    branchId: altBranch.id,
                    fromNode: altBranch.from,
                    toNode: altBranch.to,
                    description: `[Alívio Otimizado] Abertura da chave ${altBranch.from}-${altBranch.to}`,
                    alertMessage: `⚠️ Tomada de Carga Otimizada (VNS N3): A chave ${altBranch.from}-${altBranch.to} substituiu a abertura original.`
                };

                if (onProgress) onProgress(`VNS N3: Testando alternativa ${altBranch.from}-${altBranch.to}...`);
                await yieldToMain(); // Não trava a interface

                // 👇 1. FILTRO ULTRARRÁPIDO
                const candidateEval = evaluateSequenceFast(candidateSequence, initialState, sysData);

                if (candidateEval.isValid) {
                    const diff = bestENS - candidateEval.totalENS;
                    
                    if (diff > 0.001) {
                        console.log(`🔍 N3: Abertura alternativa ${altBranch.from}-${altBranch.to} reduziu ENS. Acionando Cão de Guarda (NR)...`);
                        
                        // 👇 2. CÃO DE GUARDA DO NR
                        const nrValid = verifySequenceNR(candidateSequence, initialState, sysData);
                        
                        if (nrValid) {
                            console.log(`🌟 VNS N3 ENCONTROU UM CAMINHO MELHOR! Substituiu ${step.fromNode}-${step.toNode} por ${altBranch.from}-${altBranch.to}`);
                            console.log(`📉 ENS caiu de ${bestENS.toFixed(2)} para ${candidateEval.totalENS.toFixed(2)}`);
                            
                            bestENS = candidateEval.totalENS;
                            bestSequence = candidateSequence; // Adota a nova sequência como a melhor atual
                            
                            // Em um Best-Improvement clássico, nós continuamos testando as outras alternativas
                            // para ver se alguma derruba a ENS *ainda mais*. O loop segue rodando!
                        } else {
                            console.log(`❌ N3 Alternativa ${altBranch.from}-${altBranch.to}: Falso Positivo LDF (NR barrou)`);
                        }
                    } else {
                        console.log(`❌ N3 Alternativa ${altBranch.from}-${altBranch.to}: Válida, mas ENS pior/igual (${candidateEval.totalENS.toFixed(2)})`);
                    }
                } else {
                    console.log(`🚫 N3 Alternativa ${altBranch.from}-${altBranch.to}: Infactível no Filtro Rápido (Sobrecarga ou Loop)`);
                }
            }
        }
    }

    if (onProgress) onProgress("Otimização VNS Concluída!");
    
    console.log("🏁 SEQUÊNCIA FINAL OTIMIZADA PELO VNS:");
    console.table(bestSequence.map(s => ({
        Ação: s.type,
        Chave: `${s.fromNode}-${s.toNode}`,
        Pacote: s.packageName || 'SOS',
        ENS_Relativa: s.ensImpact?.toFixed(2)
    })));

    return bestSequence; // Esta é a sequência que deve ser enviada para o State do React
}

// FIM DO ARQUIVO vnsOptimizer.js