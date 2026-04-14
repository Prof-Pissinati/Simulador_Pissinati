import fs from 'fs';
import { SYSTEM_DATA_SHUNT } from './src/data/systemData54.js';
// 👇 Agora nós importamos as posições reais dos seus postes!
import { GEO_POSITIONS } from './src/data/systemDataGeo.js'; 

console.log("Iniciando o Matcher Geográfico...");

const caminhoArquivo = './src/data/systemRoutes.json';
const rawData = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf8'));

const arquivoOrganizado = { routes: {}, waypoints: {} };

// Função matemática para calcular a distância entre dois pontos no mapa
function calcDist(lat1, lng1, lat2, lng2) {
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2));
}

let rotasSalvas = 0;

// Descobre onde as rotas bagunçadas estão no arquivo
const rotasParaProcessar = rawData.routes && Object.keys(rawData.routes).length > 0 && !Object.keys(rawData.routes).some(k => k.includes('-')) 
    ? rawData.routes 
    : rawData;

// Varre todas as rotas desenhadas
Object.keys(rotasParaProcessar).forEach(key => {
    if (key === 'routes' || key === 'waypoints') return;
    
    const route = rotasParaProcessar[key];
    if (!route || route.length < 2) return;

    // Pega a exata primeira e última coordenada que o OSRM traçou
    const start = route[0]; 
    const end = route[route.length - 1]; 

    let bestMatch = null;
    let minDistance = Infinity;

    // Procura em TODAS as linhas do seu sistema qual encaixa perfeitamente
    SYSTEM_DATA_SHUNT.branches.forEach(branch => {
        const p1 = GEO_POSITIONS[branch.from];
        const p2 = GEO_POSITIONS[branch.to];

        if (p1 && p2) {
            // Testa se a rota foi traçada do 'from' pro 'to'
            const distDirect = calcDist(start[0], start[1], p1.lat, p1.lng) + calcDist(end[0], end[1], p2.lat, p2.lng);
            // Testa se a rota foi traçada do 'to' pro 'from' (Invertido)
            const distReverse = calcDist(start[0], start[1], p2.lat, p2.lng) + calcDist(end[0], end[1], p1.lat, p1.lng);

            const bestLocalDist = Math.min(distDirect, distReverse);

            // Salva a que tiver a menor distância
            if (bestLocalDist < minDistance) {
                minDistance = bestLocalDist;
                bestMatch = branch;
            }
        }
    });

    // Se o erro geográfico for mínimo, achamos a dona da rota!
    if (bestMatch && minDistance < 0.01) {
        const nomeDaRota = `${bestMatch.from}-${bestMatch.to}`;
        arquivoOrganizado.routes[nomeDaRota] = route;
        rotasSalvas++;
        console.log(`✅ Rota oculta ${key} -> pertence à Linha ${nomeDaRota}`);
    } else {
        console.log(`❌ Rota ${key} descartada. Muito longe de qualquer poste conhecido.`);
    }
});

// Transforma em texto e aplica a sua formatação compacta de colchetes
let jsonString = JSON.stringify(arquivoOrganizado, null, 2);
jsonString = jsonString.replace(/\[\s+([-0-9.]+),\s+([-0-9.]+)\s+\]/g, '[$1, $2]');

fs.writeFileSync(caminhoArquivo, jsonString);
console.log(`\n🎉 Fim! ${rotasSalvas} rotas foram casadas geograficamente com sucesso!`);