import { calculateForceLayout, calculateOrthogonalLayout, calculateVNSLayout } from './autoLayout';

// =========================================================
// TRAVA DO PONTO CENTRAL
// Impede que o sistema se movimente para longe da tela
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

    // 3. Descobre a diferença de deslocamento
    const deltaX = center_old_x - center_new_x;
    const deltaY = center_old_y - center_new_y;

    if (isNaN(deltaX) || isNaN(deltaY)) return calculatedPos;

    // 4. Empurra todas as barras geradas de volta para o eixo original
    const lockedPos = {};
    nodesArray.forEach(id => {
        if (calculatedPos[id]) {
            lockedPos[id] = {
                x: calculatedPos[id].x + deltaX,
                y: calculatedPos[id].y + deltaY
            };
        }
    });

    return lockedPos;
}

// =========================================================
// COMUNICAÇÃO COM O REACT
// =========================================================
self.onmessage = async (e) => {
    // 1. Recebe a "encomenda" de trabalho do React
    const { type, nodesArray, branchesArray, sourcesArray, config, jobId } = e.data;

    // 2. Intercepta relatórios de progresso
    if (config && config.reportProgress) {
        config.onProgress = (passes, msg1, msg2) => {
            self.postMessage({ type: 'progress', jobId, passes, msg1, msg2 });
        };
    }

    try {
        let result;
        // 3. Executa APENAS os 3 motores oficiais
        if (type === 'force') {
            result = calculateForceLayout(nodesArray, branchesArray, sourcesArray, config);
        } else if (type === 'vns') {
            result = await calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config);
        } else if (type === 'orthogonal') {
            result = await calculateOrthogonalLayout(nodesArray, branchesArray, sourcesArray, config);
        }
        
        // 👇 A MÁGICA ACONTECE AQUI 👇
        // Se temos a posição atual da tela (config.currentPos), aplicamos a trava!
        if (config && config.currentPos) {
            result = lockLayoutCenter(config.currentPos, result, nodesArray);
        }
        
        // 4. Devolve o mapa pronto (e centralizado) para o React
        self.postMessage({ type: 'success', jobId, result });
    } catch (error) {
        self.postMessage({ type: 'error', jobId, error: error.message });
    }
};