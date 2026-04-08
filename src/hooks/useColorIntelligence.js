import { useMemo, useCallback } from 'react';
import { THEME } from '../utils/theme';

// 1. PALETA FIXA E SEGURA (Sem vermelhos de falta e sem amarelos de loop)
// Ordem: Azul, Verde, Laranja, Roxo, Ciano, Rosa, Verde-Limão, Índigo, Verde-Água, Laranja-Escuro
export const PALETTE_HUES = [210, 120, 30, 280, 180, 320, 85, 240, 150, 15];

// 2. FUNÇÃO QUE DISTRIBUI AS CORES POR ORDEM DE CRESCIMENTO
export const getBaseColor = (id, allRoots, darkMode) => {
    const sortedRoots = [...allRoots].sort((a, b) => a - b);
    let idx = sortedRoots.indexOf(id);
    if (idx === -1) idx = 0; // Fallback de segurança
    
    const h = PALETTE_HUES[idx % PALETTE_HUES.length];
    return `hsl(${h}, 95%, ${darkMode ? 50 : 35}%)`;
};

export function useColorIntelligence({ branches, faultNodes, activeSources, nodeFeeds, lineCurrents, darkMode, feedersList }) {
    
    const { nodeZones, edgeZones, loopNodes, loopEdges, colorRoots } = useMemo(() => {
        const nZ = {}; const eZ = {};
        const loopN = new Set(); const loopE = new Set();
        const roots = [...activeSources, ...feedersList];
        const tracker = {}; 
        
        let queue = [...roots];
        roots.forEach(r => {
            tracker[r] = new Set([r]);
            nZ[r] = r;
        });
        
        while(queue.length > 0) {
            const curr = queue.shift();
            const zonesToPropagate = feedersList.includes(curr) ? new Set([curr]) : tracker[curr];

            branches.forEach(b => {
                if (b.state === 1 && !faultNodes.has(b.from) && !faultNodes.has(b.to)) {
                    const neighbor = (b.from === curr) ? b.to : ((b.to === curr) ? b.from : null);
                    if (neighbor !== null) {
                        if (activeSources.includes(neighbor)) return;
                        if (!tracker[neighbor]) {
                            tracker[neighbor] = new Set(zonesToPropagate);
                            nZ[neighbor] = Array.from(zonesToPropagate)[0];
                            eZ[b.id] = nZ[neighbor];
                            queue.push(neighbor);
                        } else {
                            let isNewConflict = false;
                            zonesToPropagate.forEach(z => {
                                if (!tracker[neighbor].has(z)) {
                                    tracker[neighbor].add(z);
                                    isNewConflict = true;
                                }
                            });
                            if (isNewConflict) queue.push(neighbor);
                        }
                    }
                }
            });
        }
        
        // 👇 A NOVA INTELIGÊNCIA DE LOOPS POR PATENTE 👇
        Object.keys(tracker).forEach(nStr => {
            const node = Number(nStr);
            const zones = Array.from(tracker[node]); 

            let sourceCount = 0;
            let feederCount = 0;

            zones.forEach(z => {
                if (activeSources.includes(z)) sourceCount++;
                if (feedersList.includes(z)) feederCount++;
            });

            // É loop SE chocar 2 Subestações Principais OU 2 Alimentadores.
            if (sourceCount >= 2 || feederCount >= 2) loopN.add(node);
        });

        branches.forEach(b => {
            if (b.state === 1) {
                if (loopN.has(b.from) && loopN.has(b.to)) {
                    loopE.add(b.id);
                } else {
                    const zF = Array.from(tracker[b.from] || []);
                    const zT = Array.from(tracker[b.to] || []);
                    
                    if (zF.length > 0 && zT.length > 0 && zF[0] !== zT[0]) {
                        const isSourceF = activeSources.includes(zF[0]);
                        const isSourceT = activeSources.includes(zT[0]);
                        const isFeederF = feedersList.includes(zF[0]);
                        const isFeederT = feedersList.includes(zT[0]);

                        // Verifica a Patente para pintar a linha de amarelo
                        if ((isSourceF && isSourceT) || (isFeederF && isFeederT)) {
                            loopE.add(b.id);
                            loopN.add(b.from); loopN.add(b.to);
                        }
                    }
                }
            }
        });
        // 👆 ======================================== 👆

        return { nodeZones: nZ, edgeZones: eZ, loopNodes: loopN, loopEdges: loopE, colorRoots: roots };
    }, [branches, faultNodes, activeSources, feedersList]);

    const getNodeColor = useCallback((nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (faultNodes.has(nodeId)) return colors.fault;
        if (loopNodes.has(nodeId)) return colors.loop;
        
        let sourceToUse = null;
        if (activeSources.includes(nodeId)) {
            sourceToUse = nodeId;
        } else {
            const feeds = nodeFeeds[nodeId];
            if (!feeds || feeds.size === 0) return colors.de;
            sourceToUse = Array.from(feeds)[0];
        }
        
        const zone = nodeZones[nodeId] || sourceToUse;
        return getBaseColor(zone, colorRoots, darkMode);
    }, [darkMode, faultNodes, loopNodes, activeSources, nodeFeeds, nodeZones, colorRoots]);

    const getEdgeColor = useCallback((branch) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (branch.state === 0) return colors.de;
        
        const current = lineCurrents[branch.id];
        if (!current || current.current < 0.01) return colors.de;
        if (current.percentage >= 100) return '#d50000'; 
        if (loopEdges.has(branch.id)) return colors.loop; 
        
        const zone = edgeZones[branch.id];
        if (!zone) return colors.de; 
        
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const alpha = 0.1 + (0.9 * Math.sqrt(p)); 
        
        const sortedRoots = [...colorRoots].sort((a, b) => a - b);
        let idx = sortedRoots.indexOf(zone);
        if (idx === -1) idx = 0;
        
        const hue = PALETTE_HUES[idx % PALETTE_HUES.length];
        return `hsla(${hue}, 95%, ${darkMode ? 50 : 35}%, ${alpha.toFixed(3)})`; 
    }, [darkMode, lineCurrents, loopEdges, edgeZones, colorRoots]);

    return { getNodeColor, getEdgeColor, loopNodes, loopEdges };
}