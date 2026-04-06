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
import { useShortcuts } from './hooks/useShortcuts';

// 👇 ADICIONEI A COR DA SUBESTAÇÃO 1000 AQUI (Vermelho Intenso) 👇
const SOURCE_COLORS = { 1000: '#00bcd4', 101: '#2e7d32', 102: '#e65100', 104: '#7b1fa2', 1: '#2962ff' };

const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 128, g: 128, b: 128 };
};

const getSafeHue = (id) => {
    let h = (id * 137) % 360;
    // Se a cor cair no vermelho/laranja escuro (0-25 ou 335-360), joga para o Azul/Verde
    if (h < 25 || h > 335) h = (h + 45) % 360; 
    return h;
};

function App() {
    const [activeSources, setActiveSources] = useState([101, 102, 104]);
    const [darkMode, setDarkMode] = useState(true); 
    const [branches, setBranches] = useState(() => SYSTEM_DATA.branches.map((b, idx) => ({ 
        ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
    })));

    const initialBranchesRef = useRef(SYSTEM_DATA.branches.map((b, idx) => ({ 
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
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    const [projectPositions, setProjectPositions] = useState(SYSTEM_DATA.positionsProject || {});
    const [projectWaypoints, setProjectWaypoints] = useState(SYSTEM_DATA.waypointsProject || {});
    const [systemLoads, setSystemLoads] = useState(SYSTEM_DATA.loads);

    const activePositions = useMemo(() => layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions), [layoutMode, projectPositions, organicPositions]);
    const activeWaypoints = useMemo(() => layoutMode === 'project' ? projectWaypoints : {}, [layoutMode, projectWaypoints]);
    
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

    const sysData = useMemo(() => ({
        sources: activeSources, 
        loads: systemLoads, 
        Vbase: SYSTEM_DATA.Vbase || 13.8,
        Sbase: SYSTEM_DATA.Sbase || 1000,
        shunts: SYSTEM_DATA.shunts || {}, 
        sses: SYSTEM_DATA.sses || {}      
    }), [activeSources, branches]);

    const nodeFeeds = useMemo(() => propagateFeeds(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    
    // 👇👇👇 A NOVA INTELIGÊNCIA DE PROPAGAÇÃO DE CORES DA ENGENHARIA 👇👇👇
    const { nodeZones, edgeZones, feedersList } = useMemo(() => {
        const nZ = {};
        const eZ = {};
        const mainSources = activeSources; 
        
        // O App não calcula mais nada. Ele só pega a lista que o Parser fez!
        const feeders = SYSTEM_DATA.feeders || [];
            
        const roots = mainSources.length > 0 ? mainSources : [1];
        let queue = [...roots];
        roots.forEach(r => nZ[r] = r);
        
        const visited = new Set(roots);
                
        while(queue.length > 0) {
            const curr = queue.shift();
            
            // O Efeito Prisma: Se o nó atual for um Alimentador, tudo que sai dele leva a cor dele.
            // Senão, continua levando a cor da Subestação Principal.
            const propagationZone = feeders.includes(curr) ? curr : nZ[curr];
            
            branches.forEach(b => {
                if (b.state === 1 && !faultNodes.has(b.from) && !faultNodes.has(b.to)) {
                    if (b.from === curr && !visited.has(b.to)) {
                        nZ[b.to] = propagationZone;
                        eZ[b.id] = propagationZone; // A linha assume a cor da propagação
                        visited.add(b.to);
                        queue.push(b.to);
                    } else if (b.to === curr && !visited.has(b.from)) {
                        nZ[b.from] = propagationZone;
                        eZ[b.id] = propagationZone;
                        visited.add(b.from);
                        queue.push(b.from);
                    }
                }
            });
        }

        return { nodeZones: nZ, edgeZones: eZ, feedersList: feeders };
    }, [branches, faultNodes, activeSources]);
    // 👆👆👆 ========================================================== 👆👆👆

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
        const cached = CacheManager.get(branches, faultNodes, calcMethod);
        if (cached) return cached;
        const result = runPowerFlow(branches, faultNodes, calcMethod, sysData); 
        CacheManager.set(branches, faultNodes, calcMethod, result);
        return result;
    }, [branches, faultNodes, calcMethod, sysData]); 

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
                            if (b.hasSwitch) { branchesToOpen.add(b.id); } 
                            else { visitedNodes.add(neighbor); queue.push(neighbor); }
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
                    if (data.loads) setSystemLoads(data.loads);
                    if (data.baseKV) SYSTEM_DATA.Vbase = data.baseKV;
                    if (data.sBase) SYSTEM_DATA.Sbase = data.sBase;
                    if (data.sources) SYSTEM_DATA.sources = data.sources;
                    if (data.sses) SYSTEM_DATA.sses = data.sses;
                    if (data.shunts) SYSTEM_DATA.shunts = data.shunts;

                    if (data.branches) {
                        setBranches(data.branches);
                        initialBranchesRef.current = JSON.parse(JSON.stringify(data.branches));
                    }
                    if (data.faults) setFaultNodes(new Set(data.faults));

                    setTimeout(() => { window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: data })); }, 100);

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
                const parsedData = parseAMPLDat(text);
                
                setProjectPositions(parsedData.positions || {});
                setProjectWaypoints(parsedData.waypoints || {});
 
                setSystemLoads(parsedData.loads);
                SYSTEM_DATA.Vbase = parsedData.baseKV;
                SYSTEM_DATA.Sbase = parsedData.sBase;
                SYSTEM_DATA.sources = parsedData.sources;

                SYSTEM_DATA.feeders = parsedData.feeders || [];
                SYSTEM_DATA.nodeTypes = parsedData.nodeTypes || {}; 

                SYSTEM_DATA.sses = parsedData.sses || {};
                SYSTEM_DATA.shunts = parsedData.shunts || {};

                setActiveSources(parsedData.sources);
                setBranches(parsedData.branches);
                initialBranchesRef.current = JSON.parse(JSON.stringify(parsedData.branches));
                setFaultNodes(new Set());
                
                setTimeout(() => { window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: parsedData })); }, 100);
                
                setIsProjectLoaded(true);
                showToast("Sistema AMPL importado com sucesso!", "success");
            } catch (err) {
                alert("❌ Erro ao processar o ficheiro .dat.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    const handleDownloadTemplate = () => {
        const templateContent = `# Modelo de Arquivo...`; // Simplificado para economizar espaço
        const blob = new Blob([templateContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'Template_IEEE.dat'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
        showToast("Template baixado com sucesso!", "success");
    };

    const handleExportFullState = useCallback((positions, waypoints) => {
        const exportData = {
            version: "1.0", systemName: "Sistema Salvo", baseKV: SYSTEM_DATA.Vbase || 13.8, sBase: SYSTEM_DATA.Sbase || 1000, 
            sources: sources, loads: SYSTEM_DATA.loads, branches: branches, faults: Array.from(faultNodes), 
            layout: { positions: positions, waypoints: waypoints }
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", "meu_sistema_salvo.json");
        document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        showToast("Projeto exportado com sucesso!", "success");
    }, [branches, faultNodes, sources]);

    // --- LÓGICA DE IMPORTAÇÃO DE ESTADOS E SALVAMENTO DE ARRASTO ---
    useEffect(() => {
        const handleApplyFullState = (e) => {
            const data = e.detail;
            
            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            const layoutData = data.layout || data;
            
            if (layoutData.positions) {
                // 👇 A CORREÇÃO DE MEMÓRIA ENTRA AQUI 👇
                // Agora ele sabe em qual aba você está e salva no lugar certo!
                if (layoutMode === 'organic') {
                    setOrganicPositions(layoutData.positions);
                } else {
                    setProjectPositions(layoutData.positions);
                }
            }
            if (layoutData.waypoints) setProjectWaypoints(layoutData.waypoints);
        };
        
        window.addEventListener('applyGraphLayout', handleApplyFullState);
        return () => window.removeEventListener('applyGraphLayout', handleApplyFullState);
        
    // 👇 MUDANÇA CRÍTICA: Adicionamos layoutMode na lista de dependências 👇
    }, [layoutMode]);

    useEffect(() => {
        const handleApplyOrganic = (e) => { setOrganicPositions(e.detail.positions); setLayoutMode('organic'); };
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

    const handleExportSVG = () => { exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg'); showToast('Diagrama vetorizado baixado!', 'success'); };
    const handleExportPDF = () => { setSelectedElement(null); setTimeout(() => window.print(), 100); };

    // 👇👇👇 A NOVA LÓGICA DE DEFINIÇÃO DE CORES DA ENGENHARIA 👇👇👇
    const getNodeColor = (nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        
        if (faultNodes.has(nodeId)) return colors.fault;
        if (!nodeZones[nodeId]) return colors.de;

        // Se for Fonte Principal (1000) OU Alimentador (101), exibe a cor própria
        if (activeSources.includes(nodeId) || feedersList.includes(nodeId)) {
            if (SOURCE_COLORS[nodeId]) return SOURCE_COLORS[nodeId];
            return `hsl(${getSafeHue(nodeId)}, 70%, ${darkMode ? 65 : 45}%)`;
        }
        
        // Se for Carga comum, herda a cor da Zona (1000, 101, etc) calculada no BFS
        const zone = nodeZones[nodeId];
        if (SOURCE_COLORS[zone]) return SOURCE_COLORS[zone];
        return `hsl(${getSafeHue(zone)}, 70%, ${darkMode ? 65 : 45}%)`;
    };

    const getEdgeColor = (branch) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (branch.state === 0) return colors.de;
        
        const zone = edgeZones[branch.id];
        if (!zone) return colors.de; 
        
        const current = lineCurrents[branch.id];
        if (!current || current.current < 0.01) return colors.de;
        if (current.percentage >= 100) return '#d50000'; 
        
        // Mantemos a segurança extra de Loop do sistema antigo
        const feedsFrom = nodeFeeds[branch.from] || new Set();
        if (feedsFrom.size > 1) return colors.loop; 
        
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const alpha = 0.1 + (0.9 * Math.sqrt(p)); 
        
        // Renderiza a cor da Zona para a linha!
        if (SOURCE_COLORS[zone]) {
            const rgb = hexToRgb(SOURCE_COLORS[zone]);
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`; 
        } else {
            const hue = getSafeHue(zone);
            const l = darkMode ? 65 : 45; 
            return `hsla(${hue}, 70%, ${l}%, ${alpha.toFixed(3)})`; 
        }
    };
    // 👆👆👆 ========================================================= 👆👆👆

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
                `}
            </style>

            <div className="hide-on-print" style={{ borderRight: '1px solid #333', zIndex: 100 }}>
                {!isEditMode ? (
                    <Sidebar 
                        sidebarMode={sidebarMode} darkMode={darkMode} setDarkMode={setDarkMode} resetSystem={resetSystem} maintenanceMode={maintenanceMode} setMaintenanceMode={setMaintenanceMode} showLabels={showLabels} setShowLabels={setShowLabels} selectedElement={displayElement} sources={sources} loads={loads} faultNodes={faultNodes} branches={branches} toggleSwitch={toggleSwitch} setSelectedElement={setSelectedElement} setHoveredLineId={setHoveredLineId} onDownloadReport={handleDownloadReport} onUploadSwitches={handleUploadSwitches} calcMethod={calcMethod} setCalcMethod={setCalcMethod} onExportSVG={handleExportSVG} onExportPDF={handleExportPDF} getNodeColor={getNodeColor} getEdgeColor={getEdgeColor} systemSize={Math.max(0, allNodes.length)} disconnectedStats={disconnectedStats} lineCurrents={lineCurrents} feedersList={SYSTEM_DATA.feeders || []}
                    />
                ) : (
                    <EditSidebar isEditMode={isEditMode} setIsEditMode={setIsEditMode} darkMode={darkMode} onUndo={handleUndoLayout} canUndo={layoutHistory.length > 0} onReset={handleResetToOriginalLayout} branches={branches} allNodes={allNodes} sources={sources} currentPositions={activePositions}/>
                )}
            </div>

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
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: printFrameMode !== 'none' ? '#ff9800' : 'inherit' }}>A4 <span style={{ opacity: 0.8, fontSize: '12px' }}>{printFrameMode === 'none' ? '🔲' : (printFrameMode === 'landscape' ? '↔' : '↕')}</span></span>
                    </button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', opacity: showLegend ? 1 : 0.4 }} title="Mostrar/Ocultar Legenda" onClick={() => setShowLegend(!showLegend)}>👁️</button>
                </div>

                {printFrameMode !== 'none' && (
                    <div className="hide-on-print" style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#ff9800', color: '#000', padding: '6px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}> Visualização de Impressão: {printFrameMode === 'landscape' ? 'Paisagem' : 'Retrato'} (Ctrl+P para Imprimir) </div>
                )}

                <GraphArea 
                    printFrameMode={printFrameMode} isFaultSidebarOpen={isFaultSidebarOpen} branches={branches} allNodes={allNodes} sources={sources} showLabels={showLabels} getEdgeColor={getEdgeColor} getNodeColor={getNodeColor} toggleSwitch={toggleSwitch} toggleFault={toggleFault} setSelectedElement={setSelectedElement} selectedElement={selectedElement} hoveredLineId={hoveredLineId} setHoveredLineId={setHoveredLineId} hoveredNodeId={hoveredNodeId} setHoveredNodeId={setHoveredNodeId} maintenanceMode={maintenanceMode} activePositions={activePositions} lineCurrents={lineCurrents} nodeData={nodeData} isEditMode={isEditMode} setIsEditMode={setIsEditMode} activeWaypoints={activeWaypoints} darkMode={darkMode} onSaveLayoutToHistory={saveLayoutToHistory} loads={loads} systemLoads={systemLoads} onExportRequest={handleExportFullState} sses={SYSTEM_DATA.sses} feedersList={SYSTEM_DATA.feeders || []}
                >
                    {showLegend && (
                        <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                            <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                    <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                    <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                </div>
                            {/* ... (botões de PROJETO e ORGÂNICO) ... */}
                            </div>
                            
                            {/* 1. SUBESTAÇÕES PRINCIPAIS */}
                            {sources.map(s => (<div key={s} className="legend-item"><div className="legend-dot" style={{ background: SOURCE_COLORS[s] || `hsl(${(s * 137) % 360}, 70%, 45%)` }}></div> SUB {s}</div>))}
                            
                            {/* 2. ALIMENTADORES */}
                            {feedersList.map(f => (<div key={f} className="legend-item"><div className="legend-dot" style={{ background: SOURCE_COLORS[f] || `hsl(${(f * 137) % 360}, 70%, 45%)` }}></div> ALIM {f}</div>))}

                            {/* 3. OUTROS STATUS */}
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                        </div>
                    )}
                </GraphArea>
            </div>

            <div className="hide-on-print right-panel-wrapper" style={{ zIndex: 100 }}>
                <div onClick={() => setFaultSidebarOpen(!isFaultSidebarOpen)} title={isFaultSidebarOpen ? "Ocultar Painel" : "Painel de Faltas"} style={{ position: 'absolute', left: '-28px', top: 'calc(50% - 35px)', width: '28px', height: '70px', background: darkMode ? '#1e1e1e' : '#fff', borderTop: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderBottom: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderLeft: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', color: '#ff9800', zIndex: 101, transition: 'background-color 0.2s' }}> {isFaultSidebarOpen ? '▶' : '⚡'} </div>
                <div className="panel-content">
                    <FaultPanel 
                        isFaultSidebarOpen={isFaultSidebarOpen} setFaultSidebarOpen={setFaultSidebarOpen} sources={sources} loadNodes={loadNodes} faultNodes={faultNodes} nodeFeeds={nodeFeeds} toggleFault={toggleFault} setSelectedElement={setSelectedElement} selectedElement={displayElement} setHoveredNodeId={setHoveredNodeId} getNodeColor={getNodeColor} darkMode={darkMode} THEME={THEME} nodeData={nodeData} lineCurrents={lineCurrents} loads={loads} branches={branches} sses={SYSTEM_DATA.sses || {}} feedersList={feedersList}
                    />
                </div>
            </div>

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
                            <li><strong style={{ color: '#ff9800' }}>O</strong> - Abrir/Importar Arquivo</li>
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