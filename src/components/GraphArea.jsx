import React, { useRef, useState, useEffect } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

// ==============================================================
// 🚀 MOTOR DE ANIMAÇÃO 60 FPS (Física de Transição)
// Resolve a limitação dos navegadores ao animar linhas SVG
// ==============================================================
function useAnimatedLayout(targetPositions, duration = 800) {
    const [positions, setPositions] = useState(targetPositions);

    useEffect(() => {
        let startTime = null;
        let animationFrameId;
        // Captura onde as barras estão EXATAMENTE agora (mesmo no meio de uma viagem)
        const startPositions = { ...positions };

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            let progress = (timestamp - startTime) / duration;
            if (progress > 1) progress = 1;

            // Matemática da Curva (Cubic Ease In-Out): Acelera e depois freia suavemente
            const ease = progress < 0.5 
                ? 4 * progress * progress * progress 
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const currentPositions = {};
            
            // Interpola a posição X e Y de cada barra
            for (let key in targetPositions) {
                const startP = startPositions[key] || targetPositions[key];
                const endP = targetPositions[key];
                currentPositions[key] = {
                    x: startP.x + (endP.x - startP.x) * ease,
                    y: startP.y + (endP.y - startP.y) * ease,
                };
            }

            setPositions(currentPositions);

            // Continua a animação até chegar a 100%
            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animate);
            }
        };

        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    }, [targetPositions]); // Só roda quando você aperta o botão de mudar o layout

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
    activePositions // Posições Alvo
}) {
    const svgRef = useRef(null);
    const [transform, setTransform] = useState({ x: -50, y: 0, scale: 1 });
    
    // As coordenadas animadas frame-a-frame!
    const animPositions = useAnimatedLayout(activePositions, 800); 

    const isPanning = useRef(false);
    const hasMoved = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Deixamos o CSS cuidar apenas das cores e brilhos agora (Crossfade suave)
    const colorTransition = 'fill 0.5s ease, stroke 0.5s ease, opacity 0.5s ease, filter 0.5s ease';

    // MOUSE HANDLERS (Zoom e Arrastar a Tela)
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

    return (
        <div className="graph-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
            <svg id="sistema-eletrico-svg" className="graph-svg" viewBox="0 0 900 650" ref={svgRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp} 
                onMouseLeave={() => isPanning.current = false}
            >
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                    
                    {/* --- DESENHO DAS LINHAS (CABOS) --- */}
                    {branches.map(b => {
                        // USA AS POSIÇÕES DO MOTOR DE ANIMAÇÃO
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
                                {/* Linha de interação (grossa e transparente) para facilitar o clique */}
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
                                {/* Linha Visível (Acompanha a posição matemática em tempo real) */}
                                <line 
                                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} 
                                    stroke={strokeColor} strokeWidth={strokeWidth} 
                                    strokeDasharray={b.state === 1 ? 'none' : '5,5'} 
                                    pointerEvents="none" className="edge-line"
                                    style={{ 
                                        transition: colorTransition, // Anima só cor/sombra
                                        filter: shadowFilter, 
                                        opacity: b.state === 1 ? 1 : 0.4 
                                    }} 
                                />
                            </g>
                        );
                    })}

                    {/* --- DESENHO DOS NÓS (BARRAS) --- */}
                    {allNodes.map(nodeId => {
                        // USA AS POSIÇÕES DO MOTOR DE ANIMAÇÃO
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
                               // A Cápsula inteira se move acompanhando o motor matemático
                               style={{ 
                                   transform: `translate(${pos.x}px, ${pos.y}px)`,
                                   cursor: 'pointer'
                               }}
                               onClick={(e) => { 
                                   e.stopPropagation(); 
                                   toggleFault(nodeId); 
                               }} 
                               onMouseEnter={() => { if(!isMobile) { setSelectedElement({ type: 'node', id: nodeId }); setHoveredNodeId(nodeId); } }}
                               onMouseLeave={() => { if(!isMobile) setHoveredNodeId(null); }}
                            >
                                {isSource ? (
                                    <circle 
                                        cx="0" cy="0" 
                                        r={isHighlighted ? 26 : 22} 
                                        fill={color} stroke={strokeColor} strokeWidth={strokeWidth} 
                                        style={{ filter: shadowFilter, transition: colorTransition }} 
                                    />
                                ) : (
                                    <g>
                                        <rect x="-20" y="-12" width="40" height="24" fill="transparent" />
                                        <rect 
                                            x="-14" y="-8" width="28" height="16" rx="2"
                                            fill={color} stroke={strokeColor} strokeWidth={strokeWidth} 
                                            style={{ filter: shadowFilter, transition: colorTransition }} 
                                        />
                                    </g>
                                )}
                                
                                <text 
                                    x="0" y="0" textAnchor="middle" dominantBaseline="central" 
                                    fill="white" fontSize={isSource ? "14px" : "10px"} fontWeight="bold" 
                                    pointerEvents="none" className="node-label" 
                                    style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                                >
                                    {nodeId}
                                </text>
                                
                                {showLabels && !isSource && SYSTEM_DATA.loads[nodeId] && (
                                    <text 
                                        x="0" y="22" textAnchor="middle" fill="gray" fontSize="9px" pointerEvents="none"
                                    >
                                        {(SYSTEM_DATA.loads[nodeId].p / 1000).toFixed(1)} MW
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
}