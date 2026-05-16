import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { analyzeTopology, calculateLoads, runPowerFlow, CacheManager } from './utils/powerCalculations';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import MapArea from './components/MapArea';
import GraphArea from './components/GraphArea';
import EditSidebar from './components/EditSidebar'; 
import { exportSVG, generateTextReport } from './utils/exportUtils';
import './index.css';
import { useFileImport } from './hooks/useFileImport';

import { runAsyncLayout } from './utils/runLayoutWorker';
import { expandTopology, contractTopology, relaxExpandedNodes, findIntersections, compactPositions } from './utils/autoLayout';

import { useShortcuts } from './hooks/useShortcuts';
import { useColorIntelligence, getBaseColor } from './hooks/useColorIntelligence';
import { SYSTEM_DATA} from './data/systemData';
import { SYSTEM_DATA_SHUNT } from './data/systemData54';

import { parseSequenceFile, buildSnapshots, findProtectionSwitches, applyStepToSnapshot } from './utils/switchSequencer';
import SequenceOverlay from './components/SequenceOverlay';

import { runOptimizer } from './utils/reconfigOptimizer';
import { runVNS } from './utils/vnsOptimizer';

function App() {

    const [macroGraph, setMacroGraph] = useState(null);
    // Escuta o evento que vem do botão da Sidebar
    useEffect(() => {
        const handleApplyMacro = (e) => setMacroGraph(e.detail);
        window.addEventListener('applyMacroGraph', handleApplyMacro);
        return () => window.removeEventListener('applyMacroGraph', handleApplyMacro);
    }, []);
    
    // Configurações Base do Sistema (Unificadas)
    const [vBase, setVBase] = useState(13.8);
    const [sBase, setSBase] = useState(1000);
    const [sses, setSses] = useState({});

    const [showReportModal, setShowReportModal] = useState(false);
    const [darkMode, setDarkMode] = useState(true); 
    // Controle de Visualização: 'schematic' (Diagrama SVG) ou 'map' (Georreferenciado Leaflet)
    const [viewMode, setViewMode] = useState('schematic');
    
    // O sistema agora nasce vazio, sem chaves e sem peso na memória
    const [branches, setBranches] = useState([]);
    const initialBranchesRef = useRef([]);
    
    
    const [faultNodes, setFaultNodes] = useState(new Set());
    
    // Implementação para o sistema de redução de calculo NR
    const [lastEventNodes, setLastEventNodes] = useState(new Set());
    
    const [activeSources, setActiveSources] = useState([]);
    const [systemShunts, setSystemShunts] = useState({});
    const [systemFeeders, setSystemFeeders] = useState([]);
    const [systemLoads, setSystemLoads] = useState({});
    const [systemGD, setSystemGD] = useState({}); // 👈 Novo estado para GD
    const [projectPositions, setProjectPositions] = useState({});
    const [projectWaypoints, setProjectWaypoints] = useState({});
    const [geoPositions, setGeoPositions] = useState({});
    // 👇 NOVOS ESTADOS ELEVADOS DAS ROTAS DO MAPA 👇
    const [routedPaths, setRoutedPaths] = useState({});
    const [manualWaypoints, setManualWaypoints] = useState({});
    const [straightSegments, setStraightSegments] = useState({});
    
    const [sequenceData, setSequenceData] = useState(null);
    const [seqOverlayOpen, setSeqOverlayOpen] = useState(false);
    const [hoveredSeqBranch, setHoveredSeqBranch] = useState(null);
    const [isRecordingSeq, setIsRecordingSeq] = useState(false);

    const [selectedElement, setSelectedElement] = useState(null);
    const [showLabels, setShowLabels] = useState(false);
    const [showLegend, setShowLegend] = useState(true); 
    const [toast, setToast] = useState(null);
    const [calcMethod, setCalcMethod] = useState('NR'); 
    const [isEditMode, setIsEditMode] = useState(false);
    const [showCrossings, setShowCrossings] = useState(true);

    const [layoutHistory, setLayoutHistory] = useState([]); 
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    const [organicWaypoints, setOrganicWaypoints] = useState({});

    const [isCalculatingLayout, setIsCalculatingLayout] = useState(false);
    // 👇 CÂMERA DE SEGURANÇA 1: Monitora a Variável da Tela Preta
    useEffect(() => {
        console.log(`🎥 [App.jsx] A variável isCalculatingLayout mudou para: ${isCalculatingLayout ? '🟢 LIGADA' : '🔴 DESLIGADA'}`);
    }, [isCalculatingLayout]);

    const activePositions = useMemo(() => {
        if (macroGraph) return macroGraph.positions; // 👈 Posição amassada ganha prioridade
        return layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions);
    }, [layoutMode, projectPositions, organicPositions, macroGraph]);

    
    // ==========================================
    // 🎯 RADAR DE CRUZAMENTOS (CALCULADOR)
    // ==========================================
    const intersections = useMemo(() => {
        if (!activePositions || !branches) return [];
        return findIntersections(activePositions, branches);
    }, [activePositions, branches]);

    const activeWaypoints = useMemo(() => layoutMode === 'project' ? projectWaypoints : (organicWaypoints || projectWaypoints), [layoutMode, projectWaypoints, organicWaypoints]);
    
    const [printFrameMode, setPrintFrameMode] = useState('none'); 
    const [showShortcuts, setShowShortcuts] = useState(false);
    
    const [sidebarMode, setSidebarMode] = useState('full');
    const [isFaultSidebarOpen, setFaultSidebarOpen] = useState(true);
    const [hoveredLineId, setHoveredLineId] = useState(null);
    const [hoveredNodeId, setHoveredNodeId] = useState(null);
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const welcomeFileInputRef = useRef(null);
    const datFileInputRef = useRef(null);
    // 👇 BLINDAGEM CONTRA LOOP INFINITO 👇
    const allNodes = useMemo(() => 
        Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b)
    , [branches]);
    
    const sources = activeSources;
    
    const loadNodes = useMemo(() => 
        allNodes.filter(n => !sources.includes(n) && !systemFeeders.includes(n))
    , [allNodes, sources, systemFeeders]);
    
    // 👇 IMPORTANTE: Esta lista mista blinda os barramentos para o Sequenciador 👇
    const allBoundaryNodes = useMemo(() => [...sources, ...systemFeeders], [sources, systemFeeders]);
    
    const [optimizerStatus, setOptimizerStatus] = useState("");
    
    const [layoutProgress, setLayoutProgress] = useState({ passes: 0, msg1: '', msg2: '' });
    
    // 👇 BLACK START INTELIGENTE (Agrupamento de Loops) 👇
    const runBlackStart = useCallback((targetBranches, targetSources, targetFeeders) => {
        
        const feederNodes = new Set((targetFeeders || []).map(Number));
        const allSources = (targetSources || []).map(Number);
        
        // 1. A verdadeira raiz é quem é Source mas NÃO É Alimentador
        const trueRoots = allSources.filter(s => !feederNodes.has(s));
        if (trueRoots.length === 0) {
            console.warn("⚠️ ALERTA: Nenhuma fonte principal encontrada! Verifique o arquivo de dados.");
        }
        const rootSourcesSet = new Set(trueRoots.length > 0 ? trueRoots : allSources);

        // 2. Identificação das Chaves Mestras e geração do Blackout
        const rootBranches = [];
        const blackoutState = targetBranches.map(b => {
            const isMasterSwitch = rootSourcesSet.has(Number(b.from)) || rootSourcesSet.has(Number(b.to));
            if (b.state === 1 && isMasterSwitch) {
                rootBranches.push(b);
                return { ...b, state: 0 }; 
            }
            return { ...b };
        });

        // =========================================================
        // 🧠 3. INTELIGÊNCIA DE LOOPS: Agrupamento Topológico
        // =========================================================
        const rootBranchIds = new Set(rootBranches.map(b => b.id));
        const adj = {};
        
        // 3a. Cria mapa de conexões APENAS com a rede interna (ignorando as chaves mestras)
        targetBranches.forEach(b => {
            if (b.state === 1 && !rootBranchIds.has(b.id)) {
                if (!adj[b.from]) adj[b.from] = [];
                if (!adj[b.to]) adj[b.to] = [];
                adj[b.from].push(b.to);
                adj[b.to].push(b.from);
            }
        });

        const nodeComponent = {};
        let compCounter = 0;
        
        // 3b. Algoritmo de Busca (BFS) para mapear Ilhas
        const getComponent = (startNode) => {
            if (nodeComponent[startNode] !== undefined) return nodeComponent[startNode];
            compCounter++;
            const queue = [startNode];
            nodeComponent[startNode] = compCounter;
            
            let head = 0;
            while(head < queue.length) {
                const u = queue[head++];
                if (adj[u]) {
                    adj[u].forEach(v => {
                        if (nodeComponent[v] === undefined) {
                            nodeComponent[v] = compCounter;
                            queue.push(v);
                        }
                    });
                }
            }
            return compCounter;
        };

        const groupsMap = {};
        rootBranches.forEach(b => {
            // Pega o nó da chave que está "dentro" da rede (e não na subestação)
            const networkNode = rootSourcesSet.has(Number(b.from)) ? Number(b.to) : Number(b.from);
            const compId = getComponent(networkNode);
            
            if (!groupsMap[compId]) groupsMap[compId] = [];
            groupsMap[compId].push(b.id); // Agrupa as chaves que tocam a mesma ilha
        });

        // Converte o mapa em um Array de grupos de chaves
        const rootBranchGroups = Object.values(groupsMap);
        // =========================================================

        // Desliga a subestação
        setBranches(blackoutState);

        // 4. Religamento em Cascata (Agrupado por Ilha/Loop)
        let index = 0;
        const interval = setInterval(() => {
            if (index >= rootBranchGroups.length) {
                clearInterval(interval);
                return;
            }

            const groupToClose = rootBranchGroups[index]; // Array com 1 ou mais IDs de chaves
            
            // 4a. Liga TODAS as chaves do grupo simultaneamente
            setBranches(prev => prev.map(b => 
                groupToClose.includes(b.id) ? { ...b, state: 1 } : b
            ));
            
            // 4b. Acorda o Newton-Raphson com os nós de todas as chaves fechadas
            const nodesToWake = new Set();
            targetBranches.forEach(b => {
                if (groupToClose.includes(b.id)) {
                    nodesToWake.add(b.from);
                    nodesToWake.add(b.to);
                }
            });
            if (nodesToWake.size > 0) setLastEventNodes(nodesToWake);

            index++;
        }, 50);
    }, []);

    // 👇 FUNÇÃO DE CARREGAMENTO UNIFICADA 👇
    const applySystemData = useCallback((data, sourceName = "Externo") => {
        const targetBranches = data.branches ? data.branches.map((b, idx) => ({ 
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
        })) : [];

        setBranches(targetBranches);
        if (initialBranchesRef) initialBranchesRef.current = JSON.parse(JSON.stringify(targetBranches)); 
        
        setSystemLoads(data.loads || {}); 
        setSystemShunts(data.shunts || {});
        setActiveSources(data.sources || []); 
        setSystemFeeders(data.feeders || []);
        setSystemGD(data.systemGD || data.gd || {}); // 👈 Injeta a GD vinda do Parser ou JSON

        // 👇 ADICIONADO: Suporte para nomes de variáveis tanto do JSON quanto do DAT
        setVBase(data.Vbase || data.baseKV || 13.8);
        setSBase(data.Sbase || data.sBase || 1000);
        setSses(data.sses || {});

        const layoutData = data.layout || data;
        setProjectPositions(layoutData.positionsProject || layoutData.positions || {});
        setProjectWaypoints(layoutData.waypointsProject || layoutData.waypoints || {});
        setGeoPositions(layoutData.geoPositions || data.geoPositions || {});
        // 👇 IMPORTA AS ROTAS DO ARQUIVO (OU ZERA SE FOR UM SISTEMA NOVO) 👇
        setRoutedPaths(layoutData.routes || data.routes || {});
        setManualWaypoints(layoutData.manualWaypoints || data.manualWaypoints || {});
        setStraightSegments(layoutData.straightSegments || data.straightSegments || {});

        setFaultNodes(new Set(data.faults || []));
        setIsProjectLoaded(true);

        runBlackStart(targetBranches, data.sources || [], data.feeders || []);

        console.log(`⚙️ Sistema [${sourceName}] carregado com sucesso na Engine Unificada.`);

        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 50);
        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 650);
    }, [runBlackStart]);

    // 👇 EFEITO DO LAYOUT ORGÂNICO ASYNC 👇
    useEffect(() => {
        if (layoutMode === 'organic' && !organicPositions && allNodes.length > 0 && !isCalculatingLayout) {
            const calculateAsync = async () => {
                setIsCalculatingLayout(true);
                setLayoutProgress({ passes: 0, msg1: "Iniciando Motor Físico...", msg2: "Preparando nós" });
                
                try {
                    // Chama o operário terceirizado!
                    const newLayout = await runAsyncLayout('auto', allNodes, branches, sources, { 
                        gridSize: 100, 
                        maxIter: 30,
                        currentPos: projectPositions,
                        onProgress: (passes, msg1, msg2) => {
                            setLayoutProgress({ passes, msg1, msg2 });
                        }
                    });
                    setOrganicPositions(newLayout);
                } catch (error) {
                    console.error("Erro no Worker de Layout:", error);
                    showToast("Erro ao calcular layout orgânico.", "error");
                } finally {
                    setIsCalculatingLayout(false);
                }
            };
            calculateAsync();
        }
    }, [layoutMode, organicPositions, allNodes, branches, sources]);

    useEffect(() => {
        setOrganicPositions(null);
        setLayoutMode('project');
    }, [allNodes.length]);

    useEffect(() => {
        const timer1 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 50);
        const timer2 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 700);
        return () => { clearTimeout(timer1); clearTimeout(timer2); };
    }, [layoutMode]);

    useEffect(() => {
        if (darkMode) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    }, [darkMode]);

    const handleUndoLayout = useCallback(() => {
        if (layoutHistory.length === 0) return;
        const lastState = layoutHistory[layoutHistory.length - 1];
        if (layoutMode === 'organic') {
            setOrganicPositions(lastState.positions);
            if (lastState.waypoints) setOrganicWaypoints(lastState.waypoints); 
        } else {
            setProjectPositions(lastState.positions);
            setProjectWaypoints(lastState.waypoints);
        }
        setLayoutHistory(prev => prev.slice(0, -1));
    }, [layoutHistory, layoutMode]);

    const saveLayoutToHistory = useCallback((positions, waypoints) => {
        const currentState = JSON.parse(JSON.stringify({ positions: positions, waypoints: waypoints }));
        setLayoutHistory(prev => [...prev, currentState].slice(-20)); 
    }, []);

    useEffect(() => {
        const handleSaveToHistory = (e) => { saveLayoutToHistory(e.detail.positions, e.detail.waypoints); };
        window.addEventListener('saveToHistory', handleSaveToHistory);
        return () => window.removeEventListener('saveToHistory', handleSaveToHistory);
    }, [saveLayoutToHistory]);

    const handleResetToOriginalLayout = useCallback(() => {
        if (window.confirm("🚨 Tem certeza que deseja resetar o layout para o padrão do arquivo? Todas as alterações não salvas serão perdidas.")) {
            window.dispatchEvent(new CustomEvent('resetGraphLayout'));
            setLayoutHistory([]); 
        }
    }, []);

    // 👇 CORREÇÃO: Abre o sequenciador a partir do estado EXATO atual da tela 👇
    const handleOpenEmptySequencer = () => {
        if (!sequenceData) {
            // Pega as chaves atuais (branches) e as faltas atuais (faultNodes)
            const initialSnapshot = { 
                branches: branches, 
                faults: new Set(faultNodes), 
                shunts: JSON.parse(JSON.stringify(systemShunts))
            };
            
            setSequenceData({
                steps: [],
                snapshots: buildSnapshots(initialSnapshot, [], allBoundaryNodes, systemLoads),
                method: 'Iniciado Manualmente'
            });
        }
        setSeqOverlayOpen(true);
    };

    const sysData = useMemo(() => ({
        sources: activeSources, 
        feeders: systemFeeders,
        loads: systemLoads, 
        gd: systemGD, // 👈 Agora o motor matemático recebe a GD
        Vbase: vBase, // 👈 Dinâmico
        Sbase: sBase, // 👈 Dinâmico
        shunts: systemShunts || {}, 
        sses: sses    // 👈 Dinâmico
    }), [activeSources, systemLoads, systemShunts, systemFeeders, vBase, sBase, sses]);

    const topology = useMemo(() => analyzeTopology(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const { nodeFeeds, loopNodes } = topology; // Extraímos o que o App e o Painel precisam
    
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    
    const disconnectedStats = useMemo(() => {
        let totalP = 0, totalQ = 0, count = 0;
        loadNodes.forEach(nodeId => {
            const feeds = nodeFeeds[nodeId];
            if ((!feeds || feeds.size === 0) && !faultNodes.has(nodeId)) {
                // 👇 CORREÇÃO: Usa o 'systemLoads' que veio da importação, não o arquivo fixo!
                const load = systemLoads[nodeId]; 
                if (load) { totalP += load.p || 0; totalQ += load.q || 0; count++; }
            }
        });
        const sKVA = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
        // 👇 Usa o vBase dinâmico
        const estimatedCurrent = sKVA / (Math.sqrt(3) * vBase); 
        return { p: totalP, q: totalQ, current: estimatedCurrent || 0, count: count };
    }, [loadNodes, nodeFeeds, faultNodes, systemLoads, vBase]);

    // Bloco atualizado para implementar redução do cálculo de fluxo de carga usando os "lastEventNodes"
    const powerFlowResults = useMemo(() => {

        // Se não há ramos, não há o que calcular
        if (!branches || branches.length === 0) return { nodes: {}, lines: {} };


        const cached = CacheManager.get(branches, faultNodes, calcMethod, sysData);
        if (cached) return cached;
        // Passamos o lastEventNodes aqui no final:
        const result = runPowerFlow(branches, faultNodes, calcMethod, sysData, lastEventNodes); 
        CacheManager.set(branches, faultNodes, calcMethod, sysData, result);
        return result;
    }, [branches, faultNodes, calcMethod, sysData, lastEventNodes]);

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    // Usa o Estado Oficial do React
    const { getNodeColor, getEdgeColor } = useColorIntelligence({
        faultNodes, activeSources, lineCurrents, darkMode, topology
    });

    const effectiveHoveredLineId = hoveredSeqBranch !== null ? hoveredSeqBranch : hoveredLineId;

    const displayElement = useMemo(() => {
        if (hoveredNodeId !== null) return { type: 'node', id: hoveredNodeId };
        if (effectiveHoveredLineId !== null) return { type: 'edge', data: branches.find(b => b.id === effectiveHoveredLineId) };
        if (selectedElement?.type === 'edge' && selectedElement.data) {
            return { type: 'edge', data: branches.find(b => b.id === selectedElement.data.id) || selectedElement.data };
        }
        return selectedElement;
    }, [hoveredNodeId, effectiveHoveredLineId, selectedElement, branches]);

    const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };
    
    const { handleWelcomeFileUpload, handleDatFileUpload } = useFileImport({
        setBranches,    // Mantido apenas por compatibilidade com arquivos de Sequência
        setFaultNodes,  // Mantido apenas por compatibilidade com arquivos de Sequência
        showToast,
        setIsCalculatingLayout, 
        setLayoutProgress,
        applySystemData // Passamos o Motor para o importador.
    });

    const handleUploadSwitches = async (file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const fileContent = e.target.result;

                // 👇 1. IMPORTAÇÃO DE SEQUÊNCIA PRONTA (TXT Exportado) 👇
                if (fileContent.trim().startsWith("Sequenciamento")) {
                    const lines = fileContent.split('\n').map(l => l.trim()).filter(l => l);
                    const importedSteps = [];

                    let currentTempBranches = [...branches];
                    
                    // 👈 DECLARAÇÃO DA VARIÁVEL QUE ESTAVA FALTANDO 👈
                    let currentImportStage = "Sequência Importada"; 

                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split(' ');
                        const action = parts[0].toUpperCase();

                        // 👇 A LÓGICA QUE IDENTIFICA E MUDA O NOME DA ETAPA 👇
                        if (action === 'ETAPA') {
                            currentImportStage = lines[i].substring(6).trim();
                            continue; // Pula para a próxima linha do arquivo
                        }

                        if (action === 'FECHAR' || action === 'ABRIR') {
                            const from = parseInt(parts[1], 10);
                            const to = parseInt(parts[2], 10);
                            
                            const branch = branches.find(b => (b.from === from && b.to === to) || (b.from === to && b.to === from));
                            
                            importedSteps.push({
                                type: action === 'FECHAR' ? 'close' : 'open',
                                branchId: branch ? branch.id : `${from}-${to}`,
                                fromNode: from,
                                toNode: to,
                                description: `${action === 'FECHAR' ? 'Fechar' : 'Abrir'} chave ${from}-${to}`,
                                stage: currentImportStage // 👈 Agora a variável existe e tem o nome certo!
                            });

                            if (branch) {
                                currentTempBranches = currentTempBranches.map(b => 
                                    b.id === branch.id ? { ...b, state: action === 'FECHAR' ? 1 : 0 } : b
                                );
                            }

                        } else if (action === 'FALTA_ADICIONAR') {
                            const node = parseInt(parts[1], 10);
                            const branchesToOpen = findProtectionSwitches(node, currentTempBranches);

                            importedSteps.push({
                                type: 'fault_add',
                                nodeId: node,
                                description: `Falta na barra ${node} e Proteção atuada`,
                                openedBranches: branchesToOpen,
                                stage: currentImportStage // 👈 Usando a variável da etapa
                            });

                            currentTempBranches = currentTempBranches.map(b =>
                                branchesToOpen.some(op => op.id === b.id) ? { ...b, state: 0 } : b
                            );

                        } else if (action === 'FALTA_RESTAURAR') {
                            const node = parseInt(parts[1], 10);
                            importedSteps.push({
                                type: 'fault_remove',
                                nodeId: node,
                                description: `Restauração da falta na barra ${node}`,
                                stage: currentImportStage // 👈 Usando a variável da etapa
                            });
                        }
                    }

                    if (importedSteps.length === 0) return;

                    setSeqOverlayOpen(true);
                    setOptimizerStatus("A carregar sequência exportada...");

                    const baseSnapshot = { branches, faults: faultNodes, shunts: systemShunts };
                    
                    const resultData = {
                        steps: importedSteps,
                        snapshots: buildSnapshots(baseSnapshot, importedSteps, allBoundaryNodes, systemLoads),
                        method: "Sequência Importada"
                    };

                    setSequenceData(resultData);
                    
                    if (resultData.snapshots.length > 0) {
                        const finalSnap = resultData.snapshots[resultData.snapshots.length - 1];
                        setBranches(finalSnap.branches);
                        setFaultNodes(finalSnap.faults);
                    }

                    setTimeout(() => setOptimizerStatus(""), 2500);
                    return; 
                }

                // 👇 2. IMPORTAÇÃO DE ESTADO/TOPOLOGIA (Otimizador Guloso) 👇
                // ⚠️ A LINHA QUE ESTAVA FALTANDO É ESTA AQUI:
                const { updates, newFaults, providedSteps } = parseSequenceFile(fileContent, branches);

                // 👇 2. O PULO DO GATO: Definir o Estado Base
                const isAppending = sequenceData && sequenceData.steps && sequenceData.steps.length > 0;
                const initialSnapshot = isAppending 
                    ? sequenceData.snapshots[sequenceData.snapshots.length - 1] 
                    : { branches, faults: faultNodes, shunts: systemShunts };

                const currentStageNumber = isAppending ? new Set(sequenceData.steps.map(s => s.stage)).size + 1 : 1;
                // 👇 LÓGICA DE NOMENCLATURA POR FALTAS CORRIGIDA 👇
                // Nós usamos as 'newFaults' (O alvo da etapa) em vez das faltas atuais
                const targetFaultsArray = Array.from(newFaults).sort((a, b) => a - b);
                const faultLabel = targetFaultsArray.length > 0 
                    ? `Faltas ${targetFaultsArray.join('-')}` 
                    : "Restauração Final";
                
                const stageName = `Etapa ${faultLabel}`;
                let finalSteps = [];
                let methodTag = "Carregado";

                if (updates.size > 0 || newFaults.size > 0) {
                    setSeqOverlayOpen(true);
                    setOptimizerStatus(`Processando ${stageName}...`);
                    
                    const targetBranches = initialSnapshot.branches.map(b => {
                        const key = `${b.from}-${b.to}`;
                        return updates.has(key) ? { ...b, state: updates.get(key) } : { ...b };
                    });

                    let postFaultSnapshot = { ...initialSnapshot };
                    const faultSteps = [];

                    const importedFaults = newFaults; 
                    const currentFaults = initialSnapshot.faults;

                    const faultsToAdd = [...importedFaults].filter(f => !currentFaults.has(f));
                    const faultsToRemove = [...currentFaults].filter(f => !importedFaults.has(f));

                    faultsToRemove.forEach(nodeId => {
                        const step = { 
                            type: 'fault_remove', 
                            nodeId, 
                            description: `Restauração da falta na barra ${nodeId}`, 
                            stage: stageName
                        };
                        faultSteps.push(step);
                        postFaultSnapshot = applyStepToSnapshot(step, postFaultSnapshot);
                    });

                    faultsToAdd.forEach(nodeId => {
                        const branchesToOpen = findProtectionSwitches(nodeId, postFaultSnapshot.branches);
                        const step = { 
                            type: 'fault_add', 
                            nodeId, 
                            description: `Falta na barra ${nodeId} e Proteção atuada`, 
                            openedBranches: branchesToOpen,
                            stage: stageName
                        };
                        faultSteps.push(step);
                        postFaultSnapshot = applyStepToSnapshot(step, postFaultSnapshot); 
                    });

                    // 1. Roda o Guloso para achar a solução inicial
                    const optResult = await runOptimizer(faultSteps, postFaultSnapshot, targetBranches, sysData, setOptimizerStatus);

                    // 2. Roda o VNS sobre a solução do Guloso
                    const vnsOptimizedSteps = await runVNS(optResult.steps, postFaultSnapshot, sysData, setOptimizerStatus);
                    
                    // 👇 3. A CORREÇÃO: Aplica a etapa na lista do VNS e entrega ela para a Interface 👇
                    vnsOptimizedSteps.forEach(s => { if(!s.stage) s.stage = stageName; });
                    
                    finalSteps = vnsOptimizedSteps; // ✅ AGORA SIM! A interface recebe os blocos agrupados
                    methodTag = optResult.method + " + VNS"; // Mostra na UI que o VNS atuou!
                }

                const allSteps = isAppending ? [...sequenceData.steps, ...finalSteps] : finalSteps;
                const absoluteInitialState = isAppending ? sequenceData.snapshots[0] : initialSnapshot;

                const resultData = {
                    steps: allSteps,
                    snapshots: buildSnapshots(absoluteInitialState, allSteps, allBoundaryNodes, systemLoads),
                    method: methodTag
                };

                if (resultData.snapshots.length > 1) {
                    const finalSnap = resultData.snapshots[resultData.snapshots.length - 1];
                    setBranches(finalSnap.branches);
                    setFaultNodes(finalSnap.faults);
                }

                setSequenceData(resultData); 
                setSeqOverlayOpen(true);
                setTimeout(() => setOptimizerStatus(""), 3000);

            } catch (error) {
                console.error("🚨 ERRO GRAVE:", error);
                showToast(`Erro técnico: ${error.message}`, 'error');
            }
        };
        reader.readAsText(file);
    };

// Lembre-se também de remover o `generateSequence` do topo do seu App.jsx:
// import { parseSequenceFile, buildSnapshots } from './utils/switchSequencer';

const handleExportSequence = useCallback(() => {
        if (!sequenceData?.steps?.length) return;

        let content = "Sequenciamento\n";
        let lastStage = null;
        
        sequenceData.steps.forEach(step => {
            // 👇 Grava a tag de etapa sempre que ela muda 👇
            if (step.stage && step.stage !== lastStage) {
                content += `ETAPA ${step.stage}\n`;
                lastStage = step.stage;
            }
            if (step.type === 'open') content += `ABRIR ${step.fromNode} ${step.toNode}\n`;
            else if (step.type === 'close') content += `FECHAR ${step.fromNode} ${step.toNode}\n`;
            else if (step.type === 'tap') content += `TAP ${step.fromNode} ${step.toNode} ${step.tapValue}\n`;
            else if (step.type === 'shunt_step') content += `SHUNT_STEP ${step.nodeId} ${step.steps}\n`;
            else if (step.type === 'fault_add') content += `FALTA_ADICIONAR ${step.nodeId}\n`;
            else if (step.type === 'fault_remove') content += `FALTA_RESTAURAR ${step.nodeId}\n`;
        });

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; 
        link.download = 'sequenciamento_exportado.txt';
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link); 
        URL.revokeObjectURL(url);

        showToast("Sequência exportada com sucesso!", "success");
    }, [sequenceData]);

    const toggleSwitch = (branchId) => {
        if (seqOverlayOpen && sequenceData && isRecordingSeq) {
            const lastSnapshot = sequenceData.snapshots[sequenceData.snapshots.length - 1];
            const branchInSnap = lastSnapshot.branches.find(b => b.id === branchId);
            if (!branchInSnap) return;
            
            const actionType = branchInSnap.state === 1 ? 'open' : 'close';
            
            const newStep = {
                type: actionType,
                branchId: branchInSnap.id,
                fromNode: branchInSnap.from,
                toNode: branchInSnap.to,
                description: `${actionType === 'open' ? 'Abrir' : 'Fechar'} chave ${branchInSnap.from}–${branchInSnap.to} (Inserido)`
            };
            
            const newSteps = [...sequenceData.steps, newStep];
            const baseSnapshot = sequenceData.snapshots[0]; 
            
            setSequenceData({
                ...sequenceData,
                steps: newSteps,
                snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                method: sequenceData.method.includes('Interativa') ? sequenceData.method : 'Edição Manual Interativa'
            });
            showToast('Manobra inserida no sequenciador!', 'success');
            return;
        }

        // 👇 MODO AO VIVO: ATUALIZADO PARA INFORMAR O ESCUDO 👇
        const branchToToggle = branches.find(b => b.id === branchId);
        if (branchToToggle) {
            setLastEventNodes(new Set([branchToToggle.from, branchToToggle.to]));
        }

        setBranches(prev => prev.map(b => b.id === branchId ? { ...b, state: b.state === 1 ? 0 : 1 } : b));
        showToast('Chave alterada', 'success');
    };

    const toggleGD = useCallback((nodeId) => {
        setSystemGD(prev => {
            if (!prev[nodeId]) return prev;
            return {
                ...prev,
                [nodeId]: { ...prev[nodeId], active: !prev[nodeId].active }
            };
        });
        // Força o redutor a recalcular a ilha afetada
        setLastEventNodes(new Set([nodeId]));
    }, []);

    // Função para ajustar o valor da Geração Distribuída dinamicamente
    const handleGDChange = useCallback((nodeId, field, increment) => {
        setSystemGD(prev => {
            const gd = prev[nodeId];
            if (!gd) return prev;
            
            let newValue = gd[field] + increment;
            
            // Trava Mínima: A geração não pode ser negativa (para não virar carga)
            if (newValue < 0) newValue = 0;
            
            // Trava Máxima: Limitamos pelo Smax cadastrado no gerador
            if (newValue > gd.sMax) newValue = gd.sMax;
            
            if (newValue === gd[field]) return prev; // Nada mudou
            
            return {
                ...prev,
                [nodeId]: { ...gd, [field]: newValue }
            };
        });
        
        // Acorda o Newton-Raphson avisando que a injeção de potência dessa barra mudou!
        setLastEventNodes(new Set([nodeId]));
    }, []);

    const handleTapChange = useCallback((branchId, increment) => {
        // 👇 MODO GRAVAÇÃO DO SEQUENCIADOR 👇
        if (seqOverlayOpen && sequenceData && isRecordingSeq) {
            const lastSnapshot = sequenceData.snapshots[sequenceData.snapshots.length - 1];
            const branchInSnap = lastSnapshot.branches.find(b => b.id === branchId);
            
            if (!branchInSnap || !branchInSnap.isRegulator) return;

            let newTap = branchInSnap.currentTap + increment;
            if (newTap > branchInSnap.maxTaps) newTap = branchInSnap.maxTaps;
            if (newTap < -branchInSnap.maxTaps) newTap = -branchInSnap.maxTaps;

            if (newTap === branchInSnap.currentTap) return; // Nada mudou

            const newStep = {
                type: 'tap',
                branchId: branchId,
                tapValue: newTap,
                fromNode: branchInSnap.from,
                toNode: branchInSnap.to,
                description: `Ajustar TAP ${branchInSnap.from}–${branchInSnap.to} → ${newTap > 0 ? '+' : ''}${newTap} (Inserido)`
            };

            const newStepsArray = [...sequenceData.steps, newStep];
            const baseSnapshot = sequenceData.snapshots[0]; 
            
            setSequenceData({
                ...sequenceData,
                steps: newStepsArray,
                snapshots: buildSnapshots(baseSnapshot, newStepsArray, allBoundaryNodes, systemLoads),
                method: sequenceData.method.includes('Interativa') ? sequenceData.method : 'Edição Manual Interativa'
            });
            
            // Força a atualização na tela imediatamente durante a gravação
            setBranches(prev => prev.map(b => b.id === branchId ? { ...b, currentTap: newTap } : b));
            
            showToast('Ajuste de TAP inserido no sequenciador!', 'success');
            return;
        }

        // 👇 MODO AO VIVO 👇
        setBranches(prev => prev.map(b => {
            if (b.id === branchId && b.isRegulator) {
                let newTap = b.currentTap + increment;
                if (newTap > b.maxTaps) newTap = b.maxTaps;
                if (newTap < -b.maxTaps) newTap = -b.maxTaps;
                return { ...b, currentTap: newTap };
            }
            return b;
        }));
    }, [seqOverlayOpen, sequenceData, isRecordingSeq, allBoundaryNodes, systemLoads]);

const handleShuntChange = useCallback((nodeId, increment) => {
        // MODO GRAVAÇÃO DO SEQUENCIADOR
        if (seqOverlayOpen && sequenceData && isRecordingSeq) {
            const lastSnapshot = sequenceData.snapshots[sequenceData.snapshots.length - 1];
            
            // Pega o estado do capacitor no último snapshot (ou do sistema atual se não existir no snap)
            const shuntInSnap = lastSnapshot?.shunts ? lastSnapshot.shunts[nodeId] : systemShunts[nodeId];
            if (!shuntInSnap) return;

            let newStepsValue = shuntInSnap.steps + increment;
            if (newStepsValue < 0) newStepsValue = 0;
            if (newStepsValue > shuntInSnap.maxSteps) newStepsValue = shuntInSnap.maxSteps;

            if (newStepsValue === shuntInSnap.steps) return; // Nada mudou

            const newStep = {
                type: 'shunt_step',
                nodeId: nodeId,
                steps: newStepsValue,
                description: `Ajustar Capacitor ${nodeId} → Estágio ${newStepsValue} (Inserido)`
            };

            const newStepsArray = [...sequenceData.steps, newStep];
            const baseSnapshot = sequenceData.snapshots[0]; 
            
            setSequenceData({
                ...sequenceData,
                steps: newStepsArray,
                snapshots: buildSnapshots(baseSnapshot, newStepsArray, allBoundaryNodes, systemLoads),
                method: sequenceData.method.includes('Interativa') ? sequenceData.method : 'Edição Manual Interativa'
            });

            setSystemShunts(prev => ({
                ...prev,
                [nodeId]: { ...prev[nodeId], steps: newStepsValue }
            }));

            showToast('Manobra de capacitor inserida no sequenciador!', 'success');
            return;
        }

        // MODO AO VIVO
        setSystemShunts(prev => {
            const shunt = prev[nodeId];
            if (!shunt) return prev;
            
            let newSteps = shunt.steps + increment;
            if (newSteps < 0) newSteps = 0;
            if (newSteps > shunt.maxSteps) newSteps = shunt.maxSteps;
            
            if (newSteps === shunt.steps) return prev; // Nada mudou
            
            return {
                ...prev,
                [nodeId]: { ...shunt, steps: newSteps }
            };
        });
    }, [seqOverlayOpen, sequenceData, isRecordingSeq, systemShunts, allBoundaryNodes, systemLoads]);
    
    const toggleFault = (nodeId) => {
        if (seqOverlayOpen && sequenceData && isRecordingSeq) {
            const lastSnapshot = sequenceData.snapshots[sequenceData.snapshots.length - 1];
            const hasFault = lastSnapshot.faults.has(nodeId);
            
            let newStep;
            if (hasFault) {
                newStep = { type: 'fault_remove', nodeId, description: `Restaurar barra ${nodeId} (Inserido)` };
            } else {
                // Modo Sequenciador: As chaves abrirão sozinhas graças à atualização do switchSequencer.js
                newStep = { type: 'fault_add', nodeId, description: `Falta na barra ${nodeId} e Proteção (Inserido)` };
            }

            const newSteps = [...sequenceData.steps, newStep];
            const baseSnapshot = sequenceData.snapshots[0];
            
            setSequenceData({
                ...sequenceData,
                steps: newSteps,
                snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                method: sequenceData.method.includes('Interativa') ? sequenceData.method : 'Edição Manual Interativa'
            });
            showToast('Falta inserida no sequenciador!', 'success');
            return;
        }

        if (faultNodes.has(nodeId)) {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.delete(nodeId); return newSet; });
            showToast(`Falta removida da barra ${nodeId}`, 'success');
        } else {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.add(nodeId); return newSet; });
            
            setBranches(prevBranches => {
                const branchesToOpen = new Set();
                const visitedNodes = new Set([nodeId]);
                const queue = [nodeId];

                while (queue.length > 0) {
                    const curr = queue.shift();
                    const connected = prevBranches.filter(b => b.state === 1 && (b.from === curr || b.to === curr));
                    connected.forEach(b => {
                        const neighbor = b.from === curr ? b.to : b.from;
                        if (!visitedNodes.has(neighbor)) {
                            if (b.hasSwitch) { 
                                branchesToOpen.add(b.id); 
                            } else if (allBoundaryNodes.includes(neighbor)) {
                                // 👇 BARREIRA INTRANSPONÍVEL (AO VIVO): O barramento da Subestação não permite a falta passar! 👇
                                visitedNodes.add(neighbor);
                            } else { 
                                visitedNodes.add(neighbor); 
                                queue.push(neighbor); 
                            }
                        }
                    });
                }

                if (branchesToOpen.size > 0) {
                    showToast(`Proteção atuou! ${branchesToOpen.size} disjuntor(es) aberto(s) para isolar a falta.`, 'warning');
                    return prevBranches.map(b => branchesToOpen.has(b.id) ? { ...b, state: 0 } : b);
                } else {
                    showToast(`Atenção: Nenhum disjuntor encontrado para isolar a falta na barra ${nodeId}!`, 'error');
                    return prevBranches;
                }
            });
        }
    };

    const resetSystem = () => {
        if (window.confirm("Deseja remover as faltas e voltar as chaves para a posição inicial?")) {
            setFaultNodes(new Set());
            if (initialBranchesRef.current && initialBranchesRef.current.length > 0) {
                setBranches(JSON.parse(JSON.stringify(initialBranchesRef.current)));
            } else {
                setBranches(prev => prev.map(b => ({ ...b, state: 1 })));
            }
             showToast("Sistema reiniciado com sucesso!", "success");
        }
    };

    // Botões da Tela Inicial agora apenas chamam o carregador:
    const handleLoadExample = () => applySystemData(SYSTEM_DATA, "IEEE 53");
    const handleLoadSystem54 = () => applySystemData(SYSTEM_DATA_SHUNT, "IEEE 54 Shunt");

    const handleDownloadTemplate = () => {
        const templateContent = `# Modelo de Arquivo...`; 
        const blob = new Blob([templateContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'Template_IEEE.dat'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
        showToast("Template baixado com sucesso!", "success");
    };

    const handleExportFullState = useCallback((positions, waypoints) => {
        const exportData = {
            version: "1.0", systemName: "Sistema Salvo", baseKV: vBase, sBase: sBase, 
            sources: activeSources, 
            feeders: systemFeeders,
            sses: sses,
            shunts: systemShunts,
            loads: systemLoads,
            gd: systemGD, // 👈 Salva a GD no JSON
            branches: branches, 
            faults: Array.from(faultNodes), 
            layout: { positions: positions, waypoints: waypoints, geoPositions: geoPositions, routes: routedPaths, manualWaypoints: manualWaypoints, straightSegments: straightSegments }
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", "meu_sistema_salvo.json");
        document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        showToast("Projeto exportado com sucesso!", "success");
    }, [branches, faultNodes, sources]);

    useEffect(() => {
        const handleApplyFullState = (e) => {
            const data = e.detail;
            
            if (data.feeders) setSystemFeeders(data.feeders);
            if (data.sses) setSses(data.sses);
            if (data.shunts) setSystemShunts(data.shunts);
            if (data.gd) setSystemGD(data.gd);

            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            const layoutData = data.layout || data;

            // 👇 1. PROTEÇÃO DO MODO MACRO (ESQUELETO) 👇
            if (macroGraph) {
                if (layoutData.positions) {
                    setMacroGraph(prev => ({ ...prev, positions: layoutData.positions }));
                }
                return; // 👈 Impede que as posições originais sejam sobrescritas pelas "amassadas"
            }

            // 👇 2. ATUALIZAÇÃO NORMAL 👇
            if (layoutData.positions) {
                if (layoutMode === 'organic') setOrganicPositions(layoutData.positions);
                else setProjectPositions(layoutData.positions);
            }
            if (layoutData.waypoints) {
                if (layoutMode === 'organic') setOrganicWaypoints(layoutData.waypoints);
                else setProjectWaypoints(layoutData.waypoints);
            }
        };
        
        window.addEventListener('applyGraphLayout', handleApplyFullState);
        return () => window.removeEventListener('applyGraphLayout', handleApplyFullState);
        
    }, [layoutMode, macroGraph]); // 👈 IMPORTANTE: Adicione o macroGraph aqui no array!

    useEffect(() => {
        const handleApplyOrganic = (e) => { 
            setOrganicPositions(e.detail.positions); 
            if (e.detail.waypoints) setOrganicWaypoints(e.detail.waypoints);
            setLayoutMode('organic'); 
        };
        window.addEventListener('applyOrganicLayout', handleApplyOrganic);
        return () => window.removeEventListener('applyOrganicLayout', handleApplyOrganic);
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (e) => { if (isProjectLoaded) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => { window.removeEventListener('beforeunload', handleBeforeUnload); };
    }, [isProjectLoaded]);

    const handleDownloadReportClick = () => {
        // Verifica se há uma sequência de passos carregada e com itens
        if (sequenceData && sequenceData.steps && sequenceData.steps.length > 0) {
            setShowReportModal(true);
        } else {
            generateAndDownloadReport('current');
        }
    };

    const generateAndDownloadReport = (type) => {
        setShowReportModal(false);
        
        // Monta o snapshot do que está na tela agora
        const currentSnapshot = { branches, faults: faultNodes, shunts: systemShunts };

        if (type === 'current' || type === 'both') {
            generateTextReport('current', currentSnapshot, sequenceData, sysData, calcMethod);
            showToast('Relatório do estado atual baixado!', 'success');
        }
        if (type === 'sequence' || type === 'both') {
            generateTextReport('sequence', currentSnapshot, sequenceData, sysData, calcMethod);
            showToast('Relatório da sequência baixado!', 'success');
        }
        // 👇 A CONDIÇÃO QUE ESTAVA FALTANDO 👇
        if (type === 'summary') {
            generateTextReport('summary', currentSnapshot, sequenceData, sysData, calcMethod);
            showToast('Resumo por Etapas baixado!', 'success');
        }
    };

    const handleExportSVG = () => { 
        exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg', calcMethod, sources, systemFeeders, darkMode); 
        showToast('Diagrama vetorizado baixado!', 'success'); 
    };
    
    const handleExportPDF = () => { 
        setSelectedElement(null); setTimeout(() => window.print(), 100); 
    };

    useShortcuts({ 
        setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels, 
        setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
        handleDownloadReportClick, handleExportSVG 
    });

    const handleDeleteStage = (stageName) => {
        if (!window.confirm(`Deseja excluir toda a "${stageName}"?`)) return;
        
        // 👇 PULO DO GATO: Se a etapa for manual, assume 'Etapa 1' para o filtro funcionar
        const newSteps = sequenceData.steps.filter(s => {
            const stepStage = s.stage || 'Etapa 1';
            return stepStage !== stageName;
        });

        // Se o usuário apagou a última etapa restante, fecha o sequenciador de vez
        if (newSteps.length === 0) {
            setSequenceData(null);
            setSeqOverlayOpen(false);
            return;
        }

        const baseSnapshot = sequenceData.snapshots[0];
        setSequenceData({
            ...sequenceData,
            steps: newSteps,
            snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads)
        });
    };

    const handleMoveStage = (stageName, direction) => {
        const steps = [...sequenceData.steps];
        const stages = Array.from(new Set(steps.map(s => s.stage)));
        const currentIndex = stages.indexOf(stageName);
        const newIndex = currentIndex + direction;
        if (newIndex < 0 || newIndex >= stages.length) return;

        const newStagesOrder = [...stages];
        [newStagesOrder[currentIndex], newStagesOrder[newIndex]] = [newStagesOrder[newIndex], newStagesOrder[currentIndex]];

        const reorderedSteps = [];
        newStagesOrder.forEach(st => {
            reorderedSteps.push(...steps.filter(s => s.stage === st));
        });

        const baseSnapshot = sequenceData.snapshots[0];
        setSequenceData({
            ...sequenceData,
            steps: reorderedSteps,
            snapshots: buildSnapshots(baseSnapshot, reorderedSteps, allBoundaryNodes, systemLoads)
        });
    };

    if (!isProjectLoaded) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', backgroundColor: darkMode ? '#121212' : '#f0f2f5', color: darkMode ? '#ffffff' : '#333333', fontFamily: 'sans-serif', transition: 'background-color 0.3s' }}>
                <button onClick={() => setDarkMode(!darkMode)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer' }}> {darkMode ? '☀️' : '🌙'} </button>
                <div style={{ background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.9)', padding: '50px 40px', borderRadius: '16px', boxShadow: darkMode ? '0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)', textAlign: 'center', maxWidth: '450px', width: '90%', border: darkMode ? '1px solid #333' : '1px solid #fff' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>⚡</div>
                    <h1 style={{ margin: '0 0 10px 0', fontSize: '22px', color: darkMode ? '#eee' : '#222' }}>Simulador de Sistemas de Potência</h1>
                    <p style={{ margin: '0 0 30px 0', fontSize: '14px', color: darkMode ? '#aaa' : '#666', lineHeight: '1.5' }}>Motor genérico para simulação e visualização de fluxo de carga e atuação de proteção.</p>
                    <input type="file" ref={welcomeFileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleWelcomeFileUpload} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <button onClick={() => welcomeFileInputRef.current.click()} style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: '#00bcd4', color: '#000', transition: 'transform 0.2s', boxShadow: '0 4px 10px rgba(0, 188, 212, 0.3)' }} onMouseOver={e => e.target.style.transform = 'translateY(-2px)'} onMouseOut={e => e.target.style.transform = 'translateY(0)'}> 📂 Carregar Projeto Salvo (.json) </button>
                        <button onClick={handleLoadExample} style={{ width: '100%', padding: '14px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: darkMode ? '#fff' : '#333', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.background = darkMode ? '#333' : '#e0e0e0'} onMouseOut={e => e.target.style.background = 'transparent'}> 🚀 Iniciar Sistema Exemplo (IEEE 53) </button>
                        <button onClick={handleLoadSystem54} style={{ width: '100%', padding: '14px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: darkMode ? '#00bcd4' : '#00bcd4', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.background = darkMode ? '#333' : '#e0e0e0'} onMouseOut={e => e.target.style.background = 'transparent'}> 🚀 Iniciar Sistema 54 (com Capacitores) </button>
                        <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', color: darkMode ? '#555' : '#aaa' }}><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div><span style={{ padding: '0 10px', fontSize: '12px' }}> OU </span><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div></div>
                        <input type="file" ref={datFileInputRef} accept=".dat,.txt" style={{ display: 'none' }} onChange={handleDatFileUpload} />
                        <button onClick={() => datFileInputRef.current.click()} style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: darkMode ? '#ff9800' : '#ff9800', color: '#000', transition: 'transform 0.2s', boxShadow: '0 4px 10px rgba(255, 152, 0, 0.3)' }} onMouseOver={e => e.target.style.transform = 'translateY(-2px)'} onMouseOut={e => e.target.style.transform = 'translateY(0)'}> 📥 Importar Novo Sistema (.dat AMPL) </button>
                        <button onClick={handleDownloadTemplate} style={{ width: '100%', padding: '8px', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', background: 'transparent', color: darkMode ? '#00bcd4' : '#0097a7', textDecoration: 'underline', transition: 'opacity 0.2s' }} onMouseOver={e => e.target.style.opacity = '0.7'} onMouseOut={e => e.target.style.opacity = '1'}> Precisa de ajuda? Baixe o modelo (.dat) </button>
                    </div>
                </div>

                {isCalculatingLayout && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                        <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                        <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                        <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                        
                        <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                        </div>
                        <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteração {layoutProgress.passes} de 30</p>
                        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="app-container">
            <style>
                {`
                .app-container { display: flex !important; flex-direction: row !important; width: 100vw; height: 100vh; overflow: hidden; background-color: ${darkMode ? '#121212' : '#f0f2f5'}; }
                .graph-wrapper { flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; background-color: ${printFrameMode !== 'none' ? (darkMode ? '#080808' : '#cfd3d6') : 'transparent'}; transition: background-color 0.3s ease; }
                .right-panel-wrapper { position: relative; width: ${isFaultSidebarOpen ? '230px' : '0px'}; transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1); flex-shrink: 0; border-left: ${isFaultSidebarOpen ? '1px solid #333' : 'none'}; }
                .right-panel-wrapper > div.panel-content { position: absolute !important; left: 0 !important; top: 0 !important; width: 230px !important; height: 100vh !important; overflow: hidden; background: ${darkMode ? '#1e1e1e' : '#fff'}; }
                .tool-btn:hover { background-color: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; transform: translateY(-1px); }
                .tool-btn:active { transform: translateY(1px); }
                @media print {
                    @page { size: ${printFrameMode === 'portrait' ? 'portrait' : 'landscape'}; margin: 0mm; }
                    body, html, .app-container { width: 100% !important; height: 100% !important; margin: 0 !important; display: block !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important; }
                    .hide-on-print { display: none !important; }
                    .graph-wrapper { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: transparent !important; display: block !important; }
                    .graph-wrapper, .graph-svg, .graph-svg text {user-select: none !important; -webkit-user-select: none !important; -moz-user-select: none !important; -ms-user-select: none !important; }
                    .paper-container { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: none !important; box-shadow: none !important; aspect-ratio: auto !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important;}
                    .graph-svg { width: 100% !important; height: 100% !important; }
                }
                .voltage-glow-wrapper { filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.9)); transition: filter 0.4s ease-in-out; }
                `}
            </style>

            <div className="hide-on-print" style={{ borderRight: '1px solid #333', zIndex: 100 }}>
                {!isEditMode ? (
                    <Sidebar 
                        sidebarMode={sidebarMode} 
                        darkMode={darkMode} 
                        setDarkMode={setDarkMode} 
                        resetSystem={resetSystem} 
                        maintenanceMode={maintenanceMode} 
                        setMaintenanceMode={setMaintenanceMode} 
                        showLabels={showLabels} 
                        setShowLabels={setShowLabels} 
                        selectedElement={displayElement} 
                        sources={sources} 
                        loads={loads} 
                        faultNodes={faultNodes} 
                        branches={branches} 
                        toggleSwitch={toggleSwitch} 
                        setSelectedElement={setSelectedElement} 
                        setHoveredLineId={setHoveredLineId} 
                        onDownloadReport={handleDownloadReportClick}
                        onUploadSwitches={handleUploadSwitches} 
                        calcMethod={calcMethod} 
                        setCalcMethod={setCalcMethod} 
                        onExportSVG={handleExportSVG} 
                        onExportPDF={handleExportPDF} 
                        getNodeColor={getNodeColor} 
                        getEdgeColor={getEdgeColor} 
                        systemSize={Math.max(0, allNodes.length)} 
                        disconnectedStats={disconnectedStats} 
                        lineCurrents={lineCurrents} 
                        feedersList={systemFeeders}
                        nodeData={nodeData}
                        systemLoads={systemLoads}
                        systemShunts={systemShunts}
                        setViewMode={setViewMode}
                        sBase={sBase}
                        sses={sses}
                        handleTapChange={handleTapChange}
                        handleShuntChange={handleShuntChange}
                        viewMode={viewMode}
                        vBase={vBase} 
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                        handleGDChange={handleGDChange}
                    />
                ) : (
                    <EditSidebar 
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        darkMode={darkMode} 
                        onUndo={handleUndoLayout} 
                        canUndo={layoutHistory.length > 0} 
                        onReset={handleResetToOriginalLayout} 
                        branches={branches} 
                        allNodes={allNodes} 
                        sources={sources} 
                        currentPositions={activePositions}
                        setIsCalculatingLayout={setIsCalculatingLayout}
                        setLayoutProgress={setLayoutProgress}
                    />
                )}
            </div>

            {macroGraph && (
                <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, background: '#ff5722', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', display: 'flex', gap: '15px', alignItems: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                    <span>⚠️ Modo de Depuração: Grafo Compactado (Coarsening)</span>
                    
                    {/* 👇 BOTÃO DE APLICAR (A MÁGICA) 👇 */}
                    <button 
                        onClick={() => {
                            const basePos = layoutMode === 'organic' ? (organicPositions || projectPositions) : projectPositions;
                            
                            let coarseInfo = macroGraph.macroData?.coarseData;
                            
                            // Blindagem 1: Recálculo Determinístico
                            if (!coarseInfo || (!coarseInfo.prunedMap && !coarseInfo.chainMap)) {
                                console.log("⚙️ Reconstruindo mapa de poda do esqueleto...");
                                const contraction = contractTopology(allNodes, branches, sources);
                                coarseInfo = contraction.coarseData;
                            }
                            
                            // Desdobra o esqueleto de volta para os 54 nós
                            const newFullPositions = expandTopology(
                                macroGraph.positions,
                                coarseInfo, 
                                basePos
                            );

                            
                            // 👇 BLINDAGEM 2: Prevenção de Abismo
                            const safeFullPositions = { ...basePos, ...newFullPositions };
                            
                            // 👇 O TOQUE DE MESTRE DA ENGENHARIA 👇
                            const skeletonIds = Object.keys(macroGraph.positions);
                            
                            // ❌ Removemos a captura das sanfonas daqui! 
                            // Agora SOMENTE as âncoras do Esqueleto ganham "chumbo nos pés"
                            const fixedIds = [...skeletonIds];
                            
                            // Roda a física RESTRITA (agora passando o coarseInfo)
                            const finalRelaxedPositions = relaxExpandedNodes(
                                safeFullPositions, 
                                fixedIds, // Apenas esqueleto travado
                                allNodes, 
                                branches,
                                coarseInfo // 👈 IMPORTANTE: Passe a memória da poda aqui!
                            );
                            
                            // Salva no estado oficial as posições RELAXADAS
                            if (layoutMode === 'organic') {
                                setOrganicPositions(finalRelaxedPositions);
                            } else {
                                setProjectPositions(finalRelaxedPositions);
                            }
                            
                            // Encerra o modo de depuração
                            setMacroGraph(null);
                        }} 
                        style={{ background: '#4caf50', color: '#fff', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ✔ Expandir e Salvar
                    </button>

                    {/* 👇 BOTÃO DE DESCARTAR 👇 */}
                    <button 
                        onClick={() => setMacroGraph(null)} 
                        style={{ background: '#fff', color: '#ff5722', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ❌ Descartar
                    </button>
                </div>
            )}

            <div className="graph-wrapper">
                {/* ... Botões flutuantes mantidos ... */}
                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', top: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px', borderRadius: '14px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Menu Esquerdo" onClick={() => {if (isEditMode) setIsEditMode(false); else setSidebarMode(p => p === 'full' ? 'mini' : (p === 'mini' ? 'hidden' : 'full'))}}>≡</button>
                    <div style={{ height: '1px', width: '70%', margin: '2px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: isEditMode ? '#ff9800' : (darkMode ? '#fff' : '#333'), transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Modo Edição" onClick={() => setIsEditMode(!isEditMode)}>✏️</button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Atalhos" onClick={() => setShowShortcuts(true)}>⌨️</button>
                    
                    <div style={{ height: '1px', width: '70%', margin: '2px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: seqOverlayOpen ? '#00bcd4' : (darkMode ? '#fff' : '#333'), transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Abrir Sequenciador (Planejamento)" onClick={handleOpenEmptySequencer}>🎬</button>
                </div>

                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px 6px', borderRadius: '20px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Centralizar Gráfico" onClick={() => window.dispatchEvent(new CustomEvent('triggerZoomExtents'))}>🎯</button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', flexDirection: 'column' }} title="Alternar Folha / Tela Cheia" onClick={() => setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'))}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: printFrameMode !== 'none' ? '#ff9800' : 'inherit' }}>A4</span>
                        <span style={{ opacity: 0.8, fontSize: '10px' }}>{printFrameMode === 'none' ? '🔲' : (printFrameMode === 'landscape' ? '↔' : '↕')}</span>
                    </button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', opacity: showLegend ? 1 : 0.4 }} title="Mostrar/Ocultar Legenda" onClick={() => setShowLegend(!showLegend)}>👁️</button>
                </div>

                {printFrameMode !== 'none' && (
                    <div className="hide-on-print" style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#ff9800', color: '#000', padding: '6px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}> Visualização de Impressão: {printFrameMode === 'landscape' ? 'Paisagem' : 'Retrato'} (Ctrl+P para Imprimir) </div>
                )}

                {/* 👇 COLE O NOVO PAINEL AQUI 👇 */}
                {/* PAINEL DE POLIMENTO DE LAYOUT (SÓ APARECE NO MODO EDIÇÃO) */}
                {isEditMode && (
                    <div className="hide-on-print" style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: '15px', alignItems: 'center', background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255,255,255,0.8)', padding: '10px 20px', borderRadius: '30px', backdropFilter: 'blur(10px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                        
                        {/* Indicador de Cruzamentos (Agora é um botão interativo) */}
                        <button 
                            onClick={() => setShowCrossings(!showCrossings)}
                            title="Mostrar/Ocultar marcadores de cruzamento"
                            style={{ 
                                background: intersections.length > 0 ? (showCrossings ? '#f44336' : '#d32f2f') : '#4caf50', 
                                color: '#fff', 
                                padding: '6px 12px', 
                                borderRadius: '20px', 
                                fontSize: '12px', 
                                fontWeight: 'bold', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '5px',
                                border: 'none',
                                cursor: intersections.length > 0 ? 'pointer' : 'default',
                                transition: 'all 0.2s',
                                opacity: showCrossings || intersections.length === 0 ? 1 : 0.6
                            }}
                            onMouseOver={e => intersections.length > 0 && (e.target.style.transform='scale(1.05)')}
                            onMouseOut={e => intersections.length > 0 && (e.target.style.transform='scale(1)')}
                        >
                            {intersections.length > 0 
                                ? `⚠️ ${intersections.length} Cruzamentos ${showCrossings ? '(Ocultar)' : '(Mostrar)'}` 
                                : '✅ Sem Cruzamentos'}
                        </button>

                        {/* Motor Compactador */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 0.90); // 0.90 = Encolhe 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Aproxima as barras em 10% para o centro"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🗜️ Compactar (10%)
                        </button>

                        {/* Motor Expansor (NOVO) */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 1.10); // 1.10 = Expande 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Afasta as barras em 10% a partir do centro"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🌌 Expandir (10%)
                        </button>
                    </div>
                )}
                {/* 👆 FIM DO PAINEL 👆 */}

                {/* 👇 A MÁGICA ACONTECE AQUI: ALTERNÂNCIA DE TELAS 👇 */}
                {viewMode === 'schematic' ? (
                    <GraphArea 
                        darkMode={darkMode}
                        printFrameMode={printFrameMode} 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        branches={macroGraph?.macroData?.branches || branches} 
                        allNodes={macroGraph?.macroData?.nodes || allNodes} 
                        sources={sources} showLabels={showLabels} 
                        getEdgeColor={getEdgeColor} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={selectedElement} 
                        hoveredLineId={effectiveHoveredLineId} 
                        setHoveredLineId={setHoveredLineId} 
                        hoveredNodeId={hoveredNodeId} 
                        setHoveredNodeId={setHoveredNodeId} 
                        maintenanceMode={maintenanceMode} 
                        activePositions={activePositions} 
                        activeWaypoints={activeWaypoints} 
                        lineCurrents={lineCurrents} 
                        nodeData={nodeData} 
                        nodeFeeds={nodeFeeds}
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        onSaveLayoutToHistory={saveLayoutToHistory} 
                        loads={loads} systemLoads={systemLoads} 
                        onExportRequest={handleExportFullState} 
                        sses={sses} 
                        feedersList={systemFeeders} 
                        handleTapChange={handleTapChange}
                        systemShunts={systemShunts} 
                        handleShuntChange={handleShuntChange}
                        systemGD={systemGD}    // 👈 Adicione esta linha
                        toggleGD={toggleGD}    // 👈 Adicione esta linha (se for usar dentro do GraphArea)
                        intersections={intersections}
                        showCrossings={showCrossings}
                    >
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                    </div>
                                </div>
                                
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> SUB {s}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> ALIM {f}</div>
                                ))}

                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                            </div>
                        )}
                    </GraphArea>
                ) : (
                    <MapArea 
                        darkMode={darkMode}
                        branches={branches} 
                        sources={sources} 
                        feedersList={systemFeeders} 
                        sses={sses}
                        getEdgeColor={getEdgeColor} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        nodeData={nodeData}
                        lineCurrents={lineCurrents}
                        isEditMode={isEditMode}
                        systemShunts={systemShunts}
                        hoveredLineId={hoveredLineId}
                        setHoveredLineId={setHoveredLineId}
                        hoveredNodeId={hoveredNodeId}
                        setHoveredNodeId={setHoveredNodeId}
                        loads={loads}
                        systemLoads={systemLoads}
                        allNodes={allNodes}
                        svgPositions={activePositions}
                        geoPositions={geoPositions}
                        setGeoPositions={setGeoPositions}
                        routedPaths={routedPaths}
                        setRoutedPaths={setRoutedPaths}
                        manualWaypoints={manualWaypoints}
                        setManualWaypoints={setManualWaypoints}
                        straightSegments={straightSegments}
                        setStraightSegments={setStraightSegments}
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                    >
                        {/* 👇 A LEGENDA AGORA É ENVIADA PARA DENTRO DO MAPA 👇 */}
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                    </div>
                                </div>
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> SUB {s}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> ALIM {f}</div>
                                ))}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                            </div>
                        )}
                    </MapArea>
                )}
            </div>

            <div className="hide-on-print right-panel-wrapper" style={{ zIndex: 100 }}>
                <div onClick={() => setFaultSidebarOpen(!isFaultSidebarOpen)} title={isFaultSidebarOpen ? "Ocultar Painel" : "Diretório de Elementos"} style={{ position: 'absolute', left: '-28px', top: 'calc(50% - 35px)', width: '28px', height: '70px', background: darkMode ? '#1e1e1e' : '#fff', borderTop: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderBottom: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderLeft: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', color: '#ff9800', zIndex: 101, transition: 'background-color 0.2s' }}> {isFaultSidebarOpen ? '▶' : '⚡'} </div>
                <div className="panel-content">
                    <FaultPanel 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        setFaultSidebarOpen={setFaultSidebarOpen} 
                        sources={sources} 
                        loadNodes={loadNodes} 
                        faultNodes={faultNodes} 
                        nodeFeeds={nodeFeeds} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={displayElement} 
                        setHoveredNodeId={setHoveredNodeId} 
                        getNodeColor={getNodeColor} 
                        darkMode={darkMode} 
                        THEME={THEME} 
                        branches={branches} 
                        feedersList={systemFeeders}
                        
                        // 👇 ADICIONADO PARA A LISTA DE CHAVES QUE AGORA FICA AQUI 👇
                        toggleSwitch={toggleSwitch}
                        setHoveredLineId={setHoveredLineId}
                        loopNodes={loopNodes}
                    />
                </div>
            </div>

            {showShortcuts && (
                <div className="hide-on-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setShowShortcuts(false)}>
                    <div style={{ background: darkMode ? '#222' : '#fff', color: darkMode ? '#fff' : '#000', padding: '25px', borderRadius: '12px', width: '350px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #555', paddingBottom: '10px' }}>Atalhos de Teclado</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '2' }}>
                            <li><strong style={{ color: '#00bcd4' }}>Clique (Chave)</strong> - Abrir/Fechar Chave</li>
                            <li><strong style={{ color: '#00bcd4' }}>Clique (Barra)</strong> - Inserir/Remover Falta</li>
                            <li><strong style={{ color: '#ff9800' }}>Ctrl + Clique</strong> - Inspecionar Elemento (Seleção Fixa)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Clique</strong> - Fixar/Desafixar Tooltip (Post-it)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Arrastar Fundo</strong> - Seleção Múltipla (Modo Edição)</li>
                            <li><strong style={{ color: '#ff9800' }}>Duplo Clique (Linha)</strong> - Criar/Remover Joelho (Modo Edição)</li>
                            <hr style={{ borderColor: '#444', margin: '8px 0' }} />
                            <li><strong style={{ color: '#4caf50' }}>Z</strong> - Centralizar Diagrama na Tela</li>
                            <li><strong style={{ color: '#4caf50' }}>P</strong> - Alterar Paisagem/Retrato (Impressão)</li>
                            <li><strong style={{ color: '#4caf50' }}>Ctrl + P</strong> - Imprimir / Salvar PDF</li>
                            <li><strong style={{ color: '#4caf50' }}>E</strong> - Entrar/Sair do Modo de Edição</li>
                            <li><strong style={{ color: '#4caf50' }}>D</strong> - Alternar Tema (Escuro/Claro)</li>
                            <li><strong style={{ color: '#4caf50' }}>L</strong> - Mostrar/Ocultar Labels</li>
                            <li><strong style={{ color: '#4caf50' }}>M</strong> - Alternar Método (NR / GS)</li>
                            <li><strong style={{ color: '#4caf50' }}>R</strong> - Reiniciar Sistema (Limpar Faltas)</li>
                        </ul>
                        <button onClick={() => setShowShortcuts(false)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#00bcd4', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>Fechar</button>
                    </div>
                </div>
            )}
            
            {seqOverlayOpen && sequenceData && (
                <SequenceOverlay
                    onMoveStage={handleMoveStage}
                    onDeleteStage={handleDeleteStage}
                    steps={sequenceData.steps}
                    snapshots={sequenceData.snapshots}
                    method={sequenceData.method}
                    darkMode={darkMode}
                    isRecording={isRecordingSeq}
                    onToggleRecording={() => setIsRecordingSeq(!isRecordingSeq)}
                    onClose={() => { 
                        setSeqOverlayOpen(false); 
                        setIsRecordingSeq(false); 
                        setSequenceData(null); // 👈 ISSO MATA A MEMÓRIA DA SEQUÊNCIA MANUAL
                        
                        // Retorna o sistema ao normal ao fechar
                        if (initialBranchesRef.current && initialBranchesRef.current.length > 0) {
                            setBranches(JSON.parse(JSON.stringify(initialBranchesRef.current)));
                        } else {
                            setBranches(prev => prev.map(b => ({ ...b, state: 1 })));
                        }
                    }}
                    onHoverBranch={setHoveredSeqBranch}
                    onApplySnapshot={(snapshot) => {
                        setBranches(snapshot.branches);
                        setFaultNodes(snapshot.faults);
                        if (snapshot.shunts) setSystemShunts(snapshot.shunts); // 👈 ADICIONAR ESTA LINHA
                    }}
                    onReorderSteps={(newSteps) => {
                        const baseSnapshot = sequenceData.snapshots[0];
                        setSequenceData({
                            ...sequenceData,
                            steps: newSteps,
                            snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                            method: sequenceData.method.replace(' (Reordenado)', '') + ' (Reordenado)'
                        });
                    }}
                    onDeleteStep={(indexToRemove) => {
                        const newSteps = [...sequenceData.steps];
                        newSteps.splice(indexToRemove, 1);
                        const baseSnapshot = sequenceData.snapshots[0];
                        setSequenceData({
                            ...sequenceData,
                            steps: newSteps,
                            snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                            method: sequenceData.method.replace(' (Editado)', '') + ' (Editado)'
                        });
                    }}
                    onExportSequence={handleExportSequence}
                    onToggleStepAction={(idx) => {
                        const newSteps = [...sequenceData.steps];
                        const step = newSteps[idx];
                        
                        if (step.type === 'open') {
                            step.type = 'close';
                            step.description = `Fechar chave ${step.fromNode}–${step.toNode} (Alterado)`;
                        } else if (step.type === 'close') {
                            step.type = 'open';
                            step.description = `Abrir chave ${step.fromNode}–${step.toNode} (Alterado)`;
                        } else if (step.type === 'fault_add') {
                            step.type = 'fault_remove';
                            step.description = `Restaurar barra ${step.nodeId} (Alterado)`;
                        } else if (step.type === 'fault_remove') {
                            step.type = 'fault_add';
                            step.description = `Falta na barra ${step.nodeId} e Proteção (Alterado)`;
                        } else {
                            return; 
                        }
                        
                        const baseSnapshot = sequenceData.snapshots[0];
                        setSequenceData({
                            ...sequenceData,
                            steps: newSteps,
                            snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                            method: sequenceData.method.includes('Editado') ? sequenceData.method : sequenceData.method + ' (Editado)'
                        });
                    }}
                    onUpdateStepValue={(idx, newValue) => {
                        const newSteps = [...sequenceData.steps];
                        const step = newSteps[idx];
                        
                        if (step.type === 'tap') {
                            const b = branches.find(br => br.id === step.branchId);
                            let clamped = newValue;
                            if (b) {
                                if (clamped < -b.maxTaps) clamped = -b.maxTaps;
                                if (clamped > b.maxTaps) clamped = b.maxTaps;
                            }
                            if (clamped === step.tapValue) return;
                            step.tapValue = clamped;
                            step.description = `Ajustar TAP ${step.fromNode}–${step.toNode} → ${clamped > 0 ? '+' : ''}${clamped} (Alterado)`;
                        } else if (step.type === 'shunt_step') {
                            const shunt = systemShunts[step.nodeId];
                            let clamped = newValue;
                            if (shunt) {
                                if (clamped < 0) clamped = 0;
                                if (clamped > shunt.maxSteps) clamped = shunt.maxSteps;
                            }
                            if (clamped === step.steps) return;
                            step.steps = clamped;
                            step.description = `Ajustar Capacitor ${step.nodeId} → Estágio ${clamped} (Alterado)`;
                        }

                        const baseSnapshot = sequenceData.snapshots[0];
                        setSequenceData({
                            ...sequenceData,
                            steps: newSteps,
                            snapshots: buildSnapshots(baseSnapshot, newSteps, allBoundaryNodes, systemLoads),
                            method: sequenceData.method.includes('Editado') ? sequenceData.method : sequenceData.method + ' (Editado)'
                        });
                    }}
                    onActiveStepChange={(step) => {
                        if (!step) {
                            setSelectedElement(null); 
                        } else {
                            // Marca o elemento no mapa
                            if (step.branchId !== undefined) {
                                setSelectedElement({ type: 'edge', data: { id: step.branchId } });
                            } else if (step.nodeId !== undefined) {
                                setSelectedElement({ type: 'node', id: step.nodeId });
                            }
                            
                            // 👇 POPUP DE ALÍVIO DE CARGA / BBM 👇
                            if (step.isLoadShedding && step.alertMessage) {
                                showToast(step.alertMessage, 'warning');
                            }
                        }
                    }}
                    optimizerStatus={optimizerStatus}
                    onOptimizeSequence={async () => {
                        setOptimizerStatus("Iniciando Otimização VNS (Reordenamento)...");
                        
                        const trueInitialSnapshot = sequenceData.snapshots[0]; 
                        
                        // 👇 3. Chama o VNS manualmente pelo botão 👇
                        const vnsResultSteps = await runVNS(sequenceData.steps, trueInitialSnapshot, sysData, setOptimizerStatus);
                        
                        setSequenceData({
                            steps: vnsResultSteps,
                            snapshots: buildSnapshots(trueInitialSnapshot, vnsResultSteps, allBoundaryNodes, systemLoads),
                            method: sequenceData.method.replace(' + VNS', '') + ' + VNS (Manual)'
                        });
                        setTimeout(() => setOptimizerStatus(""), 3000);
                    }}
                />
            )}
            
            {toast && <div className="toast">{toast.message}</div>}

            {showReportModal && (
                <div className="hide-on-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setShowReportModal(false)}>
                    <div style={{ background: darkMode ? '#222' : '#fff', color: darkMode ? '#fff' : '#000', padding: '25px', borderRadius: '12px', width: '380px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #555', paddingBottom: '10px' }}>📄 Exportar Relatório</h3>
                        <p style={{ fontSize: '14px', marginBottom: '20px', color: darkMode ? '#aaa' : '#666' }}>O sistema detectou uma sequência de manobras ativa. Qual formato de relatório deve ser gerado?</p>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button onClick={() => generateAndDownloadReport('current')} style={{ padding: '12px', background: '#4caf50', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseOver={e => e.target.style.opacity = '0.8'} onMouseOut={e => e.target.style.opacity = '1'}>
                                Apenas Estado Final
                            </button>
                            <button onClick={() => generateAndDownloadReport('sequence')} style={{ padding: '12px', background: '#00bcd4', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseOver={e => e.target.style.opacity = '0.8'} onMouseOut={e => e.target.style.opacity = '1'}>
                                Sequência Completa
                            </button>
                            <button onClick={() => generateAndDownloadReport('summary')} style={{ padding: '12px', background: '#ff9800', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>
                                Resumo por Etapa (Estado Pós-Restauração)
                            </button>
                        </div>
                        
                        <button onClick={() => setShowReportModal(false)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: 'transparent', border: `1px solid ${darkMode ? '#555' : '#ccc'}`, borderRadius: '6px', color: darkMode ? '#fff' : '#000', cursor: 'pointer' }}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* 👇 TELA DE CARREGAMENTO DO WORKER 👇 */}
            {isCalculatingLayout && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                    <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                    <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                    <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                    
                    <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                    </div>
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteração {layoutProgress.passes} de 30</p>
                    <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
        </div>
    );
}

export default App;