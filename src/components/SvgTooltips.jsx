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
    systemLoads,
    sses
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
                const fillColor = hoveredLineData.percentage >= 100 ? '#d32f2f' : (hoveredLineData.percentage > 80 ? '#ff9800' : '#4caf50');
                
                return (
                    <g transform={`translate(${midX + 15}, ${midY + 15})`} pointerEvents="none" className="svg-tooltip">
                        <rect x="0" y="0" width="160" height="100" rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                        <text x="12" y="20" fill="#00bcd4" fontSize="12" fontWeight="bold" fontFamily="monospace">Fluxo: {flowFrom} ➔ {flowTo}</text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                        <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Ativa):</text>
                        <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayP.toFixed(2)} MW</text>
                        <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reativa):</text>
                        <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayQ.toFixed(2)} MVAr</text>
                        <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">Corrente:</text>
                        <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLineData.current.toFixed(1)} A</text>
                        <rect x="15" y="78" width={barWidth} height="12" rx="3" fill="#333" />
                        <rect x="15" y="78" width={fillWidth} height="12" rx="3" fill={fillColor} />
                        <text x={15 + barWidth / 2} y="88" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{isNaN(hoveredLineData.percentage) ? 'N/A' : `${hoveredLineData.percentage.toFixed(1)}%`}</text>
                    </g>
                );
            })()}

            {/* 2. TOOLTIP DOS NÓS/BARRAS */}
            {localHoveredNode !== null && hoveredNodeInfo && (() => {
                const pos = manualPositions[localHoveredNode] || animPositions[localHoveredNode];
                if (!pos) return null;

                const isSource = sources.includes(localHoveredNode);
                const hoveredLoad = systemLoads && systemLoads[localHoveredNode];

                // Variáveis para a Subestação
                let sLimit = 1000, sApparent = 0, loadingPercent = 0;
                let totalP = 0, totalQ = 0;

                if (isSource) {
                    // Calcula a geração real somando o fluxo das linhas (P e Q)
                    if (lineCurrents) {
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
                    }
                    totalP = Math.abs(totalP);
                    totalQ = Math.abs(totalQ);

                    // Puxa o limite real em kVA (SSE)
                    sLimit = sses && sses[localHoveredNode] ? sses[localHoveredNode] : 1000;
                    sApparent = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                    loadingPercent = (sApparent / sLimit) * 100;
                }

                // Ajusta a altura da caixinha: maior para Fonte, média para Carga, pequena para Nó Simples
                const h = isSource ? 105 : (hoveredLoad ? 105 : 65);
                const vPu = hoveredNodeInfo.v ? hoveredNodeInfo.v.toFixed(3) : '1.000';
                const angle = hoveredNodeInfo.angle ? hoveredNodeInfo.angle.toFixed(2) : '0.00';
                
                // Cores dinâmicas de alerta
                const vColor = (hoveredNodeInfo.v < 0.95 || hoveredNodeInfo.v > 1.05) ? '#ff5252' : '#fff';
                const loadColor = loadingPercent > 100 ? '#ff0000' : (loadingPercent > 80 ? '#ff9800' : '#4caf50');

                return (
                    <g transform={`translate(${pos.x + 25}, ${pos.y + 25})`} pointerEvents="none" className="svg-tooltip">
                        <rect x="0" y="0" width="160" height={h} rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                        <text x="12" y="20" fill="#00bcd4" fontSize="12" fontWeight="bold" fontFamily="monospace">{isSource ? `Subestação ${localHoveredNode}` : `Barra ${localHoveredNode}`}</text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                        
                        {/* SE NÃO FOR FONTE, MOSTRA TENSÃO E ÂNGULO CLÁSSICOS */}
                        {!isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Tensão:</text>
                                <text x="148" y="44" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{vPu} pu</text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Ângulo:</text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{angle}°</text>
                            </>
                        )}

                        {/* --- EXIBIÇÃO EXCLUSIVA PARA SUBESTAÇÕES (O QUE VOCÊ PEDIU) --- */}
                        {isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Total P:</text>
                                <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{totalP.toFixed(1)} kW</text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Total Q:</text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{totalQ.toFixed(1)} kVAr</text>

                                <text x="12" y="72 " fill="#aaa" fontSize="11" fontFamily="monospace">Total S:</text>
                                <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{sApparent.toFixed(1)} kVA</text>
                                
                                {/* Barra de progresso SVG */}
                                <rect x="12" y="82" width="136" height="12" rx="3" fill="#333" />
                                <rect x="12" y="82" width={Math.min(136, (loadingPercent / 100) * 136)} height="12" rx="3" fill={loadColor} style={{transition: 'width 0.3s ease'}} />
                                <text x="80" y="91" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{loadingPercent.toFixed(1)}%</text>
                            </>
                        )}

                        {/* --- EXIBIÇÃO EXCLUSIVA PARA BARRAS COM CARGA --- */}
                        {!isSource && hoveredLoad && (
                            <>
                                <line x1="10" y1="66" x2="150" y2="66" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                                <text x="12" y="80" fill="#aaa" fontSize="11" fontFamily="monospace">Carga P:</text>
                                <text x="148" y="80" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.p.toFixed(0)} kW</text>
                                <text x="12" y="94" fill="#aaa" fontSize="11" fontFamily="monospace">Carga Q:</text>
                                <text x="148" y="94" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.q.toFixed(0)} kVAr</text>
                            </>
                        )}
                    </g>
                );
            })()}
        </>
    );
}