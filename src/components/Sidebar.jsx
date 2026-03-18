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
    branches,
    toggleSwitch,
    setSelectedElement,
    setHoveredLineId,
    onDownloadReport,
    onUploadSwitches = () => {}, 
    calcMethod = 'NR',
    setCalcMethod = () => console.warn("Função setCalcMethod não conectada!"),
    // --- NOVA PROP ---
    onExportSVG = () => console.warn("Função onExportSVG não conectada!") 
}) {
    const btnColor = calcMethod === 'NR' ? '#ff6d00' : '#2979ff';
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
                <h1>⚡ IEEE 54</h1>
                <div className="control-group">
                    <button 
                        className={`btn-ui`} 
                        style={{ background: darkMode ? '#fff' : '#333', color: darkMode ? '#333' : '#fff', borderColor: darkMode ? '#fff' : '#333' }}
                        onClick={() => setDarkMode(!darkMode)} title="Alternar Tema"
                    >
                        <span className="btn-icon">🌗</span>
                        <span className="btn-text">Tema</span>
                    </button>

                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{display: 'none'}} 
                        accept=".txt,.dat,.log" 
                        onChange={handleFileChange} 
                    />
                    <button 
                        className="btn-ui" 
                        onClick={handleImportClick} 
                        title="Importar (AMPLE/TXT)" 
                        style={{ borderColor: '#00bcd4', color: '#00bcd4', fontWeight: 'bold' }}
                    > 
                        <span className="btn-icon">📂</span> 
                        <span className="btn-text">Abrir</span> 
                    </button>

                    {/* --- BOTÃO DE EXPORTAÇÃO SVG --- */}
                    <button 
                        className="btn-ui" 
                        onClick={onExportSVG} 
                        title="Exportar para Imagem Vetorizada (.svg)" 
                        style={{ borderColor: '#FFC107', color: '#FFC107', fontWeight: 'bold' }}
                    > 
                        <span className="btn-icon">🖼️</span> 
                        <span className="btn-text">Vetor</span> 
                    </button>
                    {/* ------------------------------- */}

                    <button className="btn-ui btn-reset" onClick={resetSystem} title="Reiniciar Sistema">
                        <span className="btn-icon">🔄</span>
                        <span className="btn-text">Reset</span>
                    </button>

                    <button 
                        className="btn-ui" 
                        onClick={() => {
                            const novo = calcMethod === 'NR' ? 'GS' : 'NR';
                            setCalcMethod(novo);
                        }}
                        title={`Clique para trocar. Atual: ${calcMethod}`}
                        style={{ 
                            backgroundColor: btnColor, 
                            borderColor: btnColor,
                            color: 'white',
                            transition: 'all 0.3s ease',
                            fontWeight: 'bold',
                            minWidth: '70px'
                        }}
                    >
                        <span className="btn-icon">{calcMethod === 'NR' ? '⚡' : '🌊'}</span>
                        <span className="btn-text">{calcMethod}</span>
                    </button>

                    <button className={`btn-ui ${showLabels ? 'active-label' : ''}`} onClick={() => setShowLabels(!showLabels)} title="Mostrar/Esconder Labels">
                        <span className="btn-icon">🏷️</span>
                        <span className="btn-text">Labels</span>
                    </button>
                    
                    <button 
                        className="btn-ui" 
                        onClick={onDownloadReport} 
                        title="Baixar Relatório TXT" 
                        style={{
                            background: '#7b1fa2',
                            color: 'white',
                            borderColor: '#7b1fa2'
                        }}
                    >
                        <span className="btn-icon">📄</span>
                        <span className="btn-text">Relat.</span>
                    </button>
                </div>
            </div>

            {/* LOAD DISPLAY */}
            <div className="load-display">
                {sources.map(subId => {
                    const load = loads[subId];
                    // Proteção se Vbase não estiver definida
                    const vbase = SYSTEM_DATA.Vbase || 13.8; 
                    const S = Math.sqrt((load?.p || 0)**2 + (load?.q || 0)**2);
                    const I = S / (Math.sqrt(3) * vbase);
                    const inFault = faultNodes.has(subId);
                    
                    return (
                        <div key={subId} className={`load-card lc-${subId}`}>
                            <div className="load-card-title">SUB {subId}</div>
                            <span className="load-card-value">{inFault ? '—' : I.toFixed(0)} A</span>
                            <div className="load-card-subtitle">{inFault ? '—' : (load?.p || 0).toFixed(0)} kW</div>
                            <div className="load-card-subtitle">{inFault ? '—' : (load?.nodes || 0)} barras</div>
                        </div>
                    );
                })}
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