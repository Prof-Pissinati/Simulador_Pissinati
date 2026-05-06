import { useCallback } from 'react';
import { THEME } from '../utils/theme';

export const PALETTE_HUES = [210, 120, 30, 280, 180, 320, 85, 240, 150, 15];

export const getBaseColor = (id, allRoots, darkMode) => {
    const sortedRoots = [...(allRoots || [])].sort((a, b) => a - b);
    let idx = sortedRoots.indexOf(id);
    if (idx === -1) idx = 0; 
    
    const h = PALETTE_HUES[idx % PALETTE_HUES.length];
    return `hsl(${h}, 95%, ${darkMode ? 50 : 35}%)`;
};

// 👇 Recebe a "topology" pronta de bandeja 👇
export function useColorIntelligence({ faultNodes, activeSources, lineCurrents, darkMode, topology }) {
    
    // Extrai o que precisa do pacote
    const { nodeFeeds, nodeZones, edgeZones, loopNodes, loopEdges, colorRoots } = topology;

    const getNodeColor = useCallback((nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (faultNodes.has(nodeId)) return colors.fault;
        if (loopNodes.has(nodeId)) return colors.loop;
        
        let sourceToUse = null;
        if ((activeSources || []).includes(nodeId)) {
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
        if (!current || current.current < 0.001) return colors.de; 
        if (current.percentage >= 100) return '#d50000'; 
        if (loopEdges.has(branch.id)) return colors.loop; 
        
        const pVal = current.p !== undefined ? current.p : (current.pFlow || 0);
        const isReverse = pVal < 0; 
        const sendingNode = isReverse ? branch.to : branch.from;
        
        let zone = nodeZones[sendingNode] || edgeZones[branch.id];
        
        if (!zone && colorRoots) {
            zone = colorRoots.includes(sendingNode) ? sendingNode : colorRoots[0];
        }
        
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const alpha = 0.45 + (0.55 * Math.sqrt(p)); 
        
        const sortedRoots = [...(colorRoots || [])].sort((a, b) => a - b);
        let idx = sortedRoots.indexOf(zone);
        if (idx === -1) idx = 0; 
        
        const hue = PALETTE_HUES[idx % PALETTE_HUES.length] || 0;
        
        return `hsla(${hue}, 95%, ${darkMode ? 55 : 35}%, ${alpha.toFixed(3)})`; 
    }, [darkMode, lineCurrents, loopEdges, nodeZones, edgeZones, colorRoots]);

    return { getNodeColor, getEdgeColor };
}