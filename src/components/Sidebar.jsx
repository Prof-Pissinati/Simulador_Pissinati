import React, { useRef } from 'react';

// Função para converter grandezas de potência automaticamente
const formatPower = (kw, isMini = false) => {
    if (kw >= 1000000) return (kw / 1000000).toFixed(1) + (isMini ? 'G' : ' GW');
    if (kw >= 1000) return (kw / 1000).toFixed(1) + (isMini ? 'M' : ' MW');
    return kw.toFixed(0) + (isMini ? 'k' : ' kW');
};

export default function Sidebar({
    sidebarMode,
    darkMode,
    setDarkMode,
    resetSystem,
    calcMethod = 'NR',
    setCalcMethod = () => console.warn("Função setCalcMethod não conectada!"),
    onExportPDF = () => console.warn("Função onExportPDF não conectada!"),
    showLabels,
    setShowLabels,
    selectedElement,
    sources,
    loads,
    faultNodes,
    disconnectedStats,
    branches,
    onDownloadReport,
    onUploadSwitches = () => {}, 
    getNodeColor,
    systemSize,
    lineCurrents,
    feedersList = [],
    nodeData,
    systemLoads,
    systemShunts,
    vBase,
    sBase,
    sses,
    handleTapChange,
    handleShuntChange,
    viewMode,
    setViewMode
}) {
    const fileInputRef = useRef(null);
    const isMini = sidebarMode !== 'full'; // 👈 Variável que identifica o estado compacto (não full)

    const handleImportClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            onUploadSwitches(file);
        }
        e.target.value = null; 
    };

    const getVoltage = (id) => {
        if (!nodeData || !nodeData[id]) return { v: 0, angle: 0 };
        return nodeData[id];
    };

    const getLoadColor = (percentage) => {
        const p = Math.max(0, Math.min(100, percentage));
        const hue = ((100 - p) * 1.2).toFixed(0); 
        return `hsl(${hue}, 100%, 40%)`;
    };

    return (
        <div className={`sidebar ${sidebarMode}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            
            {/* CABEÇALHO FIXO E ADAPTÁVEL */}
            <div className="sidebar-header" style={{ flexShrink: 0 }}>
                {!isMini && (
                <h1 style={{ marginTop: '-10px', marginBottom: '10px', fontSize: isMini ? '16px' : '24px', textAlign: 'center' }}>
                    {`⚡Sis. ${systemSize} Barras`}
                </h1>
                )}
                
                <input type="file" ref={fileInputRef} style={{display: 'none'}} accept=".txt,.dat,.log" onChange={handleFileChange} />

                {/* Grelha de botões: 2 colunas no normal, 1 coluna no mini */}
                <div style={{ display: 'grid', gridTemplateColumns: isMini ? '1fr 1fr' : '1fr 1fr', gap: isMini ? '4px' : '2px', marginBottom: '2px' }}>
                    <button className="sidebar-action-btn" style={{ '--btn-color': darkMode ? '#aaaaaa' : '#555555' }} onClick={() => setDarkMode(!darkMode)} title="Alternar Tema">
                        {darkMode ? '☀️' : '🌙'}{!isMini && ' Tema'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#FFC107' }} onClick={onExportPDF} title="Exportar para PDF">
                        🖼️{!isMini && ' PDF'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#00bcd4' }} onClick={handleImportClick} title="Importar (AMPLE/TXT)">
                        📂{!isMini && ' Abrir'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#4caf50' }} onClick={resetSystem} title="Reiniciar Sistema">
                        🔄{!isMini && ' Reset'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': calcMethod === 'NR' ? '#ff6d00' : '#2979ff' }} onClick={() => setCalcMethod(calcMethod === 'NR' ? 'GS' : 'NR')} title={`Clique para trocar. Atual: ${calcMethod}`}>
                        {calcMethod === 'NR' ? '⚡' : '🌊'}{!isMini && ` ${calcMethod}`}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#9e9e9e' }} onClick={() => setShowLabels(!showLabels)} title="Mostrar/Esconder Labels">
                        🏷️{!isMini && ' Labels'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#9c27b0' }} onClick={onDownloadReport} title="Baixar Relatório TXT">
                        📄{!isMini && ' Relatório'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': viewMode === 'schematic' ? '#e91e63' : '#00bcd4' }} onClick={() => setViewMode(viewMode === 'schematic' ? 'map' : 'schematic')} title="Alternar Visualização">
                        {viewMode === 'schematic' ? '🗺️' : '📐'}{!isMini && (viewMode === 'schematic' ? ' Ver Mapa' : ' Diagrama')}
                    </button>
                </div>
            </div>

            {/* PAINEL DE CARGAS (Resumo) */}
            <div className="load-display custom-scrollbar" style={{ flexShrink: 0, marginTop: '0px', maxHeight: isMini ? 'none' : '320px', overflowY: 'auto', paddingBottom: '5px', display: isMini ? 'flex' : 'grid', flexDirection: isMini ? 'column' : 'row' }}> 
                {(() => {
                    const renderLoadCard = (subId, isFeeder) => {
                        let totalP = 0; let totalQ = 0;
                        if (lineCurrents) {
                            if (!isFeeder) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; } 
                                        else if (b.to === subId) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
                                    }
                                });
                                totalP = Math.abs(totalP); totalQ = Math.abs(totalQ);
                            } else {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId || b.to === subId) {
                                            sumP += Math.abs(lineCurrents[b.id].pFlow); sumQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                                totalP = sumP / 2; totalQ = sumQ / 2;
                            }
                        }

                        const currentVBase = vBase || 13.8; 
                        const S = Math.sqrt((totalP)**2 + (totalQ)**2);
                        const I = S / (Math.sqrt(3) * currentVBase);
                        const inFault = faultNodes.has(subId);
                        const cardColor = getNodeColor ? getNodeColor(subId) : 'var(--eng-orange)';
                        
                        const nodeCount = loads[subId]?.nodes || 0;

                        return (
                            <div key={subId} className={`load-card lc-${subId}`} style={{ borderTop: `4px solid ${cardColor}` }} title={`${isFeeder ? 'ALIM' : 'SUB'} ${subId}`}>
                                <div className="load-card-title" style={{ color: cardColor, fontSize: isMini ? '9px' : '10px' }}>
                                    {isMini ? `S${subId}` : (isFeeder ? `ALIM. ${subId}` : `SUB ${subId}`)}
                                </div>
                                <span className="load-card-value" style={{ fontSize: isMini ? '12px' : '16px' }}>{inFault ? '—' : formatPower(totalP, isMini)}</span>
                                
                                <div className="load-card-subtitle" style={{ fontSize: isMini ? '9px' : '10px' }}>
                                    {inFault ? '—' : (isMini ? `${nodeCount} brs` : `${I.toFixed(0)} A`)}
                                </div>
                                
                                {!isMini && (
                                    <div className="load-card-subtitle">
                                        {inFault ? '—' : `${nodeCount} barras`}
                                    </div>
                                )}
                            </div>
                        );
                    };

                    return (
                        <>
                            {sources.map(id => renderLoadCard(id, false))}
                            {disconnectedStats && (
                                <div key="200" className="load-card" style={{ borderTop: '4px solid #757575', opacity: disconnectedStats.count > 0 ? 1 : 0.4, transition: 'opacity 0.3s ease' }} title="Subestação Desconectada">
                                    <div className="load-card-title" style={{ color: '#757575', fontSize: isMini ? '9px' : '10px' }}>{isMini ? 'OFF' : 'SUB (Off)'}</div>
                                    <span className="load-card-value" style={{ fontSize: isMini ? '12px' : '16px' }}>{formatPower(disconnectedStats.p, isMini)}</span>
                                    <div className="load-card-subtitle" style={{ fontSize: isMini ? '9px' : '10px' }}>{isMini ? `${disconnectedStats.count} brs` : `${disconnectedStats.current.toFixed(0)} A`}</div>
                                    {!isMini && <div className="load-card-subtitle">{disconnectedStats.count} barras</div>}
                                </div>
                            )}
                            {feedersList.map(id => renderLoadCard(id, true))}
                        </>
                    );
                })()}
            </div>

            {/* ESTATÍSTICAS */}
            <div className="stats-panel" style={{ flexShrink: 0, padding: isMini ? '5px' : '15px' }}>
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: isMini ? '1fr' : 'repeat(3, 1fr)', gap: isMini ? '4px' : '10px' }}>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'FECHADAS' : 'Linhas Fechadas'}</div>
                        <div className="stat-value good" style={{ fontSize: isMini ? '14px' : '18px' }}>{branches.filter(b => b.state === 1).length}</div>
                    </div>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'ABERTAS' : 'Linhas Abertas'}</div>
                        <div className="stat-value" style={{ fontSize: isMini ? '14px' : '18px' }}>{branches.filter(b => b.state === 0).length}</div>
                    </div>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'FALTAS' : 'Faltas Ativas'}</div>
                        <div className={`stat-value ${faultNodes.size > 0 ? 'bad' : ''}`} style={{ fontSize: isMini ? '14px' : '18px' }}>{faultNodes.size}</div>
                    </div>
                </div>
            </div>

            {/* ================= INSPETOR (Oculto no modo mini via CSS) ================= */}
            <div className="inspector custom-scrollbar" style={{ flex: 1, minHeight: '300px', background: 'transparent', padding: isMini ? '15px 5px' : '20px 25px', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderTop: `1px solid ${darkMode ? '#333' : '#ddd'}` }}>
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                    (() => {
                        const { v, angle } = getVoltage(selectedElement.id);
                        const puVal = v.toFixed(3);
                        const vColor = v < 0.93 ? '#d50000' : (v < 0.95 ? '#ffd600' : (v > 1.05 ? '#d50000' : '#4caf50'));
                        const isMainSource = sources.includes(selectedElement.id);
                        const isFeeder = feedersList.includes(selectedElement.id);
                        const isSource = isMainSource || isFeeder; 
                        
                        let totalP = 0, totalQ = 0, totalS = 0;
                        if (isSource && lineCurrents) {
                            if (isMainSource) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; } 
                                        else if (b.to === selectedElement.id) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
                                    }
                                });
                                totalP = Math.abs(totalP); totalQ = Math.abs(totalQ);
                            } else if (isFeeder) {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id || b.to === selectedElement.id) { sumP += Math.abs(lineCurrents[b.id].pFlow); sumQ += Math.abs(lineCurrents[b.id].qFlow); }
                                    }
                                });
                                totalP = sumP / 2; totalQ = sumQ / 2;
                            }
                            totalS = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                        }

                        let sLimit = 1000, loadingPercent = 0, loadColor = vColor;
                        if (isSource) {
                            sLimit = (sses && sses[selectedElement.id]) ? sses[selectedElement.id] : 1000;
                            loadingPercent = (totalS / sLimit) * 100;
                            loadColor = loadingPercent > 100 ? '#d50000' : (loadingPercent > 75 ? '#ff9800' : '#4caf50');
                        }

                        const titleColor = isMainSource ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800');
                        
                        // 👇 INSPETOR MINI PARA BARRAS (COM MEDIDORES VERTICAIS) 👇
                        if (isMini) return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center', width: '100%' }}>
                                {/* TÍTULO */}
                                <div style={{ color: titleColor, fontSize: '11px', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>
                                    {isMainSource ? 'SUB' : (isFeeder ? 'ALIM' : 'BARRA')}<br/>
                                    <span style={{ fontSize: '15px', color: darkMode ? '#fff' : '#000' }}>{selectedElement.id}</span>
                                </div>

                                {/* CONTAINER DAS BARRAS VERTICAIS */}
                                <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                                    
                                    {/* COLUNA 1: TENSÃO */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: vColor }}>{puVal}</div>
                                        <div style={{ position: 'relative', height: '70px', width: '8px', background: darkMode ? '#333' : '#ddd', borderRadius: '4px' }}>
                                            <div style={{ position: 'absolute', bottom: '25%', height: '50%', width: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.2)' : 'rgba(76, 175, 80, 0.3)' }}></div>
                                            <div style={{ position: 'absolute', bottom: '50%', width: '10px', left: '-1px', height: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                            <div style={{ position: 'absolute', bottom: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, left: '-3px', right: '-3px', height: '4px', background: vColor, borderRadius: '2px', transform: 'translateY(50%)', transition: 'bottom 0.4s' }}></div>
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>V (pu)</div>
                                    </div>

                                    {/* COLUNA 2: CARREGAMENTO (Só para Fontes) */}
                                    {isSource && (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: loadColor }}>{loadingPercent.toFixed(0)}%</div>
                                            <div style={{ position: 'relative', height: '70px', width: '12px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '6px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, overflow: 'hidden' }}>
                                                <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.min(loadingPercent, 100)}%`, background: loadColor, transition: 'height 0.4s' }}></div>
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>CARGA</div>
                                        </div>
                                    )}

                                    {/* COLUNA 3: BANCO SHUNT (Se existir) */}
                                    {systemShunts && systemShunts[selectedElement.id] && (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#00bcd4' }}>{systemShunts[selectedElement.id].steps}</div>
                                            <input 
                                                type="range" min="0" max={systemShunts[selectedElement.id].maxSteps} step="1" 
                                                value={systemShunts[selectedElement.id].steps}
                                                onChange={(e) => {
                                                    const newVal = parseInt(e.target.value);
                                                    if(handleShuntChange) handleShuntChange(selectedElement.id, newVal - systemShunts[selectedElement.id].steps);
                                                }}
                                                style={{ WebkitAppearance: 'slider-vertical', width: '12px', height: '70px', accentColor: '#00bcd4', cursor: 'pointer', margin: 0 }}
                                            />
                                            <div style={{ fontSize: '9px', color: '#00bcd4', fontWeight: 'bold' }}>BC</div>
                                        </div>
                                    )}
                                </div>
                                
                                {/* RODAPÉ: ÂNGULO */}
                                <div style={{ fontSize: '10px', color: '#888', fontFamily: 'monospace', marginTop: '-5px' }}>θ: {angle.toFixed(1)}°</div>
                            </div>
                        );
                        // 👆 FIM DA INJEÇÃO 👆
                        
                        return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {/* 1. TÍTULO */}
                                <div className="inspector-title" style={{ fontSize: '18px', margin: -5, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{isMainSource ? 'Subestação' : (isFeeder ? 'Alimentador' : 'Barra')}</span>
                                    <span>{selectedElement.id}</span>
                                </div>

                                {/* 2. GRÁFICO PRINCIPAL (Carregamento ou Tensão) */}
                                <div style={{ paddingBottom: isSource ? '0px' : '20px', borderBottom: isSource ? `1px dashed ${darkMode ? '#444' : '#ccc'}` : `1px dashed ${darkMode ? '#555' : '#ddd'}` }}>
                                    {isSource ? (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                                                <span style={{ color: darkMode ? '#aaa' : '#666' }}>Carregamento</span>
                                                <b style={{ color: loadColor }}>{loadingPercent.toFixed(1)}%</b>
                                            </div>
                                            <div style={{ height: '22px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '11px', overflow: 'hidden', border: `1px solid ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ width: `${Math.min(loadingPercent, 100)}%`, height: '100%', background: loadColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#000', fontWeight: 'bold', transition: 'width 0.4s ease, background 0.4s ease' }}>
                                                    {loadingPercent > 15 ? `${loadingPercent.toFixed(1)}%` : ''}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', color: loadingPercent >= 100 ? '#d50000' : (loadingPercent > 80 ? '#ff9800' : (darkMode ? '#aaa' : '#666')), fontWeight: loadingPercent > 80 ? 'bold' : 'normal' }}>
                                                {loadingPercent >= 100 ? '⚠️ SOBRECARGA' : (loadingPercent > 80 ? 'Carga Alta' : 'Operação Normal')}
                                            </div>
                                            <div className="inspector-row" style={{ marginTop: '8px', borderTop: '1px dashed #444', paddingTop: '8px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(V)</span>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(θ)</span>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span>
                                            </div>
                                            </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#888',marginTop: '4px', marginBottom: '4px', fontFamily: 'monospace' }}><span>0.90</span><span>1.00</span><span>1.10</span></div>
                                            <div style={{ position: 'relative', height: '4px', background: darkMode ? '#333' : '#e0e0e0', borderRadius: '2px' }}>
                                                <div style={{ position: 'absolute', left: '25%', width: '50%', height: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.25)', borderRadius: '2px' }}></div>
                                                <div style={{ position: 'absolute', left: '50%', top: '-3px', bottom: '-3px', width: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                                <div style={{ position: 'absolute', top: '-5px', bottom: '-5px', left: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, width: '4px', background: vColor, borderRadius: '2px', transform: 'translateX(-50%)', transition: 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.4s ease'}}></div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(V)</span>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(θ)</span>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span>
                                            </div>
                                            </>
                                    )}
                                </div>

                                {/* 3. CONTROLES (Capacitor Shunt) */}
                                {systemShunts && systemShunts[selectedElement.id] && (
                                    (() => {
                                        const shunt = systemShunts[selectedElement.id];
                                        const maxKvar = shunt.maxSteps * shunt.stepSize;
                                        const curKvar = shunt.steps * shunt.stepSize;
                                        
                                        return (
                                            <div style={{ paddingBottom: '10px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', whiteSpace: 'nowrap' }}>Banco Shunt</span>
                                                    <b style={{ color: '#00bcd4', fontSize: '13px' }}>{curKvar} <span style={{fontSize: '10px', color: '#888'}}>/ {maxKvar} kVAr</span></b>
                                                </div>
                                                
                                                <input type="range" min="0" max={shunt.maxSteps} step="1" value={shunt.steps}
                                                    onChange={(e) => {
                                                        const newVal = parseInt(e.target.value);
                                                        const diff = newVal - shunt.steps;
                                                        if(handleShuntChange) handleShuntChange(selectedElement.id, diff);
                                                    }}
                                                    style={{ width: '100%', accentColor: '#00bcd4', cursor: 'pointer', height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', appearance: 'auto' }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: darkMode ? '#777' : '#999', marginTop: '4px' }}>
                                                    <span>0</span><span>Estágio {shunt.steps}</span><span>{shunt.maxSteps}</span>
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}

                                {/* 4. DADOS BRUTOS */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <div className="inspector-row"><span>Tipo:</span><b>{isMainSource ? 'Subest. Principal' : (isFeeder ? 'Alimentador' : (systemShunts && systemShunts[selectedElement.id] ? 'Carga Shunt' : 'Carga'))}</b></div>

                                    {!isSource && systemLoads[selectedElement.id] && (
                                        <>
                                            <div className="inspector-row"><span>Carga P:</span><b>{systemLoads[selectedElement.id].p.toFixed(1)} kW</b></div>
                                            <div className="inspector-row"><span>Carga Q:</span><b>{systemLoads[selectedElement.id].q.toFixed(1)} kVAr</b></div>
                                        </>
                                    )}

                                    {isSource && (
                                        <>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demanda P:' : 'Geração P:'}</span><b>{totalP.toFixed(1)} kW</b></div>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demanda Q:' : 'Geração Q:'}</span><b>{totalQ.toFixed(1)} kVAr</b></div>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demanda S:' : 'Geração S:'}</span><b>{totalS.toFixed(1)} kVA</b></div>
                                            <div className="inspector-row"><span>Limite (SSE):</span><b>{sLimit.toFixed(0)} kVA</b></div>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })()
                    ) : (
                        (() => {
                            const liveBranch = branches.find(b => b.id === selectedElement.data.id) || selectedElement.data;
                            const currentInfo = lineCurrents[liveBranch.id];
                            if(!currentInfo) return null;
                            const barColor = getLoadColor(currentInfo.percentage);

                            // 👇 INSPETOR MINI PARA LINHAS (COM MEDIDORES VERTICAIS) 👇
                            if (isMini) return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center', width: '100%' }}>
                                    {/* TÍTULO */}
                                    <div style={{ color: '#aaa', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>
                                        LINHA<br/>
                                        <span style={{ fontSize: '14px', color: darkMode ? '#fff' : '#000' }}>{liveBranch.from}-{liveBranch.to}</span>
                                    </div>

                                    {/* CONTAINER DAS BARRAS VERTICAIS */}
                                    <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                                        
                                        {/* COLUNA 1: CARREGAMENTO */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: liveBranch.state === 1 ? barColor : '#f44336' }}>
                                                {liveBranch.state === 1 ? `${currentInfo.percentage.toFixed(0)}%` : 'OFF'}
                                            </div>
                                            <div style={{ position: 'relative', height: '80px', width: '14px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '7px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, overflow: 'hidden', opacity: liveBranch.state === 1 ? 1 : 0.3 }}>
                                                <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.min(currentInfo.percentage, 100)}%`, background: barColor, transition: 'height 0.4s' }}></div>
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>CARGA</div>
                                        </div>

                                        {/* COLUNA 2: TAP (Se for regulador) */}
                                        {liveBranch.isRegulator && (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#00bcd4' }}>
                                                    {liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap}
                                                </div>
                                                <input 
                                                    type="range" min={-liveBranch.maxTaps} max={liveBranch.maxTaps} step="1" 
                                                    value={liveBranch.currentTap}
                                                    onChange={(e) => {
                                                        const newVal = parseInt(e.target.value);
                                                        if(handleTapChange) handleTapChange(liveBranch.id, newVal - liveBranch.currentTap);
                                                    }}
                                                    style={{ WebkitAppearance: 'slider-vertical', width: '14px', height: '80px', accentColor: '#00bcd4', cursor: 'pointer', margin: 0 }}
                                                />
                                                <div style={{ fontSize: '9px', color: '#00bcd4', fontWeight: 'bold' }}>TAP</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                            // 👆 FIM DA INJEÇÃO 👆

                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {/* 1. TÍTULO */}
                                    <div className="inspector-title" style={{ fontSize: '18px', margin: -5, display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Linha </span>
                                        <span>{liveBranch.from}-{liveBranch.to}</span>
                                    </div>
                                    
                                    {/* 2. GRÁFICO PRINCIPAL (Carregamento da Linha) */}
                                    {liveBranch.state === 1 && (
                                        <div style={{ paddingBottom: '8px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                                                <span style={{ color: darkMode ? '#aaa' : '#666' }}>Carregamento</span>
                                                <b style={{ color: barColor }}>{currentInfo.percentage.toFixed(1)}%</b>
                                            </div>
                                            <div style={{ height: '22px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '11px', overflow: 'hidden', border: `1px solid ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ width: `${Math.min(currentInfo.percentage, 100)}%`, height: '100%', background: barColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#000', fontWeight: 'bold', transition: 'width 0.4s ease, background 0.4s ease' }}>
                                                    {currentInfo.percentage > 15 ? `${currentInfo.percentage.toFixed(1)}%` : ''}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', color: currentInfo.percentage >= 100 ? '#d50000' : (currentInfo.percentage > 80 ? '#ff9800' : (darkMode ? '#aaa' : '#666')), fontWeight: currentInfo.percentage > 80 ? 'bold' : 'normal' }}>
                                                {currentInfo.percentage >= 100 ? '⚠️ SOBRECARGA' : (currentInfo.percentage > 80 ? 'Carga Alta' : 'Operação Normal')}
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. CONTROLES (TAP Regulador de Tensão) */}
                                    {liveBranch.isRegulator && (
                                        <div style={{ paddingBottom: '10px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <span style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', whiteSpace: 'nowrap' }}>Regulador (TAP)</span>
                                                <b style={{ color: '#00bcd4', fontSize: '13px' }}>{liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap} <span style={{fontSize: '10px', color: '#888'}}>/ ±{liveBranch.maxTaps}</span></b>
                                            </div>
                                            
                                            <input type="range" min={-liveBranch.maxTaps} max={liveBranch.maxTaps} step="1" value={liveBranch.currentTap}
                                                onChange={(e) => {
                                                    const newVal = parseInt(e.target.value);
                                                    const diff = newVal - liveBranch.currentTap;
                                                    if(handleTapChange) handleTapChange(liveBranch.id, diff);
                                                }}
                                                style={{ width: '100%', accentColor: '#00bcd4', cursor: 'pointer', height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', appearance: 'auto' }}
                                            />
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: darkMode ? '#777' : '#999', marginTop: '4px' }}>
                                                <span>-{liveBranch.maxTaps}</span><span>Posição {liveBranch.currentTap}</span><span>+{liveBranch.maxTaps}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* 4. DADOS BRUTOS */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
                                        <div className="inspector-row"><span>Status:</span><b style={{ color: liveBranch.state === 1 ? '#4caf50' : '#f44336' }}>{liveBranch.state === 1 ? 'FECHADO' : 'ABERTO'}</b></div>
                                        <div className="inspector-row"><span>Resistência (R):</span><b>{liveBranch.r} Ω</b></div>
                                        <div className="inspector-row"><span>Reatância (X):</span><b>{liveBranch.x} Ω</b></div>
                                        <div className="inspector-row"><span>Limite (Imax):</span><b>{currentInfo.limitCurrent ? `${currentInfo.limitCurrent.toFixed(0)} A` : '—'}</b></div>
                                        
                                        {liveBranch.state === 1 && (
                                            <>
                                                {/* 👇 POTÊNCIAS INSERIDAS AQUI (Magnitude em kW/kVAr) 👇 */}
                                                <div className="inspector-row"><span>Potência P:</span><b>{Math.abs(currentInfo.pFlow).toFixed(2)} kW</b></div>
                                                <div className="inspector-row"><span>Potência Q:</span><b>{Math.abs(currentInfo.qFlow).toFixed(2)} kVAr</b></div>
                                                
                                                <div className="inspector-row"><span>Corrente:</span><b>{currentInfo.current.toFixed(1)} A</b></div>
                                                <div className="inspector-row"><span>Perdas (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    )
                ) : (
                    <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, textAlign: 'center', color: darkMode ? '#aaa' : '#666' }}>
                        <span style={{ fontSize: isMini ? '24px' : '45px', marginBottom: isMini ? '0' : '15px' }}>🖱️</span>
                        {!isMini && (
                            <>
                                <span style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>Inspetor de Elementos</span>
                                <span style={{ fontSize: '13px' }}>Clique ou passe o mouse sobre<br/>uma barra ou linha.<br/> Use Shift + Clique para fixar </span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}