import React, { memo } from 'react';

const GraphNode = memo(function GraphNode({
    nodeId, pos, isSource, color, isHighlighted, darkMode,
    isEditMode, isRestoringLayout, showLabels, nodeLoad,
    onMouseDown, onClick, onMouseEnter, onMouseLeave
}) {
    // Cálculo dos estilos de destaque
    const strokeColor = isHighlighted ? '#ffffff33' : (darkMode ? '#ffffff17' : '#00000017');
    const strokeWidth = isHighlighted ? 3 : 2;
    
    const shadowFilter = isHighlighted 
        ? `drop-shadow(0 0 10px ${color})` 
        : 'drop-shadow(0 2px 3px rgba(129, 129, 129, 0.3))';
        
    const colorTransition = 'all 0.3s ease';

    return (
        <g style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: isEditMode ? 'grab' : 'pointer', transition: isRestoringLayout ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
           onMouseDown={(e) => onMouseDown(e, nodeId)}
           onClick={(e) => onClick(e, nodeId)}
           onMouseEnter={() => onMouseEnter(nodeId)}
           onMouseLeave={() => onMouseLeave(nodeId)}
        >
            {isSource ? (
                <circle cx="0" cy="0" r={isHighlighted ? 26 : 22} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
            ) : (
                <g>
                    <rect x="-20" y="-12" width="40" height="24" fill="transparent" />
                    <rect x="-14" y="-8" width="28" height="16" rx="2" fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
                </g>
            )}
            
            <text x="0" y="0" textAnchor="middle" dominantBaseline="central" fill="white" fontSize={isSource ? "14px" : "10px"} fontWeight="bold" pointerEvents="none" className="node-label" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{nodeId}</text>
            
            {/* O Texto de Carga agora vem direto do pai, bem mais leve */}
            {showLabels && !isSource && nodeLoad && (
                <text x="0" y="22" textAnchor="middle" fill="gray" fontSize="9px" pointerEvents="none">{nodeLoad} MW</text>
            )}
        </g>
    );
});

export default GraphNode;