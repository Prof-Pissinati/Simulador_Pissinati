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
    sses,
    feedersList = [] // 👈 ADICIONADO AQUI
}) {
    //if (!isHoveringSVG) return null;

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

                // 👇 LÓGICA DE IDENTIFICAÇÃO ATUALIZADA 👇
                const isMainSource = sources.includes(localHoveredNode);
                const isFeeder = feedersList.includes(localHoveredNode);
                const isSource = isMainSource || isFeeder;
                const hoveredLoad = systemLoads && systemLoads[localHoveredNode];

                // Variáveis
                let sLimit = 1000, sApparent = 0, loadingPercent = 0;
                let totalP = 0, totalQ = 0;

                if (isSource) {
                    if (lineCurrents) {
                        if (isMainSource) {
                            // GERAÇÃO: Saldo líquido
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
                            totalP = Math.abs(totalP);
                            totalQ = Math.abs(totalQ);
                        } else if (isFeeder) {
                            // ALIMENTADOR: Soma do módulo dividida por 2
                            let sumP = 0, sumQ = 0;
                            branches.forEach(b => {
                                if (b.state === 1 && lineCurrents[b.id]) {
                                    if (b.from === localHoveredNode || b.to === localHoveredNode) {
                                        sumP += Math.abs(lineCurrents[b.id].pFlow);
                                        sumQ += Math.abs(lineCurrents[b.id].qFlow);
                                    }
                                }
                            });
                            totalP = sumP / 2;
                            totalQ = sumQ / 2;
                        }
                    }

                    sLimit = sses && sses[localHoveredNode] ? sses[localHoveredNode] : 1000;
                    sApparent = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                    loadingPercent = (sApparent / sLimit) * 100;
                }

                const h = isSource ? 105 : (hoveredLoad ? 105 : 65);
                const vPu = hoveredNodeInfo.v ? hoveredNodeInfo.v.toFixed(3) : '1.000';
                const angle = hoveredNodeInfo.angle ? hoveredNodeInfo.angle.toFixed(2) : '0.00';
                
                const vColor = (hoveredNodeInfo.v < 0.95 || hoveredNodeInfo.v > 1.05) ? '#ff5252' : '#fff';
                const loadColor = loadingPercent > 100 ? '#ff0000' : (loadingPercent > 80 ? '#ff9800' : '#4caf50');

                return (
                    <g transform={`translate(${pos.x + 25}, ${pos.y + 25})`} pointerEvents="none" className="svg-tooltip">
                        <rect x="0" y="0" width="160" height={h} rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                        
                        {/* Título dinâmico: SUB, ALIM ou BARRA */}
                        <text x="12" y="20" fill={isMainSource ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800')} fontSize="12" fontWeight="bold" fontFamily="monospace">
                            {isMainSource ? `Subestação ${localHoveredNode}` : (isFeeder ? `Alim. ${localHoveredNode}` : `Barra ${localHoveredNode}`)}
                        </text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                        
                        {!isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Tensão:</text>
                                <text x="148" y="44" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{vPu} pu</text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Ângulo:</text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{angle}°</text>
                            </>
                        )}

                        {isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demanda P:' : 'Geração P:'}</text>
                                <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{totalP.toFixed(1)} kW</text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demanda Q:' : 'Geração Q:'}</text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{totalQ.toFixed(1)} kVAr</text>

                                <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demanda S:' : 'Geração S:'}</text>
                                <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{sApparent.toFixed(1)} kVA</text>
                                
                                <rect x="12" y="82" width="136" height="12" rx="3" fill="#333" />
                                <rect x="12" y="82" width={Math.min(136, (loadingPercent / 100) * 136)} height="12" rx="3" fill={loadColor} style={{transition: 'width 0.3s ease'}} />
                                <text x="80" y="91" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{loadingPercent.toFixed(1)}%</text>
                            </>
                        )}

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