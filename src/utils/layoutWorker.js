import { calculateForceLayout, calculateOrthogonalLayout, calculateVNSLayout } from './autoLayout';

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
        
        // 4. Devolve o mapa pronto para o React
        self.postMessage({ type: 'success', jobId, result });
    } catch (error) {
        self.postMessage({ type: 'error', jobId, error: error.message });
    }
};