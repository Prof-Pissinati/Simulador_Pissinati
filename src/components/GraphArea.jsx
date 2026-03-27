import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SYSTEM_DATA } from '../data/systemData';

const FIXED_GRID_SIZE = 10;

function useAnimatedLayout(targetPositions, duration = 800) {
    const [positions, setPositions] = useState(targetPositions);
    useEffect(() => {
        let startTime = null; let animationFrameId;
        const startPositions = { ...positions };
        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            let progress = (timestamp - startTime) / duration;
            if (progress > 1) progress = 1;
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            const currentPositions = {};
            for (let key in targetPositions) {
                const startP = startPositions[key] || targetPositions[key];
                const endP = targetPositions[key];
                currentPositions[key] = { x: startP.x + (endP.x - startP.x) * ease, y: startP.y + (endP.y - startP.y) * ease };
            }
            setPositions(currentPositions);
            if (progress < 1) animationFrameId = requestAnimationFrame(animate);
        };
        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    }, [targetPositions]);
    return positions;
}

function getClosestSegmentIndex(p1, p2, waypoints, clickPt) {
    if (!p1 || !p2 || !clickPt) return 0; 
    const pts = [p1, ...waypoints, p2];
    let minIdx = 0; let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]; const b = pts[i + 1];
        const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
        let t = l2 === 0 ? 0 : ((clickPt.x - a.x) * (b.x - a.x) + (clickPt.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        const dist = Math.sqrt(Math.pow(clickPt.x - proj.x, 2) + Math.pow(clickPt.y - proj.y, 2));
        if (dist < minDist) { minDist = dist; minIdx = i; }
    }
    return minIdx;
}

export default function GraphArea({
    branches = [], allNodes = [], sources = [], showLabels, getEdgeColor, getNodeColor, toggleSwitch, toggleFault, setSelectedElement,
    selectedElement, hoveredLineId, setHoveredLineId, hoveredNodeId, setHoveredNodeId, maintenanceMode, isMobile,
    activePositions = {}, activeWaypoints = {}, lineCurrents = {}, nodeData = {}, isEditMode, setIsEditMode, darkMode,
    printFrameMode, isFaultSidebarOpen, onSaveLayoutToHistory, children, onExportRequest 
}) {
    const svgRef = useRef(null);
    const measureRef = useRef(null); 
    
    const [transform, setTransform] = useState({ x: -50, y: 0, scale: 1 });
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const animPositions = useAnimatedLayout(activePositions, 800); 

    const [manualPositions, setManualPositions] = useState({});
    const [manualWaypoints, setManualWaypoints] = useState({}); 
    const [dragInfo, setDragInfo] = useState(null); 
    const wasDragged = useRef(false);

    const [selectedEditNodes, setSelectedEditNodes] = useState(new Set());
    const [selectedEditWaypoints, setSelectedEditWaypoints] = useState(new Set()); 
    const [selectionBox, setSelectionBox] = useState(null);
    const isSelecting = useRef(false);
    const [isRestoringLayout, setIsRestoringLayout] = useState(false);
    const restoreTimeout = useRef(null);

    const [isHoveringSVG, setIsHoveringSVG] = useState(false);
    const [localHoveredNode, setLocalHoveredNode] = useState(null);
    const [localHoveredLine, setLocalHoveredLine] = useState(null);

    const [isAnimatingZoom, setIsAnimatingZoom] = useState(false);
    const zoomTimeout = useRef(null);

    const stopAnimation = useCallback(() => {
        if (isAnimatingZoom) setIsAnimatingZoom(false);
        if (zoomTimeout.current) {
            clearTimeout(zoomTimeout.current);
            zoomTimeout.current = null;
        }
    }, [isAnimatingZoom]);

    const [containerSize, setContainerSize] = useState({ w: 900, h: 650 });
    
    useEffect(() => {
        const updateSize = () => {
            if (measureRef.current) {
                const rect = measureRef.current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    setContainerSize({ w: rect.width, h: rect.height });
                }
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        const timer = setTimeout(updateSize, 350); 
        return () => { window.removeEventListener('resize', updateSize); clearTimeout(timer); };
    }, [printFrameMode, isFaultSidebarOpen, isEditMode]);

    useEffect(() => { 
        setManualPositions({}); 
        setManualWaypoints(activeWaypoints || {}); 
        setSelectedEditNodes(new Set()); 
        setSelectedEditWaypoints(new Set()); 
    }, [activePositions, activeWaypoints]);

    useEffect(() => {
        if (!isEditMode) {
            setSelectedEditNodes(new Set());
            setSelectedEditWaypoints(new Set());
            setSelectionBox(null);
        }
    }, [isEditMode]);

    const getCurrentFullLayout = useCallback(() => {
        const fullPositions = {};
        allNodes.forEach(id => { fullPositions[id] = manualPositions[id] || animPositions[id]; });
        const fullWaypoints = JSON.parse(JSON.stringify(manualWaypoints)); 
        return { positions: fullPositions, waypoints: fullWaypoints };
    }, [allNodes, manualPositions, animPositions, manualWaypoints]);

    useEffect(() => {
        const handleApplyLayout = (e) => {
            setIsRestoringLayout(true);
            // Lê do novo formato de projeto (data.layout) ou do antigo (data)
            const layoutData = e.detail.layout || e.detail;
            setManualPositions(layoutData.positions || {}); 
            setManualWaypoints(layoutData.waypoints || {});
            
            if (restoreTimeout.current) clearTimeout(restoreTimeout.current);
            restoreTimeout.current = setTimeout(() => setIsRestoringLayout(false), 400);
        };
        
        const handleResetLayout = () => {
            setIsRestoringLayout(true);
            setManualPositions({}); setManualWaypoints({});
            if (restoreTimeout.current) clearTimeout(restoreTimeout.current);
            restoreTimeout.current = setTimeout(() => setIsRestoringLayout(false), 400);
        };

        // NOVO: Quando pedem para exportar, empacota o layout e envia pro App.jsx!
        const handleTriggerExport = () => {
            const fullLayout = getCurrentFullLayout();
            if (onExportRequest) onExportRequest(fullLayout.positions, fullLayout.waypoints);
        };
        
        window.addEventListener('applyGraphLayout', handleApplyLayout);
        window.addEventListener('resetGraphLayout', handleResetLayout);
        window.addEventListener('requestLayoutExport', handleTriggerExport);
        
        return () => { 
            window.removeEventListener('applyGraphLayout', handleApplyLayout); 
            window.removeEventListener('resetGraphLayout', handleResetLayout); 
            window.removeEventListener('requestLayoutExport', handleTriggerExport);
        };
    }, [getCurrentFullLayout, onExportRequest]);

    const isPanning = useRef(false);
    const hasMoved = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    
    // CORREÇÃO: Variável de animação de cores restaurada!
    const colorTransition = 'all 0.3s ease';

    const getRawSVGPoint = useCallback((clientX, clientY) => {
        const svg = svgRef.current;
        if (!svg) return { x: clientX, y: clientY };
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }, []);

    const getTransformedPoint = useCallback((clientX, clientY) => {
        const rawPt = getRawSVGPoint(clientX, clientY);
        return { x: (rawPt.x - transform.x) / transform.scale, y: (rawPt.y - transform.y) / transform.scale };
    }, [getRawSVGPoint, transform.x, transform.y, transform.scale]);

    const isPaper = printFrameMode !== 'none';
    const isLandscape = printFrameMode === 'landscape';
    const vbW = isPaper ? (isLandscape ? 2970 : 2100) : 900;
    const vbH = isPaper ? (isLandscape ? 2100 : 2970) : 650;

    const handleZoomExtents = useCallback(() => {
        const { positions, waypoints } = getCurrentFullLayout();
        const nodeIds = Object.keys(positions);
        if (nodeIds.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodeIds.forEach(id => {
            const p = positions[id];
            if (!p) return; // <--- ADICIONE ESTA TRAVA DE SEGURANÇA AQUI
            
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        Object.values(waypoints).forEach(branchWps => {
            branchWps.forEach(wp => {
                if (!wp) return; // <--- ADICIONE ESTA TRAVA DE SEGURANÇA AQUI
                
                if (wp.x < minX) minX = wp.x;
                if (wp.x > maxX) maxX = wp.x;
                if (wp.y < minY) minY = wp.y;
                if (wp.y > maxY) maxY = wp.y;
            });
        });

        if (minX === Infinity) return;

        const padding = 80; 
        const width = maxX - minX;
        const height = maxY - minY;

        const scaleX = (vbW - padding * 2) / (width || 1);
        const scaleY = (vbH - padding * 2) / (height || 1);
        const newScale = Math.max(0.02, Math.min(scaleX, scaleY, 2.5));

        const centerX = minX + width / 2;
        const centerY = minY + height / 2;
        const newX = (vbW / 2) - (centerX * newScale);
        const newY = (vbH / 2) - (centerY * newScale);

        setIsAnimatingZoom(true);
        setTransform({ x: newX, y: newY, scale: newScale });
        
        if (zoomTimeout.current) clearTimeout(zoomTimeout.current);
        zoomTimeout.current = setTimeout(() => { setIsAnimatingZoom(false); }, 500);
    }, [getCurrentFullLayout, vbW, vbH]);

    useEffect(() => { 
        if (printFrameMode !== 'none') {
            handleZoomExtents(); 
        } else {
            setTimeout(() => handleZoomExtents(), 150);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [printFrameMode]);

    useEffect(() => {
        const handleZoom = () => handleZoomExtents(); 
        window.addEventListener('triggerZoomExtents', handleZoom);
        return () => window.removeEventListener('triggerZoomExtents', handleZoom);
    }, [handleZoomExtents]);

    // 1. Envolvemos no useCallback
    const handleWheel = useCallback((e) => {
        stopAnimation(); 
        e.preventDefault(); // Agora o navegador vai aceitar isso sem reclamar!
        const scaleMultiplier = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform(prev => {
            const newScale = Math.max(0.1, Math.min(4, prev.scale * scaleMultiplier));
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            const groupX = (rawPt.x - prev.x) / prev.scale;
            const groupY = (rawPt.y - prev.y) / prev.scale;
            const newX = rawPt.x - (groupX * newScale);
            const newY = rawPt.y - (groupY * newScale);
            return { x: newX, y: newY, scale: newScale };
        });
    }, [stopAnimation, getRawSVGPoint]);

    // 2. Adicionamos o EventListener com { passive: false }
    useEffect(() => {
        const svg = svgRef.current;
        if (svg) {
            svg.addEventListener('wheel', handleWheel, { passive: false });
            return () => svg.removeEventListener('wheel', handleWheel);
        }
    }, [handleWheel]);

    const handleMouseDown = (e) => {
        stopAnimation(); 
        if (e.button === 1) { e.preventDefault(); handleZoomExtents(); return; }
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        const isBackgroundClick = e.target.tagName === 'svg' || e.target.id === 'bg-grid-rect';

        if (isBackgroundClick) {
            if (isEditMode && e.shiftKey) {
                isSelecting.current = true;
                setSelectionBox({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
            } else {
                isPanning.current = true; hasMoved.current = false;
                const rawPt = getRawSVGPoint(e.clientX, e.clientY);
                dragStart.current = { x: rawPt.x - transform.x, y: rawPt.y - transform.y };
                if (isEditMode && !e.shiftKey) {
                    setSelectedEditNodes(new Set());
                    setSelectedEditWaypoints(new Set());
                }
            }
        }
    };

    const handleMouseMove = (e) => {
        setMousePos({ x: e.clientX, y: e.clientY });
        const svgPt = getTransformedPoint(e.clientX, e.clientY);

        if (isSelecting.current && isEditMode) {
            setSelectionBox(prev => ({ ...prev, x2: svgPt.x, y2: svgPt.y }));
        }
        else if (dragInfo && isEditMode) {
            const rawDx = (svgPt.x - dragInfo.startX);
            const rawDy = (svgPt.y - dragInfo.startY);
            const snap = (v) => Math.round(v / FIXED_GRID_SIZE) * FIXED_GRID_SIZE;

            if (dragInfo.type === 'mixed') {
                let actualDx = 0, actualDy = 0;
                if (dragInfo.leaderType === 'node') {
                    const leaderInitial = dragInfo.groupNodes[dragInfo.leaderId];
                    const leaderTargetX = snap(leaderInitial.x + rawDx);
                    const leaderTargetY = snap(leaderInitial.y + rawDy);
                    actualDx = leaderTargetX - leaderInitial.x;
                    actualDy = leaderTargetY - leaderInitial.y;
                } else {
                    const leaderTargetX = snap(dragInfo.initialX + rawDx);
                    const leaderTargetY = snap(dragInfo.initialY + rawDy);
                    actualDx = leaderTargetX - dragInfo.initialX;
                    actualDy = leaderTargetY - dragInfo.initialY;
                }
                if (Math.abs(actualDx) > 0 || Math.abs(actualDy) > 0) wasDragged.current = true;
                if (Object.keys(dragInfo.groupNodes).length > 0) {
                    setManualPositions(prev => {
                        const nextPos = { ...prev };
                        Object.keys(dragInfo.groupNodes).forEach(id => {
                            nextPos[id] = { x: dragInfo.groupNodes[id].x + actualDx, y: dragInfo.groupNodes[id].y + actualDy };
                        });
                        return nextPos;
                    });
                }
                if (Object.keys(dragInfo.groupWps).length > 0) {
                    setManualWaypoints(prev => {
                        const nextWps = JSON.parse(JSON.stringify(prev));
                        Object.keys(dragInfo.groupWps).forEach(key => {
                            const [bId, idxStr] = key.split('-');
                            const idx = parseInt(idxStr);
                            if (nextWps[bId] && nextWps[bId][idx]) {
                                nextWps[bId][idx] = { x: dragInfo.groupWps[key].x + actualDx, y: dragInfo.groupWps[key].y + actualDy };
                            }
                        });
                        return nextWps;
                    });
                }
            } else if (dragInfo.type === 'line') {
                if (Math.abs(rawDx) > 5 || Math.abs(rawDy) > 5) {
                    wasDragged.current = true;
                    setManualWaypoints(prev => {
                        const currentWps = prev[dragInfo.branchId] && Array.isArray(prev[dragInfo.branchId]) ? [...prev[dragInfo.branchId]] : [];
                        currentWps.splice(dragInfo.insertIdx, 0, { x: dragInfo.startX, y: dragInfo.startY });
                        return { ...prev, [dragInfo.branchId]: currentWps };
                    });
                    const wpKey = `${dragInfo.branchId}-${dragInfo.insertIdx}`;
                    setDragInfo({
                        type: 'mixed', leaderType: 'waypoint', leaderId: wpKey, startX: dragInfo.startX, startY: dragInfo.startY,
                        initialX: dragInfo.startX, initialY: dragInfo.startY, groupNodes: {}, groupWps: { [wpKey]: { x: dragInfo.startX, y: dragInfo.startY } }
                    });
                }
            }
        } 
        else if (isPanning.current) {
            hasMoved.current = true;
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            setTransform(p => ({ ...p, x: rawPt.x - dragStart.current.x, y: rawPt.y - dragStart.current.y }));
        }
    };

    const handleMouseUp = (e) => {
        if (isSelecting.current && selectionBox) {
            const minX = Math.min(selectionBox.x1, selectionBox.x2);
            const maxX = Math.max(selectionBox.x1, selectionBox.x2);
            const minY = Math.min(selectionBox.y1, selectionBox.y2);
            const maxY = Math.max(selectionBox.y1, selectionBox.y2);
            const newSelection = new Set(); const newWpSelection = new Set(); 
            allNodes.forEach(id => {
                const pos = manualPositions[id] || activePositions[id] || animPositions[id];
                if (!pos) return;
                if (pos && pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) newSelection.add(id);
            });
            Object.keys(manualWaypoints).forEach(branchId => {
                const wps = manualWaypoints[branchId];
                if (Array.isArray(wps)) {
                    wps.forEach((wp, index) => {
                        if (wp && wp.x >= minX && wp.x <= maxX && wp.y >= minY && wp.y <= maxY) newWpSelection.add(`${branchId}-${index}`);
                    });
                }
            });
            setSelectedEditNodes(newSelection); setSelectedEditWaypoints(newWpSelection);
            setSelectionBox(null); isSelecting.current = false;
        }
        if (dragInfo) { setDragInfo(null); setTimeout(() => { wasDragged.current = false; }, 50); }
        isPanning.current = false;
        const isBackgroundClick = e.target.tagName === 'svg' || e.target.id === 'bg-grid-rect';
        if (isBackgroundClick && !hasMoved.current && !isEditMode) setSelectedElement(null);
        hasMoved.current = false;
    };

    const getPathData = (p1, p2, waypoints = []) => {
        if (!p1 || !p2) return ''; 
        if (!Array.isArray(waypoints) || waypoints.length === 0) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        let d = `M ${p1.x} ${p1.y} `;
        waypoints.forEach(wp => { if(wp && wp.x) d += `L ${wp.x} ${wp.y} `; });
        d += `L ${p2.x} ${p2.y}`;
        return d;
    };

    const hoveredBranch = localHoveredLine !== null ? branches.find(b => b.id === localHoveredLine) : null;
    const hoveredLineData = localHoveredLine !== null ? lineCurrents[localHoveredLine] : null;
    const hoveredNodeInfo = localHoveredNode !== null && nodeData[localHoveredNode] ? nodeData[localHoveredNode] : null;

    const svgCursor = isPanning.current ? 'grabbing' : (isEditMode ? 'default' : 'pointer');
    
    const paperRatio = isLandscape ? 297 / 210 : 210 / 297;
    const containerRatio = (containerSize.w || 1) / (containerSize.h || 1);
    
    let calcWidth = '100%';
    let calcHeight = '100%';
    
    if (isPaper && containerSize.w && containerSize.h) {
        if (containerRatio > paperRatio) {
            calcHeight = Math.max(0, containerSize.h - 40);
            calcWidth = calcHeight * paperRatio;
        } else {
            calcWidth = Math.max(0, containerSize.w - 40);
            calcHeight = calcWidth / paperRatio;
        }
    }

    const paperStyle = {
        position: 'relative',
        width: isPaper ? `${calcWidth}px` : '100%',
        height: isPaper ? `${calcHeight}px` : '100%',
        margin: 'auto',
        boxShadow: isPaper ? '0 20px 60px rgba(0,0,0,0.5)' : 'none',
        border: isPaper ? '1px solid #333' : 'none',
        backgroundColor: darkMode ? '#121212' : '#ffffff',
        transition: 'width 0.3s, height 0.3s, background-color 0.3s',
        overflow: 'hidden'
    };

    return (
        <div className="graph-container" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div ref={measureRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: -1 }}></div>

            <div className="paper-container" style={paperStyle}>
                <svg id="sistema-eletrico-svg" className="graph-svg" viewBox={`0 0 ${vbW} ${vbH}`} 
                    preserveAspectRatio="xMidYMid meet" 
                    ref={svgRef}
                    style={{ width: '100%', height: '100%', display: 'block', cursor: svgCursor }}
                    onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} 
                    onMouseEnter={() => setIsHoveringSVG(true)}
                    onMouseLeave={() => { setIsHoveringSVG(false); isPanning.current = false; isSelecting.current = false; setHoveredLineId(null); setHoveredNodeId(null); setLocalHoveredNode(null); setLocalHoveredLine(null); if(dragInfo) setDragInfo(null); }}
                >
                    <g 
                        transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
                        style={{ transition: isAnimatingZoom ? 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                    >
                        {isEditMode && (
                            <g>
                                <defs>
                                    <pattern id={`bg-grid-${FIXED_GRID_SIZE}`} width={FIXED_GRID_SIZE} height={FIXED_GRID_SIZE} patternUnits="userSpaceOnUse">
                                        <path d={`M ${FIXED_GRID_SIZE} 0 L 0 0 0 ${FIXED_GRID_SIZE}`} fill="none" stroke={darkMode ? '#333' : '#e0e0e0'} strokeWidth="1"/>
                                    </pattern>
                                </defs>
                                <rect id="bg-grid-rect" x="-10000" y="-10000" width="20000" height="20000" fill={`url(#bg-grid-${FIXED_GRID_SIZE})`} />
                            </g>
                        )}

                        {/* --- DESENHO DAS LINHAS (CABOS) --- */}
                        {branches.map(b => {
                            const p1 = manualPositions[b.from] || animPositions[b.from];
                            const p2 = manualPositions[b.to] || animPositions[b.to];
                            if (!p1 || !p2) return null; 
                            
                            const waypoints = Array.isArray(manualWaypoints[b.id]) ? manualWaypoints[b.id] : [];
                            const pathString = getPathData(p1, p2, waypoints);
                            const color = getEdgeColor(b);
                            
                            const isHovered = hoveredLineId === b.id || localHoveredLine === b.id;
                            const isSelected = selectedElement && selectedElement.type === 'edge' && selectedElement.data.id === b.id;
                            const isHighlighted = isHovered || isSelected;

                            const strokeColor = color; 
                            let strokeWidth = isHighlighted ? 6 : 2; 
                            if (!isHighlighted && b.state === 1) strokeWidth = 3;

                            // EFEITO NEON/GLOW ORIGINAL DO SEU GIT
                            const shadowFilter = isHighlighted 
                                ? `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 15px ${color})` 
                                : 'none';

                            return (
                                <g key={b.id}>
                                    {/* CAMADA INVISÍVEL PARA CLIQUE (Nova Mecânica) */}
                                    <path d={pathString} stroke="transparent" strokeWidth="20" fill="none"
                                        style={{ cursor: isEditMode ? 'move' : 'pointer', transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }} 
                                        onMouseDown={(e) => {
                                            if (!isEditMode) return;
                                            e.stopPropagation(); wasDragged.current = false;
                                            const svgPt = getTransformedPoint(e.clientX, e.clientY);
                                            if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
                                            const insertIdx = getClosestSegmentIndex(p1, p2, waypoints, svgPt);
                                            setDragInfo({ type: 'line', branchId: b.id, insertIdx: insertIdx, startX: svgPt.x, startY: svgPt.y });
                                        }}
                                        onClick={(e) => { e.stopPropagation(); if (!isEditMode) { if (isMobile) setSelectedElement({ type: 'edge', data: b }); else if (b.hasSwitch || maintenanceMode) toggleSwitch(b.id); } }} 
                                        onDoubleClick={(e) => {
                                            if (!isEditMode) return;
                                            if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
                                            e.stopPropagation();
                                            const svgPt = getTransformedPoint(e.clientX, e.clientY);
                                            const insertIdx = getClosestSegmentIndex(p1, p2, waypoints, svgPt);
                                            setManualWaypoints(prev => {
                                                const currentWps = prev[b.id] && Array.isArray(prev[b.id]) ? [...prev[b.id]] : [];
                                                currentWps.splice(insertIdx, 0, { x: svgPt.x, y: svgPt.y });
                                                return { ...prev, [b.id]: currentWps };
                                            });
                                        }}
                                        onMouseEnter={() => { if(!isMobile) { setHoveredLineId(b.id); setLocalHoveredLine(b.id); } }} 
                                        onMouseLeave={() => { if(!isMobile) { setHoveredLineId(null); setLocalHoveredLine(null); } }}
                                    />

                                    {/* LINHA VISÍVEL (Visual Clássico do Git) */}
                                    <path d={pathString} stroke={strokeColor} strokeWidth={strokeWidth} fill="none"
                                        strokeDasharray={b.state === 1 ? 'none' : '5,5'} pointerEvents="none" className="edge-line" strokeLinejoin="round"
                                        style={{ transition: isRestoringLayout ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.3s ease' : 'stroke 0.3s ease', filter: shadowFilter, opacity: b.state === 1 ? 1 : 0.4 }} 
                                    />
                                    
                                    {/* JOELHOS/WAYPOINTS DO MODO EDIÇÃO */}
                                    {isEditMode && waypoints.map((wp, wpIndex) => {
                                        const wpKey = `${b.id}-${wpIndex}`;
                                        const isSelectedWp = selectedEditWaypoints.has(wpKey);
                                        return (
                                            <circle key={`wp-${wpKey}`} cx={wp.x} cy={wp.y} r={isSelectedWp ? "8" : "6"} fill={isSelectedWp ? "#2962ff" : "#ff9800"} stroke={isSelectedWp ? "#ffffff" : "#fff"} strokeWidth="2" style={{ cursor: dragInfo?.type === 'waypoint' ? 'grabbing' : 'grab', transition: isRestoringLayout ? 'cx 0.4s cubic-bezier(0.25, 1, 0.5, 1), cy 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                                                onMouseDown={(e) => {
                                                    e.stopPropagation(); wasDragged.current = false;
                                                    if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
                                                    const svgPt = getTransformedPoint(e.clientX, e.clientY);
                                                    let currentWps = new Set(selectedEditWaypoints);
                                                    let currentSelection = new Set(selectedEditNodes);
                                                    if (!currentWps.has(wpKey)) {
                                                        if (!e.shiftKey) { currentWps.clear(); currentSelection.clear(); }
                                                        currentWps.add(wpKey); setSelectedEditWaypoints(currentWps); setSelectedEditNodes(currentSelection);
                                                    }
                                                    const groupNodes = {}; currentSelection.forEach(id => { const p = manualPositions[id] || animPositions[id]; if (p) groupNodes[id] = { ...p }; });
                                                    const groupWps = {}; currentWps.forEach(key => { const [bId, idxStr] = key.split('-'); const idx = parseInt(idxStr); if (manualWaypoints[bId] && manualWaypoints[bId][idx]) groupWps[key] = { ...manualWaypoints[bId][idx] }; });
                                                    setDragInfo({ type: 'mixed', leaderType: 'waypoint', leaderId: wpKey, initialX: wp.x, initialY: wp.y, startX: svgPt.x, startY: svgPt.y, groupNodes, groupWps });
                                                }}
                                                onDoubleClick={(e) => {
                                                    if (!isEditMode) return;
                                                    if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
                                                    e.stopPropagation();
                                                    setManualWaypoints(prev => {
                                                        const currentWps = prev[b.id] && Array.isArray(prev[b.id]) ? [...prev[b.id]] : [];
                                                        currentWps.splice(wpIndex, 1);
                                                        return { ...prev, [b.id]: currentWps };
                                                    });
                                                }}
                                            />
                                        );
                                    })}
                                </g>
                            );
                        })}

                        {/* --- DESENHO DOS NÓS (BARRAS) --- */}
                        {allNodes.map(nodeId => {
                            const pos = manualPositions[nodeId] || animPositions[nodeId];
                            if (!pos) return null;
                            
                            const isSource = sources.includes(nodeId);
                            const color = getNodeColor(nodeId);
                            const isSelectedEdit = selectedEditNodes.has(nodeId);
                            
                            const isHighlighted = hoveredNodeId === nodeId || localHoveredNode === nodeId || isSelectedEdit || (!isEditMode && selectedElement?.id === nodeId);
                            
                            // BORDAS ORIGINAIS DO SEU GIT
                            const strokeColor = isHighlighted ? '#ffffff33' : (darkMode ? '#ffffff17' : '#00000017');
                            const strokeWidth = isHighlighted ? 3 : 2;
                            
                            // SOMBRA ORIGINAL DO SEU GIT
                            const shadowFilter = isHighlighted 
                                ? `drop-shadow(0 0 10px ${color})` 
                                : 'drop-shadow(0 2px 3px rgba(129, 129, 129, 0.3))';

                            return (
                                <g key={nodeId} style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: isEditMode ? 'grab' : 'pointer', transition: isRestoringLayout ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                                   onMouseDown={(e) => {
                                       if (!isEditMode) return; 
                                       e.stopPropagation(); wasDragged.current = false;
                                       if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
                                       const svgPt = getTransformedPoint(e.clientX, e.clientY);
                                       let currentSelection = new Set(selectedEditNodes);
                                       let currentWps = new Set(selectedEditWaypoints);
                                       if (!currentSelection.has(nodeId)) {
                                           if (!e.shiftKey) { currentSelection.clear(); currentWps.clear(); }
                                           currentSelection.add(nodeId);
                                           setSelectedEditNodes(currentSelection); setSelectedEditWaypoints(currentWps);
                                       }
                                       const groupNodes = {}; currentSelection.forEach(id => { const p = manualPositions[id] || animPositions[id]; if (p) groupNodes[id] = { ...p }; });
                                       const groupWps = {}; currentWps.forEach(key => { const [bId, idxStr] = key.split('-'); const idx = parseInt(idxStr); if (manualWaypoints[bId] && manualWaypoints[bId][idx]) groupWps[key] = { ...manualWaypoints[bId][idx] }; });
                                       setDragInfo({ type: 'mixed', leaderType: 'node', leaderId: nodeId, startX: svgPt.x, startY: svgPt.y, groupNodes, groupWps });
                                   }}
                                   onClick={(e) => { e.stopPropagation(); if (!isEditMode && !wasDragged.current) toggleFault(nodeId); }} 
                                   onMouseEnter={() => { if(!isMobile && !dragInfo) { setHoveredNodeId(nodeId); setLocalHoveredNode(nodeId); } }}
                                   onMouseLeave={() => { if(!isMobile && !dragInfo) { setHoveredNodeId(null); setLocalHoveredNode(null); } }}
                                >
                                    {isSource ? (
                                        <circle cx="0" cy="0" r={isHighlighted ? 26 : 22} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
                                    ) : (
                                        <g>
                                            <rect x="-20" y="-12" width="40" height="24" fill="transparent" />
                                            <rect x="-14" y="-8" width="28" height="16" rx="2" fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={{ filter: shadowFilter, transition: colorTransition }} />
                                        </g>
                                    )}
                                    {/* TEXTO BRANCO CLÁSSICO DO GIT */}
                                    <text x="0" y="0" textAnchor="middle" dominantBaseline="central" fill="white" fontSize={isSource ? "14px" : "10px"} fontWeight="bold" pointerEvents="none" className="node-label" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{nodeId}</text>
                                    
                                    {showLabels && !isSource && SYSTEM_DATA.loads[nodeId] && (<text x="0" y="22" textAnchor="middle" fill="gray" fontSize="9px" pointerEvents="none">{(SYSTEM_DATA.loads[nodeId].p / 1000).toFixed(1)} MW</text>)}
                                </g>
                            );
                        })}

                        {selectionBox && (
                            <rect x={Math.min(selectionBox.x1, selectionBox.x2)} y={Math.min(selectionBox.y1, selectionBox.y2)} width={Math.abs(selectionBox.x2 - selectionBox.x1)} height={Math.abs(selectionBox.y2 - selectionBox.y1)} fill="rgba(41, 98, 255, 0.1)" stroke="#2962ff" strokeWidth="2" strokeDasharray="5,5" pointerEvents="none" />
                        )}

                        {!isMobile && !isPanning.current && !dragInfo && !isEditMode && !selectionBox && (
                            <>
                                {isHoveringSVG && localHoveredLine !== null && hoveredLineData && hoveredBranch && hoveredBranch.state === 1 && (() => {
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
                                    const fillColor = hoveredLineData.percentage >= 100 ? '#d32f2f' : (hoveredLineData.percentage > 80 ? '#fbc02d' : '#4caf50');
                                    return (
                                        <g transform={`translate(${midX + 15}, ${midY + 15})`} pointerEvents="none" className="svg-tooltip">
                                            <rect x="0" y="0" width="160" height="95" rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                                            <text x="12" y="20" fill="#00bcd4" fontSize="12" fontWeight="bold" fontFamily="monospace">Fluxo: {flowFrom} ➔ {flowTo}</text>
                                            <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                                            <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Ativa):</text>
                                            <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayP.toFixed(2)} MW</text>
                                            <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reativa):</text>
                                            <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{displayQ.toFixed(2)} MVAr</text>
                                            <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">Corrente:</text>
                                            <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLineData.current.toFixed(1)} A</text>
                                            <rect x="15" y="82" width={barWidth} height="4" rx="2" fill="#333" />
                                            <rect x="15" y="82" width={fillWidth} height="4" rx="2" fill={fillColor} />
                                        </g>
                                    );
                                })()}

                                {isHoveringSVG && localHoveredNode !== null && hoveredNodeInfo && localHoveredLine === null && (() => {
                                    const pos = manualPositions[localHoveredNode] || animPositions[localHoveredNode];
                                    if (!pos) return null;
                                    
                                    const isSource = sources.includes(localHoveredNode);
                                    const hoveredLoad = SYSTEM_DATA.loads ? SYSTEM_DATA.loads[localHoveredNode] : null;
                                    const h = isSource ? 75 : 115;

                                    let content = null;

                                    if (isSource) {
                                        let totalP = 0;
                                        let totalQ = 0;
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

                                        content = (
                                            <>
                                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Total P:</text>
                                                <text x="148" y="78" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad?.p ? hoveredLoad.p.toFixed(0) : 0} kW</text>
                                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Total Q:</text>
                                                <text x="148" y="98" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad?.q ? hoveredLoad.q.toFixed(0) : 0} kVAr</text>
                                            </>
                                        );
                                    } else {
                                        content = (
                                            <>
                                                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">Tensão:</text>
                                                <text x="148" y="44" fill={hoveredNodeInfo.v < 0.93 ? '#ff5252' : (hoveredNodeInfo.v < 0.95 ? '#fbc02d' : '#fff')} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{(hoveredNodeInfo.v || 0).toFixed(3)} pu</text>
                                                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Ângulo:</text>
                                                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{(hoveredNodeInfo.angle || 0).toFixed(2)}°</text>
                                                {hoveredLoad && (
                                                    <>
                                                        <line x1="10" y1="68" x2="150" y2="68" stroke="#555" strokeWidth="1" strokeDasharray="3,3" />
                                                        <text x="12" y="84" fill="#aaa" fontSize="11" fontFamily="monospace">Carga P:</text>
                                                        <text x="148" y="84" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.p.toFixed(0)} kW</text>
                                                        <text x="12" y="98" fill="#aaa" fontSize="11" fontFamily="monospace">Carga Q:</text>
                                                        <text x="148" y="98" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{hoveredLoad.q.toFixed(0)} kVAr</text>
                                                    </>
                                                )}
                                            </>
                                        );
                                    }

                                    return (
                                        <g transform={`translate(${pos.x + 25}, ${pos.y + 25})`} pointerEvents="none" className="svg-tooltip">
                                            <rect x="0" y="0" width="160" height={h} rx="6" fill="rgba(20, 20, 20, 0.95)" stroke="#444" strokeWidth="1" />
                                            <text x="12" y="20" fill={isSource ? '#4caf50' : '#ff9800'} fontSize="12" fontWeight="bold" fontFamily="monospace">{isSource ? `Subestação ${localHoveredNode}` : `Barra ${localHoveredNode}`}</text>
                                            <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />
                                            {content}
                                        </g>
                                    );
                                })()}
                            </>
                        )}
                    </g>
                </svg>

                {children}
            </div>
        </div>
    );
}