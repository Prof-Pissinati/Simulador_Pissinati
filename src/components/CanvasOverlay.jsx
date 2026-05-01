import React, { useRef, useEffect } from 'react';

const CanvasOverlay = ({ 
    allNodes, branches, activePositions, activeWaypoints, 
    transform, getNodeColor, getEdgeColor, width, height, darkMode,
    sources = [], feedersList = [], systemShunts = {}, draggedNodeId
}) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);

        const dragIdNum = draggedNodeId ? Number(draggedNodeId) : null;

        // 1. DESENHAR LINHAS
        branches.forEach(b => {
            if (dragIdNum !== null && (Number(b.from) === dragIdNum || Number(b.to) === dragIdNum)) return;

            const p1 = activePositions[b.from];
            const p2 = activePositions[b.to];
            if (!p1 || !p2) return;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            const wps = activeWaypoints[b.id] || [];
            wps.forEach(wp => ctx.lineTo(wp.x, wp.y));
            ctx.lineTo(p2.x, p2.y);

            ctx.strokeStyle = getEdgeColor(b);
            ctx.lineWidth = 2.5 / transform.scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (b.state === 0) ctx.setLineDash([5, 5]);
            else ctx.setLineDash([]);
            ctx.stroke();
        });

        // 2. DESENHAR BARRAS (AGORA COM GEOMETRIA)
        allNodes.forEach(nodeId => {
            if (dragIdNum !== null && Number(nodeId) === dragIdNum) return;

            const pos = activePositions[nodeId];
            if (!pos) return;

            // Lógica de Identificação
            const isSource = sources.includes(nodeId) || feedersList.includes(nodeId);
            const hasShunt = !!systemShunts[nodeId];
            
            const baseR = 7 / transform.scale;
            ctx.fillStyle = getNodeColor(nodeId);
            ctx.beginPath();

            if (isSource) {
                // 👇 SUBESTAÇÕES: Hexágono (Levemente maior para destaque)
                const hexR = baseR * 1.5;
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i - (Math.PI / 6); // Rotação para ter bico em cima/baixo
                    const px = pos.x + hexR * Math.cos(angle);
                    const py = pos.y + hexR * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
            } else if (hasShunt) {
                // 👇 SHUNTS: Losango (Diamante)
                const rhoR = baseR * 1.5;
                ctx.moveTo(pos.x, pos.y - rhoR);
                ctx.lineTo(pos.x + rhoR, pos.y);
                ctx.lineTo(pos.x, pos.y + rhoR);
                ctx.lineTo(pos.x - rhoR, pos.y);
                ctx.closePath();
            } else {
                // 👇 BARRAS COMUNS: Bolinha (Alta Performance)
                ctx.arc(pos.x, pos.y, baseR, 0, Math.PI * 2);
            }
            
            ctx.fill();
        });

        ctx.restore();
    }, [allNodes, branches, activePositions, activeWaypoints, transform, getNodeColor, getEdgeColor, width, height, darkMode, sources, feedersList, systemShunts, draggedNodeId]);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />;
};

export default CanvasOverlay;