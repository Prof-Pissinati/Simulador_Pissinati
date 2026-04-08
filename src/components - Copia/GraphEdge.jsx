import React, { memo } from 'react';

const GraphEdge = memo(function GraphEdge({
    branch, pathString, color, isHighlighted, isEditMode, isRestoringLayout,
    waypoints, selectedEditWaypoints, dragInfoType,
    onLineMouseDown, onLineClick, onLineDoubleClick,
    onLineMouseEnter, onLineMouseLeave,
    onWaypointMouseDown, onWaypointDoubleClick
}) {
    const strokeColor = color; 
    
    // Espessura encorpada (4px), mas sem ser grosseira. Hover fica com 7px. Linha aberta fica com 2px.
    let strokeWidth = isHighlighted ? 6 : (branch.state === 1 ? 3 : 2); 

    // O Segredo: Removemos o brilho artificial contínuo!
    // Assim, o brilho só aparece quando você passa o mouse.
    // O efeito de carregamento voltará a ser controlado puramente pela variação de cor/opacidade do seu App.jsx
    const shadowFilter = isHighlighted 
        ? `drop-shadow(0 0 5px ${color})` 
        : 'none';
    return (
        <g>
            <path 
                d={pathString} stroke="transparent" strokeWidth="20" fill="none"
                style={{ cursor: isEditMode ? 'move' : 'pointer', transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }} 
                // 👇 Retornamos o ID e o Evento limpos
                onMouseDown={(e) => onLineMouseDown(e, branch.id)}
                onClick={(e) => onLineClick(e, branch.id)}
                onDoubleClick={(e) => onLineDoubleClick(e, branch.id)}
                onMouseEnter={() => onLineMouseEnter(branch.id)}
                onMouseLeave={() => onLineMouseLeave(branch.id)}
            />

            <path 
                d={pathString} stroke={strokeColor} strokeWidth={strokeWidth} fill="none"
                strokeDasharray={branch.state === 1 ? 'none' : '8,6'} // Mais visível
                pointerEvents="none" className="edge-line" strokeLinejoin="round"
                style={{ transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.3s ease' : 'stroke 0.3s ease', filter: shadowFilter, opacity: branch.state === 1 ? 1 : 0.7 }} // Opacidade elevada
            />
            
            {isEditMode && waypoints.map((wp, wpIndex) => {
                const wpKey = `${branch.id}-${wpIndex}`;
                const isSelectedWp = selectedEditWaypoints.has(wpKey);
                return (
                    <circle 
                        key={`wp-${wpKey}`} cx={wp.x} cy={wp.y} r={isSelectedWp ? "8" : "6"} 
                        fill={isSelectedWp ? "#2962ff" : "#ff9800"} stroke={isSelectedWp ? "#ffffff" : "#fff"} strokeWidth="2" 
                        style={{ cursor: dragInfoType === 'waypoint' ? 'grabbing' : 'grab', transition: isRestoringLayout ? 'cx 0.4s cubic-bezier(0.25, 1, 0.5, 1), cy 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                        // 👇 Waypoints também padronizados
                        onMouseDown={(e) => onWaypointMouseDown(e, branch.id, wpIndex, wpKey, wp)}
                        onDoubleClick={(e) => onWaypointDoubleClick(e, branch.id, wpIndex)}
                    />
                );
            })}
        </g>
    );
});

export default GraphEdge;