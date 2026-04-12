import React, { useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline } from 'react-leaflet';
import { GEO_POSITIONS } from '../data/systemDataGeo'; // 👈 Puxando do novo arquivo!
import { fetchStreetRoute } from '../utils/geoRouting';


export default function MapArea({ 
    darkMode, branches, sources, feedersList, getNodeColor, 
    getEdgeColor, setSelectedElement, toggleSwitch, toggleFault,
    nodeData, lineCurrents, children
}) {
    const center = [-20.4319, -51.3425];
    const mapTileUrl = darkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    // Estado que guarda as rotas desenhadas pelas ruas (Dicionário: { branchId: [[lat,lng], ...] })
    const [routedPaths, setRoutedPaths] = useState({});
    const [isRouting, setIsRouting] = useState(false);
    const [routeProgress, setRouteProgress] = useState(0);

    // Função que escaneia o sistema e pede as rotas das ruas uma a uma (para não derrubar a API)
    const handleCalculateRealRoutes = async () => {
        setIsRouting(true);
        setRouteProgress(0);
        const newRoutes = { ...routedPaths };

        for (let i = 0; i < branches.length; i++) {
            const branch = branches[i];
            // Pula se já calculou essa rota antes
            if (newRoutes[branch.id]) continue; 

            const p1 = GEO_POSITIONS[branch.from];
            const p2 = GEO_POSITIONS[branch.to];
            
            if (p1 && p2) {
                const route = await fetchStreetRoute(p1.lat, p1.lng, p2.lat, p2.lng);
                if (route) {
                    newRoutes[branch.id] = route;
                    // Atualiza a tela em tempo real a cada rua calculada!
                    setRoutedPaths({ ...newRoutes }); 
                }
            }
            setRouteProgress(Math.round(((i + 1) / branches.length) * 100));
            // Espera 300ms entre cada requisição para respeitar o limite do servidor público
            await new Promise(r => setTimeout(r, 300)); 
        }
        setIsRouting(false);
    };

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
            
            {/* PAINEL DE ROTEAMENTO FLUTUANTE */}
            <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: darkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)', padding: '10px 20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <button 
                    onClick={handleCalculateRealRoutes} disabled={isRouting}
                    style={{ background: isRouting ? '#555' : '#00bcd4', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: isRouting ? 'wait' : 'pointer', transition: 'background 0.3s' }}
                >
                    {isRouting ? `🛰️ Mapeando Ruas (${routeProgress}%)...` : '🛣️ Traçar Roteamento Real (OSRM)'}
                </button>
                {isRouting && (
                    <div style={{ width: '100%', height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${routeProgress}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                    </div>
                )}
            </div>

            <MapContainer center={center} zoom={15} style={{ width: '100%', height: '100%', background: darkMode ? '#121212' : '#f0f2f5' }}>
                <TileLayer url={mapTileUrl} attribution='&copy; OpenStreetMap' />

                {/* 1. DESENHO DAS LINHAS (BRANCHES) */}
                {branches.map(branch => {
                    const p1 = GEO_POSITIONS[branch.from];
                    const p2 = GEO_POSITIONS[branch.to];
                    if (!p1 || !p2) return null;

                    const color = getEdgeColor(branch);
                    const lineData = lineCurrents[branch.id];
                    const percentage = lineData?.percentage || 0;
                    
                    // Se o roteamento já foi feito para essa linha, usa a curva da rua. Senão, reta!
                    const polylinePositions = routedPaths[branch.id] || [[p1.lat, p1.lng], [p2.lat, p2.lng]];
                    
                    return (
                        <Polyline 
                            key={`branch-${branch.id}`}
                            positions={polylinePositions}
                            color={color}
                            weight={routedPaths[branch.id] ? 4 : 5} // Linhas roteadas podem ser ligeiramente mais finas para elegância
                            opacity={branch.state === 1 ? 0.9 : 0.3}
                            dashArray={branch.state === 0 ? "10, 10" : null} // Linhas abertas ficam tracejadas no mapa!
                            eventHandlers={{
                                click: () => { 
                                    setSelectedElement({ type: 'edge', data: branch }); 
                                    if (branch.hasSwitch) toggleSwitch(branch.id); 
                                }
                            }}
                        >
                            <Tooltip sticky>
                                <strong>Linha {branch.from}-{branch.to}</strong><br/>
                                {branch.state === 1 ? `Carregamento: ${percentage.toFixed(1)}%` : 'ABERTA'}
                            </Tooltip>
                        </Polyline>
                    );
                })}

                {/* 2. DESENHO DAS BARRAS (NODES) */}
                {Object.keys(GEO_POSITIONS).map(nodeId => {
                    const pos = GEO_POSITIONS[nodeId];
                    const numId = parseInt(nodeId);
                    const isSource = sources.includes(numId) || feedersList.includes(numId);
                    const color = getNodeColor(numId);
                    const v_pu = nodeData[nodeId]?.v || 1.0;

                    return (
                        <CircleMarker 
                            key={`node-${nodeId}`}
                            center={[pos.lat, pos.lng]}
                            radius={isSource ? 9 : 5} // Bolinhas ligeiramente menores para não poluir o mapa real
                            fillColor={color}
                            color={darkMode ? '#121212' : '#ffffff'} // Borda que combina com o mapa
                            weight={2}
                            fillOpacity={1}
                            eventHandlers={{
                                click: () => { 
                                    setSelectedElement({ type: 'node', id: numId }); 
                                    toggleFault(numId); 
                                }
                            }}
                        >
                            <Tooltip direction="top" offset={[0, -8]}>
                                <div style={{ textAlign: 'center' }}>
                                    <strong style={{ color: color }}>{isSource ? 'FONTE' : 'BARRA'} {nodeId}</strong><br/>
                                    {v_pu.toFixed(3)} pu
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    );
                })}
                
            </MapContainer>
            {/* Permite que a Legenda do App.jsx seja injetada aqui dentro */}
            {children}
        </div>
    );
}
