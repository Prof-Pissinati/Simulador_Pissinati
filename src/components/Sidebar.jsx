import React, { useRef } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

// Função para converter grandezas de potência automaticamente
const formatPower = (kw) => {
    if (kw >= 1000000) return (kw / 1000000).toFixed(2) + ' GW';
    if (kw >= 1000) return (kw / 1000).toFixed(2) + ' MW';
    return kw.toFixed(0) + ' kW';
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
    handleTapChange,
    handleShuntChange
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
            
            {/* CABEÇALHO FIXO */}
            <div className="sidebar-header" style={{ flexShrink: 0 }}>
                <h1 style={{ marginTop: '-10px',marginBottom: '10px' } }>⚡Sis. {systemSize} Barras</h1>
                
                <input type="file" ref={fileInputRef} style={{display: 'none'}} accept=".txt,.dat,.log" onChange={handleFileChange} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', marginBottom: '1px' }}>
                    <button className="sidebar-action-btn" style={{ '--btn-color': darkMode ? '#aaaaaa' : '#555555' }} onClick={() => setDarkMode(!darkMode)} title="Alternar Tema">🌗 Tema</button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#FFC107' }} onClick={onExportPDF} title="Exportar para PDF">🖼️ PDF</button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#00bcd4' }} onClick={handleImportClick} title="Importar (AMPLE/TXT)">📂 Abrir</button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#4caf50' }} onClick={resetSystem} title="Reiniciar Sistema">🔄 Reset</button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': calcMethod === 'NR' ? '#ff6d00' : '#2979ff' }} onClick={() => setCalcMethod(calcMethod === 'NR' ? 'GS' : 'NR')} title={`Clique para trocar. Atual: ${calcMethod}`}>{calcMethod === 'NR' ? '⚡' : '🌊'} {calcMethod}</button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#9e9e9e' }} onClick={() => setShowLabels(!showLabels)} title="Mostrar/Esconder Labels">🏷️ Labels</button>
                </div>

                <button className="sidebar-action-btn" style={{ '--btn-color': '#9c27b0', width: '100%', marginBottom: '-10px' }} onClick={onDownloadReport} title="Baixar Relatório TXT">
                    📄 Relatório
                </button>
            </div>

            {/* PAINEL DE CARGAS (Resumo) */}
            <div className="load-display custom-scrollbar" style={{ flexShrink: 0, marginTop: '0px', maxHeight: '320px', overflowY: 'auto', paddingBottom: '5px' }}> 
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

                        const vbase = SYSTEM_DATA?.Vbase || 13.8; 
                        const S = Math.sqrt((totalP)**2 + (totalQ)**2);
                        const I = S / (Math.sqrt(3) * vbase);
                        const inFault = faultNodes.has(subId);
                        const cardColor = getNodeColor ? getNodeColor(subId) : 'var(--eng-orange)';
                        
                        return (
                            <div key={subId} className={`load-card lc-${subId}`} style={{ borderTop: `4px solid ${cardColor}` }}>
                                <div className="load-card-title" style={{ color: cardColor }}>{isFeeder ? `ALIM. ${subId}` : `SUB ${subId}`}</div>
                                <span className="load-card-value">{inFault ? '—' : formatPower(totalP)}</span>
                                <div className="load-card-subtitle">{inFault ? '—' : I.toFixed(0)} A</div>
                                <div className="load-card-subtitle">{inFault ? '—' : (isFeeder ? 'Alimentador' : `${loads[subId]?.nodes || 0} barras`)}</div>
                            </div>
                        );
                    };

                    return (
                        <>
                            {sources.map(id => renderLoadCard(id, false))}
                            {disconnectedStats && (
                                <div key="200" className="load-card" style={{ borderTop: '4px solid #757575', opacity: disconnectedStats.count > 0 ? 1 : 0.4, transition: 'opacity 0.3s ease' }}>
                                    <div className="load-card-title" style={{ color: '#757575' }}>SUB (Off)</div>
                                    <span className="load-card-value">{formatPower(disconnectedStats.p)}</span>
                                    <div className="load-card-subtitle">{disconnectedStats.current.toFixed(0)} A</div>
                                    <div className="load-card-subtitle">{disconnectedStats.count} barras</div>
                                </div>
                            )}
                            {feedersList.map(id => renderLoadCard(id, true))}
                        </>
                    );
                })()}
            </div>

            {/* ESTATÍSTICAS */}
            <div className="stats-panel" style={{ flexShrink: 0 }}>
                <div className="stats-grid">
                    <div className="stat-item"><div className="stat-label">Linhas Fechadas</div><div className="stat-value good">{branches.filter(b => b.state === 1).length}</div></div>
                    <div className="stat-item"><div className="stat-label">Linhas Abertas</div><div className="stat-value">{branches.filter(b => b.state === 0).length}</div></div>
                    <div className="stat-item"><div className="stat-label">Faltas Ativas</div><div className={`stat-value ${faultNodes.size > 0 ? 'bad' : ''}`}>{faultNodes.size}</div></div>
                </div>
            </div>

            {/* ================= INSPETOR ================= */}
            <div className="inspector custom-scrollbar" style={{ flex: 1, minHeight: '300px', background: 'transparent', padding: '20px 25px', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderTop: `1px solid ${darkMode ? '#333' : '#ddd'}` }}>
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
                            sLimit = (SYSTEM_DATA.sses && SYSTEM_DATA.sses[selectedElement.id]) ? SYSTEM_DATA.sses[selectedElement.id] : 1000;
                            loadingPercent = (totalS / sLimit) * 100;
                            loadColor = loadingPercent > 100 ? '#d50000' : (loadingPercent > 75 ? '#ff9800' : '#4caf50');
                        }
                        
                        return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                {/* 1. TÍTULO */}
                                <div className="inspector-title" style={{ fontSize: '18px', margin: 0 }}>
                                    {isMainSource ? 'Subestação' : (isFeeder ? 'Alimentador' : 'Barra')} {selectedElement.id}
                                </div>

                                {/* 2. GRÁFICO PRINCIPAL (Carregamento ou Tensão) */}
                                <div style={{ paddingBottom: '15px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
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
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', marginBottom: '4px', fontFamily: 'monospace' }}><span>0.90</span><span>1.00</span><span>1.10</span></div>
                                            <div style={{ position: 'relative', height: '4px', background: darkMode ? '#333' : '#e0e0e0', borderRadius: '2px' }}>
                                                <div style={{ position: 'absolute', left: '25%', width: '50%', height: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.25)', borderRadius: '2px' }}></div>
                                                <div style={{ position: 'absolute', left: '50%', top: '-3px', bottom: '-3px', width: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                                <div style={{ position: 'absolute', top: '-5px', bottom: '-5px', left: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, width: '4px', background: vColor, borderRadius: '2px', transform: 'translateX(-50%)', transition: 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.4s ease'}}></div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}><span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>Tensão</span><span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}><span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>Ângulo</span><span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span></div>
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
                                            <div style={{ paddingBottom: '15px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
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

                                {/* 4. DADOS BRUTOS (Ficam por último como detalhes) */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    {/* 1. TÍTULO */}
                                    <div className="inspector-title" style={{ fontSize: '18px', margin: 0 }}>Linha {liveBranch.from}-{liveBranch.to}</div>
                                    
                                    {/* 2. GRÁFICO PRINCIPAL (Carregamento da Linha) */}
                                    {liveBranch.state === 1 && (
                                        <div style={{ paddingBottom: '15px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
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

                                    {/* 3. CONTROLES (TAP Regulador de Tensão com botões reformulados) */}
                                    {liveBranch.isRegulator && (
                                        <div style={{ paddingBottom: '15px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}><span style={{ color: darkMode ? '#aaa' : '#666' }}>Regulador (TAP):</span><b style={{ color: '#00bcd4', fontFamily: 'monospace', fontSize: '14px' }}>{liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap}</b></div>
                                            
                                            {/* Novos botões de TAP combinando com a identidade visual do app */}
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                                                <button 
                                                    onClick={() => handleTapChange(liveBranch.id, -1)} 
                                                    disabled={liveBranch.currentTap <= -liveBranch.maxTaps} 
                                                    style={{ 
                                                        flex: 1, padding: '8px', 
                                                        background: liveBranch.currentTap <= -liveBranch.maxTaps ? 'transparent' : (darkMode ? '#1e1e1e' : '#fff'), 
                                                        color: liveBranch.currentTap <= -liveBranch.maxTaps ? '#555' : (darkMode ? '#fff' : '#000'), 
                                                        border: `1px solid ${liveBranch.currentTap <= -liveBranch.maxTaps ? '#555' : (darkMode ? '#555' : '#ccc')}`, 
                                                        borderRadius: '6px', cursor: liveBranch.currentTap <= -liveBranch.maxTaps ? 'not-allowed' : 'pointer', 
                                                        fontWeight: 'bold', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                                                    }}
                                                    onMouseOver={e => { if(liveBranch.currentTap > -liveBranch.maxTaps) e.target.style.borderColor = '#00bcd4' }}
                                                    onMouseOut={e => { if(liveBranch.currentTap > -liveBranch.maxTaps) e.target.style.borderColor = darkMode ? '#555' : '#ccc' }}
                                                >
                                                    <span style={{ fontSize: '16px', color: '#f44336' }}>-</span> REDUZIR
                                                </button>
                                                
                                                <button 
                                                    onClick={() => handleTapChange(liveBranch.id, 1)} 
                                                    disabled={liveBranch.currentTap >= liveBranch.maxTaps} 
                                                    style={{ 
                                                        flex: 1, padding: '8px', 
                                                        background: liveBranch.currentTap >= liveBranch.maxTaps ? 'transparent' : (darkMode ? '#1e1e1e' : '#fff'), 
                                                        color: liveBranch.currentTap >= liveBranch.maxTaps ? '#555' : (darkMode ? '#fff' : '#000'), 
                                                        border: `1px solid ${liveBranch.currentTap >= liveBranch.maxTaps ? '#555' : (darkMode ? '#555' : '#ccc')}`, 
                                                        borderRadius: '6px', cursor: liveBranch.currentTap >= liveBranch.maxTaps ? 'not-allowed' : 'pointer', 
                                                        fontWeight: 'bold', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                                                    }}
                                                    onMouseOver={e => { if(liveBranch.currentTap < liveBranch.maxTaps) e.target.style.borderColor = '#00bcd4' }}
                                                    onMouseOut={e => { if(liveBranch.currentTap < liveBranch.maxTaps) e.target.style.borderColor = darkMode ? '#555' : '#ccc' }}
                                                >
                                                    <span style={{ fontSize: '16px', color: '#4caf50' }}>+</span> ELEVAR
                                                </button>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginTop: '10px' }}>Operando entre ±{liveBranch.maxTaps} posições</div>
                                        </div>
                                    )}

                                    {/* 4. DADOS BRUTOS */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div className="inspector-row"><span>Status:</span><b style={{ color: liveBranch.state === 1 ? '#4caf50' : '#f44336' }}>{liveBranch.state === 1 ? 'FECHADO' : 'ABERTO'}</b></div>
                                        <div className="inspector-row"><span>Resistência (R):</span><b>{liveBranch.r} Ω</b></div>
                                        <div className="inspector-row"><span>Reatância (X):</span><b>{liveBranch.x} Ω</b></div>
                                        <div className="inspector-row"><span>Limite (Imax):</span><b>{currentInfo.limitCurrent ? `${currentInfo.limitCurrent.toFixed(0)} A` : '—'}</b></div>
                                        
                                        {liveBranch.state === 1 && (
                                            <>
                                                <div className="inspector-row"><span>Perdas (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>
                                                <div className="inspector-row"><span>Corrente:</span><b>{currentInfo.current.toFixed(1)} A</b></div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    )
                ) : (
                    /* ESTADO VAZIO BONITO E CENTRALIZADO */
                    <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, textAlign: 'center', color: darkMode ? '#aaa' : '#666' }}>
                        <span style={{ fontSize: '45px', marginBottom: '15px' }}>🖱️</span>
                        <span style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>Inspetor de Elementos</span>
                        <span style={{ fontSize: '13px' }}>Clique ou passe o mouse sobre<br/>uma barra ou linha no diagrama.</span>
                    </div>
                )}
            </div>
        </div>
    );
}