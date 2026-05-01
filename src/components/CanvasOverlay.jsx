import React, { useRef, useEffect } from 'react';

const CanvasOverlay = ({ 
    allNodes, branches, activePositions, activeWaypoints, 
    transform, getNodeColor, getEdgeColor, width, height, darkMode,
    sources = [], feedersList = [], systemShunts = {}, 
    draggedNodeId, isEditMode, draggedWaypointKey
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
        const draggedBranchIdStr = draggedWaypointKey ? draggedWaypointKey.substring(0, draggedWaypointKey.lastIndexOf('-')) : null;

        // 1. DESENHAR LINHAS
        branches.forEach(b => {
            if (dragIdNum !== null && (Number(b.from) === dragIdNum || Number(b.to) === dragIdNum)) return;
            if (draggedBranchIdStr !== null && String(b.id) === draggedBranchIdStr) return;

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

        // 2. DESENHAR WAYPOINTS (MODO EDIÇÃO)
        if (isEditMode) {
            branches.forEach(b => {
                if (draggedBranchIdStr !== null && String(b.id) === draggedBranchIdStr) return;
                const wps = activeWaypoints[b.id];
                if (!Array.isArray(wps)) return;

                wps.forEach(wp => {
                    ctx.fillStyle = '#ff9800';
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5 / transform.scale;
                    ctx.beginPath();
                    ctx.arc(wp.x, wp.y, 4 / transform.scale, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
            });
        }

        // 3. DESENHAR BARRAS (GEOMETRIA PADRONIZADA E BLINDADA)
        allNodes.forEach(nodeId => {
            const numId = Number(nodeId);
            if (dragIdNum !== null && numId === dragIdNum) return;

            const pos = activePositions[nodeId];
            if (!pos) return;

            // BLINDAGEM DE TIPOS: Converte tudo para número antes de comparar
            const isSource = sources.some(s => Number(s) === numId);
            const isFeeder = feedersList.some(f => Number(f) === numId);
            const hasShunt = !!systemShunts[nodeId] || !!systemShunts[numId];
            
            const baseR = 10 / transform.scale;
            ctx.fillStyle = getNodeColor(nodeId);
            ctx.beginPath();

            if (isSource) {
                // SUBESTAÇÃO: Círculo (Prioridade 1)
                ctx.arc(pos.x, pos.y, baseR * 1.3, 0, Math.PI * 2);
            } else if (isFeeder) {
                // ALIMENTADOR: Hexágono (Prioridade 2)
                const hexR = baseR * 1.5;
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i - (Math.PI / 6);
                    const px = pos.x + hexR * Math.cos(angle);
                    const py = pos.y + hexR * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
            } else if (hasShunt) {
                // SHUNT: Losango
                const rhoR = baseR * 1.5;
                ctx.moveTo(pos.x, pos.y - rhoR);
                ctx.lineTo(pos.x + rhoR, pos.y);
                ctx.lineTo(pos.x, pos.y + rhoR);
                ctx.lineTo(pos.x - rhoR, pos.y);
                ctx.closePath();
            } else {
                // BARRA COMUM: Retângulo
                const w = baseR * 2.5;
                const h = baseR * 1.2;
                if (ctx.roundRect) {
                    ctx.roundRect(pos.x - w/2, pos.y - h/2, w, h, 2 / transform.scale);
                } else {
                    ctx.rect(pos.x - w/2, pos.y - h/2, w, h);
                }
            }
            
            ctx.fill();
            
            // Adiciona o contorno das barras
            ctx.strokeStyle = darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1.5 / transform.scale;
            ctx.stroke();
        });

        ctx.restore();
        
    }, [allNodes, branches, activePositions, activeWaypoints, transform, getNodeColor, getEdgeColor, width, height, darkMode, sources, feedersList, systemShunts, draggedNodeId, isEditMode, draggedWaypointKey]);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />;
};

export default CanvasOverlay;