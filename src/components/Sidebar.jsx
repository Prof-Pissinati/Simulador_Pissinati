import React, { useRef } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

export default function Sidebar({
    sidebarMode,
    darkMode,
    setDarkMode,
    resetSystem,
    maintenanceMode,
    setMaintenanceMode,
    showLabels,
    setShowLabels,
    selectedElement,
    sources,
    loads,
    faultNodes,
    disconnectedStats,
    branches,
    toggleSwitch,
    setSelectedElement,
    setHoveredLineId,
    onDownloadReport,
    onUploadSwitches = () => {}, 
    calcMethod = 'NR',
    setCalcMethod = () => console.warn("Função setCalcMethod não conectada!"),
    onExportPDF = () => console.warn("Função onExportPDF não conectada!"),
    getNodeColor
}) {
    const fileInputRef = useRef(null);

    const handleImportClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            onUploadSwitches(file);
        }
        e.target.value = null; // Reseta para permitir nova seleção
    };

    return (
        <div className={`sidebar ${sidebarMode}`}>
            <div className="sidebar-header">
                <h1 style={{ marginTop: '-10px',marginBottom: '10px' } }>⚡IEEE 53 Barras</h1>
                
                {/* Input invisível para a importação de ficheiros */}
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{display: 'none'}} 
                    accept=".txt,.dat,.log" 
                    onChange={handleFileChange} 
                />

                {/* PAINEL DE BOTÕES MODERNOS (GHOST BUTTONS) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', marginBottom: '1px' }}>
                    
                    <button className="sidebar-action-btn" style={{ '--btn-color': darkMode ? '#aaaaaa' : '#555555' }} onClick={() => setDarkMode(!darkMode)} title="Alternar Tema">
                        🌗 Tema
                    </button>
                    
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#FFC107' }} onClick={onExportPDF} title="Exportar para PDF">
                        🖼️ PDF
                    </button>

                    <button className="sidebar-action-btn" style={{ '--btn-color': '#00bcd4' }} onClick={handleImportClick} title="Importar (AMPLE/TXT)">
                        📂 Abrir
                    </button>
                    
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#4caf50' }} onClick={resetSystem} title="Reiniciar Sistema">
                        🔄 Reset
                    </button>

                    <button className="sidebar-action-btn" style={{ '--btn-color': calcMethod === 'NR' ? '#ff6d00' : '#2979ff' }} onClick={() => setCalcMethod(calcMethod === 'NR' ? 'GS' : 'NR')} title={`Clique para trocar. Atual: ${calcMethod}`}>
                        {calcMethod === 'NR' ? '⚡' : '🌊'} {calcMethod}
                    </button>

                    <button className="sidebar-action-btn" style={{ '--btn-color': '#9e9e9e' }} onClick={() => setShowLabels(!showLabels)} title="Mostrar/Esconder Labels">
                        🏷️ Labels
                    </button>
                </div>

                {/* BOTÃO RELATÓRIO OCUPANDO A LARGURA TOTAL */}
                <button className="sidebar-action-btn" style={{ '--btn-color': '#9c27b0', width: '100%', marginBottom: '-10px' }} onClick={onDownloadReport} title="Baixar Relatório TXT">
                    📄 Relatório
                </button>
            </div>

            {/* LOAD DISPLAY */}
            <div className="load-display" style={{ marginTop: '0px'}}> 
                {sources.map(subId => {
                    const load = loads[subId];
                    // Proteção se Vbase não estiver definida
                    const vbase = SYSTEM_DATA?.Vbase || 13.8; 
                    const S = Math.sqrt((load?.p || 0)**2 + (load?.q || 0)**2);
                    const I = S / (Math.sqrt(3) * vbase);
                    const inFault = faultNodes.has(subId);
                    
                    // 1. CHAMA A FUNÇÃO DE COR AQUI:
                    const cardColor = getNodeColor ? getNodeColor(subId) : 'var(--eng-orange)';
                    
                    return (
                        // 2. APLICA A COR NA BORDA SUPERIOR E NO TÍTULO DO CARD:
                        <div key={subId} className={`load-card lc-${subId}`} style={{ borderTop: `4px solid ${cardColor}` }}>
                            <div className="load-card-title" style={{ color: cardColor }}>SUB {subId}</div>
                            <span className="load-card-value">{inFault ? '—' : I.toFixed(0)} A</span>
                            <div className="load-card-subtitle">{inFault ? '—' : (load?.p || 0).toFixed(0)} kW</div>
                            <div className="load-card-subtitle">{inFault ? '—' : (load?.nodes || 0)} barras</div>
                        </div>
                    );
                })}
                
                {/* --- SUBESTAÇÃO 200 (Cargas Desconectadas / Apagão) --- */}
                {disconnectedStats && (
                    <div key="200" className="load-card" style={{ 
                        borderTop: '4px solid #757575', 
                        opacity: disconnectedStats.count > 0 ? 1 : 0.4,
                        transition: 'opacity 0.3s ease'
                    }}>
                        <div className="load-card-title" style={{ color: '#757575' }}>SUB (Off)</div>
                        <span className="load-card-value">{disconnectedStats.current.toFixed(0)} A</span>
                        <div className="load-card-subtitle">{disconnectedStats.p.toFixed(0)} kW</div>
                        <div className="load-card-subtitle">{disconnectedStats.count} barras</div>
                    </div>
                )}
            </div>

            {/* STATS */}
            <div className="stats-panel">
                <div className="stats-grid">
                    <div className="stat-item">
                        <div className="stat-label">Linhas Fechadas</div>
                        <div className="stat-value good">{branches.filter(b => b.state === 1).length}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-label">Linhas Abertas</div>
                        <div className="stat-value">{branches.filter(b => b.state === 0).length}</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-label">Faltas Ativas</div>
                        <div className={`stat-value ${faultNodes.size > 0 ? 'bad' : ''}`}>{faultNodes.size}</div>
                    </div>
                </div>
            </div>

            {/* SWITCH LIST */}
            <div className="switch-list">
                {branches
                    .slice()
                    .sort((a, b) => {
                        const minA = Math.min(a.from, a.to);
                        const minB = Math.min(b.from, b.to);
                        if (minA !== minB) return minA - minB;
                        return Math.max(a.from, a.to) - Math.max(b.from, b.to);
                    })
                    .map(branch => (
                    <div key={branch.id} className="switch-item" 
                         onMouseEnter={() => { setSelectedElement({ type: 'edge', data: branch }); setHoveredLineId(branch.id); }} 
                         onMouseLeave={() => setHoveredLineId(null)}>
                        <span style={{fontSize:'13px', fontWeight:'600'}}>{Math.min(branch.from, branch.to)}-{Math.max(branch.from, branch.to)}</span>
                        {(branch.hasSwitch) ? (
                            <button className={`switch-btn ${branch.state === 1 ? 'on' : 'off'}`} onClick={() => toggleSwitch(branch.id)}>{branch.state === 1 ? 'ON' : 'OFF'}</button>
                        ) : <span style={{fontSize:'10px', color:'#999', fontWeight:'bold'}}>FIXO</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}