import { calculateForceLayout, calculateOrthogonalLayout, calculateVNSLayout, calculateHierarchicalLayout, classifyTopology, contractTopology, expandTopology, applySmartCompaction, findIntersections } from './autoLayout';

// =========================================================
// TRAVA DO PONTO CENTRAL
// Impede que o sistema se movimente para longe da tela,
// mas RESPEITA rigorosamente a malha absoluta de 10px!
// =========================================================
function lockLayoutCenter(initialPos, calculatedPos, nodesArray) {
    if (!initialPos || Object.keys(initialPos).length === 0) return calculatedPos;

    // 1. Acha o Ponto Central atual (antes do algoritmo)
    let minX_old = Infinity, maxX_old = -Infinity, minY_old = Infinity, maxY_old = -Infinity;
    let minX_new = Infinity, maxX_new = -Infinity, minY_new = Infinity, maxY_new = -Infinity;

    nodesArray.forEach(id => {
        // Limites Antigos
        const pOld = initialPos[id];
        if (pOld) {
            if (pOld.x < minX_old) minX_old = pOld.x; if (pOld.x > maxX_old) maxX_old = pOld.x;
            if (pOld.y < minY_old) minY_old = pOld.y; if (pOld.y > maxY_old) maxY_old = pOld.y;
        }
        // Limites Novos
        const pNew = calculatedPos[id];
        if (pNew) {
            if (pNew.x < minX_new) minX_new = pNew.x; if (pNew.x > maxX_new) maxX_new = pNew.x;
            if (pNew.y < minY_new) minY_new = pNew.y; if (pNew.y > maxY_new) maxY_new = pNew.y;
        }
    });

    // 2. Calcula os dois centros
    const center_old_x = minX_old + (maxX_old - minX_old) / 2;
    const center_old_y = minY_old + (maxY_old - minY_old) / 2;
    
    const center_new_x = minX_new + (maxX_new - minX_new) / 2;
    const center_new_y = minY_new + (maxY_new - minY_new) / 2;

    // 3. Descobre a diferença de deslocamento bruto
    const deltaX = center_old_x - center_new_x;
    const deltaY = center_old_y - center_new_y;

    if (isNaN(deltaX) || isNaN(deltaY)) return calculatedPos;

    // 👇 A MÁGICA AQUI: Arredonda o "empurrão" para o grid de 10px da interface
    const FIXED_GRID = 10;
    const snappedDeltaX = Math.round(deltaX / FIXED_GRID) * FIXED_GRID;
    const snappedDeltaY = Math.round(deltaY / FIXED_GRID) * FIXED_GRID;

    // 4. Empurra todas as barras mantendo o alinhamento perfeito
    const lockedPos = {};
    nodesArray.forEach(id => {
        if (calculatedPos[id]) {
            lockedPos[id] = {
                x: calculatedPos[id].x + snappedDeltaX,
                y: calculatedPos[id].y + snappedDeltaY
            };
        }
    });

    return lockedPos;
}

// =========================================================
// COMUNICAÇÃO COM O REACT
// =========================================================
self.onmessage = async (e) => {
    const { type, nodesArray, branchesArray, sourcesArray, config, jobId } = e.data;

    if (config && config.reportProgress) {
        config.onProgress = (passes, msg1, msg2) => {
            self.postMessage({ type: 'progress', jobId, passes, msg1, msg2 });
        };
    }

    try {
        let result;
        let actualType = type;

        // 👇 FASE 3: MAPA DE ALIMENTADORES (BFS) 👇
        const feederMap = {};
        if (config && config.feeders) {
            const queue = [...config.feeders];
            config.feeders.forEach(f => feederMap[f] = String(f));
            
            // Cria lista de adjacência rápida apenas com chaves fechadas
            const adj = {};
            branchesArray.forEach(b => {
                if (b.state === 1) {
                    if (!adj[b.from]) adj[b.from] = [];
                    if (!adj[b.to]) adj[b.to] = [];
                    adj[b.from].push(b.to);
                    adj[b.to].push(b.from);
                }
            });

            let head = 0;
            while (head < queue.length) {
                const currId = queue[head++];
                const myFeeder = feederMap[currId];
                if (adj[currId]) {
                    adj[currId].forEach(nxt => {
                        if (!feederMap[nxt] && !sourcesArray.includes(nxt)) {
                            feederMap[nxt] = myFeeder;
                            queue.push(nxt);
                        }
                    });
                }
            }
        }
        config.feederMap = feederMap; // Injeta no config para os motores usarem!
        // 👆 FIM DA FASE 3 👆

        // 👇 FASE 1: O CÉREBRO ENTRA EM AÇÃO 👇
        if (type === 'auto') {
            const analysis = classifyTopology(nodesArray, branchesArray, config);
            
            // 👇 CORREÇÃO: Lendo a variável com o nome exato que vem da análise 👇
            actualType = analysis.recommendedEngine; 
            
            console.log('🧠 [AUTO-LAYOUT] Análise Topológica:', analysis);
            
            if (config && config.reportProgress) {
                config.onProgress(0, `Topologia: ${analysis.type}`, `Motor: ${actualType}`);
            }
        }

        // ==========================================
        // GRAPH COARSENING (Topologia Híbrida 2.0)
        // ==========================================
        let targetNodes = nodesArray;
        let targetBranches = branchesArray;
        let coarseData = null;
        let isCoarsened = false;

        // 👇 Correção do Erro: Agora amassa se for automático OU se o usuário pediu a depuração visual
        const forceCoarsen = config && config.visualizeCoarsened;
        // VNS/VND opera no grafo completo — não usa coarsening
        const autoCoarsen = nodesArray.length > 150 && actualType !== 'force' && actualType !== 'vns' && actualType !== 'hierarchical';

        if (autoCoarsen || forceCoarsen) {
            try {
                if (config && config.reportProgress) config.onProgress(1, "Otimização", "Compactando topologia...");
                const coarsened = contractTopology(nodesArray, branchesArray, sourcesArray);
                targetNodes = coarsened.coarseNodesArray;
                targetBranches = coarsened.coarseBranchesArray;
                coarseData = coarsened.coarseData;
                isCoarsened = true;
            } catch (err) { console.warn("⚠️ Falha na compactação.", err); }
        }

        // 👇 PEDÁGIO 1: ANTES DO MOTOR (Congelado nas posições originais)
        if (config && config.visualizeCoarsened && config.debugPhase === 'before' && isCoarsened) {
            const originalPos = config.currentPos || {};
            const debugPositions = {};
            targetNodes.forEach(id => { debugPositions[id] = originalPos[id] || {x: 0, y: 0}; });

            self.postMessage({ type: 'success', jobId, result: debugPositions, macroData: { nodes: targetNodes, branches: targetBranches, contractionMap: coarseData } });
            return; // 🛑 Para aqui!
        }

        // ==========================================
        // EXECUÇÃO DOS MOTORES
        // ==========================================
        if (actualType === 'force') {
            result = calculateForceLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'vns') {
            result = await calculateVNSLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'orthogonal') {
            result = await calculateOrthogonalLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'hierarchical') {
            // 👇 O AWAIT ESTAVA FALTANDO EXATAMENTE AQUI 👇
            result = await calculateHierarchicalLayout(targetNodes, targetBranches, sourcesArray, config);
        } else { 
            throw new Error(`Motor não reconhecido: ${actualType}`); 
        }

        // 👇 PEDÁGIO 2: DEPOIS DO MOTOR (Esqueleto organizado)
        if (config && config.visualizeCoarsened && config.debugPhase === 'after' && isCoarsened) {
            self.postMessage({ type: 'success', jobId, result: result, macroData: { nodes: targetNodes, branches: targetBranches, contractionMap: coarseData } });
            return; // 🛑 Para aqui, antes de expandir!
        }

        // ==========================================
        // EXPANSÃO DUPLA (Restaurando geometria)
        // ==========================================
        if (isCoarsened && coarseData) {
            if (config && config.reportProgress) config.onProgress(30, "Finalizando", "Desdobrando topologia...");
            result = expandTopology(result, coarseData, config.currentPos || {});
        }

        // 4. Trava o Ponto Central (Usando a lista de nós ORIGINAL)
        if (config && config.currentPos) {
            result = lockLayoutCenter(config.currentPos, result, nodesArray);
        }
        
        // 5. Devolve o mapa pronto
        self.postMessage({ type: 'success', jobId, result });
    } catch (error) {
        self.postMessage({ type: 'error', jobId, error: error.message });
    }
};