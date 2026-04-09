// ================================================================
// PARSER DE ARQUIVOS .DAT (AMPL)
// Converte arquivo de texto .dat em estrutura JavaScript
// ================================================================

/**
 * Função principal: Parse completo de arquivo .dat
 * @param {string} fileContent - Conteúdo do arquivo .dat
 * @returns {Object} Dados estruturados
 */
export function parseDatFile(fileContent) {
    try {
        return {
            params: parseGlobalParams(fileContent),
            nodes: parseNodesTable(fileContent),
            lines: parseLinesTable(fileContent),
            sources: parseSourcesSet(fileContent),
            faults: parseFaultsSet(fileContent),
            sef: parseSEF(fileContent),
            capacitors: parseCapacitorsTable(fileContent),
            regulators: parseRegulatorsTable(fileContent)
        };
    } catch (error) {
        throw new Error(`Erro ao fazer parse do arquivo .dat: ${error.message}`);
    }
}

// ================================================================
// PARSE DE PARÂMETROS GLOBAIS
// ================================================================
/**
 * Extrai parâmetros globais do tipo: param vb := 12.66;
 */
function parseGlobalParams(content) {
    const params = {};
    
    // Regex para capturar: param NAME := VALUE;
    const paramRegex = /param\s+(\w+)\s*:=\s*([\d.]+)\s*;/g;
    
    let match;
    while ((match = paramRegex.exec(content)) !== null) {
        const [, name, value] = match;
        params[name] = parseFloat(value);
    }
    
    // Parâmetros obrigatórios
    const required = ['Vbase', 'Sbase'];
    required.forEach(param => {
        if (params[param] === undefined) {
            throw new Error(`Parâmetro obrigatório "${param}" não encontrado`);
        }
    });
    
    // Valores padrão para opcionais
    if (!params.Vmax) params.Vmax = 1.05;
    if (!params.Vmin) params.Vmin = 0.90;
    
    return params;
}

// ================================================================
// PARSE DE TABELA DE BARRAS (N)
// ================================================================
/**
 * Extrai tabela de barras: param: N: Pd Qd Type ...
 */
function parseNodesTable(content) {
    const nodes = [];
    
    // Localiza bloco da tabela N
    const tableRegex = /param:\s*N:\s*([\w\s]+):=\s*([\s\S]+?);/;
    const match = content.match(tableRegex);
    
    if (!match) {
        throw new Error('Tabela de barras (param: N:) não encontrada');
    }
    
    const [, headers, data] = match;
    
    // Parse dos headers (colunas)
    const cols = headers.trim().split(/\s+/);
    const pdIndex = cols.indexOf('Pd');
    const qdIndex = cols.indexOf('Qd');
    const typeIndex = cols.indexOf('Type');
    
    if (pdIndex === -1 || qdIndex === -1) {
        throw new Error('Colunas Pd e Qd não encontradas na tabela N');
    }
    
    // Parse das linhas de dados
    const lines = data.trim().split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });
    
    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) return; // Ignora linhas incompletas
        
        const id = parseInt(parts[0]);
        if (isNaN(id)) return;
        
        nodes.push({
            id: id,
            pd: parseFloat(parts[pdIndex + 1]) || 0,
            qd: parseFloat(parts[qdIndex + 1]) || 0,
            type: typeIndex !== -1 ? parseInt(parts[typeIndex + 1]) : 0
        });
    });
    
    if (nodes.length === 0) {
        throw new Error('Nenhuma barra válida encontrada na tabela N');
    }
    
    return nodes;
}

// ================================================================
// PARSE DE TABELA DE LINHAS (L)
// ================================================================
/**
 * Extrai tabela de linhas: param: L: R X Imax reg State
 */
function parseLinesTable(content) {
    const lines = [];
    
    // Localiza bloco da tabela L
    const tableRegex = /param:\s*L:\s*([\w\s]+):=\s*([\s\S]+?);/;
    const match = content.match(tableRegex);
    
    if (!match) {
        throw new Error('Tabela de linhas (param: L:) não encontrada');
    }
    
    const [, headers, data] = match;
    
    // Parse dos headers
    const cols = headers.trim().split(/\s+/);
    const rIndex = cols.indexOf('R');
    const xIndex = cols.indexOf('X');
    const imaxIndex = cols.indexOf('Imax');
    const regIndex = cols.indexOf('reg');
    const stateIndex = cols.indexOf('State');
    
    if (rIndex === -1 || xIndex === -1) {
        throw new Error('Colunas R e X não encontradas na tabela L');
    }
    
    // Parse das linhas de dados
    const dataLines = data.trim().split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });
    
    dataLines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) return; // Ignora linhas incompletas
        
        const from = parseInt(parts[0]);
        const to = parseInt(parts[1]);
        
        if (isNaN(from) || isNaN(to)) return;
        
        lines.push({
            from: from,
            to: to,
            r: parseFloat(parts[rIndex + 2]) || 0,
            x: parseFloat(parts[xIndex + 2]) || 0,
            imax: parseFloat(parts[imaxIndex + 2]) || 125,
            reg: regIndex !== -1 ? parseFloat(parts[regIndex + 2]) : 0,
            state: stateIndex !== -1 ? parseInt(parts[stateIndex + 2]) : 1
        });
    });
    
    if (lines.length === 0) {
        throw new Error('Nenhuma linha válida encontrada na tabela L');
    }
    
    return lines;
}

// ================================================================
// PARSE DE CONJUNTO DE SUBESTAÇÕES (S)
// ================================================================
/**
 * Extrai subestações: set S := 200 1;
 */
function parseSourcesSet(content) {
    const setRegex = /set\s+S\s*:=\s*([\d\s]+);/;
    const match = content.match(setRegex);
    
    if (!match) {
        // Se não encontrar set S, tenta detectar por Pd=0 e Qd=0
        console.warn('set S não encontrado, detectando subestações por Pd=0 e Qd=0');
        return [];
    }
    
    const ids = match[1].trim().split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));
    
    if (ids.length === 0) {
        throw new Error('Nenhuma subestação encontrada em set S');
    }
    
    return ids;
}

// ================================================================
// PARSE DE FALTAS (BF)
// ================================================================
/**
 * Extrai faltas: set BF := 36 47;
 */
function parseFaultsSet(content) {
    const setRegex = /set\s+BF\s*:=\s*([\d\s]+);/;
    const match = content.match(setRegex);
    
    if (!match) {
        return []; // Sem faltas é válido
    }
    
    const ids = match[1].trim().split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));
    return ids;
}

// ================================================================
// PARSE DE SEF (Barra de Desenergizados)
// ================================================================
/**
 * Extrai SEF: param SEF := 200;
 */
function parseSEF(content) {
    const paramRegex = /param\s+SEF\s*:=\s*(\d+)\s*;/;
    const match = content.match(paramRegex);
    
    if (!match) {
        console.warn('param SEF não encontrado, usando 200 como padrão');
        return 200;
    }
    
    return parseInt(match[1]);
}

// ================================================================
// PARSE DE CAPACITORES (Opcional)
// ================================================================
/**
 * Extrai capacitores: param: CAP: Node Qnom Steps ...
 */
function parseCapacitorsTable(content) {
    const capacitors = [];
    
    // Localiza bloco da tabela CAP
    const tableRegex = /param:\s*CAP:\s*([\w\s]+):=\s*([\s\S]+?);/;
    const match = content.match(tableRegex);
    
    if (!match) {
        return []; // Capacitores são opcionais
    }
    
    const [, headers, data] = match;
    
    // Parse dos headers
    const cols = headers.trim().split(/\s+/);
    const nodeIndex = cols.indexOf('Node');
    const qnomIndex = cols.indexOf('Qnom');
    const stepsIndex = cols.indexOf('Steps');
    const currentStepsIndex = cols.indexOf('Current_Steps');
    const switchableIndex = cols.indexOf('Switchable');
    
    // Parse das linhas
    const lines = data.trim().split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });
    
    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return;
        
        const id = parseInt(parts[0]);
        if (isNaN(id)) return;
        
        const qnom = parseFloat(parts[qnomIndex + 1]) || 0;
        const steps = parseInt(parts[stepsIndex + 1]) || 1;
        const currentSteps = parseInt(parts[currentStepsIndex + 1]) || 0;
        
        capacitors.push({
            id: id,
            node: parseInt(parts[nodeIndex + 1]),
            qNominal: qnom,
            steps: steps,
            currentSteps: currentSteps,
            switchable: switchableIndex !== -1 ? parseInt(parts[switchableIndex + 1]) === 1 : true,
            qTotal: qnom * currentSteps
        });
    });
    
    return capacitors;
}

// ================================================================
// PARSE DE REGULADORES (Opcional)
// ================================================================
/**
 * Extrai reguladores: param: REG: Line_ID Tap_Min Tap_Max ...
 */
function parseRegulatorsTable(content) {
    const regulators = [];
    
    // Localiza bloco da tabela REG
    const tableRegex = /param:\s*REG:\s*([\w\s]+):=\s*([\s\S]+?);/;
    const match = content.match(tableRegex);
    
    if (!match) {
        return []; // Reguladores são opcionais
    }
    
    const [, headers, data] = match;
    
    // Parse dos headers
    const cols = headers.trim().split(/\s+/);
    const lineIdIndex = cols.indexOf('Line_ID');
    const tapMinIndex = cols.indexOf('Tap_Min');
    const tapMaxIndex = cols.indexOf('Tap_Max');
    const tapStepIndex = cols.indexOf('Tap_Step');
    const currentTapIndex = cols.indexOf('Current_Tap');
    const controllableIndex = cols.indexOf('Controllable');
    
    // Parse das linhas
    const lines = data.trim().split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });
    
    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return;
        
        const id = parseInt(parts[0]);
        if (isNaN(id)) return;
        
        regulators.push({
            id: id,
            lineId: parts[lineIdIndex + 1],
            tapMin: parseFloat(parts[tapMinIndex + 1]) || 0.9,
            tapMax: parseFloat(parts[tapMaxIndex + 1]) || 1.1,
            tapStep: parseFloat(parts[tapStepIndex + 1]) || 0.0125,
            currentTap: parseFloat(parts[currentTapIndex + 1]) || 1.0,
            controllable: controllableIndex !== -1 ? parseInt(parts[controllableIndex + 1]) === 1 : true
        });
    });
    
    return regulators;
}

// ================================================================
// VALIDAÇÃO DOS DADOS PARSEADOS
// ================================================================
/**
 * Valida se os dados parseados são consistentes
 */
export function validateParsedData(parsedData) {
    const errors = [];
    const warnings = [];
    
    // Validações obrigatórias
    if (!parsedData.params.Vbase) errors.push('Vbase não encontrado');
    if (!parsedData.params.Sbase) errors.push('Sbase não encontrado');
    if (!parsedData.nodes || parsedData.nodes.length === 0) errors.push('Nenhuma barra encontrada');
    if (!parsedData.lines || parsedData.lines.length === 0) errors.push('Nenhuma linha encontrada');
    
    // Validações de consistência
    const nodeIds = new Set(parsedData.nodes.map(n => n.id));
    
    parsedData.lines.forEach((line, index) => {
        if (!nodeIds.has(line.from)) {
            errors.push(`Linha ${index}: barra origem ${line.from} não existe`);
        }
        if (!nodeIds.has(line.to)) {
            errors.push(`Linha ${index}: barra destino ${line.to} não existe`);
        }
    });
    
    // Validações de subestações
    if (parsedData.sources.length === 0) {
        warnings.push('Nenhuma subestação explícita (set S), tentando detectar automaticamente');
        
        // Detecta subestações por Pd=0, Qd=0, Type=1
        const detectedSources = parsedData.nodes
            .filter(n => n.pd === 0 && n.qd === 0 && n.type === 1 && n.id !== parsedData.sef)
            .map(n => n.id);
        
        if (detectedSources.length === 0) {
            errors.push('Nenhuma subestação detectada (Pd=0, Qd=0, Type=1)');
        } else {
            parsedData.sources = detectedSources;
            warnings.push(`Detectadas ${detectedSources.length} subestações: ${detectedSources.join(', ')}`);
        }
    }
    
    // Validações de faltas
    parsedData.faults.forEach(faultId => {
        if (!nodeIds.has(faultId)) {
            warnings.push(`Falta em barra ${faultId} não existe no sistema`);
        }
    });
    
    // Warnings para dados opcionais
    if (parsedData.capacitors.length === 0) {
        warnings.push('Nenhum capacitor encontrado (opcional)');
    }
    if (parsedData.regulators.length === 0) {
        warnings.push('Nenhum regulador encontrado (opcional)');
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ================================================================
// HELPER: Gera resumo dos dados parseados
// ================================================================
export function generateParseReport(parsedData) {
    const validation = validateParsedData(parsedData);
    
    return {
        summary: {
            nodes: parsedData.nodes.length,
            lines: parsedData.lines.length,
            sources: parsedData.sources.length,
            faults: parsedData.faults.length,
            capacitors: parsedData.capacitors.length,
            regulators: parsedData.regulators.length,
            sef: parsedData.sef
        },
        validation
    };
}
