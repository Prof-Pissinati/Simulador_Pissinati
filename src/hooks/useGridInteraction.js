// src/hooks/useGridInteraction.js
import { useCallback } from 'react';

export function useGridInteraction({
    isEditMode,
    setSelectedElement,
    toggleSwitch,
    toggleFault
}) {

    // === INTERAÇÃO COM BARRAS (NODES) ===
    const handleNodeClick = useCallback((nodeId) => {
        if (isEditMode) return; // No modo lápis, o clique faz outras coisas
        setSelectedElement({ type: 'node', id: parseInt(nodeId) });
    }, [isEditMode, setSelectedElement]);

    const handleNodeDoubleClick = useCallback((nodeId, event) => {
        if (isEditMode) return;
        if (event && event.stopPropagation) event.stopPropagation(); // Impede o mapa de dar zoom sem querer
        toggleFault(parseInt(nodeId));
    }, [isEditMode, toggleFault]);


    // === INTERAÇÃO COM LINHAS (EDGES) ===
    const handleEdgeClick = useCallback((branchObj) => {
        if (isEditMode) return;
        setSelectedElement({ type: 'edge', data: branchObj });
    }, [isEditMode, setSelectedElement]);

    const handleEdgeDoubleClick = useCallback((branchObj, fallbackId, event) => {
        if (isEditMode) return;
        if (event && event.stopPropagation) event.stopPropagation();
        
        if (branchObj.hasSwitch) {
            // Garante que o ID da chave será encontrado (seja o ID numérico ou a string "De-Para")
            const switchId = branchObj.id !== undefined ? branchObj.id : fallbackId;
            toggleSwitch(switchId);
        }
    }, [isEditMode, toggleSwitch]);

    return {
        handleNodeClick,
        handleNodeDoubleClick,
        handleEdgeClick,
        handleEdgeDoubleClick
    };
}