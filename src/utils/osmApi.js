// src/utils/osmApi.js

export async function fetchOSMPowerData(lat = -20.4319, lng = -51.3425, radius = 4000) { 
    // Aumentamos o raio para 4000m (4km) para tentar pescar a Usina na represa
    
    // Adicionamos 'tower' e 'relation' para garantir que pegamos as linhas de transmissão
    const query = `
        [out:json][timeout:25];
        (
            node["power"="plant"](around:${radius}, ${lat}, ${lng});
            way["power"="plant"](around:${radius}, ${lat}, ${lng});
            relation["power"="plant"](around:${radius}, ${lat}, ${lng});
            
            node["power"="generator"](around:${radius}, ${lat}, ${lng});
            way["power"="generator"](around:${radius}, ${lat}, ${lng});
            
            node["power"="substation"](around:${radius}, ${lat}, ${lng});
            way["power"="substation"](around:${radius}, ${lat}, ${lng});
            
            node["power"="tower"](around:${radius}, ${lat}, ${lng});
            node["power"="pole"](around:${radius}, ${lat}, ${lng});
        );
        out center;
    `;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
        console.log("📡 Buscando dados reais no OpenStreetMap...");
        const response = await fetch(url);
        
        // 👇 BLINDAGEM: Se o servidor estiver sobrecarregado (504, 429), saímos graciosamente 👇
        if (!response.ok) {
            console.warn(`Servidor OSM congestionado (Erro ${response.status}). Tente novamente mais tarde.`);
            return { plants: [], substations: [], poles: [] }; 
        }

        const data = await response.json();
        const infra = { plants: [], substations: [], poles: [] };

        // Filtra e organiza o que a API devolveu
        data.elements.forEach(el => {
            const elLat = el.lat || el.center?.lat;
            const elLng = el.lon || el.center?.lon;
            const powerType = el.tags?.power;

            if (powerType === 'generator' || powerType === 'plant') {
                infra.plants.push({ id: el.id, lat: elLat, lng: elLng, name: el.tags?.name || 'Usina/Gerador' });
            } else if (powerType === 'substation') {
                infra.substations.push({ id: el.id, lat: elLat, lng: elLng, name: el.tags?.name || 'Subestação' });
            } else if (powerType === 'pole' || powerType === 'tower') {
                // Agrupamos postes e torres
                infra.poles.push({ id: el.id, lat: elLat, lng: elLng, type: powerType });
            }
        });

        console.log(`✅ Encontrados: ${infra.plants.length} usinas, ${infra.substations.length} subestações, ${infra.poles.length} postes/torres.`);
        return infra;

    } catch (error) {
        // Se a internet cair ou der erro de sintaxe, o simulador não trava
        console.error("❌ Falha na conexão com o Overpass API:", error);
        return { plants: [], substations: [], poles: [] };
    }
}