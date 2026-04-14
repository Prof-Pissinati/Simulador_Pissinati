import { useCallback } from 'react';

export function useGridInteraction({
    isEditMode,
    setSelectedElement,
    toggleSwitch,
    toggleFault,
    onPinCard // 👈 NOVO: Função para fixar o Post-it
}) {
    // === INTERAÇÃO COM BARRAS (NODES) ===
    const handleNodeClick = useCallback((nodeId, event) => {
        if (isEditMode) return;
        
        const isShift = event?.originalEvent?.shiftKey;
        
        if (isShift) {
            setSelectedElement({ type: 'node', id: parseInt(nodeId) });
            // Avisa o mapa para criar o post-it na coordenada do clique
            if (onPinCard) onPinCard('node', nodeId, event); 
        } else {
            toggleFault(parseInt(nodeId));
        }
    }, [isEditMode, setSelectedElement, toggleFault, onPinCard]);

    // === INTERAÇÃO COM LINHAS (EDGES) ===
    const handleEdgeClick = useCallback((branchObj, fallbackId, event) => {
        if (isEditMode) return;
        
        const branchId = branchObj.id !== undefined ? branchObj.id : fallbackId;
        const isShift = event?.originalEvent?.shiftKey;
        
        if (isShift) {
            setSelectedElement({ type: 'edge', data: branchObj });
            // Avisa o mapa para criar o post-it
            if (onPinCard) onPinCard('line', branchId, event); 
        } else {
            if (branchObj.hasSwitch) {
                toggleSwitch(branchId);
            }
        }
    }, [isEditMode, setSelectedElement, toggleSwitch, onPinCard]);

    return {
        handleNodeClick,
        handleEdgeClick
    };
}