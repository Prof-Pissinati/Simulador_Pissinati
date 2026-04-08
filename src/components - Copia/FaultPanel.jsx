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
    handleTapChange
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
                 height: '340px', minHeight: '340px', borderBottom: '2px solid var(--border-color)',
                 background: 'var(--card-bg)', padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column'
             }}>
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                    (() => {
                        const { v, angle } = getVoltage(selectedElement.id);
                        const puVal = v.toFixed(3);
                        const vColor = v < 0.93 ? '#d50000' : (v < 0.95 ? '#ffd600' : '#2e7d32');
                        
                        // 👇 IDENTIFICAÇÃO DO TIPO 👇
                        const isMainSource = sources.includes(selectedElement.id);
                        const isFeeder = feedersList.includes(selectedElement.id);
                        const isSource = isMainSource || isFeeder; // Ambos se comportam como fonte visualmente
                        
                        // 👇 CÁLCULO INTELIGENTE DE ENERGIA 👇
                        let totalP = 0, totalQ = 0, totalS = 0;
                        
                        if (isSource && lineCurrents) {
                            if (isMainSource) {
                                // GERAÇÃO (Subestação Principal): Calcula saldo líquido
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
                                // DEMANDA DE PASSAGEM (Alimentador): Soma o módulo de tudo e divide por 2
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

                        // 👇 CÁLCULO DE CARREGAMENTO (SSE) 👇
                        let sLimit = 1000, loadingPercent = 0, loadColor = vColor;
                        
                        if (isSource) {
                            sLimit = (SYSTEM_DATA.sses && SYSTEM_DATA.sses[selectedElement.id]) ? SYSTEM_DATA.sses[selectedElement.id] : 1000;
                            loadingPercent = (totalS / sLimit) * 100;
                            loadColor = loadingPercent > 100 ? '#d50000' : (loadingPercent > 75 ? '#ff9800' : '#2e7d32');
                        }
                        
                        return (
                            <>
                                <div className="inspector-title">{isMainSource ? 'Subestação' : (isFeeder ? 'Alimentador' : 'Barra')} {selectedElement.id}</div>
                                <div className="inspector-row"><span>Tipo:</span><b>{isMainSource ? 'Subest. Principal' : (isFeeder ? 'Alimentador' : 'Carga')}</b></div>
                                
                                {!isSource && SYSTEM_DATA.loads[selectedElement.id] && (
                                    <>
                                        <div className="inspector-row"><span>Carga P:</span><b>{SYSTEM_DATA.loads[selectedElement.id].p.toFixed(1)} kW</b></div>
                                        <div className="inspector-row"><span>Carga Q:</span><b>{SYSTEM_DATA.loads[selectedElement.id].q.toFixed(1)} kVAr</b></div>
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

                                <div className="inspector-row" style={{marginTop:'auto', paddingTop:'10px', borderTop:'1px dashed #444'}}>
                                    <span>{'Tensão:'}</span>
                                    <b style={{color: vColor}}>{`${puVal} pu`}</b>
                                </div>
                                <div className="inspector-row"><span>Ângulo:</span><b>{angle.toFixed(2)}°</b></div>
                                
                                {/* 👇 BARRA DE PROGRESSO OU AGULHA DE TENSÃO 👇 */}
                                {isSource ? (
                                    /* Se for Subestação/Alimentador, mostra o % de Carregamento */
                                    <div className="current-bar-container" style={{marginTop:'12px', height:'24px', borderRadius:'12px'}}>
                                        <div className="current-bar" 
                                                style={{
                                                    width: `${Math.min(loadingPercent, 100)}%`, 
                                                    background: loadColor,
                                                    transition: 'width 0.4s ease, background 0.4s ease',
                                                    fontSize: '12px'
                                                }}>
                                            {loadingPercent.toFixed(1)}%
                                        </div>
                                    </div>
                                ) : (
                                    /* 💎 NOVO MEDIDOR HORIZONTAL "BULLET GAUGE" (0.90 a 1.10) 💎 */
                                    <div style={{ marginTop: '15px', padding: '0 10px' }}>
                                        {/* Régua de Valores */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '6px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                            <span>0.90</span>
                                            <span style={{ color: '#ccc' }}>1.00</span>
                                            <span>1.10</span>
                                        </div>
                                        
                                        {/* Trilha do Gradiente (Embutida) */}
                                        <div style={{ position: 'relative', height: '10px', background: 'linear-gradient(90deg, #d32f2f 0%, #d32f2f 15%, #fbc02d 25%, #388e3c 40%, #388e3c 60%, #fbc02d 75%, #d32f2f 85%, #d32f2f 100%)', borderRadius: '4px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
                                            
                                            {/* Marcação central de 1.00 pu */}
                                            <div style={{ position: 'absolute', left: '50%', top: '0', bottom: '0', width: '2px', background: 'rgba(255,255,255,0.4)', transform: 'translateX(-50%)' }}></div>
                                            
                                            {/* O Ponteiro (Barra Vertical Branca) */}
                                            <div style={{ 
                                                position: 'absolute', 
                                                top: '-4px', 
                                                bottom: '-4px', 
                                                left: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, 
                                                width: '6px', 
                                                background: '#ffffff', 
                                                border: '1px solid #333',
                                                borderRadius: '3px', 
                                                boxShadow: '0 0 5px rgba(0,0,0,0.8)',
                                                transform: 'translateX(-50%)',
                                                transition: 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
                                            }}></div>
                                        </div>
                                        
                                        {/* Valor Exato em Destaque */}
                                        <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '14px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>
                                            {puVal} pu
                                        </div>
                                    </div>
                                )}
                                {/* 👆 ========================================= 👆 */}
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