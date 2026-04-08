// src/hooks/useFileImport.js
import { useCallback } from 'react';
import { SYSTEM_DATA } from '../data/systemData';
import { parseAMPLDat } from '../utils/amplParser';
import { calculateForceLayout } from '../utils/autoLayout'; //

export function useFileImport({
    setSystemLoads,
    setBranches,
    setFaultNodes,
    setActiveSources,
    setIsProjectLoaded,
    setProjectPositions,
    setProjectWaypoints,
    showToast,
    initialBranchesRef
}) {

    // 1. IMPORTAÇÃO DE ESTADOS DE CHAVES E FALTAS (TXT/LOG)
    const handleUploadSwitches = useCallback((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const lines = content.split(/\r\n|\n/);
            const updates = new Map(); 
            const newFaults = new Set();
            let currentMode = null; 
            let switchCount = 0;
            let faultCount = 0;

            lines.forEach(line => {
                const l = line.trim();
                if (!l) return;
                if (/^set\s+BF\s*:=/.test(l)) {
                    const match = l.match(/set\s+BF\s*:=\s*([\d\s]+);?/);
                    if (match && match[1]) {
                        const faults = match[1].trim().split(/\s+/);
                        faults.forEach(f => {
                            const id = parseInt(f);
                            if (!isNaN(id)) { newFaults.add(id); faultCount++; }
                        });
                    }
                    return; 
                }
                if (l.includes('Circuitos Ativos')) { currentMode = 1; return; }
                if (l.includes('Circuitos Desconectados')) { currentMode = 0; return; }
                if (l.startsWith('i') || l.startsWith('set') || isNaN(parseInt(l[0]))) return;
                const parts = l.split(/\s+/).filter(p => p !== '');
                if (parts.length >= 2) {
                    const from = parseInt(parts[0]);
                    const to = parseInt(parts[1]);
                    if (!isNaN(from) && !isNaN(to) && currentMode !== null) {
                        updates.set(`${from}-${to}`, currentMode);
                        updates.set(`${to}-${from}`, currentMode);
                        switchCount++;
                    }
                }
            });

            if (updates.size > 0 || faultCount > 0 || newFaults.size === 0) {
                if (updates.size > 0) {
                    setBranches(prev => prev.map(b => {
                        const key = `${b.from}-${b.to}`;
                        if (updates.has(key)) return { ...b, state: updates.get(key) };
                        return b;
                    }));
                }
                setFaultNodes(newFaults);
                showToast(`Importado: ${switchCount} chaves, ${faultCount} faltas.`, 'success');
            } else {
                showToast('Arquivo lido, mas nenhum dado compatível encontrado.', 'warning');
            }
        };
        reader.readAsText(file);
    }, [setBranches, setFaultNodes, showToast]);

    // 2. IMPORTAÇÃO DE PROJETO SALVO (.JSON)
    const handleWelcomeFileUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.layout || data.positions) {
                    if (data.loads) setSystemLoads(data.loads);
                    if (data.baseKV) SYSTEM_DATA.Vbase = data.baseKV;
                    if (data.sBase) SYSTEM_DATA.Sbase = data.sBase;
                    if (data.sources) SYSTEM_DATA.sources = data.sources;
                    if (data.sses) SYSTEM_DATA.sses = data.sses;
                    if (data.shunts) SYSTEM_DATA.shunts = data.shunts;

                    if (data.branches) {
                        setBranches(data.branches);
                        if (initialBranchesRef) initialBranchesRef.current = JSON.parse(JSON.stringify(data.branches));
                    }
                    if (data.faults) setFaultNodes(new Set(data.faults));

                    setTimeout(() => { window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: data })); }, 100);

                    setActiveSources(data.sources || [101, 102, 104]);
                    setIsProjectLoaded(true);
                    showToast("Projeto carregado com sucesso!", "success");
                } else {
                    alert("❌ Arquivo inválido. O arquivo não contém o formato esperado.");
                }
            } catch (err) {
                alert("❌ Erro ao ler o arquivo. Certifique-se de que é um JSON válido.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    }, [setActiveSources, setBranches, setFaultNodes, setIsProjectLoaded, setSystemLoads, showToast, initialBranchesRef]);

    // 3. IMPORTAÇÃO DE SISTEMA AMPL (.DAT / .TXT)
    const handleDatFileUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                const parsedData = parseAMPLDat(text);

                const allNodes = Array.from(new Set(parsedData.branches.flatMap(b => [b.from, b.to])));
                parsedData.sources.forEach(s => { if (!allNodes.includes(s)) allNodes.push(s); }); // Garante que as fontes estejam na conta
                
                // Roda o algoritmo de gravidade invisível
                const autoPositions = calculateForceLayout(allNodes, parsedData.branches, parsedData.sources, { distance: 10, charge: -40 });
                
                // Substitui a grade falsa pela gravidade perfeita
                parsedData.positions = autoPositions;
                if (parsedData.layout) parsedData.layout.positions = autoPositions;
                                
                setProjectPositions(parsedData.positions || {});
                setProjectWaypoints(parsedData.waypoints || {});
 
                setSystemLoads(parsedData.loads);
                SYSTEM_DATA.Vbase = parsedData.baseKV;
                SYSTEM_DATA.Sbase = parsedData.sBase;
                SYSTEM_DATA.sources = parsedData.sources;

                SYSTEM_DATA.feeders = parsedData.feeders || [];
                SYSTEM_DATA.nodeTypes = parsedData.nodeTypes || {}; 

                SYSTEM_DATA.sses = parsedData.sses || {};
                SYSTEM_DATA.shunts = parsedData.shunts || {};

                setActiveSources(parsedData.sources);
                setBranches(parsedData.branches);
                if (initialBranchesRef) initialBranchesRef.current = JSON.parse(JSON.stringify(parsedData.branches));
                setFaultNodes(new Set());
                
                setTimeout(() => { window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: parsedData })); }, 100);
                
                setIsProjectLoaded(true);
                showToast("Sistema AMPL importado com sucesso!", "success");
            } catch (err) {
                alert("❌ Erro ao processar o ficheiro .dat.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    }, [setActiveSources, setBranches, setFaultNodes, setIsProjectLoaded, setProjectPositions, setProjectWaypoints, setSystemLoads, showToast, initialBranchesRef]);

    return { handleUploadSwitches, handleWelcomeFileUpload, handleDatFileUpload };
}