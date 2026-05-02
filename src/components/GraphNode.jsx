import React, { memo, useMemo } from 'react';

/**
 * GraphNode — Renderiza uma barra do sistema elétrico no diagrama SVG.
 *
 * Formas utilizadas por tipo de nó:
 *   Subestação principal (isSource) → Círculo com anel interno e cruz
 *   Alimentador         (isFeeder)  → Hexágono
 *   Capacitor/Shunt     (hasShunt)  → Losango
 *   Carga normal                    → Retângulo arredondado
 */
const GraphNode = memo(function GraphNode({
    nodeId,
    pos,
    isSource,      // true = subestação principal
    isFeeder,      // true = nó alimentador
    color,
    isHighlighted,
    darkMode,
    isEditMode,
    isRestoringLayout,
    showLabels,
    nodeLoad,
    hasShunt,
    onMouseDown,
    onClick,
    onMouseEnter,
    onMouseLeave,
    currentScale
}) {

    // 👇 A MÁGICA DA ESCALA INVERSA (Limitada a 3x para não poluir a tela) 👇
    const inverseScale = Math.min(1 / (currentScale || 1), 3);

    // Contorno de destaque ao hover / seleção
    const strokeColor = isHighlighted
        ? 'rgba(255,255,255,0.35)'
        : (darkMode ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)');
    const strokeWidth = isHighlighted ? 3 : 1.5;

    // Sombra projetada
    const shadowFilter = isHighlighted
        ? `drop-shadow(0 0 10px ${color})`
        : 'drop-shadow(0 2px 4px rgba(0,0,0,0.30))';

    const shapeStyle = { filter: shadowFilter, transition: 'all 0.3s ease' };

    // Pontos do hexágono (raio 22) calculados uma única vez via memo
    const hexPoints = useMemo(() => {
        const r = 31;
        return Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
        }).join(' ');
    }, []);

    // Tamanho da fonte do ID varia por tipo
    const idFontSize = isSource ? '16px' : '13px';

    return (
        <g
            style={{
                // 👇 APLIQUE O INVERSESCALE AQUI 👇
                transform: `translate(${pos.x}px, ${pos.y}px) scale(${inverseScale})`,
                cursor: isEditMode ? 'grab' : 'pointer',
                transition: isRestoringLayout
                    ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
                    : 'none',
            }}
            onMouseDown={(e) => onMouseDown(e, nodeId)}
            onClick={(e) => onClick(e, nodeId)}
            onMouseEnter={() => onMouseEnter(nodeId)}
            onMouseLeave={() => onMouseLeave(nodeId)}
        >
            {isSource ? (
                /* SUBESTAÇÃO PRINCIPAL */
                <g style={shapeStyle}>
                    <circle cx="0" cy="0" r={isHighlighted ? 36 : 31} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} />
                </g>
            ) : isFeeder ? (
                /* ALIMENTADOR */
                <g style={shapeStyle}>
                    <polygon points={hexPoints} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} />
                </g>
            ) : hasShunt ? (
                /* CAPACITOR / SHUNT */
                <polygon points="0,-25 25,0 0,25 -25,0" fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={shapeStyle} />
            ) : (
                /* CARGA NORMAL */
                <g>
                    <rect x="-28" y="-16" width="56" height="32" fill="transparent" /> {/* Hitbox aumentada */}
                    <rect x="-20" y="-11" width="40" height="22" rx="4" fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={shapeStyle} />
                </g>
            )}

            {/* Rótulo com o ID (sempre visível) */}
            <text
                x="0" y="0"
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={idFontSize}
                fontWeight="bold"
                pointerEvents="none"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
            >
                {nodeId}
            </text>

            {/* Rótulo de carga em MW (visível quando showLabels=true) */}
            {showLabels && !isSource && !isFeeder && nodeLoad && (
                <text x="0" y="30" textAnchor="middle" fill={darkMode ? '#aaa' : '#666'} fontSize="9px" pointerEvents="none" >
                    {nodeLoad} MW
                </text>
            )}
        </g>
    );
});

export default GraphNode;
