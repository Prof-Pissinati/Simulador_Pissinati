import React from 'react';

/**
 * SvgTooltips — Tooltips renderizados dentro do SVG (coordenadas de mundo).
 *
 * Posicionamento inteligente: o tooltip é deslocado para a esquerda e/ou
 * para cima quando estiver próximo da borda direita ou inferior do viewport,
 * evitando corte visual.
 *
 * Props:
 *   svgWorldBounds  {left, right, top, bottom}  Bounds visíveis em coords SVG.
 *                   Passado por GraphArea para cálculo do posicionamento.
 */

const TOOLTIP_W = 160;
const TOOLTIP_H_LINE = 105;
const TOOLTIP_H_NODE_SM = 70;
const TOOLTIP_H_NODE_LG = 110;

/**
 * Decide o offset (dx, dy) do tooltip a partir do ponto âncora,
 * garantindo que não ultrapasse os limites visíveis.
 */
function smartOffset(anchorX, anchorY, tooltipW, tooltipH, bounds) {
    if (!bounds) return { dx: 20, dy: 20 };
    const dx = (anchorX + 20 + tooltipW > bounds.right)  ? -(tooltipW + 20) : 20;
    const dy = (anchorY + 20 + tooltipH > bounds.bottom) ? -(tooltipH + 20) : 20;
    return { dx, dy };
}

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
    feedersList = [],
    svgWorldBounds,   // { left, right, top, bottom } em coords de mundo SVG
}) {
    return (
        <>
            {/* ════════════════════════════════════════════════
                1. TOOLTIP DE LINHA (fluxo e carregamento)
                ════════════════════════════════════════════════ */}
            {localHoveredLine !== null && hoveredLineData && hoveredBranch && hoveredBranch.state === 1 && (() => {
                const p1 = manualPositions[hoveredBranch.from] || animPositions[hoveredBranch.from];
                const p2 = manualPositions[hoveredBranch.to]   || animPositions[hoveredBranch.to];
                if (!p1 || !p2) return null;

                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;

                const pMW         = hoveredLineData.pFlow / 1000;
                const qMVAr       = hoveredLineData.qFlow / 1000;
                const isReverse   = pMW < 0;
                const flowFrom    = isReverse ? hoveredBranch.to   : hoveredBranch.from;
                const flowTo      = isReverse ? hoveredBranch.from : hoveredBranch.to;
                const displayP    = Math.abs(pMW);
                const displayQ    = isReverse ? -qMVAr : qMVAr;

                const safePercent = isNaN(hoveredLineData.percentage) ? 0 : Math.max(0, hoveredLineData.percentage);
                const barWidth    = 130;
                const fillWidth   = barWidth * Math.min(safePercent, 100) / 100;
                const fillColor   = safePercent >= 100 ? '#d32f2f' : (safePercent > 80 ? '#ff9800' : '#4caf50');

                const { dx, dy } = smartOffset(midX, midY, TOOLTIP_W, TOOLTIP_H_LINE, svgWorldBounds);

                return (
                    <g
                        transform={`translate(${midX + dx}, ${midY + dy})`}
                        pointerEvents="none"
                        className="svg-tooltip"
                    >
                        <rect x="0" y="0" width={TOOLTIP_W} height={TOOLTIP_H_LINE}
                            rx="6" fill="rgba(18,18,18,0.96)" stroke="#444" strokeWidth="1" />

                        {/* Título: direção do fluxo */}
                        <text x="12" y="20" fill="#00bcd4" fontSize="12" fontWeight="bold" fontFamily="monospace">
                            {flowFrom} ➔ {flowTo}
                        </text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                        {/* Potência ativa */}
                        <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Ativa):</text>
                        <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                            {displayP.toFixed(2)} MW
                        </text>

                        {/* Potência reativa */}
                        <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reativa):</text>
                        <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                            {displayQ.toFixed(2)} MVAr
                        </text>

                        {/* Corrente */}
                        <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">Corrente:</text>
                        <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                            {hoveredLineData.current.toFixed(1)} A
                        </text>

                        {/* Barra de carregamento */}
                        <rect x="15" y="80" width={barWidth} height="14" rx="3" fill="#2a2a2a" />
                        <rect x="15" y="80" width={fillWidth}  height="14" rx="3" fill={fillColor} />
                        <text x={15 + barWidth / 2} y="91" fill="#fff" fontSize="11" fontWeight="bold"
                            fontFamily="monospace" textAnchor="middle">
                            {isNaN(safePercent) ? 'N/A' : `${safePercent.toFixed(1)}%`}
                        </text>
                    </g>
                );
            })()}

            {/* ════════════════════════════════════════════════
                2. TOOLTIP DE NÓ (tensão, carga, geração)
                ════════════════════════════════════════════════ */}
            {localHoveredNode !== null && hoveredNodeInfo && (() => {
                const pos = manualPositions[localHoveredNode] || animPositions[localHoveredNode];
                if (!pos) return null;

                const isMainSource = sources.includes(localHoveredNode);
                const isFeeder     = feedersList.includes(localHoveredNode);
                const isSource     = isMainSource || isFeeder;
                const hoveredLoad  = systemLoads && systemLoads[localHoveredNode];

                let totalP = 0, totalQ = 0, sApparent = 0, loadingPercent = 0;
                let sLimit = 1000;

                if (isSource && lineCurrents) {
                    if (isMainSource) {
                        // SE principal: saldo líquido de potência
                        branches.forEach(b => {
                            if (b.state === 1 && lineCurrents[b.id]) {
                                if      (b.from === localHoveredNode) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; }
                                else if (b.to   === localHoveredNode) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
                            }
                        });
                        totalP = Math.abs(totalP);
                        totalQ = Math.abs(totalQ);
                    } else {
                        // Alimentador: média da soma dos módulos
                        let sumP = 0, sumQ = 0;
                        branches.forEach(b => {
                            if (b.state === 1 && lineCurrents[b.id] &&
                                (b.from === localHoveredNode || b.to === localHoveredNode)) {
                                sumP += Math.abs(lineCurrents[b.id].pFlow);
                                sumQ += Math.abs(lineCurrents[b.id].qFlow);
                            }
                        });
                        totalP = sumP / 2;
                        totalQ = sumQ / 2;
                    }

                    sLimit         = sses?.[localHoveredNode] ?? 1000;
                    sApparent      = Math.sqrt(totalP ** 2 + totalQ ** 2);
                    loadingPercent = (sApparent / sLimit) * 100;
                }

                const tooltipH = isSource
                    ? TOOLTIP_H_NODE_LG
                    : (hoveredLoad ? TOOLTIP_H_NODE_LG : TOOLTIP_H_NODE_SM);

                const { dx, dy } = smartOffset(pos.x, pos.y, TOOLTIP_W, tooltipH, svgWorldBounds);

                const vPu      = hoveredNodeInfo.v     ? hoveredNodeInfo.v.toFixed(3)     : '1.000';
                const angle    = hoveredNodeInfo.angle ? hoveredNodeInfo.angle.toFixed(2)  : '0.00';
                const vColor   = (hoveredNodeInfo.v < 0.95 || hoveredNodeInfo.v > 1.05) ? '#ff5252' : '#fff';
                const loadColor = loadingPercent > 100 ? '#ff0000' : (loadingPercent > 80 ? '#ff9800' : '#4caf50');

                // Cor do título por tipo
                const titleColor = isMainSource ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800');
                const titleLabel = isMainSource ? `Subestação ${localHoveredNode}`
                                 : isFeeder     ? `Alim. ${localHoveredNode}`
                                 :                `Barra ${localHoveredNode}`;

                return (
                    <g
                        transform={`translate(${pos.x + dx}, ${pos.y + dy})`}
                        pointerEvents="none"
                        className="svg-tooltip"
                    >
                        <rect x="0" y="0" width={TOOLTIP_W} height={tooltipH}
                            rx="6" fill="rgba(18,18,18,0.96)" stroke="#444" strokeWidth="1" />

                        {/* Título */}
                        <text x="12" y="20" fill={titleColor} fontSize="12" fontWeight="bold" fontFamily="monospace">
                            {titleLabel}
                        </text>
                        <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                        {/* Dados de tensão (barras de carga) */}
                        {!isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Tensão:</text>
                                <text x="148" y="44" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {vPu} pu
                                </text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Ângulo:</text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {angle}°
                                </text>
                            </>
                        )}

                        {/* Dados de geração / demanda (SE e alimentadores) */}
                        {isSource && (
                            <>
                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">
                                    {isFeeder ? 'Demanda P:' : 'Geração P:'}
                                </text>
                                <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {totalP.toFixed(1)} kW
                                </text>
                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">
                                    {isFeeder ? 'Demanda Q:' : 'Geração Q:'}
                                </text>
                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {totalQ.toFixed(1)} kVAr
                                </text>
                                <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">
                                    {isFeeder ? 'Demanda S:' : 'Geração S:'}
                                </text>
                                <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {sApparent.toFixed(1)} kVA
                                </text>
                                {/* Barra de carregamento da SE */}
                                <rect x="12" y="82" width="136" height="14" rx="3" fill="#2a2a2a" />
                                <rect x="12" y="82" width={Math.min(136, (loadingPercent / 100) * 136)} height="14" rx="3"
                                    fill={loadColor} style={{ transition: 'width 0.3s ease' }} />
                                <text x="80" y="93" fill="#fff" fontSize="11" fontWeight="bold"
                                    fontFamily="monospace" textAnchor="middle">
                                    {loadingPercent.toFixed(1)}%
                                </text>
                            </>
                        )}

                        {/* Carga instalada na barra (quando disponível) */}
                        {!isSource && hoveredLoad && (
                            <>
                                <line x1="10" y1="66" x2="150" y2="66" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                                <text x="12" y="80" fill="#aaa" fontSize="11" fontFamily="monospace">Carga P:</text>
                                <text x="148" y="80" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {hoveredLoad.p.toFixed(0)} kW
                                </text>
                                <text x="12" y="94" fill="#aaa" fontSize="11" fontFamily="monospace">Carga Q:</text>
                                <text x="148" y="94" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">
                                    {hoveredLoad.q.toFixed(0)} kVAr
                                </text>
                            </>
                        )}
                    </g>
                );
            })()}
        </>
    );
}
