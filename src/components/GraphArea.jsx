import React, { useRef, useState, useEffect } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

// ==============================================================
// 🚀 MOTOR DE ANIMAÇÃO 60 FPS
// ==============================================================
function useAnimatedLayout(targetPositions, duration = 800) {
    const [positions, setPositions] = useState(targetPositions);

    useEffect(() => {
        let startTime = null;
        let animationFrameId;
        const startPositions = { ...positions };

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            let progress = (timestamp - startTime) / duration;
            if (progress > 1) progress = 1;

            const ease = progress < 0.5 
                ? 4 * progress * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const currentPositions = {};
            for (let key in targetPositions) {
                const startP = startPositions[key] || targetPositions[key];
                const endP = targetPositions[key];
                currentPositions[key] = {
                    x: startP.x + (endP.x - startP.x) * ease,
                    y: startP.y + (endP.y - startP.y) * ease,
                };
            }
            setPositions(currentPositions);

            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animate);
            }
        };

        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    }, [targetPositions]);

    return positions;
}
// ==============================================================


export default function GraphArea({
    branches = [],
    allNodes = [],
    sources = [],
    showLabels,
    getEdgeColor,
    getNodeColor,
    toggleSwitch,
    toggleFault,
    setSelectedElement,
    selectedElement,
    hoveredLineId,
    setHoveredLineId,
    hoveredNodeId,
    setHoveredNodeId,
    maintenanceMode,
    isMobile,
    activePositions,
    // NOVOS PROPS PARA O TOOLTIP:
    lineCurrents = {},
    nodeData = {}
}) {
    const svgRef = useRef(null);
    const [transform, setTransform] = useState({ x: -50, y: 0, scale: 1 });
    
    // Estado para rastrear o mouse na tela (para o Tooltip flutuar junto)
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const animPositions = useAnimatedLayout(activePositions, 800); 

    const isPanning = useRef(false);
    const hasMoved = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });

    const colorTransition = 'fill 0.5s ease, stroke 0.5s ease, opacity 0.5s ease, filter 0.5s ease';

    const handleWheel = (e) => {
        e.preventDefault();
        const d = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform(p => ({ ...p, scale: Math.max(0.1, Math.min(4, p.scale * d)) }));
    };

    const handleMouseDown = (e) => {
        if (e.target.tagName === 'svg') {
            isPanning.current = true;
            hasMoved.current = false;
            dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
        }
    };

    const handleMouseMove = (e) => {
        // Atualiza a posição do mouse para o Tooltip usar
        setMousePos({ x: e.clientX, y: e.clientY });

        if (isPanning.current) {
            hasMoved.current = true;
            setTransform(p => ({ ...p, x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }));
        }
    };

    const handleMouseUp = (e) => {
        isPanning.current = false;
        if (e.target.tagName === 'svg' && !hasMoved.current) {
            setSelectedElement(null);
        }
        hasMoved.current = false;
    };

    // Pega as informações da linha que está com hover no momento
    const hoveredBranch = hoveredLineId !== null ? branches.find(b => b.id === hoveredLineId) : null;
    const hoveredLineData = hoveredLineId !== null ? lineCurrents[hoveredLineId] : null;

    // Pega as informações da BARRRA que está com hover no momento
    const hoveredNode = hoveredNodeId !== null ? hoveredNodeId : null;
    const hoveredNodeInfo = hoveredNode !== null && nodeData[hoveredNode] ? nodeData[hoveredNode] : null;
    const isHoveredSource = hoveredNode !== null ? sources.includes(hoveredNode) : false;
    const hoveredLoad = hoveredNode !== null ? SYSTEM_DATA.loads[hoveredNode] : null;

    return (
        <div className="graph-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
            <svg id="sistema-eletrico-svg" className="graph-svg" viewBox="0 0 900 650" ref={svgRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp} 
                onMouseLeave={() => { isPanning.current = false; setHoveredLineId(null); setHoveredNodeId(null); }}
            >
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                    
                    {/* --- DESENHO DAS LINHAS (CABOS) --- */}
                    {branches.map(b => {
                        const p1 = animPositions[b.from];
                        const p2 = animPositions[b.to];
                        if (!p1 || !p2) return null;
                        
                        const color = getEdgeColor(b);
                        const isHovered = hoveredLineId === b.id;
                        const isSelected = selectedElement && selectedElement.type === 'edge' && selectedElement.data.id === b.id;
                        const isHighlighted = isHovered || isSelected;

                        const strokeColor = color; 
                        let strokeWidth = isHighlighted ? 6 : 2; 
                        if (!isHighlighted && b.state === 1) strokeWidth = 3;

                        const shadowFilter = isHighlighted 
                            ? `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 15px ${color})` 
                            : 'none';

                        return (
                            <g key={b.id}>
                                <line 
                                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} 
                                    stroke="transparent" strokeWidth="20" 
                                    style={{ cursor: 'pointer' }} 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (isMobile) { setSelectedElement({ type: 'edge', data: b }); } 
                                        else { if (b.hasSwitch || maintenanceMode) toggleSwitch(b.id); }
                                    }} 
                                    onMouseEnter={() => { if(!isMobile) { setSelectedElement({ type: 'edge', data: b }); setHoveredLineId(b.id); } }} 
                                    onMouseLeave={() => { if(!isMobile) setHoveredLineId(null); }}
                                />
                                <line 
                                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} 
                                    stroke={strokeColor} strokeWidth={strokeWidth} 
                                    strokeDasharray={b.state === 1 ? 'none' : '5,5'} 
                                    pointerEvents="none" className="edge-line"
                                    style={{ transition: colorTransition, filter: shadowFilter, opacity: b.state === 1 ? 1 : 0.4 }} 
                                />
                            </g>
                        );
                    })}

                    {/* --- DESENHO DOS NÓS (BARRAS) --- */}
                    {allNodes.map(nodeId => {
                        const pos = animPositions[nodeId];
                        if (!pos) return null;
                        
                        const isSource = sources.includes(nodeId);
                        const color = getNodeColor(nodeId);
                        const isHovered = hoveredNodeId === nodeId;
                        const isSelected = selectedElement && selectedElement.type === 'node' && selectedElement.id === nodeId;
                        const isHighlighted = isHovered || isSelected;

                        const strokeColor = isHighlighted ? '#ffffff33' : '#333';
                        const strokeWidth = isHighlighted ? 3 : 2;
                        
                        const shadowFilter = isHighlighted 
                            ? `drop-shadow(0 0 10px ${color})` 
                            : 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))';

                        return (
                            <g key={nodeId} 
                               style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: 'pointer' }}
                               onClick={(e) => { e.stopPropagation(); toggleFault(nodeId); }} 
                               onMouseEnter={() => { if(!isMobile) { setSelectedElement({ type: 'node', id: nodeId }); setHoveredNodeId(nodeId); } }}
                               onMouseLeave={() => { if(!isMobile) setHoveredNodeId(null); }}
                            >
                                {isSource ? (
                                    <circle cx="0" cy="0" r={isHighlighted ? 26 : 22} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
                                ) : (
                                    <g>
                                        <rect x="-20" y="-12" width="40" height="24" fill="transparent" />
                                        <rect x="-14" y="-8" width="28" height="16" rx="2" fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
                                    </g>
                                )}
                                <text x="0" y="0" textAnchor="middle" dominantBaseline="central" fill="white" fontSize={isSource ? "14px" : "10px"} fontWeight="bold" pointerEvents="none" className="node-label" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                    {nodeId}
                                </text>
                                {showLabels && !isSource && SYSTEM_DATA.loads[nodeId] && (
                                    <text x="0" y="22" textAnchor="middle" fill="gray" fontSize="9px" pointerEvents="none">
                                        {(SYSTEM_DATA.loads[nodeId].p / 1000).toFixed(1)} MW
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* ==============================================================
                🚀 TOOLTIPS FLUTUANTES (Balões informacionais no Mouse)
            ============================================================== */}
            {!isMobile && !isPanning.current && (
                <>
                    {/* TOOLTIP PARA LINHAS (Com Direção Inteligente) */}
                    {hoveredBranch && hoveredLineData && hoveredBranch.state === 1 && (
                        (() => {
                            const pMW = hoveredLineData.pFlow / 1000;
                            const qMVAr = hoveredLineData.qFlow / 1000;
                            
                            // Se P for negativo, o fluxo real está indo do 'to' para o 'from'
                            const isReverseFlow = pMW < 0;
                            const flowFrom = isReverseFlow ? hoveredBranch.to : hoveredBranch.from;
                            const flowTo = isReverseFlow ? hoveredBranch.from : hoveredBranch.to;
                            
                            // Coloca P em módulo e inverte Q para acompanhar o novo referencial
                            const displayP = Math.abs(pMW);
                            const displayQ = isReverseFlow ? -qMVAr : qMVAr;

                            return (
                                <div style={{
                                    position: 'fixed', left: mousePos.x + 15, top: mousePos.y + 15,
                                    background: 'rgba(20, 20, 20, 0.95)', backdropFilter: 'blur(4px)',
                                    color: '#fff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #444',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none', zIndex: 9999,
                                    fontSize: '12px', fontFamily: 'monospace', minWidth: '150px'
                                }}>
                                    <div style={{ fontWeight: 'bold', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '6px', color: '#00bcd4' }}>
                                        Fluxo: {flowFrom} ➔ {flowTo}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{ color: '#aaa' }}>P (Ativa):</span>
                                        <strong>{displayP.toFixed(2)} MW</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{ color: '#aaa' }}>Q (Reativa):</span>
                                        <strong>{displayQ.toFixed(2)} MVAr</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ color: '#aaa' }}>Corrente:</span>
                                        <strong>{hoveredLineData.current.toFixed(1)} A</strong>
                                    </div>
                                    
                                    <div style={{ width: '100%', height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden', marginTop: '6px' }}>
                                        <div style={{ 
                                            height: '100%', width: `${Math.min(hoveredLineData.percentage, 100)}%`, 
                                            background: hoveredLineData.percentage >= 100 ? '#d32f2f' : (hoveredLineData.percentage > 80 ? '#fbc02d' : '#4caf50')
                                        }}></div>
                                    </div>
                                    <div style={{ textAlign: 'right', fontSize: '10px', marginTop: '2px', color: hoveredLineData.percentage >= 100 ? '#ff5252' : '#888' }}>
                                        {hoveredLineData.percentage.toFixed(1)}% {hoveredLineData.percentage >= 100 ? '(SOBRECARGA)' : ''}
                                    </div>
                                </div>
                            );
                        })()
                    )}

                    {/* TOOLTIP PARA BARRAS */}
                    {hoveredNode && hoveredNodeInfo && !hoveredBranch && (
                        <div style={{
                            position: 'fixed', left: mousePos.x + 15, top: mousePos.y + 15,
                            background: 'rgba(20, 20, 20, 0.95)', backdropFilter: 'blur(4px)',
                            color: '#fff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #444',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none', zIndex: 9999,
                            fontSize: '12px', fontFamily: 'monospace', minWidth: '150px'
                        }}>
                            <div style={{ fontWeight: 'bold', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '6px', color: isHoveredSource ? '#4caf50' : '#ff9800' }}>
                                {isHoveredSource ? `Subestação ${hoveredNode}` : `Barra ${hoveredNode}`}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{ color: '#aaa' }}>Tensão:</span>
                                <strong style={{ color: hoveredNodeInfo.v < 0.93 ? '#ff5252' : (hoveredNodeInfo.v < 0.95 ? '#fbc02d' : '#fff') }}>
                                    {hoveredNodeInfo.v.toFixed(3)} pu
                                </strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ color: '#aaa' }}>Ângulo:</span>
                                <strong>{hoveredNodeInfo.angle.toFixed(2)}°</strong>
                            </div>
                            
                            {!isHoveredSource && hoveredLoad && (
                                <>
                                    <div style={{ borderTop: '1px dashed #555', margin: '6px 0' }}></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{ color: '#aaa' }}>Carga P:</span>
                                        <strong>{hoveredLoad.p.toFixed(0)} kW</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: '#aaa' }}>Carga Q:</span>
                                        <strong>{hoveredLoad.q.toFixed(0)} kVAr</strong>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
            
        </div>
    );
}