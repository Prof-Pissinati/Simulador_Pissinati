import React, { useState, useEffect, useMemo } from 'react';
import { SYSTEM_DATA } from './data/systemData';
import { propagateFeeds, calculateLoads, runPowerFlow, CacheManager } from './utils/powerCalculations';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import GraphArea from './components/GraphArea';
import MobileControls from './components/MobileControls';
import { exportSVG } from './utils/exportUtils'; // <--- NOVO IMPORT
import './index.css';

// --- CORES DAS FONTES ---
const SOURCE_COLORS = {
    101: '#2e7d32', 
    102: '#e65100', 
    104: '#7b1fa2', 
    1:   '#2962ff',
};

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 128, g: 128, b: 128 };
};

function App() {
    const [darkMode, setDarkMode] = useState(true); 
    const [branches, setBranches] = useState(() => SYSTEM_DATA.branches.map((b, idx) => ({ 
        ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
    })));
    
    const [faultNodes, setFaultNodes] = useState(new Set());
    const [selectedElement, setSelectedElement] = useState(null);
    const [showLabels, setShowLabels] = useState(true);
    const [toast, setToast] = useState(null);
    const [calcMethod, setCalcMethod] = useState('NR'); 
    
    // --- LÓGICA DE LAYOUT ---
    const [layoutMode, setLayoutMode] = useState('project'); 
    
    const activePositions = layoutMode === 'project' 
        ? (SYSTEM_DATA.positionsProject || {}) 
        : (SYSTEM_DATA.positionsOrganic || SYSTEM_DATA.positionsProject || {});

    const [sidebarMode, setSidebarMode] = useState('full');
    const [isFaultSidebarOpen, setFaultSidebarOpen] = useState(true);
    const [hoveredLineId, setHoveredLineId] = useState(null);
    const [hoveredNodeId, setHoveredNodeId] = useState(null);
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    useEffect(() => {
        if (darkMode) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    }, [darkMode]);

    // Cálculos
    const nodeFeeds = useMemo(() => propagateFeeds(branches, faultNodes), [branches, faultNodes]);
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes), [nodeFeeds, faultNodes]);
    const powerFlowResults = useMemo(() => {
        const cached = CacheManager.get(branches, faultNodes, calcMethod);
        if (cached) return cached;
        const result = runPowerFlow(branches, faultNodes, calcMethod);
        CacheManager.set(branches, faultNodes, calcMethod, result);
        return result;
    }, [branches, faultNodes, calcMethod]);

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

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
        setFaultNodes(prev => {
            const newSet = new Set(prev);
            if (prev.has(nodeId)) { newSet.delete(nodeId); showToast(`Falta removida`, 'success'); }
            else { newSet.add(nodeId); showToast(`Falta aplicada`, 'warning'); }
            return newSet;
        });
    };

    const resetSystem = () => {
        setBranches(SYSTEM_DATA.branches.map((b, idx) => ({ 
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1))
        })));
        setFaultNodes(new Set());
        setSelectedElement(null);
        showToast('Sistema resetado', 'success');
    };

    // --- FUNÇÃO GERADORA DE RELATÓRIO TXT ---
    const handleDownloadReport = () => {
        let report = "=========================================================================\n";
        report += "                  RELATÓRIO DO FLUXO DE POTÊNCIA\n";
        report += `                  MÉTODO: ${calcMethod === 'NR' ? 'Newton-Raphson' : 'Gauss-Seidel'}\n`;
        report += "=========================================================================\n\n";

        report += "--- RESULTADOS DAS BARRAS (NÓS) ---\n";
        report += "Barra |   V (pu)   | Ângulo (°) | Status\n";
        report += "-------------------------------------------------\n";
        
        const sortedNodes = Object.keys(nodeData).map(Number).sort((a,b) => a - b);
        
        sortedNodes.forEach(id => {
            const n = nodeData[id];
            const status = faultNodes.has(id) ? "EM FALTA" : "Energizado";
            const vStr = n.v ? n.v.toFixed(4) : "0.0000";
            const aStr = n.angle ? n.angle.toFixed(4).padStart(10) : "    0.0000";
            report += `${String(id).padStart(5)} | ${vStr.padStart(10)} | ${aStr} | ${status}\n`;
        });

        report += "\n--- RESULTADOS DOS RAMOS (LINHAS) ---\n";
        report += "Ramo (De-Para) | Corrente (A) | Carregam. (%) |   P (MW)   |  Q (MVAr)  | Status\n";
        report += "--------------------------------------------------------------------------------------\n";
        
        const sortedBranches = [...branches].sort((a,b) => a.from - b.from || a.to - b.to);

        sortedBranches.forEach(b => {
            const current = lineCurrents[b.id];
            let status = "Aberto";
            if (b.state === 1) {
                status = (current && current.percentage >= 100) ? "SOBRECARGA" : "Fechado";
            }
            
            const iStr = (current && current.current) ? current.current.toFixed(2) : "0.00";
            const percStr = (current && current.percentage) ? current.percentage.toFixed(2) : "0.00";
            
            // Converte kW/kVAr para MW/MVAr (divide por 1000)
            const pMW = (current && current.pFlow) ? (current.pFlow / 1000).toFixed(4) : "0.0000";
            const qMVAr = (current && current.qFlow) ? (current.qFlow / 1000).toFixed(4) : "0.0000";
            
            const name = `${b.from}-${b.to}`;
            
            report += `${name.padStart(14)} | ${iStr.padStart(12)} | ${percStr.padStart(13)} | ${pMW.padStart(10)} | ${qMVAr.padStart(10)} | ${status}\n`;
        });

        const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "relatorio_fluxo_potencia.txt";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setTimeout(() => URL.revokeObjectURL(url), 200);
        showToast('Relatório TXT gerado com sucesso!', 'success');
    };

    // --- FUNÇÃO PARA EXPORTAR SVG ---
    const handleExportSVG = () => {
      exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg');
      showToast('Diagrama vetorizado baixado!', 'success');
    };

    const getNodeColor = (nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (faultNodes.has(nodeId)) return colors.fault;
        const feeds = nodeFeeds[nodeId];
        if (!feeds || feeds.size === 0) return colors.de;
        if (feeds.size > 1) return colors.loop;
        const source = Array.from(feeds)[0];
        if (SOURCE_COLORS[source]) return SOURCE_COLORS[source];
        const hue = (source * 137) % 360; 
        return `hsl(${hue}, 70%, 45%)`;
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
        
        const p = Math.min(current.percentage / 100, 1.0);
        const curve = Math.pow(p, 2.5); 
        const minBrightness = 0.3; 
        const factor = minBrightness + (1 - minBrightness) * curve;
        
        let r, g, b;
        if (SOURCE_COLORS[sourceId]) {
            const rgb = hexToRgb(SOURCE_COLORS[sourceId]);
            r = rgb.r; g = rgb.g; b = rgb.b;
        } else {
            const hue = (sourceId * 137) % 360;
            return `hsl(${hue}, 70%, ${45 * factor}%)`; 
        }
        return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    };

    const sources = (SYSTEM_DATA.sources && SYSTEM_DATA.sources.length > 0) ? SYSTEM_DATA.sources : [101, 102, 104];
    const allNodes = Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b);
    const loadNodes = allNodes.filter(n => !sources.includes(n));

    return (
        <div className="app-container">
            {!isMobile && (
                <>
                    <Sidebar 
                        sidebarMode={sidebarMode} darkMode={darkMode} setDarkMode={setDarkMode}
                        resetSystem={resetSystem} maintenanceMode={maintenanceMode} setMaintenanceMode={setMaintenanceMode}
                        showLabels={showLabels} setShowLabels={setShowLabels} selectedElement={selectedElement}
                        sources={sources} loads={loads} faultNodes={faultNodes} branches={branches} 
                        toggleSwitch={toggleSwitch} setSelectedElement={setSelectedElement} setHoveredLineId={setHoveredLineId}
                        onDownloadReport={handleDownloadReport} 
                        onUploadSwitches={handleUploadSwitches}
                        calcMethod={calcMethod} 
                        setCalcMethod={setCalcMethod} 
                        onExportSVG={handleExportSVG}
                    />
                    <button className="sidebar-toggle" onClick={() => setSidebarMode(p => p === 'full' ? 'mini' : (p === 'mini' ? 'hidden' : 'full'))}>≡</button>
                    <FaultPanel 
                        isFaultSidebarOpen={isFaultSidebarOpen} setFaultSidebarOpen={setFaultSidebarOpen}
                        sources={sources} loadNodes={loadNodes} faultNodes={faultNodes} nodeFeeds={nodeFeeds}
                        toggleFault={toggleFault} selectedElement={selectedElement} setSelectedElement={setSelectedElement}
                        setHoveredNodeId={setHoveredNodeId} getNodeColor={getNodeColor} darkMode={darkMode}
                        THEME={THEME} nodeData={nodeData} lineCurrents={lineCurrents} loads={loads} branches={branches}
                    />
                </>
            )}

            {isMobile && (
                <div className="mobile-header">
                    <button className="btn-ui" onClick={() => setDarkMode(!darkMode)} style={{width:'40px', height:'40px', borderRadius:'50%'}}>{darkMode ? '☀️' : '🌙'}</button>
                    <button className="btn-ui btn-reset" onClick={resetSystem} style={{width:'40px', height:'40px', borderRadius:'50%'}}>🔄</button>
                    <button className="btn-ui" onClick={() => setCalcMethod(m => m === 'NR' ? 'GS' : 'NR')} style={{width:'40px', height:'40px', borderRadius:'50%', fontSize:'10px', fontWeight:'bold', color: calcMethod === 'NR' ? '#ff6d00' : '#2979ff', borderColor: calcMethod === 'NR' ? '#ff6d00' : '#2979ff'}}>{calcMethod}</button>
                </div>
            )}

            <GraphArea 
                branches={branches} allNodes={allNodes} sources={sources}
                showLabels={showLabels} getEdgeColor={getEdgeColor} getNodeColor={getNodeColor}
                toggleSwitch={toggleSwitch} toggleFault={toggleFault} setSelectedElement={setSelectedElement}
                selectedElement={selectedElement} hoveredLineId={hoveredLineId} setHoveredLineId={setHoveredLineId}
                hoveredNodeId={hoveredNodeId} setHoveredNodeId={setHoveredNodeId} maintenanceMode={maintenanceMode}
                isMobile={isMobile}
                activePositions={activePositions}
                lineCurrents={lineCurrents}
                nodeData={nodeData}
            />

            {isMobile && (
                <MobileControls 
                    selectedElement={selectedElement} setSelectedElement={setSelectedElement}
                    nodeData={nodeData} lineCurrents={lineCurrents} toggleSwitch={toggleSwitch}
                    toggleFault={toggleFault} faultNodes={faultNodes} branches={branches} getNodeColor={getNodeColor}
                />
            )}

            {/* --- LEGENDA E CONTROLES FLUTUANTES --- */}
            {!isMobile && (
                <div className={`legend ${isFaultSidebarOpen ? 'shifted' : ''}`} 
                     style={{
                         zIndex: 9999, // CORREÇÃO: Garante que esteja acima do SVG
                         pointerEvents: 'all', // CORREÇÃO: Habilita cliques
                         cursor: 'default'
                     }}
                     // CORREÇÃO: Para propagação em todos os eventos de mouse
                     onMouseDown={e=>e.stopPropagation()} 
                     onMouseUp={e=>e.stopPropagation()} 
                     onClick={e=>e.stopPropagation()} 
                     onWheel={e=>e.stopPropagation()}
                     onDoubleClick={e=>e.stopPropagation()}
                >
                    
                    {/* SELETOR DE LAYOUT (PROJETO | ORGÂNICO) */}
                    <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                        <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                        <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                            <button 
                                onClick={() => setLayoutMode('project')} 
                                style={{
                                    flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold',
                                    background: layoutMode === 'project' ? '#00bcd4' : 'transparent',
                                    color: layoutMode === 'project' ? '#000' : '#666',
                                    transition: 'all 0.2s'
                                }}
                            >
                                PROJETO
                            </button>
                            <button 
                                onClick={() => setLayoutMode('organic')} 
                                style={{
                                    flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold',
                                    background: layoutMode === 'organic' ? '#00bcd4' : 'transparent',
                                    color: layoutMode === 'organic' ? '#000' : '#666',
                                    transition: 'all 0.2s'
                                }}
                            >
                                ORGÂNICO
                            </button>
                        </div>
                    </div>

                    {sources.map(s => (
                        <div key={s} className="legend-item">
                            <div className="legend-dot" style={{ background: SOURCE_COLORS[s] || `hsl(${(s * 137) % 360}, 70%, 45%)` }}></div> 
                            SUB {s}
                        </div>
                    ))}
                    
                    <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                    <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                    <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                    <div style={{marginTop: 8, paddingTop: 4, borderTop: '1px solid #ccc', fontSize: '10px', color: '#666'}}>
                        Método: <strong>{calcMethod === 'NR' ? 'Newton-Raphson' : 'Gauss-Seidel'}</strong>
                    </div>
                </div>
            )}

            {toast && <div className="toast">{toast.message}</div>}
        </div>
    );
}

export default App;