import React from 'react';
import { SYSTEM_DATA } from '../data/systemData';

export default function FaultPanel({
    isFaultSidebarOpen,
    setFaultSidebarOpen,
    sources,
    loadNodes,
    faultNodes,
    nodeFeeds,
    toggleFault,
    selectedElement,
    setSelectedElement,
    setHoveredNodeId,
    getNodeColor,
    darkMode,
    THEME,
    nodeData,
    lineCurrents,
    loads,
    branches,
    sses,
    feedersList = [], // 👈 Recebendo a lista de alimentadores
    handleTapChange,
    systemShunts = {},       // 👈 NOVO: Recebe os estados dos capacitores
    handleShuntChange,        // 👈 NOVO: Recebe a função de alterar os passos
    systemLoads = {}
}) {
    const getStatusText = (id) => {
        if (faultNodes.has(id)) return 'EM FALTA';
        const feeds = nodeFeeds[id];
        if (!feeds || feeds.size === 0) return 'DESENERGIZADO';
        if (feeds.size > 1) return 'EM LOOP';
        return 'ENERGIZADO';
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
        <div className={`right-sidebar ${isFaultSidebarOpen ? 'open' : ''}`}>
             
             {/* ================= INSPETOR ================= */}
             <div className="inspector" style={{ 
                 height: '360px', minHeight: '360px', borderBottom: '2px solid var(--border-color)',
                 background: 'var(--card-bg)', padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column'
             }}>
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                    (() => {
                        const { v, angle } = getVoltage(selectedElement.id);
                        const puVal = v.toFixed(3);
                        
                        // Lógica de cores da tensão (Violado = Vermelho, Atenção = Amarelo, Seguro = Verde)
                        const vColor = v < 0.93 ? '#d50000' : (v < 0.95 ? '#ffd600' : (v > 1.05 ? '#d50000' : '#4caf50'));
                        
                        const isMainSource = sources.includes(selectedElement.id);
                        const isFeeder = feedersList.includes(selectedElement.id);
                        const isSource = isMainSource || isFeeder; 
                        
                        let totalP = 0, totalQ = 0, totalS = 0;
                        
                        if (isSource && lineCurrents) {
                            if (isMainSource) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id) {
                                            totalP += lineCurrents[b.id].pFlow;
                                            totalQ += lineCurrents[b.id].qFlow;
                                        } else if (b.to === selectedElement.id) {
                                            totalP -= lineCurrents[b.id].pFlow;
                                            totalQ -= lineCurrents[b.id].qFlow;
                                        }
                                    }
                                });
                                totalP = Math.abs(totalP);
                                totalQ = Math.abs(totalQ);
                            } else if (isFeeder) {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id || b.to === selectedElement.id) {
                                            sumP += Math.abs(lineCurrents[b.id].pFlow);
                                            sumQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                                totalP = sumP / 2;
                                totalQ = sumQ / 2;
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
                            <>
                                <div className="inspector-title">{isMainSource ? 'Subestação' : (isFeeder ? 'Alimentador' : 'Barra')} {selectedElement.id}</div>
                                <div className="inspector-row"><span>Tipo:</span><b>{isMainSource ? 'Subest. Principal' : (isFeeder ? 'Alimentador' : (systemShunts && systemShunts[selectedElement.id] ? 'Carga Shunt' : 'Carga'))}</b></div>

                                {/* CARGAS (P e Q) */}
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

                                {/* 👇 O NOVO SLIDER DO CAPACITOR (Minimalista) 👇 */}
                                {systemShunts && systemShunts[selectedElement.id] && (
                                    (() => {
                                        const shunt = systemShunts[selectedElement.id];
                                        const maxKvar = shunt.maxSteps * shunt.stepSize;
                                        const curKvar = shunt.steps * shunt.stepSize;
                                        
                                        return (
                                            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: `1px solid ${darkMode ? '#333' : '#eee'}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', whiteSpace: 'nowrap' }}>Banco Shunt</span>
                                                    <b style={{ color: '#00bcd4', fontSize: '13px' }}>{curKvar} <span style={{fontSize: '10px', color: '#888'}}>/ {maxKvar} kVAr</span></b>
                                                </div>
                                                
                                                <input 
                                                    type="range" 
                                                    min="0" 
                                                    max={shunt.maxSteps} 
                                                    step="1" 
                                                    value={shunt.steps}
                                                    onChange={(e) => {
                                                        const newVal = parseInt(e.target.value);
                                                        const diff = newVal - shunt.steps;
                                                        if(handleShuntChange) handleShuntChange(selectedElement.id, diff);
                                                    }}
                                                    style={{ width: '100%', accentColor: '#00bcd4', cursor: 'pointer', height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', appearance: 'auto' }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: darkMode ? '#777' : '#999', marginTop: '4px' }}>
                                                    <span>0</span>
                                                    <span>Estágio {shunt.steps}</span>
                                                    <span>{shunt.maxSteps}</span>
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}

                                {/* 👇 O NOVO MEDIDOR DE TENSÃO (Bullet Graph Limpo) 👇 */}
                                <div style={{ marginTop: 'auto', paddingTop: '15px', borderTop: `1px solid ${darkMode ? '#333' : '#eee'}` }}>
                                    {isSource ? (
                                        /* Barra de carregamento da Subestação (S) */
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                                                <span style={{ color: darkMode ? '#aaa' : '#666' }}>Carregamento</span>
                                                <b style={{ color: loadColor }}>{loadingPercent.toFixed(1)}%</b>
                                            </div>
                                            <div style={{ height: '6px', background: darkMode ? '#333' : '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{ width: `${Math.min(loadingPercent, 100)}%`, height: '100%', background: loadColor, transition: 'width 0.4s ease, background 0.4s ease' }}></div>
                                            </div>
                                        </>
                                    ) : (
                                        /* Bullet Graph Minimalista para Tensão PU da Carga */
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#888', marginBottom: '4px', fontFamily: 'monospace' }}>
                                                <span>0.90</span>
                                                <span>1.00</span>
                                                <span>1.10</span>
                                            </div>
                                            
                                            <div style={{ position: 'relative', height: '4px', background: darkMode ? '#333' : '#e0e0e0', borderRadius: '2px' }}>
                                                {/* Faixa Segura (0.95 a 1.05) - Discreta */}
                                                <div style={{ position: 'absolute', left: '25%', width: '50%', height: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.25)', borderRadius: '2px' }}></div>
                                                {/* Marcador Central (1.00) */}
                                                <div style={{ position: 'absolute', left: '50%', top: '-3px', bottom: '-3px', width: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                                
                                                {/* A Agulha da Tensão */}
                                                <div style={{ 
                                                    position: 'absolute', top: '-5px', bottom: '-5px', 
                                                    left: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, 
                                                    width: '4px', background: vColor, borderRadius: '2px',
                                                    transform: 'translateX(-50%)', transition: 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.4s ease'
                                                }}></div>
                                            </div>

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>Tensão</span>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>Ângulo</span>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </>
                        );
                    })()
                    ) : (
                        /* LINHA */
                        (() => {
                            const liveBranch = branches.find(b => b.id === selectedElement.data.id) || selectedElement.data;
                            const currentInfo = lineCurrents[liveBranch.id];
                            if(!currentInfo) return null;
                            const barColor = getLoadColor(currentInfo.percentage);

                            return (
                                <>
                                    <div className="inspector-title">Linha {liveBranch.from}-{liveBranch.to}</div>
                                    <div className="inspector-row"><span>Status:</span><b>{liveBranch.state === 1 ? 'FECHADO' : 'ABERTO'}</b></div>
                                    <div className="inspector-row"><span>Resistência (R):</span><b>{liveBranch.r} Ω</b></div>
                                    <div className="inspector-row"><span>Reatância (X):</span><b>{liveBranch.x} Ω</b></div>
                                    <div className="inspector-row"><span>Limite (Imax):</span><b>{liveBranch.Imax} A</b></div>

                                    {liveBranch.isRegulator && (
                                        <div style={{ marginTop: '15px', padding: '10px', background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', borderRadius: '8px', border: `1px solid ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                                                <span style={{ color: '#888' }}>Regulador de Tensão:</span>
                                                <b style={{ color: '#00bcd4' }}>Tap {liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap}</b>
                                            </div>
                                            
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button 
                                                    onClick={() => handleTapChange(liveBranch.id, -1)} 
                                                    disabled={liveBranch.currentTap <= -liveBranch.maxTaps}
                                                    style={{ flex: 1, padding: '6px', background: liveBranch.currentTap <= -liveBranch.maxTaps ? 'transparent' : '#d32f2f', color: liveBranch.currentTap <= -liveBranch.maxTaps ? '#555' : '#fff', border: liveBranch.currentTap <= -liveBranch.maxTaps ? '1px dashed #555' : 'none', borderRadius: '4px', cursor: liveBranch.currentTap <= -liveBranch.maxTaps ? 'not-allowed' : 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
                                                >
                                                    - TAP
                                                </button>
                                                <button 
                                                    onClick={() => handleTapChange(liveBranch.id, 1)} 
                                                    disabled={liveBranch.currentTap >= liveBranch.maxTaps}
                                                    style={{ flex: 1, padding: '6px', background: liveBranch.currentTap >= liveBranch.maxTaps ? 'transparent' : '#2e7d32', color: liveBranch.currentTap >= liveBranch.maxTaps ? '#555' : '#fff', border: liveBranch.currentTap >= liveBranch.maxTaps ? '1px dashed #555' : 'none', borderRadius: '4px', cursor: liveBranch.currentTap >= liveBranch.maxTaps ? 'not-allowed' : 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
                                                >
                                                    + TAP
                                                </button>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '10px', color: '#666', marginTop: '6px' }}>
                                                Faixa Operacional: ±{liveBranch.maxTaps} posições
                                            </div>
                                        </div>
                                    )}
                                    
                                    {liveBranch.state === 1 && (
                                        <>
                                            <div className="inspector-row"><span>Perdas (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>
                                            <div className="inspector-row"><span>Corrente:</span><b>{currentInfo.current.toFixed(1)} A</b></div>
                                            <div className="current-bar-container" style={{marginTop:'auto', height:'24px', borderRadius:'12px'}}>
                                                <div className="current-bar" style={{ width: `${Math.min(currentInfo.percentage, 100)}%`, background: barColor, transition: 'background 0.3s, width 0.3s', fontSize: '12px' }}>
                                                    {currentInfo.percentage.toFixed(1)}%
                                                </div>
                                            </div>
                                            <div className="current-info" style={{justifyContent: 'center', color: currentInfo.percentage > 90 ? barColor : 'inherit'}}>
                                                {currentInfo.percentage >= 100 ? '⚠️ SOBRECARGA' : currentInfo.percentage > 80 ? 'Carga Alta' : 'Normal'}
                                            </div>
                                        </>
                                    )}
                                </>
                            );
                        })()
                    )
                ) : (
                    <div className="inspector-empty" style={{margin:'auto'}}> Passe o mouse sobre um elemento </div>
                )}
             </div>

             {/* ================= LISTA DE FALTAS ================= */}
             <div style={{padding:'15px', borderBottom:'1px solid var(--border-color)', flexShrink:0, background: 'var(--bg-color)'}}>
                <h2 style={{fontSize:'16px', margin:0}}>Gerenciador de Faltas</h2>
             </div>
             
             <div className="fault-list">
                <div style={{fontSize:'12px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'10px'}}>SUBESTAÇÃO PRINCIPAL</div>
                {sources.map(id => (
                    <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                         onClick={() => setSelectedElement({ type: 'node', id: id })}
                         onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                         onMouseLeave={() => { setHoveredNodeId(null); }}>
                        <span>SUB {id}</span>
                        <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '110px' }} 
                                onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                            {getStatusText(id)}
                        </button>
                    </div>
                ))}

                {feedersList.length > 0 && (
                    <>
                        <div style={{fontSize:'12px', fontWeight:'bold', color:'var(--eng-gray)', margin:'20px 0 10px 0'}}>ALIMENTADORES</div>
                        {feedersList.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}>
                                <span>Alim. {id}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '110px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}
                
                <div style={{fontSize:'12px', fontWeight:'bold', color:'var(--eng-gray)', margin:'20px 0 10px 0'}}>BARRAS DE CARGA</div>
                {loadNodes.map(id => (
                    <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                         onClick={() => setSelectedElement({ type: 'node', id: id })}
                         onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                         onMouseLeave={() => { setHoveredNodeId(null); }}>
                        <span>Barra {id}</span>
                        <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '110px' }} 
                                onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                            {getStatusText(id)}
                        </button>
                    </div>
                ))}
             </div>
        </div>
    );
}