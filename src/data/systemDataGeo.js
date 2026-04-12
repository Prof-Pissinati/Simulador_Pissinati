// src/data/systemDataGeo.js
import { SYSTEM_DATA_SHUNT } from './systemData54';

export const GEO_POSITIONS = {
    // A USINA: Posicionada na barragem (coordenadas reais da Usina de Ilha Solteira)
    '1000': { lat: -20.3831, lng: -51.3655 }, 
    
    // LINHA DE TRANSMISSÃO: Ponto de entrada na cidade (Subestação de Transmissão)
    '1010': { lat: -20.4205, lng: -51.3452 },

    // ALIMENTADORES: Espalhados pelas avenidas principais (Av. Brasil, Av. Atlântica)
    '101':  { lat: -20.4248, lng: -51.3415 }, // Próximo à entrada (Av. Brasil Norte)
    '102':  { lat: -20.4312, lng: -51.3485 }, // Lado Oeste (Jardim das Oliveiras)
    '104':  { lat: -20.4385, lng: -51.3392 }, // Lado Sul (Av. Brasil Sul)

    // BARRAS ESTRATÉGICAS (Exemplos posicionados em esquinas reais)
    '1':    { lat: -20.4265, lng: -51.3400 },
    '2':    { lat: -20.4285, lng: -51.3435 },
    '3':    { lat: -20.4305, lng: -51.3465 },
    '24':   { lat: -20.4330, lng: -51.3425 },
    '50':   { lat: -20.4360, lng: -51.3385 }
};

const allNodes = Array.from(new Set(SYSTEM_DATA_SHUNT.branches.flatMap(b => [b.from, b.to])));

// FALLBACK: Se uma barra não tiver posição manual, ela é gerada perto do centro
allNodes.forEach((nodeId) => {
    if (!GEO_POSITIONS[nodeId]) {
        // Gera um pequeno deslocamento aleatório para não sobrepor tudo no centro
        const offsetLat = (Math.random() - 0.5) * 0.015;
        const offsetLng = (Math.random() - 0.5) * 0.015;
        GEO_POSITIONS[nodeId] = {
            lat: -20.4319 + offsetLat,
            lng: -51.3425 + offsetLng
        };
    }
});

export const SYSTEM_DATA_GEO = {
    ...SYSTEM_DATA_SHUNT,
    geoPositions: GEO_POSITIONS
};