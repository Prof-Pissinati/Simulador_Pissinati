import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { propagateFeeds, calculateLoads, runPowerFlow, CacheManager } from './utils/powerCalculations';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import MapArea from './components/MapArea';
import GraphArea from './components/GraphArea';
import EditSidebar from './components/EditSidebar'; 
import { exportSVG } from './utils/exportUtils';
import './index.css';
import { useFileImport } from './hooks/useFileImport';
import { calculateForceLayout } from './utils/autoLayout';
import { useShortcuts } from './hooks/useShortcuts';
import { useColorIntelligence, getBaseColor } from './hooks/useColorIntelligence';
import { SYSTEM_DATA} from './data/systemData';
import { SYSTEM_DATA_SHUNT } from './data/systemData54';

import { parseSequenceFile, generateSequence, buildSnapshots } from './utils/switchSequencer';
import SequenceOverlay from './components/SequenceOverlay';

function App() {
    const [activeSources, setActiveSources] = useState([101, 102, 104]);
    const [darkMode, setDarkMode] = useState(true); 
    // Controle de Visualização: 'schematic' (Diagrama SVG) ou 'map' (Georreferenciado Leaflet)
    const [viewMode, setViewMode] = useState('schematic');
    const [branches, setBranches] = useState(() => SYSTEM_DATA.branches.map((b, idx) => ({ 
        ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
    })));

    const initialBranchesRef = useRef(SYSTEM_DATA.branches.map((b, idx) => ({ 
        ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
    })));
    
    const [faultNodes, setFaultNodes] = useState(new Set());

    const [systemShunts, setSystemShunts] = useState(SYSTEM_DATA.shunts || {});
    
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

    const [layoutHistory, setLayoutHistory] = useState([]); 
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    const [projectPositions, setProjectPositions] = useState(SYSTEM_DATA.positionsProject || {});
    const [projectWaypoints, setProjectWaypoints] = useState(SYSTEM_DATA.waypointsProject || {});
    const [organicWaypoints, setOrganicWaypoints] = useState({});

    const [systemLoads, setSystemLoads] = useState(SYSTEM_DATA.loads);

    const activePositions = useMemo(() => layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions), [layoutMode, projectPositions, organicPositions]);
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
    const allNodes = Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b);
    const sources = activeSources;
    const loadNodes = allNodes.filter(n => !sources.includes(n));

    // 👇 IMPORTANTE: Esta lista mista blinda os barramentos para o Sequenciador 👇
    const allBoundaryNodes = useMemo(() => [...sources, ...(SYSTEM_DATA.feeders || [])], [sources]);

    useEffect(() => {
        if (layoutMode === 'organic' && !organicPositions && allNodes.length > 0) {
            const newLayout = calculateForceLayout(allNodes, branches, sources, { distance: 80, charge: -400 });
            setOrganicPositions(newLayout);
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
        loads: systemLoads, 
        Vbase: SYSTEM_DATA.Vbase || 13.8,
        Sbase: SYSTEM_DATA.Sbase || 1000,
        shunts: systemShunts || {}, 
        sses: SYSTEM_DATA.sses || {}      
    }), [activeSources, branches, systemLoads, systemShunts]);

    const nodeFeeds = useMemo(() => propagateFeeds(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    
    const disconnectedStats = useMemo(() => {
        let totalP = 0, totalQ = 0, count = 0;
        loadNodes.forEach(nodeId => {
            const feeds = nodeFeeds[nodeId];
            if ((!feeds || feeds.size === 0) && !faultNodes.has(nodeId)) {
                const load = SYSTEM_DATA.loads[nodeId];
                if (load) { totalP += load.p || 0; totalQ += load.q || 0; count++; }
            }
        });
        const sKVA = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
        const estimatedCurrent = sKVA / (Math.sqrt(3) * 12.43); 
        return { p: totalP, q: totalQ, current: estimatedCurrent || 0, count: count };
    }, [loadNodes, nodeFeeds, faultNodes]);

    const powerFlowResults = useMemo(() => {
        const cached = CacheManager.get(branches, faultNodes, calcMethod, sysData);
        if (cached) return cached;
        const result = runPowerFlow(branches, faultNodes, calcMethod, sysData); 
        CacheManager.set(branches, faultNodes, calcMethod, sysData, result);
        return result;
    }, [branches, faultNodes, calcMethod, sysData]);

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    const feedersList = SYSTEM_DATA.feeders || [];
    const { getNodeColor, getEdgeColor } = useColorIntelligence({
        branches, faultNodes, activeSources, nodeFeeds, lineCurrents, darkMode, feedersList
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
        setSystemLoads,
        setBranches,
        setFaultNodes,
        setActiveSources,
        setIsProjectLoaded,
        setProjectPositions,
        setProjectWaypoints,
        showToast,
        initialBranchesRef
    });

    const handleUploadSwitches = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const { updates, newFaults, providedSteps } = parseSequenceFile(e.target.result, branches);
            if (updates.size === 0 && newFaults.size === 0 && (!providedSteps || providedSteps.length === 0)) { 
                showToast('Arquivo lido, mas nenhum dado compatível encontrado.', 'warning'); return; 
            }

            const targetBranches = branches.map(b => {
                const key = `${b.from}-${b.to}`;
                return updates.has(key) ? { ...b, state: updates.get(key) } : { ...b };
            });

            const result = generateSequence(branches, faultNodes, targetBranches, newFaults, allBoundaryNodes, systemLoads, providedSteps);
            setSequenceData(result); 
            setSeqOverlayOpen(true);
            showToast(`Sequenciamento gerado: ${result.steps.length} manobras.`, 'success');
        };
        reader.readAsText(file);
    };

    // 👇 NOVA FUNÇÃO PARA EXPORTAR A SEQUÊNCIA 👇
    const handleExportSequence = useCallback(() => {
        if (!sequenceData || !sequenceData.steps || sequenceData.steps.length === 0) {
            showToast('Não há passos no sequenciador para exportar.', 'warning');
            return;
        }

        let content = "Sequenciamento\n";
        sequenceData.steps.forEach(step => {
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

        setBranches(prev => prev.map(b => b.id === branchId ? { ...b, state: b.state === 1 ? 0 : 1 } : b));
        showToast('Chave alterada', 'success');
    };

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

    const handleLoadExample = () => {
        const defaultBranches = SYSTEM_DATA.branches.map((b, idx) => ({ 
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
        }));
        
        setBranches(defaultBranches);
        initialBranchesRef.current = JSON.parse(JSON.stringify(defaultBranches)); 
        setSystemLoads(SYSTEM_DATA.loads); 
        setSystemShunts(SYSTEM_DATA.shunts || {});
        setActiveSources(SYSTEM_DATA.sources || [101, 102, 104]); 
        
        // 👇 AQUI ESTÁ O SEGREDO: Resetar as posições para o mapa do 53! 👇
        setProjectPositions(SYSTEM_DATA.positionsProject || {});
        setProjectWaypoints(SYSTEM_DATA.waypointsProject || {});

        setFaultNodes(new Set());
        window.dispatchEvent(new CustomEvent('resetGraphLayout'));
        setIsProjectLoaded(true);
    };

    const handleLoadSystem54 = () => {
        const defaultBranches = SYSTEM_DATA_SHUNT.branches.map((b, idx) => ({
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
        }));
        
        setBranches(defaultBranches);
        initialBranchesRef.current = JSON.parse(JSON.stringify(defaultBranches)); 
        setSystemLoads(SYSTEM_DATA_SHUNT.loads); 
        setSystemShunts(SYSTEM_DATA_SHUNT.shunts || {});
        setActiveSources(SYSTEM_DATA_SHUNT.sources || [1000]);
        SYSTEM_DATA.feeders = SYSTEM_DATA_SHUNT.feeders;
        SYSTEM_DATA.sses = SYSTEM_DATA_SHUNT.sses;
        
        // 👇 AQUI ESTÁ O SEGREDO: Puxar as posições do mapa do 54! 👇
        setProjectPositions(SYSTEM_DATA_SHUNT.positionsProject || {});
        setProjectWaypoints(SYSTEM_DATA_SHUNT.waypointsProject || {});

        setFaultNodes(new Set());
        window.dispatchEvent(new CustomEvent('resetGraphLayout'));
        setIsProjectLoaded(true);
    };

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
            version: "1.0", systemName: "Sistema Salvo", baseKV: SYSTEM_DATA.Vbase || 13.8, sBase: SYSTEM_DATA.Sbase || 1000, 
            sources: sources, 
            feeders: SYSTEM_DATA.feeders || [],
            sses: SYSTEM_DATA.sses || {},
            shunts: SYSTEM_DATA.shunts || {},
            loads: SYSTEM_DATA.loads, 
            branches: branches, 
            faults: Array.from(faultNodes), 
            layout: { positions: positions, waypoints: waypoints }
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
            
            if (data.feeders) SYSTEM_DATA.feeders = data.feeders;
            if (data.sses) SYSTEM_DATA.sses = data.sses;
            if (data.shunts) SYSTEM_DATA.shunts = data.shunts;

            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            const layoutData = data.layout || data;
            
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
        
    }, [layoutMode]);

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

    const handleDownloadReport = () => {
        let report = "⚡ RELATÓRIO DO SISTEMA ELÉTRICO\n";
        const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `relatorio_sistema.txt`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        showToast('Relatório baixado!', 'success');
    };

    const handleExportSVG = () => { 
        exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg', calcMethod, sources, feedersList, darkMode); 
        showToast('Diagrama vetorizado baixado!', 'success'); 
    };
    
    const handleExportPDF = () => { 
        setSelectedElement(null); setTimeout(() => window.print(), 100); 
    };

    useShortcuts({ 
        setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels, 
        setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
        handleDownloadReport, handleExportSVG 
    });

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
                        onDownloadReport={handleDownloadReport} 
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
                        feedersList={SYSTEM_DATA.feeders || []}
                        nodeData={nodeData}
                        systemLoads={systemLoads}
                        systemShunts={systemShunts}
                        handleTapChange={handleTapChange}
                        handleShuntChange={handleShuntChange}
                        // 👇 AS DUAS LINHAS NOVAS AQUI 👇
                        viewMode={viewMode}
                        setViewMode={setViewMode}
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
                    />
                )}
            </div>

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

                {/* 👇 A MÁGICA ACONTECE AQUI: ALTERNÂNCIA DE TELAS 👇 */}
                {viewMode === 'schematic' ? (
                    <GraphArea 
                        darkMode={darkMode}
                        printFrameMode={printFrameMode} 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        branches={branches} allNodes={allNodes} 
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
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        onSaveLayoutToHistory={saveLayoutToHistory} 
                        loads={loads} systemLoads={systemLoads} 
                        onExportRequest={handleExportFullState} 
                        sses={SYSTEM_DATA.sses} 
                        feedersList={SYSTEM_DATA.feeders || []} 
                        handleTapChange={handleTapChange}
                        systemShunts={systemShunts} 
                        handleShuntChange={handleShuntChange}
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
                                    <div key={s} className="legend-item">
                                        <div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...feedersList], darkMode) }}></div> 
                                        SUB {s}
                                    </div>
                                ))}
                                
                                {feedersList.map(f => (
                                    <div key={f} className="legend-item">
                                        <div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...feedersList], darkMode) }}></div> 
                                        ALIM {f}
                                    </div>
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
                        feedersList={SYSTEM_DATA.feeders || []} 
                        getEdgeColor={getEdgeColor} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        nodeData={nodeData}
                        lineCurrents={lineCurrents}
                    />
                )}
                {/* 👆 FIM DA ALTERNÂNCIA 👆 */}

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
                        feedersList={SYSTEM_DATA.feeders || []} 
                        
                        // 👇 ADICIONADO PARA A LISTA DE CHAVES QUE AGORA FICA AQUI 👇
                        toggleSwitch={toggleSwitch}
                        setHoveredLineId={setHoveredLineId}
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
                    steps={sequenceData.steps}
                    snapshots={sequenceData.snapshots}
                    method={sequenceData.method}
                    darkMode={darkMode}
                    isRecording={isRecordingSeq}
                    onToggleRecording={() => setIsRecordingSeq(!isRecordingSeq)}
                    onClose={() => { setSeqOverlayOpen(false); setIsRecordingSeq(false); }}
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
                        } else if (step.branchId !== undefined) {
                            setSelectedElement({ type: 'edge', data: { id: step.branchId } });
                        } else if (step.nodeId !== undefined) {
                            setSelectedElement({ type: 'node', id: step.nodeId });
                        }
                    }}
                />
            )}
            
            {toast && <div className="toast">{toast.message}</div>}
        </div>
    );
}

export default App;