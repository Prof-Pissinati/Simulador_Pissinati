// src/components/GraphEdge.jsx
import React from 'react';

export default function GraphEdge({
    branch,
    pathString,
    color,
    isHighlighted,
    isEditMode,
    isRestoringLayout,
    waypoints,
    selectedEditWaypoints,
    dragInfoType,
    onLineMouseDown,
    onLineClick,
    onLineDoubleClick,
    onLineMouseEnter,
    onLineMouseLeave,
    onWaypointMouseDown,
    onWaypointDoubleClick
}) {
    const strokeColor = color; 
    let strokeWidth = isHighlighted ? 6 : 2; 
    if (!isHighlighted && branch.state === 1) strokeWidth = 3;

    // EFEITO NEON/GLOW CLÁSSICO
    const shadowFilter = isHighlighted 
        ? `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 15px ${color})` 
        : 'none';

    return (
        <g>
            {/* CAMADA INVISÍVEL PARA CLIQUE (Nova Mecânica mais fácil de clicar) */}
            <path 
                d={pathString} 
                stroke="transparent" 
                strokeWidth="20" 
                fill="none"
                style={{ cursor: isEditMode ? 'move' : 'pointer', transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }} 
                onMouseDown={(e) => onLineMouseDown(e)}
                onClick={(e) => onLineClick(e)}
                onDoubleClick={(e) => onLineDoubleClick(e)}
                onMouseEnter={onLineMouseEnter}
                onMouseLeave={onLineMouseLeave}
            />

            {/* LINHA VISÍVEL */}
            <path 
                d={pathString} 
                stroke={strokeColor} 
                strokeWidth={strokeWidth} 
                fill="none"
                strokeDasharray={branch.state === 1 ? 'none' : '5,5'} 
                pointerEvents="none" 
                className="edge-line" 
                strokeLinejoin="round"
                style={{ transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.3s ease' : 'stroke 0.3s ease', filter: shadowFilter, opacity: branch.state === 1 ? 1 : 0.4 }} 
            />
            
            {/* JOELHOS/WAYPOINTS DO MODO EDIÇÃO */}
            {isEditMode && waypoints.map((wp, wpIndex) => {
                const wpKey = `${branch.id}-${wpIndex}`;
                const isSelectedWp = selectedEditWaypoints.has(wpKey);
                return (
                    <circle 
                        key={`wp-${wpKey}`} 
                        cx={wp.x} 
                        cy={wp.y} 
                        r={isSelectedWp ? "8" : "6"} 
                        fill={isSelectedWp ? "#2962ff" : "#ff9800"} 
                        stroke={isSelectedWp ? "#ffffff" : "#fff"} 
                        strokeWidth="2" 
                        style={{ cursor: dragInfoType === 'waypoint' ? 'grabbing' : 'grab', transition: isRestoringLayout ? 'cx 0.4s cubic-bezier(0.25, 1, 0.5, 1), cy 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                        onMouseDown={(e) => onWaypointMouseDown(e, wpIndex, wpKey, wp)}
                        onDoubleClick={(e) => onWaypointDoubleClick(e, wpIndex)}
                    />
                );
            })}
        </g>
    );
}