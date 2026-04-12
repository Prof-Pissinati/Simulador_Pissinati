// src/utils/geoRouting.js

export async function fetchStreetRoute(startLat, startLng, endLat, endLng) {
    // OSRM usa o formato: {longitude},{latitude}
    const start = `${startLng},${startLat}`;
    const end = `${endLng},${endLat}`;
    
    // Usamos o perfil "driving" (carro) porque as redes de distribuição seguem as vias carroçáveis
    const url = `https://router.project-osrm.org/route/v1/driving/${start};${end}?geometries=geojson&overview=full`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Falha na API OSRM");
        
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
            // O OSRM retorna um GeoJSON onde as coordenadas são [lng, lat].
            // O Leaflet exige [lat, lng]. Precisamos inverter o array!
            const coordinates = data.routes[0].geometry.coordinates;
            return coordinates.map(coord => [coord[1], coord[0]]);
        }
        return null;
    } catch (error) {
        console.warn("Erro ao traçar rota real. Usando linha reta como fallback.", error);
        return null;
    }
}