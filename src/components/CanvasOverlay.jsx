import React, { useRef, useEffect } from 'react';

const CanvasOverlay = ({ 
    allNodes, branches, activePositions, activeWaypoints, 
    transform, getNodeColor, getEdgeColor, width, height, darkMode 
}) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Ajuste de DPI para telas Retina/Alta Resolução
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Limpa a tela
        ctx.clearRect(0, 0, width, height);

        // Aplica a Transformação (Pan e Zoom do React)
        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);

        // 1. DESENHAR LINHAS (Arestas)
        branches.forEach(b => {
            const p1 = activePositions[b.from];
            const p2 = activePositions[b.to];
            if (!p1 || !p2) return;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            
            // Waypoints (se existirem)
            const wps = activeWaypoints[b.id] || [];
            wps.forEach(wp => ctx.lineTo(wp.x, wp.y));
            
            ctx.lineTo(p2.x, p2.y);

            ctx.strokeStyle = getEdgeColor(b);
            ctx.lineWidth = 1 / transform.scale; // Mantém espessura visual constante
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            if (b.state === 0) ctx.setLineDash([5, 5]); // Tracejado para chaves abertas
            else ctx.setLineDash([]);
            
            ctx.stroke();
        });

        // 2. DESENHAR BARRAS (Nós)
        allNodes.forEach(nodeId => {
            const pos = activePositions[nodeId];
            if (!pos) return;

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4 / transform.scale, 0, Math.PI * 2);
            ctx.fillStyle = getNodeColor(nodeId);
            ctx.fill();
            
            // Borda sutil para destacar no fundo escuro
            ctx.strokeStyle = darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 0.5 / transform.scale;
            ctx.stroke();
        });

        ctx.restore();
    }, [allNodes, branches, activePositions, activeWaypoints, transform, width, height, darkMode, getNodeColor, getEdgeColor]);

    return (
        <canvas 
            ref={canvasRef} 
            style={{ 
                width: '100%', 
                height: '100%', 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                pointerEvents: 'none' // Interação continua via SVG transparente se necessário
            }} 
        />
    );
};

export default CanvasOverlay;