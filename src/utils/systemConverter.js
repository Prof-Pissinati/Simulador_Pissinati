// ================================================================
// CONVERSOR: .dat parseado → systemData.js
// Transforma dados do parser em estrutura usada pelo simulador
// ================================================================

/**
 * Converte dados parseados em estrutura systemData
 * @param {Object} parsedData - Dados do datParser
 * @param {string} systemName - Nome do sistema
 * @returns {Object} Estrutura systemData completa
 */

const convertCapacitorsToShunts = (capacitors) => {
    if (!capacitors || capacitors.length === 0) return {};
    const shunts = {};
    capacitors.forEach(cap => {
        shunts[cap.node] = {
            maxSteps: cap.steps || 1,
            steps: cap.currentSteps || 1,
            stepSize: cap.qNominal || 0
        };
    });
    return shunts;
};

export function convertToSystemData(parsedData, systemName = "Sistema Importado") {
    // Valida dados antes de converter
    if (!parsedData.params || !parsedData.nodes || !parsedData.lines) {
        throw new Error('Dados parseados incompletos');
    }
    
    const systemData = {
        // --- METADADOS ---
        metadata: {
            name: systemName,
            sourceFile: systemName + '.dat',
            importDate: new Date().toISOString().split('T')[0],
            version: "1.0",
            isImported: true
        },
        
        // --- PARÂMETROS GLOBAIS ---
        Vbase: parsedData.params.Vbase,
        Sbase: parsedData.params.Sbase,
        Vmax: parsedData.params.Vmax || 1.05,
        Vmin: parsedData.params.Vmin || 0.90,
        
        // --- SUBESTAÇÕES ---
        // Filtra SEF das sources visíveis
        sources: parsedData.sources.filter(id => id !== parsedData.sef),
        sef: parsedData.sef,
        
        // --- BARRAS/LOADS ---
        loads: convertNodes(parsedData.nodes, parsedData.sef),
        
        // --- LINHAS/BRANCHES ---
        branches: convertBranches(parsedData.lines),
        
        // --- CAPACITORES (Futuramente) ---
        capacitors: parsedData.capacitors || [],
        
        // --- REGULADORES (Futuramente) ---
        regulators: parsedData.regulators || [],
        
        // --- SHUNTS (Capacitores) ---
        shunts: convertCapacitorsToShunts(parsedData.capacitors),

        // --- FALTAS INICIAIS ---
        initialFaults: parsedData.faults || [],
        
        // --- LAYOUT (será gerado depois) ---
        positions: null,
        positionsOrganic: null,
        positionsProject: null,
        waypoints: {},
        waypointsProject: {}
    };
    
    // Validação final
    if (systemData.sources.length === 0) {
        throw new Error('Nenhuma subestação válida encontrada (excluindo SEF)');
    }
    
    return systemData;
}

// ================================================================
// CONVERSÃO DE BARRAS
// ================================================================
/**
 * Converte array de nodes em objeto loads{}
 * @param {Array} nodes - Array de barras parseadas
 * @param {number} sefId - ID da barra SEF (será excluída)
 * @returns {Object} Objeto loads
 */
function convertNodes(nodes, sefId) {
    const loads = {};
    
    nodes.forEach(node => {
        // IMPORTANTE: SEF não entra nos loads (invisível no diagrama)
        if (node.id === sefId) {
            return;
        }
        
        loads[node.id] = {
            p: node.pd || 0,
            q: node.qd || 0,
            type: node.type || 0
        };
    });
    
    return loads;
}

// ================================================================
// CONVERSÃO DE LINHAS
// ================================================================
/**
 * Converte array de lines em array branches[]
 * @param {Array} lines - Array de linhas parseadas
 * @returns {Array} Array de branches
 */
function convertBranches(lines) {
    return lines.map((line, index) => {
        const branch = {
            from: line.from,
            to: line.to,
            r: line.r,
            x: line.x,
            imax: line.imax || 125,
            initialState: line.state !== undefined ? line.state : 1,
            state: line.state !== undefined ? line.state : 1,
            hasSwitch: true  // Confirmado: todas têm chaves
        };
        
        // Regulador (se existir)
        if (line.reg && line.reg > 0) {
            branch.hasRegulator = true;
            branch.regulatorTap = line.reg;
        } else {
            branch.hasRegulator = false;
            branch.regulatorTap = null;
        }
        
        return branch;
    });
}

// ================================================================
// DETECÇÃO AUTOMÁTICA DE SUBESTAÇÕES
// ================================================================
/**
 * Detecta subestações automaticamente quando set S não existe
 * Critério: Pd=0, Qd=0, Type=1, e não é SEF
 * @param {Object} parsedData - Dados parseados
 * @returns {Array} IDs das subestações detectadas
 */
export function autoDetectSources(parsedData) {
    if (!parsedData.nodes) return [];
    
    const detected = parsedData.nodes
        .filter(node => 
            node.pd === 0 && 
            node.qd === 0 && 
            node.type === 1 && 
            node.id !== parsedData.sef
        )
        .map(node => node.id);
    
    return detected;
}

// ================================================================
// VALIDAÇÃO DO SISTEMA CONVERTIDO
// ================================================================
/**
 * Valida systemData convertido
 * @param {Object} systemData - Dados convertidos
 * @returns {Object} Resultado da validação
 */
export function validateSystemData(systemData) {
    const errors = [];
    const warnings = [];
    
    // Validações obrigatórias
    if (!systemData.Vbase || systemData.Vbase <= 0) {
        errors.push('Vbase inválido');
    }
    if (!systemData.Sbase || systemData.Sbase <= 0) {
        errors.push('Sbase inválido');
    }
    if (!systemData.sources || systemData.sources.length === 0) {
        errors.push('Nenhuma subestação válida');
    }
    if (!systemData.loads || Object.keys(systemData.loads).length === 0) {
        errors.push('Nenhuma barra encontrada');
    }
    if (!systemData.branches || systemData.branches.length === 0) {
        errors.push('Nenhuma linha encontrada');
    }
    
    // Validações de consistência
    const nodeIds = new Set([
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ]);
    
    systemData.branches.forEach((branch, index) => {
        if (!nodeIds.has(branch.from)) {
            errors.push(`Linha ${index}: barra origem ${branch.from} não existe`);
        }
        if (!nodeIds.has(branch.to)) {
            errors.push(`Linha ${index}: barra destino ${branch.to} não existe`);
        }
        if (branch.r < 0 || branch.x < 0) {
            warnings.push(`Linha ${index}: R ou X negativo`);
        }
        if (branch.imax <= 0) {
            warnings.push(`Linha ${index}: Imax inválido`);
        }
    });
    
    // Validações de faltas
    if (systemData.initialFaults) {
        systemData.initialFaults.forEach(faultId => {
            if (!nodeIds.has(faultId)) {
                warnings.push(`Falta inicial em barra ${faultId} não existe`);
            }
        });
    }
    
    // Estatísticas
    const totalP = Object.values(systemData.loads).reduce((sum, load) => sum + load.p, 0);
    const totalQ = Object.values(systemData.loads).reduce((sum, load) => sum + load.q, 0);
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            totalNodes: nodeIds.size,
            totalLines: systemData.branches.length,
            totalSources: systemData.sources.length,
            totalP: totalP.toFixed(0) + ' kW',
            totalQ: totalQ.toFixed(0) + ' kVAr',
            loadNodes: Object.keys(systemData.loads).length,
            closedLines: systemData.branches.filter(b => b.state === 1).length,
            openLines: systemData.branches.filter(b => b.state === 0).length
        }
    };
}

// ================================================================
// MERGE COM LAYOUT EXISTENTE
// ================================================================
/**
 * Mescla systemData com layout salvo anteriormente
 * @param {Object} systemData - Sistema convertido
 * @param {Object} savedLayout - Layout salvo (JSON)
 * @returns {Object} SystemData com layout aplicado
 */
export function mergeWithSavedLayout(systemData, savedLayout) {
    if (!savedLayout) return systemData;
    
    // Valida compatibilidade
    const systemNodes = new Set([
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ]);
    
    const layoutNodes = new Set(Object.keys(savedLayout.positions || {}).map(id => parseInt(id)));
    
    // Verifica se há diferenças significativas
    const missing = [...systemNodes].filter(id => !layoutNodes.has(id));
    const extra = [...layoutNodes].filter(id => !systemNodes.has(id));
    
    if (missing.length > 0 || extra.length > 0) {
        console.warn('Layout não é 100% compatível:', { missing, extra });
    }
    
    // Aplica layout onde houver match
    if (savedLayout.positions) {
        systemData.positionsProject = {};
        Object.keys(savedLayout.positions).forEach(nodeId => {
            const id = parseInt(nodeId);
            if (systemNodes.has(id)) {
                systemData.positionsProject[id] = savedLayout.positions[nodeId];
            }
        });
    }
    
    if (savedLayout.waypoints) {
        systemData.waypointsProject = savedLayout.waypoints;
    }
    
    return systemData;
}

// ================================================================
// ESTATÍSTICAS DO SISTEMA
// ================================================================
/**
 * Gera estatísticas detalhadas do sistema
 * @param {Object} systemData - Sistema convertido
 * @returns {Object} Estatísticas
 */
export function generateSystemStats(systemData) {
    const nodeIds = new Set([
        ...systemData.sources,
        ...Object.keys(systemData.loads).map(id => parseInt(id))
    ]);
    
    const totalP = Object.values(systemData.loads).reduce((sum, load) => sum + load.p, 0);
    const totalQ = Object.values(systemData.loads).reduce((sum, load) => sum + load.q, 0);
    const totalS = Math.sqrt(totalP * totalP + totalQ * totalQ);
    
    const linesWithRegulators = systemData.branches.filter(b => b.hasRegulator).length;
    const capacitorsCount = systemData.capacitors ? systemData.capacitors.length : 0;
    
    return {
        system: {
            name: systemData.metadata.name,
            vbase: systemData.Vbase + ' kV',
            sbase: systemData.Sbase + ' kVA'
        },
        topology: {
            totalNodes: nodeIds.size,
            sources: systemData.sources.length,
            loadNodes: Object.keys(systemData.loads).length,
            sef: systemData.sef,
            totalLines: systemData.branches.length,
            closedLines: systemData.branches.filter(b => b.state === 1).length,
            openLines: systemData.branches.filter(b => b.state === 0).length
        },
        power: {
            totalP: totalP.toFixed(2) + ' kW',
            totalQ: totalQ.toFixed(2) + ' kVAr',
            totalS: totalS.toFixed(2) + ' kVA',
            powerFactor: (totalP / totalS).toFixed(3)
        },
        equipment: {
            regulators: linesWithRegulators,
            capacitors: capacitorsCount
        },
        faults: {
            initial: systemData.initialFaults ? systemData.initialFaults.length : 0,
            nodes: systemData.initialFaults || []
        }
    };
}

// ================================================================
// EXPORTAÇÃO PARA JSON
// ================================================================
/**
 * Prepara systemData para exportação JSON
 * Remove dados desnecessários para o arquivo
 * @param {Object} systemData - Sistema completo
 * @returns {Object} Dados limpos para export
 */
export function prepareForExport(systemData) {
    return {
        metadata: systemData.metadata,
        params: {
            Vbase: systemData.Vbase,
            Sbase: systemData.Sbase,
            Vmax: systemData.Vmax,
            Vmin: systemData.Vmin
        },
        sources: systemData.sources,
        sef: systemData.sef,
        loads: systemData.loads,
        branches: systemData.branches.map(b => ({
            from: b.from,
            to: b.to,
            r: b.r,
            x: b.x,
            imax: b.imax,
            initialState: b.initialState,
            hasSwitch: b.hasSwitch,
            hasRegulator: b.hasRegulator,
            regulatorTap: b.regulatorTap
        })),
        initialFaults: systemData.initialFaults,
        // Layout atual (se houver)
        positions: systemData.positionsProject || systemData.positions,
        waypoints: systemData.waypointsProject || systemData.waypoints
    };
}
