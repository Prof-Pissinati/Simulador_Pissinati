import { useCallback } from 'react';

export function useGridInteraction({
    isEditMode,
    setSelectedElement,
    toggleSwitch,
    toggleFault
}) {
    // === INTERAÇÃO COM BARRAS (NODES) ===
    const handleNodeClick = useCallback((nodeId, event) => {
        if (isEditMode) return;
        
        // Verifica se o Shift está pressionado com segurança (Optional Chaining)
        const isShift = event?.originalEvent?.shiftKey;
        
        if (isShift) {
            setSelectedElement({ type: 'node', id: parseInt(nodeId) });
        } else {
            toggleFault(parseInt(nodeId));
        }
    }, [isEditMode, setSelectedElement, toggleFault]);

    // === INTERAÇÃO COM LINHAS (EDGES) ===
    const handleEdgeClick = useCallback((branchObj, fallbackId, event) => {
        if (isEditMode) return;
        
        const branchId = branchObj.id !== undefined ? branchObj.id : fallbackId;
        const isShift = event?.originalEvent?.shiftKey;
        
        if (isShift) {
            setSelectedElement({ type: 'edge', data: branchObj });
        } else {
            if (branchObj.hasSwitch) {
                toggleSwitch(branchId);
            }
        }
    }, [isEditMode, setSelectedElement, toggleSwitch]);

    return {
        handleNodeClick,
        handleEdgeClick
    };
}