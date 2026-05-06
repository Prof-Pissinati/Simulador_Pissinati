import { useCallback } from 'react';
import { parseAMPLDat } from '../utils/amplParser';
import { runAsyncLayout } from '../utils/runLayoutWorker';

export function useFileImport({
    setBranches,
    setFaultNodes,
    showToast,
    setIsCalculatingLayout,
    setLayoutProgress,
    applySystemData // 👈 A Engine
}) {

    // 1. IMPORTAÇÃO DE ESTADOS DE CHAVES E FALTAS (TXT/LOG) - Mantido igual
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
                    // 👇 DELEGA 100% PARA A ENGINE 👇
                    applySystemData(data, "Projeto JSON");
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
    }, [applySystemData, showToast]);

    // 3. IMPORTAÇÃO DE SISTEMA AMPL (.DAT / .TXT)
    const handleDatFileUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target.result;
                const parsedData = parseAMPLDat(text);

                const allNodes = Array.from(new Set(parsedData.branches.flatMap(b => [b.from, b.to])));
                parsedData.sources.forEach(s => { if (!allNodes.includes(s)) allNodes.push(s); });
                
                if (setIsCalculatingLayout) setIsCalculatingLayout(true);
                if (setLayoutProgress) setLayoutProgress({ passes: 0, msg1: "Desenhando Mapa...", msg2: "Calculando gravidade inicial" });
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const autoPositions = await runAsyncLayout('force', allNodes, parsedData.branches, parsedData.sources, { 
                    distance: 10, charge: -40,
                    onProgress: (passes, msg1, msg2) => {
                        if (setLayoutProgress) setLayoutProgress({ passes, msg1, msg2 });
                    }
                });
                
                if (setIsCalculatingLayout) setIsCalculatingLayout(false);
                
                parsedData.positions = autoPositions;
                if (parsedData.layout) parsedData.layout.positions = autoPositions;
                                
                // 👇 DELEGA 100% PARA A ENGINE 👇
                applySystemData(parsedData, "Arquivo .dat AMPL");
                
                const missingLimits = parsedData.branches.filter(b => !b.Imax && !b.imax && !b.limit && !b.capacity);
                if (missingLimits.length > 0) {
                    showToast(`⚠️ Aviso: ${missingLimits.length} linha(s) importada(s) sem Limite de Corrente. Assumindo 1000A.`, "warning");
                } else {
                    showToast("Sistema AMPL importado com integridade total!", "success");
                }

            } catch (err) {
                if (setIsCalculatingLayout) setIsCalculatingLayout(false);
                alert("❌ Erro ao processar o ficheiro .dat.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    }, [applySystemData, showToast, setIsCalculatingLayout, setLayoutProgress]);

    return { handleUploadSwitches, handleWelcomeFileUpload, handleDatFileUpload };
}