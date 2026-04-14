import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Tooltip, Polyline, Marker } from 'react-leaflet';
import L from 'leaflet';
import { GEO_POSITIONS as INITIAL_GEO } from '../data/systemDataGeo';
import { fetchStreetRoute } from '../utils/geoRouting';
import systemRoutesData from '../data/systemRoutes.json';

export default function MapArea({ 
    darkMode, branches, sources, feedersList, getNodeColor, 
    getEdgeColor, setSelectedElement, toggleSwitch, toggleFault,
    nodeData, lineCurrents, systemShunts, children, isEditMode,
    selectedElement 
}) {
    const center = [-20.4319, -51.3425];
    const mapTileUrl = darkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const [geoPositions, setGeoPositions] = useState(INITIAL_GEO);
    const [routedPaths, setRoutedPaths] = useState(systemRoutesData?.routes || {});
    const [manualWaypoints, setManualWaypoints] = useState(systemRoutesData?.waypoints || {});
    const [straightSegments, setStraightSegments] = useState(systemRoutesData?.straightSegments || {});
    
    const [isRouting, setIsRouting] = useState(false);
    const [routeProgress, setRouteProgress] = useState(0);
    const [recalculatingBranchId, setRecalculatingBranchId] = useState(null);
    const fileInputRef = useRef(null);

    const getBranchId = (branch) => `${branch.from}-${branch.to}`;

    const getClickedSegmentIndex = (map, latlng, points) => {
        const clickPt = map.latLngToLayerPoint(latlng);
        const pts = points.map(p => map.latLngToLayerPoint(L.latLng(p.lat, p.lng)));
        let minIdx = 0; let minD = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = L.LineUtil.pointToSegmentDistance(clickPt, pts[i], pts[i+1]);
            if (d < minD) { minD = d; minIdx = i; }
        }
        return minIdx;
    };

    // 👇 Correção: A função agora recebe a array exata de trechos retos da linha
    const calculateBranchPath = async (branchObj, currentWps, branchStrSegs) => {
        const p1 = geoPositions[branchObj.from];
        const p2 = geoPositions[branchObj.to];
        if (!p1 || !p2) return null;
        
        const points = [p1, ...currentWps, p2];
        let fullPath = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i+1];
            
            if (branchStrSegs.includes(i)) {
                if (i === 0) fullPath.push([start.lat, start.lng]);
                fullPath.push([end.lat, end.lng]);
            } else {
                const route = await fetchStreetRoute([start, end]);
                if (route && route.length > 0) {
                    if (i > 0 && fullPath.length > 0) fullPath.push(...route.slice(1));
                    else fullPath.push(...route);
                } else {
                    if (i === 0) fullPath.push([start.lat, start.lng]);
                    fullPath.push([end.lat, end.lng]);
                }
            }
        }
        return fullPath;
    };

    // 👇 Correção do Assíncrono: Agora podemos forçar as variáveis para não ter delay
    const forceRecalculateBranch = async (branchObj, overrideWps = null, overrideStrSegs = null) => {
        const bId = getBranchId(branchObj);
        setRecalculatingBranchId(bId);
        
        const wps = overrideWps || manualWaypoints[bId] || [];
        const strSegs = overrideStrSegs || straightSegments[bId] || [];
        
        const path = await calculateBranchPath(branchObj, wps, strSegs);
        if (path) setRoutedPaths(prev => ({ ...prev, [bId]: path }));
        
        setRecalculatingBranchId(null);
    };

    const handleImportRoutes = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const routes = data.routes || data; 
                if (Object.keys(routes).length === 0) { alert("❌ Arquivo vazio."); return; }
                
                setRoutedPaths(routes);
                setManualWaypoints(data.waypoints || {});
                setStraightSegments(data.straightSegments || {});
                alert(`✅ Sucesso! Rotas importadas.`);
            } catch (err) { alert("❌ Arquivo JSON inválido."); }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    };

    const handleExportRoutes = () => {
        const exportData = { routes: routedPaths, waypoints: manualWaypoints, straightSegments };
        let jsonString = JSON.stringify(exportData, null, 2);
        jsonString = jsonString.replace(/\[\s+([-0-9.]+),\s+([-0-9.]+)\s+\]/g, '[$1, $2]');
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "systemRoutes.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleAddWaypoint = (e, branch) => {
        const bId = getBranchId(branch);
        const map = e.target._map;
        const p1 = geoPositions[branch.from];
        const p2 = geoPositions[branch.to];
        const wps = manualWaypoints[bId] || [];
        const points = [p1, ...wps, p2];
        
        const segIdx = getClickedSegmentIndex(map, e.latlng, points);
        const newWp = { id: Date.now(), lat: e.latlng.lat, lng: e.latlng.lng };
        
        const newWps = [...wps];
        newWps.splice(segIdx, 0, newWp);
        
        const oldStrSegs = straightSegments[bId] || [];
        const newStrSegs = [];
        for (let s of oldStrSegs) {
            if (s < segIdx) newStrSegs.push(s);
            if (s === segIdx) { newStrSegs.push(s); newStrSegs.push(s+1); } 
            if (s > segIdx) newStrSegs.push(s+1);
        }
        
        setStraightSegments(prev => ({ ...prev, [bId]: newStrSegs }));
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const handleRemoveWaypoint = (branchObj, wpId) => {
        const bId = getBranchId(branchObj);
        const wps = manualWaypoints[bId] || [];
        const wpIndex = wps.findIndex(w => w.id === wpId);
        if (wpIndex === -1) return;
        
        const newWps = wps.filter(w => w.id !== wpId);
        const oldStrSegs = straightSegments[bId] || [];
        const newStrSegs = [];
        const seg1Straight = oldStrSegs.includes(wpIndex);
        const seg2Straight = oldStrSegs.includes(wpIndex + 1);
        
        for (let s of oldStrSegs) {
            if (s < wpIndex) newStrSegs.push(s);
            if (s > wpIndex + 1) newStrSegs.push(s - 1);
        }
        if (seg1Straight && seg2Straight) newStrSegs.push(wpIndex);
        
        setStraightSegments(prev => ({ ...prev, [bId]: [...new Set(newStrSegs)] }));
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const handleUpdateWaypoint = (branchObj, wpId, newLatLng) => {
        const bId = getBranchId(branchObj);
        const newWps = (manualWaypoints[bId] || []).map(w => w.id === wpId ? { ...w, lat: newLatLng.lat, lng: newLatLng.lng } : w);
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const createCustomIcon = (nodeId, color, type, v_pu) => {
        let shape = '';
        const strokeColor = darkMode ? '#121212' : '#ffffff';
        const isBadVoltage = v_pu < 0.93 || v_pu > 1.05;
        const glowStyle = isBadVoltage ? `filter="drop-shadow(0px 0px 6px red)"` : '';

        if (type === 'sub') shape = `<circle cx="10" cy="10" r="8" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;
        else if (type === 'feeder') shape = `<polygon points="10,1 18,5 18,15 10,19 2,15 2,5" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;
        else if (type === 'shunt') shape = `<polygon points="10,2 18,10 10,18 2,10" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;
        else shape = `<rect x="3" y="6" width="14" height="8" rx="1.5" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;

        return L.divIcon({ className: 'custom-node', html: `<svg width="20" height="20" viewBox="0 0 20 20" style="overflow: visible;">${shape}</svg>`, iconSize: [20, 20], iconAnchor: [10, 10] });
    };

    const waypointIcon = L.divIcon({ className: 'custom-waypoint', html: `<div style="background-color: #ff9800; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
            
            <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: darkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)', padding: '10px 20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', gap: '10px', backdropFilter: 'blur(5px)' }}>
                <button onClick={() => fileInputRef.current.click()} style={{ background: '#2196f3', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>📥 Importar systemRoutes.json</button>
                <input type="file" ref={fileInputRef} onChange={handleImportRoutes} style={{ display: 'none' }} accept=".json" />
                
                {isEditMode && (
                    <>
                        <button onClick={handleExportRoutes} style={{ background: '#ff9800', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>💾 Exportar Rotas</button>
                        <button onClick={() => { const formattedPositions = "{\n" + Object.keys(geoPositions).sort((a,b)=>parseInt(a)-parseInt(b)).map(k => `    "${k}": { "lat": ${geoPositions[k].lat}, "lng": ${geoPositions[k].lng} }`).join(",\n") + "\n}"; console.log(formattedPositions); alert("Coordenadas no Console! Aperte F12 para copiar."); }} style={{ background: '#4caf50', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>💾 Exportar Posições</button>
                    </>
                )}
            </div>

            {recalculatingBranchId !== null && (
                <div style={{ position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#e91e63', color: 'white', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 10px rgba(233,30,99,0.4)', animation: 'pulse 1.5s infinite' }}>🛰️ Roteando trecho...</div>
            )}

            <MapContainer center={center} zoom={15} style={{ width: '100%', height: '100%', background: darkMode ? '#121212' : '#f0f2f5' }}>
                <TileLayer url={mapTileUrl} attribution='&copy; OSM' />

                {branches.map(branch => {
                    const bId = getBranchId(branch);
                    const p1 = geoPositions[branch.from];
                    const p2 = geoPositions[branch.to];
                    if (!p1 || !p2) return null;

                    const color = getEdgeColor(branch);
                    const isClosed = branch.state === 1;
                    const lineData = lineCurrents[bId] || lineCurrents[branch.id]; 
                    
                    const wps = manualWaypoints[bId] || [];
                    const fallbackPath = [[p1.lat, p1.lng], ...wps.map(w => [w.lat, w.lng]), [p2.lat, p2.lng]];
                    const path = routedPaths[bId] || fallbackPath;
                    
                    const isSelected = selectedElement?.type === 'edge' && (selectedElement?.data?.id === branch.id || selectedElement?.data?.from === branch.from);
                    const isRecalculating = recalculatingBranchId === bId;
                    
                    const lineColor = isRecalculating ? '#e91e63' : (isSelected ? '#fff' : color);
                    const lineWeight = isSelected ? 6 : (routedPaths[bId] ? 4 : 5);
                    const lineOpacity = isRecalculating ? 0.5 : (isClosed ? 0.9 : 0.4);

                    return (
                        <Polyline 
                            key={`branch-${bId}`} positions={path} color={lineColor} weight={lineWeight} opacity={lineOpacity} dashArray={isClosed ? null : "10, 10"}
                            eventHandlers={{
                                click: async (e) => { 
                                    if (isEditMode) {
                                        const map = e.target._map;
                                        const points = [p1, ...wps, p2];
                                        const segIdx = getClickedSegmentIndex(map, e.latlng, points);
                                        const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                                        
                                        let newBranchStrSegs = straightSegments[bId] || [];
                                        
                                        if (isCtrl) {
                                            console.log(`🕹️ DEBUG: CTRL pressionado na linha ${bId}. Transformando trecho ${segIdx} em RETA.`);
                                            if (!newBranchStrSegs.includes(segIdx)) {
                                                newBranchStrSegs = [...newBranchStrSegs, segIdx];
                                            } else {
                                                console.log(`⚠️ DEBUG: O trecho ${segIdx} já era uma reta. O clique foi ignorado para evitar loops.`);
                                            }
                                        } else {
                                            console.log(`🖱️ DEBUG: Clique Normal na linha ${bId}. Buscando RUA no trecho ${segIdx}.`);
                                            if (newBranchStrSegs.includes(segIdx)) {
                                                newBranchStrSegs = newBranchStrSegs.filter(i => i !== segIdx);
                                            }
                                        }
                                        
                                        // Salva o novo estado das retas
                                        setStraightSegments(prev => ({ ...prev, [bId]: newBranchStrSegs }));
                                        
                                        // Força o recalculo imediato usando as variáveis fresquinhas!
                                        await forceRecalculateBranch(branch, wps, newBranchStrSegs);

                                    } else if (isSelected && branch.hasSwitch) toggleSwitch(branch.id || bId); 
                                    else setSelectedElement({ type: 'edge', data: branch }); 
                                },
                                contextmenu: (e) => handleAddWaypoint(e, branch) 
                            }}
                        >
                            <Tooltip direction="center" offset={[0,0]}>
                                <div style={{ textAlign: 'center' }}>
                                    <strong>Linha {branch.from}-{branch.to}</strong><br/>
                                    {isClosed ? `Carga: ${(lineData?.percentage || 0).toFixed(1)}%` : 'ABERTA'}<br/>
                                    {isEditMode && <span style={{fontSize: '10px', color: '#00bcd4'}}><strong>Ctrl+Click:</strong> Linha Reta NESTE trecho<br/><strong>Click Simples:</strong> Rota de Rua NESTE trecho</span>}
                                </div>
                            </Tooltip>
                        </Polyline>
                    );
                })}

                {isEditMode && Object.keys(manualWaypoints).map(bId => {
                    const branchObj = branches.find(b => getBranchId(b) === bId);
                    return manualWaypoints[bId].map(wp => (
                        <Marker 
                            key={`wp-${wp.id}`} position={[wp.lat, wp.lng]} draggable={true} icon={waypointIcon}
                            eventHandlers={{ 
                                dragend: (e) => handleUpdateWaypoint(branchObj, wp.id, e.target.getLatLng()),
                                click: () => handleRemoveWaypoint(branchObj, wp.id) 
                            }}
                        ><Tooltip direction="top">Arraste para mover<br/>Clique p/ apagar</Tooltip></Marker>
                    ));
                })}

                {Object.keys(geoPositions).map(nodeId => {
                    const pos = geoPositions[nodeId];
                    const numId = parseInt(nodeId);
                    const v_pu = nodeData[nodeId]?.v || 1.0;
                    const isSelected = selectedElement?.type === 'node' && selectedElement?.id === numId;
                    const color = isSelected ? '#ff9800' : getNodeColor(numId);
                    
                    const isSource = sources.includes(numId);
                    const isFeeder = feedersList.includes(numId);
                    const hasShunt = systemShunts && systemShunts[numId];
                    const type = isSource ? 'sub' : (isFeeder ? 'feeder' : (hasShunt ? 'shunt' : 'load'));

                    return (
                        <Marker 
                            key={`node-${nodeId}`} position={[pos.lat, pos.lng]} draggable={isEditMode} icon={createCustomIcon(nodeId, color, type, v_pu)}
                            eventHandlers={{ 
                                dragend: (e) => setGeoPositions(prev => ({ ...prev, [nodeId]: { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng } })),
                                click: async (e) => { 
                                    if (isEditMode) {
                                        const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                                        if (isCtrl) {
                                            console.log(`⚡ DEBUG: Recalculando todas as conexões da Barra ${numId}...`);
                                            const connectedBranches = branches.filter(b => b.from === numId || b.to === numId);
                                            for (const b of connectedBranches) {
                                                await forceRecalculateBranch(b);
                                            }
                                        }
                                        return;
                                    }
                                    if (isSelected) toggleFault(numId); 
                                    else setSelectedElement({ type: 'node', id: numId }); 
                                }
                            }}
                        >
                            <Tooltip direction="top" offset={[0, -8]}>
                                <div style={{ textAlign: 'center' }}>
                                    <strong style={{ color: color }}>{isSource ? 'SUB' : (isFeeder ? 'ALIM' : 'BARRA')} {nodeId}</strong><br/>
                                    {v_pu.toFixed(3)} pu
                                    {isEditMode && <><br/><span style={{fontSize: '9px', color: '#00bcd4'}}>Ctrl+Click: Recalcular Ruas nas Linhas Conectadas</span></>}
                                </div>
                            </Tooltip>
                        </Marker>
                    );
                })}
            </MapContainer>
            {children}
        </div>
    );
}