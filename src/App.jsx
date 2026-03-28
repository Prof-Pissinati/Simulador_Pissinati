import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SYSTEM_DATA } from './data/systemData';
import { propagateFeeds, calculateLoads, runPowerFlow, CacheManager } from './utils/powerCalculations';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import GraphArea from './components/GraphArea';
import EditSidebar from './components/EditSidebar'; 
import { exportSVG } from './utils/exportUtils';
import './index.css';
import { parseAMPLDat } from './utils/amplParser';
import { calculateForceLayout } from './utils/autoLayout';

const SOURCE_COLORS = { 101: '#2e7d32', 102: '#e65100', 104: '#7b1fa2', 1: '#2962ff' };

const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 128, g: 128, b: 128 };
};

// Adicione esta função logo abaixo da const hexToRgb
const getSafeHue = (id) => {
    let h = (id * 137) % 360;
    // Se a cor cair no vermelho/laranja escuro (0-25 ou 335-360), joga para o Azul/Verde
    if (h < 25 || h > 335) h = (h + 45) % 360; 
    return h;
};

function App() {
    const [activeSources, setActiveSources] = useState([101, 102, 104]);
    const [darkMode, setDarkMode] = useState(false); 
    const [branches, setBranches] = useState(() => SYSTEM_DATA.branches.map((b, idx) => ({ 
        ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
    })));
    
    const [faultNodes, setFaultNodes] = useState(new Set());
    const [selectedElement, setSelectedElement] = useState(null);
    const [showLabels, setShowLabels] = useState(false);
    const [showLegend, setShowLegend] = useState(true); 
    const [toast, setToast] = useState(null);
    const [calcMethod, setCalcMethod] = useState('NR'); 
    const [isEditMode, setIsEditMode] = useState(false);

    const [layoutHistory, setLayoutHistory] = useState([]); 
    const [initialLayout, setInitialLayout] = useState({ positions: SYSTEM_DATA.positionsProject || {}, waypoints: SYSTEM_DATA.waypointsProject || {} });
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    // 1. NOVAS MEMÓRIAS DE PROJETO
    const [projectPositions, setProjectPositions] = useState(SYSTEM_DATA.positionsProject || {});
    const [projectWaypoints, setProjectWaypoints] = useState(SYSTEM_DATA.waypointsProject || {});

    // 2. SUBSTITUA AS DUAS LINHAS de activePositions E activeWaypoints POR ESTAS:
    const activePositions = useMemo(() => layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions), [layoutMode, projectPositions, organicPositions]);
    const activeWaypoints = useMemo(() => layoutMode === 'project' ? projectWaypoints : {}, [layoutMode, projectWaypoints]);
    
    // CORREÇÃO: Voltamos com o 'none' para representar o MODO TELA CHEIA INFINITA
    const [printFrameMode, setPrintFrameMode] = useState('none'); 
    const [showShortcuts, setShowShortcuts] = useState(false);

    const [sidebarMode, setSidebarMode] = useState('full');
    const [isFaultSidebarOpen, setFaultSidebarOpen] = useState(true);
    const [hoveredLineId, setHoveredLineId] = useState(null);
    const [hoveredNodeId, setHoveredNodeId] = useState(null);
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    // --- ESTADOS DA TELA INICIAL ---
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const welcomeFileInputRef = useRef(null);
    const datFileInputRef = useRef(null);
    const allNodes = Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b);
    const sources = activeSources;
    const loadNodes = allNodes.filter(n => !sources.includes(n));

    useEffect(() => {
        if (layoutMode === 'organic' && !organicPositions && allNodes.length > 0) {
            // Roda o motor físico atualizado com os parâmetros padrão
            const newLayout = calculateForceLayout(allNodes, branches, sources, { distance: 80, charge: -400 });
            setOrganicPositions(newLayout);
        }
    }, [layoutMode, organicPositions, allNodes, branches, sources]);

    // Limpa o layout orgânico salvo sempre que importar um arquivo NOVO
    useEffect(() => {
        setOrganicPositions(null);
        setLayoutMode('project');
    }, [allNodes.length]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (darkMode) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    }, [darkMode]);

    const handleUndoLayout = useCallback(() => {
        if (layoutHistory.length === 0) return;
        const lastState = layoutHistory[layoutHistory.length - 1];
        window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: lastState }));
        setLayoutHistory(prev => prev.slice(0, -1));
    }, [layoutHistory]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();

            // --- NOVA REGRA: FECHAR ATALHOS COM ESC ---
            if (e.key === 'Escape') {setShowShortcuts(false); return;}
            if (key === 'p' && !e.ctrlKey) setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'));
            if (key === 'd') setDarkMode(prev => !prev);
            if (key === 'l') setShowLabels(prev => !prev);
            if (key === 'm') setCalcMethod(prev => prev === 'NR' ? 'GS' : 'NR');
            if (key === 'r') resetSystem();
            if (key === 'e') setIsEditMode(prev => !prev);
            if (key === 'z' && !e.ctrlKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }
            if (key === 'z' && e.ctrlKey) { e.preventDefault(); handleUndoLayout(); }
            if (key === 'h') setShowShortcuts(true);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleUndoLayout]);

    const saveLayoutToHistory = useCallback((positions, waypoints) => {
        const currentState = JSON.parse(JSON.stringify({ positions: positions, waypoints: waypoints }));
        setLayoutHistory(prev => [...prev, currentState].slice(-20)); 
    }, []);

    const handleResetToOriginalLayout = useCallback(() => {
        if (window.confirm("🚨 Tem certeza que deseja resetar o layout para o padrão do arquivo? Todas as alterações não salvas serão perdidas.")) {
            window.dispatchEvent(new CustomEvent('resetGraphLayout'));
            setLayoutHistory([]); 
        }
    }, [initialLayout]);

    // 1. CRIA O PACOTE DE DADOS AQUI
    const sysData = useMemo(() => ({
        sources: activeSources, 
        loads: SYSTEM_DATA.loads, 
        Vbase: SYSTEM_DATA.Vbase || 13.8,
        Sbase: SYSTEM_DATA.Sbase || 1000
    }), [activeSources, branches]);

    // 2. PASSA O sysData PARA AS FUNÇÕES DE PROPAGAÇÃO
    const nodeFeeds = useMemo(() => propagateFeeds(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    


    // --- NOVA LÓGICA: CÁLCULO DA SUBESTAÇÃO 200 (Apagão / Desconectados) ---
    const disconnectedStats = useMemo(() => {
        let totalP = 0;
        let totalQ = 0;
        let count = 0;
        
        loadNodes.forEach(nodeId => {
            const feeds = nodeFeeds[nodeId];
            // Se a barra não está sendo alimentada e não está em falta (curto)
            if ((!feeds || feeds.size === 0) && !faultNodes.has(nodeId)) {
                const load = SYSTEM_DATA.loads[nodeId];
                if (load) {
                    totalP += load.p || 0;
                    totalQ += load.q || 0;
                    count++;
                }
            }
        });
        
        // Estimação da Corrente
        // Pela sua imagem, SUB 101: 17602 kW e 818 A. V = 17602 / (sqrt(3)*818) ~= 12.43 kV.
        const sKVA = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
        const estimatedCurrent = sKVA / (Math.sqrt(3) * 12.43); 
        
        return {
            p: totalP,
            q: totalQ,
            current: estimatedCurrent || 0,
            count: count
        };
    }, [loadNodes, nodeFeeds, faultNodes]);

    const powerFlowResults = useMemo(() => {
        const cached = CacheManager.get(branches, faultNodes, calcMethod);
        if (cached) return cached;
        const result = runPowerFlow(branches, faultNodes, calcMethod, sysData); // <-- sysData injetado aqui!
        CacheManager.set(branches, faultNodes, calcMethod, result);
        return result;
    }, [branches, faultNodes, calcMethod, sysData]); // <-- sysData adicionado nas dependências

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    const displayElement = useMemo(() => {
        if (hoveredNodeId !== null) return { type: 'node', id: hoveredNodeId };
        if (hoveredLineId !== null) return { type: 'edge', data: branches.find(b => b.id === hoveredLineId) };
        return selectedElement;
    }, [hoveredNodeId, hoveredLineId, selectedElement, branches]);

    const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };
    const handleUploadSwitches = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const lines = content.split(/\r\n|\n/);
            const updates = new Map(); 
            const newFaults = new Set();
            let currentMode = null; 
            let switchCount = 0;
            let faultCount = 0;

            lines.forEach(line => {
                const l = line.trim();
                if (!l) return;
                if (/^set\s+BF\s*:=/.test(l)) {
                    const match = l.match(/set\s+BF\s*:=\s*([\d\s]+);?/);
                    if (match && match[1]) {
                        const faults = match[1].trim().split(/\s+/);
                        faults.forEach(f => {
                            const id = parseInt(f);
                            if (!isNaN(id)) { newFaults.add(id); faultCount++; }
                        });
                    }
                    return; 
                }
                if (l.includes('Circuitos Ativos')) { currentMode = 1; return; }
                if (l.includes('Circuitos Desconectados')) { currentMode = 0; return; }
                if (l.startsWith('i') || l.startsWith('set') || isNaN(parseInt(l[0]))) return;
                const parts = l.split(/\s+/).filter(p => p !== '');
                if (parts.length >= 2) {
                    const from = parseInt(parts[0]);
                    const to = parseInt(parts[1]);
                    if (!isNaN(from) && !isNaN(to) && currentMode !== null) {
                        updates.set(`${from}-${to}`, currentMode);
                        updates.set(`${to}-${from}`, currentMode);
                        switchCount++;
                    }
                }
            });

            if (updates.size > 0 || faultCount > 0 || newFaults.size === 0) {
                if (updates.size > 0) {
                    setBranches(prev => prev.map(b => {
                        const key = `${b.from}-${b.to}`;
                        if (updates.has(key)) return { ...b, state: updates.get(key) };
                        return b;
                    }));
                }
                setFaultNodes(newFaults);
                showToast(`Importado: ${switchCount} chaves, ${faultCount} faltas.`, 'success');
            } else {
                showToast('Arquivo lido, mas nenhum dado compatível encontrado.', 'warning');
            }
        };
        reader.readAsText(file);
    };

    const toggleSwitch = (branchId) => {
        setBranches(prev => prev.map(b => b.id === branchId ? { ...b, state: b.state === 1 ? 0 : 1 } : b));
        showToast('Chave alterada', 'success');
    };

    const toggleFault = (nodeId) => {
        if (faultNodes.has(nodeId)) {
            // 1. SE JÁ TEM FALTA: Apenas remove a falta da barra
            // (Nota de eng: Não fechamos as linhas automaticamente por segurança, o operador deve religar)
            setFaultNodes(prev => {
                const newSet = new Set(prev);
                newSet.delete(nodeId);
                return newSet;
            });
            showToast(`Falta removida da barra ${nodeId}`, 'success');
        } else {
            // 2. SE NÃO TEM FALTA: Aplica a falta e ATUA A PROTEÇÃO (Abre as linhas)
            setFaultNodes(prev => {
                const newSet = new Set(prev);
                newSet.add(nodeId);
                return newSet;
            });
            
            // Varre todas as linhas e abre (state: 0) as que tocam na barra em curto
            setBranches(prevBranches => 
                prevBranches.map(b => 
                    (b.from === nodeId || b.to === nodeId) ? { ...b, state: 0 } : b
                )
            );
            
            showToast(`Proteção atuou! Linhas da barra ${nodeId} abertas.`, 'warning');
        }
    };

    const resetSystem = () => {
        setBranches(SYSTEM_DATA.branches.map((b, idx) => ({ ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) })));
        setFaultNodes(new Set());
        setSelectedElement(null);
        showToast('Sistema resetado', 'success');
    };

    // --- FUNÇÕES DA TELA DE BOAS-VINDAS ---
    const handleLoadExample = () => {
        // Carrega o IEEE 54 padrão
        setBranches(SYSTEM_DATA.branches.map((b, idx) => ({ ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) })));
        setFaultNodes(new Set());
        window.dispatchEvent(new CustomEvent('resetGraphLayout'));
        setIsProjectLoaded(true);
    };

    const handleWelcomeFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.layout || data.positions) {
                    if (data.branches) setBranches(data.branches);
                    if (data.faults) setFaultNodes(new Set(data.faults));

                    
                    // Dá um tempinho mínimo para o React renderizar o SVG e depois aplica as posições
                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: data }));
                    }, 100);

                    setActiveSources(data.sources || [101, 102, 104]);
                    
                    setIsProjectLoaded(true);
                    showToast("Projeto carregado com sucesso!", "success");
                } else {
                    alert("❌ Arquivo inválido. O arquivo não contém o formato esperado.");
                }
            } catch (err) {
                alert("❌ Erro ao ler o arquivo. Certifique-se de que é um JSON válido.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    const handleDatFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                
                // 1. O Parser faz a tradução
                const parsedData = parseAMPLDat(text);
                setProjectPositions(parsedData.positions || {});
                setProjectWaypoints(parsedData.waypoints || {});
                /*
                // =========================================================
                // 2. O NOSSO TESTE: TRANSFORMAR EM JSON E BAIXAR
                // =========================================================
                const jsonString = JSON.stringify(parsedData, null, 2);
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.href = url;
                link.download = `Convertido_${file.name.replace(/\.[^/.]+$/, "")}.json`;
                document.body.appendChild(link);
                link.click(); // Força o download do JSON
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                // =========================================================
                */

                // 3. Atualiza as variáveis vitais de sistema (código original)
                SYSTEM_DATA.loads = parsedData.loads;
                SYSTEM_DATA.Vbase = parsedData.baseKV;
                SYSTEM_DATA.Sbase = parsedData.sBase;
                SYSTEM_DATA.sources = parsedData.sources;

                setActiveSources(parsedData.sources);
                setBranches(parsedData.branches);
                setFaultNodes(new Set());
                
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: parsedData }));
                }, 100);
                
                setIsProjectLoaded(true);
                showToast("Sistema AMPL importado e JSON gerado!", "success");
            } catch (err) {
                alert("❌ Erro ao processar o ficheiro .dat.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    // --- LÓGICA DE DOWNLOAD DO TEMPLATE ---
    const handleDownloadTemplate = () => {
        const templateContent = `# =========================================================
# TEMPLATE DE SISTEMA ELÉTRICO PARA O SIMULADOR
# =========================================================

# --- PARÂMETROS GERAIS ---
param Vbase := 13.8;
param Sbase := 1000;
param SEF := 200; // subestação para estimar cargas desconectadas (apagão)

# --- DECLARAÇÃO DE SUBESTAÇÕES (Opcional) ---
set SR := 0;

# =========================================================
# TABELA DE BARRAS (NÓS)
# O primeiro valor é sempre o ID da Barra.
# Colunas lidas: Pd (kW), Qd (kVAr), Type (1=Sub, 0=Carga)
# =========================================================
param: N:   Pd      Qd      Type :=
  0         0.0     0.0     1
  1         50.0    20.0    0
  2         120.0   60.0    0
  3         45.5    15.2    0
;

# =========================================================
# TABELA DE LINHAS (RAMOS)
# Os dois primeiros valores são sempre Origem e Destino.
# Colunas lidas: R, X, Imax, State (1=ON, 0=OFF), sw (1=Tem Chave)
# =========================================================
param: L:   R       X       Imax    State   sw :=
  0   1     0.33    0.76    400     1       1
  1   2     0.22    0.51    400     1       0
  2   3     0.15    0.35    250     0       1
;`;
        
        const blob = new Blob([templateContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Template_IEEE.dat';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showToast("Template baixado com sucesso!", "success");
    };

    // --- LÓGICA DE EXPORTAÇÃO DO PROJETO (NOVO FORMATO) ---
    const handleExportFullState = useCallback((positions, waypoints) => {
        const exportData = {
            version: "1.0",
            systemName: "IEEE 54 (Projeto Salvo)",
            baseKV: SYSTEM_DATA.Vbase || 13.8,
            sources: sources,
            loads: SYSTEM_DATA.loads, 
            branches: branches, // Salva todas as linhas e o estado atual das chaves!
            faults: Array.from(faultNodes), // Salva as faltas ativas!
            layout: {
                positions: positions,
                waypoints: waypoints
            }
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "meu_sistema_salvo.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        showToast("Projeto exportado com sucesso!", "success");
    }, [branches, faultNodes, sources]);

    // --- LÓGICA DE IMPORTAÇÃO DE ESTADOS (CHAVES E FALTAS) ---
    useEffect(() => {
        const handleApplyFullState = (e) => {
            const data = e.detail;
            
            // Restaura chaves e faltas
            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            // 👇 A MÁGICA DA MEMÓRIA ENTRA AQUI 👇
            // Captura as posições do arquivo e salva na memória permanente do Projeto
            const layoutData = data.layout || data;
            if (layoutData.positions) setProjectPositions(layoutData.positions);
            if (layoutData.waypoints) setProjectWaypoints(layoutData.waypoints);
        };
        
        window.addEventListener('applyGraphLayout', handleApplyFullState);
        return () => window.removeEventListener('applyGraphLayout', handleApplyFullState);
    }, []);

    // --- LÓGICA DE CAPTURA DO GERADOR GEOMÉTRICO (ORGÂNICO) ---
    useEffect(() => {
        const handleApplyOrganic = (e) => {
            // 1. Salva o layout gerado apenas na memória temporária (mesa de trabalho)
            setOrganicPositions(e.detail.positions);
            
            // 2. Muda a aba da Legenda para 'Orgânico' automaticamente
            setLayoutMode('organic'); 
        };
        
        window.addEventListener('applyOrganicLayout', handleApplyOrganic);
        return () => window.removeEventListener('applyOrganicLayout', handleApplyOrganic);
    }, []);

    // --- ESCUDO CONTRA FECHAMENTO ACIDENTAL DA ABA ---
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            // Só exibe o alerta se houver um projeto carregado na tela
            if (isProjectLoaded) {
                e.preventDefault();
                // Esta linha é obrigatória para navegadores modernos exibirem o popup padrão
                e.returnValue = ''; 
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isProjectLoaded]);

    const handleDownloadReport = () => {
        let report = "⚡ RELATÓRIO DO SISTEMA ELÉTRICO - IEEE 54\n";
        report += "========================================\n\n";
        report += `Data/Hora: ${new Date().toLocaleString()}\n`;
        report += `Método de Cálculo: ${calcMethod}\n\n`;

        report += "ESTADO DAS CHAVES (LINHAS):\n";
        report += "---------------------------\n";
        branches.forEach(b => {
            report += `Linha ${b.from} - ${b.to}: ${b.state === 1 ? 'ON (Fechada)' : 'OFF (Aberta)'}\n`;
        });

        report += "\nFALTAS ATIVAS:\n";
        report += "--------------\n";
        if (faultNodes.size === 0) {
            report += "Nenhuma falta ativa no sistema.\n";
        } else {
            Array.from(faultNodes).forEach(f => report += `[ALERTA] Curto/Falta na Barra ${f}\n`);
        }

        const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `relatorio_ieee54_${new Date().getTime()}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Relatório baixado!', 'success');
    };

    const handleExportSVG = () => { exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg'); showToast('Diagrama vetorizado baixado!', 'success'); };

    const handleExportPDF = () => {
        setSelectedElement(null); 
        setTimeout(() => window.print(), 100); 
    };

    /*
    // --- RESTAURAÇÃO DA INVERSÃO DE INTENSIDADE DE CORES ---
    const getNodeColor = (nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        
        // Prioridade 1: Falta/Curto (Vermelho Piscante)
        if (faultNodes.has(nodeId)) return colors.fault;
        
        const feeds = nodeFeeds[nodeId];
        
        // Prioridade 2: Desenergizado (Cinza)
        if (!feeds || feeds.size === 0) return colors.de;
        
        // Prioridade 3: Loop/Anel (Azul claro)
        if (feeds.size > 1) return colors.loop;
        
        // Prioridade 4: Alimentação Normal (Cor da Fonte)
        const source = Array.from(feeds)[0];
        
        // Se for uma das fontes principais (101, 102, 104)
        if (SOURCE_COLORS[source]) return SOURCE_COLORS[source];
        
        // Para nós genéricos que herdam a cor da fonte via HSL:
        // CÁLCULO MÁGICO DE INVERSÃO:
        // Modo Claro: Luminosidade BAIXA (45%) -> Cor escura/saturada
        // Modo Escuro: Luminosidade ALTA (65%) -> Cor clara/pastela ("brilha")
        const h = (source * 137) % 360; // Matiz única baseada no ID
        const s = 70; // Saturação fixa
        const l = darkMode ? 65 : 45; // <-- A mágica acontece aqui
        
        return `hsl(${h}, ${s}%, ${l}%)`;
    };

    const getEdgeColor = (branch) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (branch.state === 0) return colors.de;
        
        const current = lineCurrents[branch.id];
        if (!current || current.current === 0) return colors.de;
        if (current.percentage >= 100) return '#d50000';
        
        const feedsFrom = nodeFeeds[branch.from] || new Set();
        let sourceId = null;
        if (feedsFrom.size === 1) sourceId = Array.from(feedsFrom)[0];
        if (!sourceId) return colors.de;
        
        // Mágica da Transparência: Quanto menor a carga, mais transparente (desbota no fundo)
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const curve = Math.pow(p, 1.5); 
        const minAlpha = 0.25; // Garante que a linha nunca fique 100% invisível
        const alpha = minAlpha + (1 - minAlpha) * curve;
        
        if (SOURCE_COLORS[sourceId]) {
            const rgb = hexToRgb(SOURCE_COLORS[sourceId]);
            const getSafeHue = (id) => {
                let h = (id * 137) % 360;
                // Se a cor cair no vermelho/laranja escuro (0-25 ou 335-360), joga para o Azul/Verde
                if (h < 25 || h > 335) h = (h + 45) % 360; 
                return h;
            };
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`; 
        } else {
            const hue = (sourceId * 137) % 360;
            const l = darkMode ? 65 : 45; 
            return `hsla(${hue}, 70%, ${l}%, ${alpha.toFixed(3)})`; 
        }
    };

    */

    const getNodeColor = (nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        
        // 1. Falta
        if (faultNodes.has(nodeId)) return colors.fault;
        
        let sourceToUse = null;
        
        // 2. É uma subestação? Força a cor dela!
        if (sources.includes(nodeId)) {
            sourceToUse = nodeId;
        } else {
            const feeds = nodeFeeds[nodeId];
            if (!feeds || feeds.size === 0) return colors.de;
            if (feeds.size > 1) return colors.loop;
            sourceToUse = Array.from(feeds)[0];
        }
        
        if (SOURCE_COLORS[sourceToUse]) return SOURCE_COLORS[sourceToUse];
        
        // Aplica nossa função anti-vermelho
        const h = getSafeHue(sourceToUse);
        const l = darkMode ? 65 : 45; 
        return `hsl(${h}, 70%, ${l}%)`;
    };

    const getEdgeColor = (branch) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (branch.state === 0) return colors.de;
        
        const current = lineCurrents[branch.id];
        // Se a corrente for quase zero absoluto, apaga a linha
        if (!current || current.current < 0.01) return colors.de;
        if (current.percentage >= 100) return '#d50000'; // Sobrecarga em vermelho fixo
        
        const feedsFrom = nodeFeeds[branch.from] || new Set();
        if (feedsFrom.size === 0) return colors.de;
        // CORREÇÃO DOS LOOPS: Se for anel, brilha em amarelo!
        if (feedsFrom.size > 1) return colors.loop; 
        
        const sourceId = Array.from(feedsFrom)[0];
        
        // CORREÇÃO DE OPACIDADE: O mínimo agora é 45% (nunca mais ficará cinza morta)
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const alpha = 0.45 + (0.55 * Math.sqrt(p)); 
        
        if (SOURCE_COLORS[sourceId]) {
            const rgb = hexToRgb(SOURCE_COLORS[sourceId]);
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`; 
        } else {
            const hue = getSafeHue(sourceId);
            const l = darkMode ? 65 : 45; 
            return `hsla(${hue}, 70%, ${l}%, ${alpha.toFixed(3)})`; 
        }
    };

    // --- TELA DE BOAS VINDAS (BLANK SLATE) ---
    if (!isProjectLoaded) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', backgroundColor: darkMode ? '#121212' : '#f0f2f5', color: darkMode ? '#ffffff' : '#333333', fontFamily: 'sans-serif', transition: 'background-color 0.3s' }}>
                
                {/* Botão de Tema na Tela Inicial */}
                <button onClick={() => setDarkMode(!darkMode)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer' }}>
                    {darkMode ? '☀️' : '🌙'}
                </button>

                <div style={{ background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.9)', padding: '50px 40px', borderRadius: '16px', boxShadow: darkMode ? '0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)', textAlign: 'center', maxWidth: '450px', width: '90%', border: darkMode ? '1px solid #333' : '1px solid #fff' }}>
                    
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>⚡</div>
                    <h1 style={{ margin: '0 0 10px 0', fontSize: '22px', color: darkMode ? '#eee' : '#222' }}>Simulador de Sistemas de Potência</h1>
                    <p style={{ margin: '0 0 30px 0', fontSize: '14px', color: darkMode ? '#aaa' : '#666', lineHeight: '1.5' }}>Motor genérico para simulação e visualização de fluxo de carga e atuação de proteção.</p>

                    <input type="file" ref={welcomeFileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleWelcomeFileUpload} />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <button 
                            onClick={() => welcomeFileInputRef.current.click()}
                            style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: '#00bcd4', color: '#000', transition: 'transform 0.2s', boxShadow: '0 4px 10px rgba(0, 188, 212, 0.3)' }}
                            onMouseOver={e => e.target.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.target.style.transform = 'translateY(0)'}
                        >
                            📂 Carregar Projeto Salvo (.json)
                        </button>

                        <button 
                            onClick={handleLoadExample}
                            style={{ width: '100%', padding: '14px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: darkMode ? '#fff' : '#333', transition: 'background 0.2s' }}
                            onMouseOver={e => e.target.style.background = darkMode ? '#333' : '#e0e0e0'}
                            onMouseOut={e => e.target.style.background = 'transparent'}
                        >
                            🚀 Iniciar Sistema Exemplo (IEEE 53)
                        </button>

                        <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', color: darkMode ? '#555' : '#aaa' }}>
                            <div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div>
                            <span style={{ padding: '0 10px', fontSize: '12px' }}> OU </span>
                            <div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div>
                        </div>

                        {/* INPUT INVISÍVEL PARA LER O .DAT */}
                        <input type="file" ref={datFileInputRef} accept=".dat,.txt" style={{ display: 'none' }} onChange={handleDatFileUpload} />

                        {/* O NOVO BOTÃO ATIVADO */}
                        <button 
                            onClick={() => datFileInputRef.current.click()}
                            style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: darkMode ? '#ff9800' : '#ff9800', color: '#000', transition: 'transform 0.2s', boxShadow: '0 4px 10px rgba(255, 152, 0, 0.3)' }}
                            onMouseOver={e => e.target.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.target.style.transform = 'translateY(0)'}
                        >
                            📥 Importar Novo Sistema (.dat AMPL)
                        </button>

                        {/* --- BOTÃO TEMPLATE.DAT --- */}
                        <button 
                            onClick={handleDownloadTemplate}
                            style={{ width: '100%', padding: '8px', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', background: 'transparent', color: darkMode ? '#00bcd4' : '#0097a7', textDecoration: 'underline', transition: 'opacity 0.2s' }}
                            onMouseOver={e => e.target.style.opacity = '0.7'}
                            onMouseOut={e => e.target.style.opacity = '1'}
                        >
                            Precisa de ajuda? Baixe o modelo (.dat)
                        </button>
                        {/* --------------------------------------- */}
                    </div>
                </div>
            </div>
        );
    }


    return (
        <div className="app-container">
            <style>
                {`
                .app-container { display: flex !important; flex-direction: row !important; width: 100vw; height: 100vh; overflow: hidden; background-color: ${darkMode ? '#121212' : '#f0f2f5'}; }
                
                .graph-wrapper { 
                    flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; 
                    background-color: ${printFrameMode !== 'none' ? (darkMode ? '#080808' : '#cfd3d6') : 'transparent'}; 
                    transition: background-color 0.3s ease; 
                }
                
                .right-panel-wrapper { position: relative; width: ${isFaultSidebarOpen ? '230px' : '0px'}; transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1); flex-shrink: 0; border-left: ${isFaultSidebarOpen ? '1px solid #333' : 'none'}; }
                .right-panel-wrapper > div.panel-content { position: absolute !important; left: 0 !important; top: 0 !important; width: 230px !important; height: 100vh !important; overflow: hidden; background: ${darkMode ? '#1e1e1e' : '#fff'}; }
                
                .tool-btn:hover { background-color: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; transform: translateY(-1px); }
                .tool-btn:active { transform: translateY(1px); }

                @media print {
                    @page { size: ${printFrameMode === 'portrait' ? 'portrait' : 'landscape'}; margin: 0mm; }
                    body, html, .app-container { width: 100% !important; height: 100% !important; margin: 0 !important; display: block !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important; }
                    .hide-on-print { display: none !important; }
                    .graph-wrapper { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: transparent !important; display: block !important; }
                    .paper-container { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: none !important; box-shadow: none !important; aspect-ratio: auto !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important;}
                    .graph-svg { width: 100% !important; height: 100% !important; }
                }
                `}
            </style>

            {!isMobile && (
                <div className="hide-on-print" style={{ borderRight: '1px solid #333', zIndex: 100 }}>
                    {!isEditMode ? (
                        <Sidebar 
                            sidebarMode={sidebarMode} darkMode={darkMode} setDarkMode={setDarkMode}
                            resetSystem={resetSystem} maintenanceMode={maintenanceMode} setMaintenanceMode={setMaintenanceMode}
                            showLabels={showLabels} setShowLabels={setShowLabels} 
                            selectedElement={displayElement}
                            sources={sources} loads={loads} faultNodes={faultNodes} branches={branches} 
                            toggleSwitch={toggleSwitch} setSelectedElement={setSelectedElement} setHoveredLineId={setHoveredLineId}
                            onDownloadReport={handleDownloadReport} onUploadSwitches={handleUploadSwitches}
                            calcMethod={calcMethod} setCalcMethod={setCalcMethod} onExportSVG={handleExportSVG}
                            onExportPDF={handleExportPDF} getNodeColor={getNodeColor} getEdgeColor={getEdgeColor}

                            // ENVIANDO OS DADOS DA SUB 200 PARA O MENU!
                            disconnectedStats={disconnectedStats}
                        />
                    ) : (
                        <EditSidebar isEditMode={isEditMode} setIsEditMode={setIsEditMode} darkMode={darkMode} onUndo={handleUndoLayout} canUndo={layoutHistory.length > 0} onReset={handleResetToOriginalLayout} branches={branches} allNodes={allNodes} sources={sources} currentPositions={activePositions}/>
                    )}
                </div>
            )}

            <div className="graph-wrapper">
                
                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', top: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px', borderRadius: '14px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Menu Esquerdo" onClick={() => {if (isEditMode) setIsEditMode(false); else setSidebarMode(p => p === 'full' ? 'mini' : (p === 'mini' ? 'hidden' : 'full'))}}>≡</button>
                    <div style={{ height: '1px', width: '70%', margin: '2px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: isEditMode ? '#ff9800' : (darkMode ? '#fff' : '#333'), transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Modo Edição" onClick={() => setIsEditMode(!isEditMode)}>✏️</button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Atalhos" onClick={() => setShowShortcuts(true)}>⌨️</button>
                </div>

                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'row', gap: '4px', padding: '6px 12px', borderRadius: '20px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Centralizar Gráfico" onClick={() => window.dispatchEvent(new CustomEvent('triggerZoomExtents'))}>🎯</button>
                    <div style={{ width: '1px', height: '60%', margin: 'auto 6px', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Alternar Folha / Tela Cheia" onClick={() => setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'))}>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: printFrameMode !== 'none' ? '#ff9800' : 'inherit' }}>
                            A4 <span style={{ opacity: 0.8, fontSize: '12px' }}>{printFrameMode === 'none' ? '🔲' : (printFrameMode === 'landscape' ? '↔' : '↕')}</span>
                        </span>
                    </button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', opacity: showLegend ? 1 : 0.4 }} title="Mostrar/Ocultar Legenda" onClick={() => setShowLegend(!showLegend)}>👁️</button>
                </div>

                {printFrameMode !== 'none' && !isMobile && (
                    <div className="hide-on-print" style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#ff9800', color: '#000', padding: '6px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                        Visualização de Impressão: {printFrameMode === 'landscape' ? 'Paisagem' : 'Retrato'} (Ctrl+P para Imprimir)
                    </div>
                )}

                <GraphArea 
                    printFrameMode={printFrameMode} isFaultSidebarOpen={isFaultSidebarOpen}
                    branches={branches} allNodes={allNodes} sources={sources} showLabels={showLabels} 
                    getEdgeColor={getEdgeColor} getNodeColor={getNodeColor} toggleSwitch={toggleSwitch} 
                    toggleFault={toggleFault} setSelectedElement={setSelectedElement} selectedElement={selectedElement} 
                    hoveredLineId={hoveredLineId} setHoveredLineId={setHoveredLineId} hoveredNodeId={hoveredNodeId} 
                    setHoveredNodeId={setHoveredNodeId} maintenanceMode={maintenanceMode} isMobile={isMobile} 
                    activePositions={activePositions} lineCurrents={lineCurrents} nodeData={nodeData} 
                    isEditMode={isEditMode} setIsEditMode={setIsEditMode} activeWaypoints={activeWaypoints} 
                    darkMode={darkMode} onSaveLayoutToHistory={saveLayoutToHistory} loads={loads} onExportRequest={handleExportFullState}
                >
                    {showLegend && !isMobile && (
                        <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                            <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                    <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                    <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                </div>
                            </div>
                            {sources.map(s => (<div key={s} className="legend-item"><div className="legend-dot" style={{ background: SOURCE_COLORS[s] || `hsl(${(s * 137) % 360}, 70%, 45%)` }}></div> SUB {s}</div>))}
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                        </div>
                    )}
                </GraphArea>
            </div>

            {!isMobile && (
                <div className="hide-on-print right-panel-wrapper" style={{ zIndex: 100 }}>
                    <div onClick={() => setFaultSidebarOpen(!isFaultSidebarOpen)} title={isFaultSidebarOpen ? "Ocultar Painel" : "Painel de Faltas"} style={{
                        position: 'absolute', left: '-28px', top: 'calc(50% - 35px)',
                        width: '28px', height: '70px', background: darkMode ? '#1e1e1e' : '#fff',
                        border: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderRight: 'none',
                        borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', color: '#ff9800',
                        zIndex: 101, transition: 'background-color 0.2s'
                    }}>
                        {isFaultSidebarOpen ? '▶' : '⚡'}
                    </div>
                    <div className="panel-content">
                        <FaultPanel 
                            isFaultSidebarOpen={isFaultSidebarOpen} setFaultSidebarOpen={setFaultSidebarOpen}
                            sources={sources} loadNodes={loadNodes} faultNodes={faultNodes} nodeFeeds={nodeFeeds}
                            toggleFault={toggleFault} setSelectedElement={setSelectedElement} 
                            selectedElement={displayElement}
                            setHoveredNodeId={setHoveredNodeId} getNodeColor={getNodeColor} darkMode={darkMode}
                            THEME={THEME} nodeData={nodeData} lineCurrents={lineCurrents} loads={loads} branches={branches}
                        />
                    </div>
                </div>
            )}

            {showShortcuts && (
                <div className="hide-on-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setShowShortcuts(false)}>
                    <div style={{ background: darkMode ? '#222' : '#fff', color: darkMode ? '#fff' : '#000', padding: '25px', borderRadius: '12px', width: '350px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #555', paddingBottom: '10px' }}>Atalhos de Teclado</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '2' }}>
                            <li><strong style={{ color: '#ff9800' }}>P</strong> - Alterar Paisagem/Retrato</li>
                            <li><strong style={{ color: '#ff9800' }}>Ctrl + P</strong> - Imprimir PDF</li>
                            <li><strong style={{ color: '#ff9800' }}>E</strong> - Entrar/Sair da Edição</li>
                            <li><strong style={{ color: '#ff9800' }}>Z</strong> - Centralizar Sistema</li>
                            <li><strong style={{ color: '#ff9800' }}>D</strong> - Tema Escuro</li>
                            <li><strong style={{ color: '#ff9800' }}>L</strong> - Mostrar Labels</li>
                            <li><strong style={{ color: '#ff9800' }}>M</strong> - Método de Cálculo (NR/GS)</li>
                            <li><strong style={{ color: '#ff9800' }}>R</strong> - Reiniciar Sistema</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Arrastar Fundo</strong> - Seleção Múltipla</li>
                        </ul>
                        <button onClick={() => setShowShortcuts(false)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#00bcd4', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>Fechar</button>
                    </div>
                </div>
            )}
            {toast && <div className="toast">{toast.message}</div>}
        </div>
    );
}

export default App;