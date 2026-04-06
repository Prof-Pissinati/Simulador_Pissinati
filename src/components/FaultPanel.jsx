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
    sses
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
        /* REMOVI O FRAGMENTO <> PARA RETORNAR UM ELEMENTO SÓ */
        <div className={`right-sidebar ${isFaultSidebarOpen ? 'open' : ''}`}>
             
             {/* ================= INSPETOR ================= */}
             <div className="inspector" style={{ 
                 height: '340px', 
                 minHeight: '340px', 
                 borderBottom: '2px solid var(--border-color)',
                 background: 'var(--card-bg)',
                 padding: '20px',
                 overflow: 'hidden',
                 display: 'flex',
                 flexDirection: 'column'
             }}>
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                    (() => {
                        const { v, angle } = getVoltage(selectedElement.id);
                        const puVal = v.toFixed(3);
                        const vColor = v < 0.93 ? '#d50000' : (v < 0.95 ? '#ffd600' : '#2e7d32');
                        const isSource = sources.includes(selectedElement.id);
                        
                        // 👇 LÓGICA DE GERAÇÃO REAL 👇
                        let totalP = 0, totalQ = 0, totalS = 0;
                        if (isSource && lineCurrents) {
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
                            totalS = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                        }

                        // 👇 NOVO: CÁLCULO DE CARREGAMENTO (SSE) 👇
                        let sLimit = 1000, sApparent = 0, loadingPercent = 0, loadColor = vColor;
                        
                        if (isSource) {
                            sLimit = (SYSTEM_DATA.sses && SYSTEM_DATA.sses[selectedElement.id]) ? SYSTEM_DATA.sses[selectedElement.id] : 1000;
                            sApparent = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                            loadingPercent = (sApparent / sLimit) * 100;
                            loadColor = loadingPercent > 100 ? '#d50000' : (loadingPercent > 75 ? '#ff9800' : '#2e7d32');
                        }
                        
                        return (
                            <>
                                <div className="inspector-title">Barra {selectedElement.id}</div>
                                <div className="inspector-row"><span>Tipo:</span><b>{isSource ? 'Subestação' : 'Carga'}</b></div>
                                
                                {!isSource && SYSTEM_DATA.loads[selectedElement.id] && (
                                    <>
                                        <div className="inspector-row"><span>Carga P:</span><b>{SYSTEM_DATA.loads[selectedElement.id].p.toFixed(1)} kW</b></div>
                                        <div className="inspector-row"><span>Carga Q:</span><b>{SYSTEM_DATA.loads[selectedElement.id].q.toFixed(1)} kVAr</b></div>
                                    </>
                                )}

                                {/* MUDANÇA: Agora exibe a geração e o Limite SSE! */}
                                {isSource && (
                                    <>
                                        <div className="inspector-row"><span>Total P:</span><b>{totalP.toFixed(1)} kW</b></div>
                                        <div className="inspector-row"><span>Total Q:</span><b>{totalQ.toFixed(1)} kVAr</b></div>
                                        <div className="inspector-row"><span>Total S:</span><b>{totalS.toFixed(1)} kVA</b></div>
                                        <div className="inspector-row"><span>Limite (SSE):</span><b>{sLimit.toFixed(0)} kVA</b></div>
                                    </>
                                )}

                                {/* 👇 A MÁGICA: Muda o título e valor baseado no tipo de Barra 👇 */}
                                <div className="inspector-row" style={{marginTop:'auto', paddingTop:'10px', borderTop:'1px dashed #444'}}>
                                    <span>{isSource ? 'Carregamento:' : 'Tensão:'}</span>
                                    <b style={{color: isSource ? loadColor : vColor}}>
                                        {isSource ? `${loadingPercent.toFixed(1)}%` : `${puVal} pu`}
                                    </b>
                                </div>
                                <div className="inspector-row"><span>Ângulo:</span><b>{angle.toFixed(2)}°</b></div>
                                
                                {/* BARRA DE PROGRESSO OU DESVIO CENTRALIZADO */}
                                {isSource ? (
                                    <div className="current-bar-container" style={{marginTop:'8px', height:'24px', borderRadius:'12px'}}>
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
                                    <div className="voltage-deviation-container" style={{
                                        marginTop: '10px', height: '28px', background: darkMode ? '#222' : '#f0f0f0',
                                        borderRadius: '6px', position: 'relative', overflow: 'hidden',
                                        border: `1px solid ${darkMode ? '#333' : '#ccc'}`
                                    }}>
                                        {/* Marca 1.00 central */}
                                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: darkMode ? '#555' : '#ccc', zIndex: 2 }} />
                                        
                                        {/* Textos: 0.90 - 1.00 - 1.10 */}
                                        <span style={{ position: 'absolute', left: '4px', top: '2px', fontSize: '9px', color: '#888' }}>0.90</span>
                                        <span style={{ position: 'absolute', left: '50%', top: '2px', fontSize: '9px', color: darkMode ? '#fff' : '#000', transform: 'translateX(-50%)', fontWeight: 'bold', zIndex: 3 }}>1.00</span>
                                        <span style={{ position: 'absolute', right: '4px', top: '2px', fontSize: '9px', color: '#888' }}>1.10</span>
                                        
                                        {/* A "Agulha" indicadora */}
                                        <div style={{
                                            position: 'absolute', top: '12px',
                                            left: `${Math.max(0, Math.min(100, ((v - 0.90) / (1.10 - 0.90)) * 100))}%`,
                                            transform: 'translateX(-50%)', width: '12px', height: '12px',
                                            borderRadius: '50%', background: vColor, border: '2px solid #fff',
                                            zIndex: 4, transition: 'left 0.4s ease, background 0.4s ease',
                                            boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                                        }} />
                                        
                                        {/* Faixa verde ideal (0.95 a 1.05) */}
                                        <div style={{
                                            position: 'absolute', left: '25%', top: '12px', bottom: '2px', width: '50%',
                                            background: 'rgba(76, 175, 80, 0.15)', borderRadius: '3px', zIndex: 1
                                        }} />
                                    </div>
                                )}
                            </>
                        );
                    })()
                    ) : (
                        /* LINHA */
                        (() => {
                            const liveBranch = branches.find(b => b.id === selectedElement.data.id) || selectedElement.data;
                            const currentInfo = lineCurrents[liveBranch.id];
                            
                            // 👇 TRAVA DE SEGURANÇA: Se não achar o limite no arquivo, assume 1000 A 👇
                            const iMaxLimit = (liveBranch && liveBranch.Imax && liveBranch.Imax > 0) 
                                ? liveBranch.Imax 
                                : (liveBranch.limit ? liveBranch.limit : (liveBranch.capacity ? liveBranch.capacity : 1000));

                            if(!currentInfo) return null;
                            
                            const barColor = getLoadColor(currentInfo.percentage);

                            return (
                                <>
                                    <div className="inspector-title">Linha {liveBranch.from}-{liveBranch.to}</div>
                                    <div className="inspector-row"><span>Status:</span><b>{liveBranch.state === 1 ? 'FECHADO' : 'ABERTO'}</b></div>
                                    
                                    <div className="inspector-row"><span>Resistência (R):</span><b>{liveBranch.r} Ω</b></div>
                                    <div className="inspector-row"><span>Reatância (X):</span><b>{liveBranch.x} Ω</b></div>
                                    <div className="inspector-row"><span>Limite (Imax):</span><b>{iMaxLimit} A</b></div>
                                    
                                    {liveBranch.state === 1 && (
                                        <>
                                            <div className="inspector-row"><span>Perdas (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>
                                            <div className="inspector-row"><span>Corrente:</span><b>{currentInfo.current.toFixed(1)} A</b></div>

                                            <div className="current-bar-container" style={{marginTop:'auto', height:'24px', borderRadius:'12px'}}>
                                                <div className="current-bar" 
                                                     style={{
                                                        width: `${Math.min(currentInfo.percentage, 100)}%`,
                                                        background: barColor,
                                                        transition: 'background 0.3s, width 0.3s',
                                                        fontSize: '12px'
                                                     }}>
                                                    {currentInfo.percentage.toFixed(1)}%
                                                </div>
                                            </div>
                                            <div className="current-info" style={{justifyContent: 'center', color: currentInfo.percentage > 90 ? barColor : 'inherit'}}>
                                                {currentInfo.percentage >= 100 ? '⚠️ SOBRECARGA' : 
                                                 currentInfo.percentage > 80 ? 'Carga Alta' : 'Normal'}
                                            </div>
                                        </>
                                    )}
                                </>
                            );
                        })()
                    )
                ) : (
                    <div className="inspector-empty" style={{margin:'auto'}}>
                        Passe o mouse sobre um elemento
                    </div>
                )}
             </div>

             {/* ================= LISTA DE FALTAS ================= */}
             <div style={{padding:'15px', borderBottom:'1px solid var(--border-color)', flexShrink:0, background: 'var(--bg-color)'}}>
                <h2 style={{fontSize:'16px', margin:0}}>Gerenciador de Faltas</h2>
             </div>
             
             <div className="fault-list">
                <div style={{fontSize:'12px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'10px'}}>SUBESTAÇÕES</div>
                {sources.map(id => (
                    <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                         onClick={() => setSelectedElement({ type: 'node', id: id })}
                         onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                         onMouseLeave={() => { setHoveredNodeId(null); }}>
                        <span>SUB {id}</span>
                        <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                style={{
                                    background: faultNodes.has(id) ? '' : getNodeColor(id), 
                                    color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white',
                                    minWidth: '110px'
                                }} 
                                onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                            {getStatusText(id)}
                        </button>
                    </div>
                ))}
                
                <div style={{fontSize:'12px', fontWeight:'bold', color:'var(--eng-gray)', margin:'20px 0 10px 0'}}>BARRAS DE CARGA</div>
                {loadNodes.map(id => (
                    <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                         onClick={() => setSelectedElement({ type: 'node', id: id })}
                         onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                         onMouseLeave={() => { setHoveredNodeId(null); }}>
                        <span>Barra {id}</span>
                        <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                style={{
                                    background: faultNodes.has(id) ? '' : getNodeColor(id), 
                                    color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white',
                                    minWidth: '110px'
                                }} 
                                onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                            {getStatusText(id)}
                        </button>
                    </div>
                ))}
             </div>
        </div>
    );
}