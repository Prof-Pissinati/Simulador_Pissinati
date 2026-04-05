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
    branches
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
                            
                            // 👇 NOVA LÓGICA DE GERAÇÃO REAL 👇
                            let totalP = 0, totalQ = 0;
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

                                    {/* MUDANÇA: Agora exibe a geração com as perdas! */}
                                    {isSource && (
                                        <>
                                            <div className="inspector-row"><span>Total P:</span><b>{totalP.toFixed(1)} kW</b></div>
                                            <div className="inspector-row"><span>Total Q:</span><b>{totalQ.toFixed(1)} kVAr</b></div>
                                        </>
                                    )}

                                    <div className="inspector-row" style={{marginTop:'auto', paddingTop:'10px', borderTop:'1px dashed #444'}}>
                                        <span>Tensão:</span><b style={{color: vColor}}>{puVal} pu</b>
                                    </div>
                                    <div className="inspector-row"><span>Ângulo:</span><b>{angle.toFixed(2)}°</b></div>
                                    
                                    <div className="current-bar-container" style={{marginTop:'8px', height:'24px', borderRadius:'12px'}}>
                                        <div className="current-bar" 
                                             style={{
                                                 width: `${Math.min(v * 100, 100)}%`, 
                                                 background: vColor,
                                                 fontSize: '12px'
                                             }}>
                                            {puVal} pu
                                        </div>
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
                                    
                                    {liveBranch.state === 1 && (
                                        <>
                                            <div className="inspector-row"><span>Corrente:</span><b>{currentInfo.current.toFixed(1)} A</b></div>
                                            <div className="inspector-row"><span>Perdas (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>

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
                         onMouseLeave={() => { setHoveredNodeId(null);}}>
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