// src/components/SvgTooltips.jsx
import React from 'react';

export default function SvgTooltips({
    isHoveringSVG,
    localHoveredLine,
    hoveredBranch,
    hoveredLineData,
    localHoveredNode,
    hoveredNodeInfo,
    manualPositions,
    animPositions,
    sources,
    branches,
    lineCurrents,
    loads,
    systemLoads
}) {
    if (!isHoveringSVG) return null;

    return (
        <>
            {/* 1. TOOLTIP DAS LINHAS (CABEAMENTO E FLUXO) */}
            {localHoveredLine !== null && hoveredLineData && hoveredBranch && hoveredBranch.state === 1 && (() => {
                const p1 = manualPositions[hoveredBranch.from] || animPositions[hoveredBranch.from];
                const p2 = manualPositions[hoveredBranch.to] || animPositions[hoveredBranch.to];
                if (!p1 || !p2) return null;
                
                const midX = (p1.x + p2.x) / 2; 
                const midY = (p1.y + p2.y) / 2;
                const pMW = hoveredLineData.pFlow / 1000; 
                const qMVAr = hoveredLineData.qFlow / 1000;
                const isReverseFlow = pMW < 0; 
                const flowFrom = isReverseFlow ? hoveredBranch.to : hoveredBranch.from;
                const flowTo = isReverseFlow ? hoveredBranch.from : hoveredBranch.to;
                const displayP = Math.abs(pMW); 
                const displayQ = isReverseFlow ? -qMVAr : qMVAr;
                const barWidth = 130; 
                const safePercentage = isNaN(hoveredLineData.percentage) ? 0 : Math.max(0, hoveredLineData.percentage);
                const fillWidth = barWidth * Math.min(safePercentage, 100) / 100;
                const fillColor = hoveredLineData.percentage >= 100 ? '#d32f2f' : (hoveredLineData.percentage > 80 ? '#fbc02d' : '#4caf50');
                
                return (
                    <g transform={`translate(${midX + 15}, ${midY + 15})`} pointerEvents="none" className="svg-tooltip">
                        <rect x="0" y="0" width="160" height="95" rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                        <text x="12" y="20" fill="#00bcd4" fontSize="12" fontWeight="bold" fontFamily="monospace">Fluxo: {flowFrom} ➔ {flowTo}</text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                        <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Ativa):</text>
                        <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayP.toFixed(2)} MW</text>
                        <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reativa):</text>
                        <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayQ.toFixed(2)} MVAr</text>
                        <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">Corrente:</text>
                        <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLineData.current.toFixed(1)} A</text>
                        <rect x="15" y="82" width={barWidth} height="4" rx="2" fill="#333" />
                        <rect x="15" y="82" width={fillWidth} height="4" rx="2" fill={fillColor} />
                    </g>
                );
            })()}

            {/* 2. TOOLTIP DOS NÓS (BARRAS E CARGAS) */}
            {localHoveredNode !== null && hoveredNodeInfo && localHoveredLine === null && (() => {
                const pos = manualPositions[localHoveredNode] || animPositions[localHoveredNode];
                if (!pos) return null;
                
                const isSource = sources.includes(localHoveredNode);
                const hoveredLoad = systemLoads ? systemLoads[localHoveredNode] : null; 
                const h = isSource ? 75 : 115;

                let content = null;

                if (isSource) {
                    let totalP = 0, totalQ = 0;
                    branches.forEach(b => {
                        if (b.state === 1 && lineCurrents[b.id]) {
                            if (b.from === localHoveredNode) {
                                totalP += lineCurrents[b.id].pFlow;
                                totalQ += lineCurrents[b.id].qFlow;
                            } else if (b.to === localHoveredNode) {
                                totalP -= lineCurrents[b.id].pFlow;
                                totalQ -= lineCurrents[b.id].qFlow;
                            }
                        }
                    });

                    content = (
                        <>
                            <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Total P:</text>
                            <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{Math.abs(totalP).toFixed(1)} kW</text>
                            
                            <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Total Q:</text>
                            <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{Math.abs(totalQ).toFixed(1)} kVAr</text>
                        </>
                    );
                } else {
                    content = (
                        <>
                            <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Tensão:</text>
                            <text x="148" y="44" fill={hoveredNodeInfo.v < 0.93 ? '#ff5252' : (hoveredNodeInfo.v < 0.95 ? '#fbc02d' : '#fff')} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{(hoveredNodeInfo.v || 0).toFixed(3)} pu</text>
                            <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Ângulo:</text>
                            <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{(hoveredNodeInfo.angle || 0).toFixed(2)}°</text>
                            {hoveredLoad && (
                                <>
                                    <line x1="10" y1="68" x2="150" y2="68" stroke="#555" strokeWidth="1" strokeDasharray="3,3" />
                                    <text x="12" y="84" fill="#aaa" fontSize="11" fontFamily="monospace">Carga P:</text>
                                    <text x="148" y="84" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.p.toFixed(0)} kW</text>
                                    <text x="12" y="98" fill="#aaa" fontSize="11" fontFamily="monospace">Carga Q:</text>
                                    <text x="148" y="98" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.q.toFixed(0)} kVAr</text>
                                </>
                            )}
                        </>
                    );
                }

                return (
                    <g transform={`translate(${pos.x + 25}, ${pos.y + 25})`} pointerEvents="none" className="svg-tooltip">
                        <rect x="0" y="0" width="160" height={h} rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                        <text x="12" y="20" fill={isSource ? '#4caf50' : '#ff9800'} fontSize="12" fontWeight="bold" fontFamily="monospace">{isSource ? `Subestação ${localHoveredNode}` : `Barra ${localHoveredNode}`}</text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                        {content}
                    </g>
                );
            })()}
        </>
    );
}