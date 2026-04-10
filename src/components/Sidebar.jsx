import React, { useRef, useState } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

// Função para converter grandezas de potência automaticamente
const formatPower = (kw) => {
    if (kw >= 1000000) return (kw / 1000000).toFixed(1) + ' GW';
    if (kw >= 1000) return (kw / 1000).toFixed(1) + ' MW';
    return kw.toFixed(0) + ' kW';
};


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
    getNodeColor,
    systemSize,
    lineCurrents,
    feedersList = [] // 👈 ADICIONADO AQUI
}) {
    const fileInputRef = useRef(null);
    const [unlockFixed, setUnlockFixed] = useState(false);

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
                <h1 style={{ marginTop: '-10px',marginBottom: '10px' } }>⚡Sis. {systemSize} Barras</h1>
                
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

                <button className="sidebar-action-btn" style={{ '--btn-color': '#9c27b0', width: '100%', marginBottom: '-10px' }} onClick={onDownloadReport} title="Baixar Relatório TXT">
                    📄 Relatório
                </button>
            </div>

            {/* LOAD DISPLAY */}
            {/* LOAD DISPLAY */}
            <div className="load-display" style={{ marginTop: '0px'}}> 
                
                {/* FUNÇÃO GERADORA DE CARDS (Para não repetir código) */}
                {(() => {
                    const renderLoadCard = (subId, isFeeder) => {
                        let totalP = 0;
                        let totalQ = 0;
                        
                        if (lineCurrents) {
                            if (!isFeeder) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; } 
                                        else if (b.to === subId) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
                                    }
                                });
                                totalP = Math.abs(totalP);
                                totalQ = Math.abs(totalQ);
                            } else {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId || b.to === subId) {
                                            sumP += Math.abs(lineCurrents[b.id].pFlow);
                                            sumQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                                totalP = sumP / 2;
                                totalQ = sumQ / 2;
                            }
                        }

                        const vbase = SYSTEM_DATA?.Vbase || 13.8; 
                        const S = Math.sqrt((totalP)**2 + (totalQ)**2);
                        const I = S / (Math.sqrt(3) * vbase);
                        const inFault = faultNodes.has(subId);
                        const cardColor = getNodeColor ? getNodeColor(subId) : 'var(--eng-orange)';
                        
                        return (
                            <div key={subId} className={`load-card lc-${subId}`} style={{ borderTop: `4px solid ${cardColor}` }}>
                                <div className="load-card-title" style={{ color: cardColor }}>
                                    {isFeeder ? `ALIM. ${subId}` : `SUB ${subId}`}
                                </div>
                                <span className="load-card-value">{inFault ? '—' : formatPower(totalP)}</span>
                                <div className="load-card-subtitle">{inFault ? '—' : I.toFixed(0)} A</div>
                                <div className="load-card-subtitle">
                                    {inFault ? '—' : (isFeeder ? 'Alimentador' : `${loads[subId]?.nodes || 0} barras`)}
                                </div>
                            </div>
                        );
                    };

                    return (
                        <>
                            {/* 1. SUBESTAÇÕES PRINCIPAIS */}
                            {sources.map(id => renderLoadCard(id, false))}

                            {/* 2. SUBESTAÇÃO OFF (Cargas Desconectadas) */}
                            {disconnectedStats && (
                                <div key="200" className="load-card" style={{ 
                                    borderTop: '4px solid #757575', 
                                    opacity: disconnectedStats.count > 0 ? 1 : 0.4,
                                    transition: 'opacity 0.3s ease'
                                }}>
                                    <div className="load-card-title" style={{ color: '#757575' }}>SUB (Off)</div>
                                    <span className="load-card-value">{formatPower(disconnectedStats.p)}</span>
                                    <div className="load-card-subtitle">{disconnectedStats.current.toFixed(0)} A</div>
                                    <div className="load-card-subtitle">{disconnectedStats.count} barras</div>
                                </div>
                            )}

                            {/* 3. ALIMENTADORES */}
                            {feedersList.map(id => renderLoadCard(id, true))}
                        </>
                    );
                })()}
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

            {/* SWITCH LIST INTELIGENTE */}
            <div className="switch-list">
                {(() => {
                    const sorter = (a, b) => {
                        const minA = Math.min(a.from, a.to);
                        const minB = Math.min(b.from, b.to);
                        if (minA !== minB) return minA - minB;
                        return Math.max(a.from, a.to) - Math.max(b.from, b.to);
                    };

                    const switchable = branches.filter(b => b.hasSwitch).sort(sorter);
                    const fixed = branches.filter(b => !b.hasSwitch).sort(sorter);

                    const renderItem = (branch, isFixedType) => {
                        const nodeColor = getNodeColor ? getNodeColor(branch.from) : '#4caf50';
                        const isOn = branch.state === 1;
                        const canClick = !isFixedType || unlockFixed; 

                        return (
                            <div key={branch.id} className="switch-item" 
                                 onMouseEnter={() => { setSelectedElement({ type: 'edge', data: branch }); setHoveredLineId(branch.id); }} 
                                 onMouseLeave={() => setHoveredLineId(null)}>
                                <span style={{fontSize:'13px', fontWeight:'600'}}>{Math.min(branch.from, branch.to)}-{Math.max(branch.from, branch.to)}</span>
                                
                                <button 
                                    className={`switch-btn ${isOn ? 'on' : 'off'}`} 
                                    onClick={() => { if (canClick) toggleSwitch(branch.id); }}
                                    style={{
                                        backgroundColor: canClick ? (isOn ? nodeColor : '') : 'transparent',
                                        color: canClick ? (isOn ? '#000' : '') : '#999',
                                        border: canClick ? 'none' : '1px solid #555',
                                        cursor: canClick ? 'pointer' : 'default',
                                        opacity: canClick ? 1 : 0.6
                                    }}
                                >
                                    {!canClick ? 'FIXO' : (isOn ? 'ON' : 'OFF')}
                                </button>
                            </div>
                        );
                    };

                    return (
                        <>
                            {switchable.map(b => renderItem(b, false))}
                            
                            {fixed.length > 0 && (
                                <div className="switch-item" style={{ justifyContent: 'center', background: 'transparent', padding: '10px 0', borderBottom: 'none' }}>
                                    <button 
                                        onClick={() => setUnlockFixed(!unlockFixed)}
                                        style={{
                                            width: '100%', padding: '8px', 
                                            background: unlockFixed ? '#d32f2f' : 'transparent',
                                            color: unlockFixed ? '#fff' : '#888', 
                                            border: '1px dashed #555',
                                            borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer',
                                            transition: 'all 0.3s'
                                        }}
                                    >
                                        {unlockFixed ? '🔒 Bloquear Barras Fixas' : '🔓 Habilitar Manobra (Fixas)'}
                                    </button>
                                </div>
                            )}
                            
                            {fixed.map(b => renderItem(b, true))}
                        </>
                    );
                })()}
            </div>
        </div>
    );
}