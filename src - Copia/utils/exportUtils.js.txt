import { getBaseColor } from '../hooks/useColorIntelligence';
import { THEME } from './theme';

export const exportSVG = (svgId, filename = 'diagrama_sistema.svg', calcMethod = 'NR', sources = [], feedersList = [], darkMode = true) => {
    const svgElement = document.getElementById(svgId);
    
    if (!svgElement) {
        alert(`❌ Erro: Não encontrei o gráfico na tela. Verifique se o <svg> tem o id="${svgId}".`);
        return;
    }

    try {
        const clonedSvg = svgElement.cloneNode(true);
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        // Pega as dimensões reais do SVG na tela para ancorar a legenda no canto inferior direito
        const svgRect = svgElement.getBoundingClientRect();
        const svgWidth = svgRect.width || 800;
        const svgHeight = svgRect.height || 600;

        // Estilos essenciais que não são capturados nativamente
        const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleElement.textContent = `
            .node-label { fill: ${darkMode ? '#ffffff' : '#333333'} !important; font-family: 'Segoe UI', sans-serif; font-weight: bold; }
            text { user-select: none; font-family: 'Segoe UI', sans-serif; }
            .edge-line { transition: none !important; opacity: 1 !important; }
        `;
        clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);

        // ==========================================================
        // DESENHA A LEGENDA VETORIZADA (Agora Dinâmica e Tematizada)
        // ==========================================================
        const allRoots = [...sources, ...feedersList];
        const legendData = [];
        
        sources.forEach(s => legendData.push({ color: getBaseColor(s, allRoots, darkMode), text: `SUB ${s}` }));
        feedersList.forEach(f => legendData.push({ color: getBaseColor(f, allRoots, darkMode), text: `ALIM ${f}` }));
        
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].fault,  text: "Falta/Sobrecarga" });
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].loop,   text: "Loop" });
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].de,     text: "Desenergizado" });

        const legendG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        legendG.setAttribute('class', 'export-legend');
        
        // Posicionamento Dinâmico: 160px da borda direita, 30px + altura da legenda da borda inferior
        const legendHeight = 15 + (legendData.length * 22);
        const posX = svgWidth - 160;
        const posY = svgHeight - legendHeight - 30;
        legendG.setAttribute('transform', `translate(${posX}, ${posY})`); 

        // Tema Dinâmico para a Legenda
        const bgFill = darkMode ? '#1e1e1e' : '#ffffff';
        const bgStroke = darkMode ? '#444444' : '#cccccc';
        const textFill = darkMode ? '#ffffff' : '#333333';

        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', '140');
        bgRect.setAttribute('height', `${legendHeight}`); 
        bgRect.setAttribute('rx', '8'); 
        bgRect.setAttribute('fill', bgFill); 
        bgRect.setAttribute('stroke', bgStroke); 
        bgRect.setAttribute('stroke-width', '1');
        legendG.appendChild(bgRect);

        legendData.forEach((item, i) => {
            const itemG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            itemG.setAttribute('transform', `translate(10, ${15 + (i * 22)})`);

            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', '6'); dot.setAttribute('cy', '0'); dot.setAttribute('r', '6');
            dot.setAttribute('fill', item.color);
            itemG.appendChild(dot);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '20'); text.setAttribute('y', '4');
            text.setAttribute('fill', textFill); text.setAttribute('font-size', '12px');
            text.textContent = item.text;
            itemG.appendChild(text);

            legendG.appendChild(itemG);
        });

        clonedSvg.appendChild(legendG);

        // 5. SERIALIZA E BAIXA
        const serializer = new XMLSerializer();
        let source = '<?xml version="1.0" standalone="no"?>\r\n' + serializer.serializeToString(clonedSvg);

        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = url; downloadLink.download = filename; downloadLink.style.display = "none";
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        setTimeout(() => URL.revokeObjectURL(url), 500);

    } catch (error) {
        console.error("Erro ao gerar SVG:", error);
        alert("Houve um erro ao gerar a imagem. Verifique o console.");
    }
};

import { runPowerFlow } from './powerCalculations'; // Ajuste o caminho se necessário

// Função auxiliar para alinhar números em colunas
const pad = (num, width, decimals = 2) => {
    if (num === undefined || num === null) return "".padStart(width, ' ');
    return Number(num).toFixed(decimals).padStart(width, ' ');
};

export const generateTextReport = (type, currentSnapshot, sequenceData, sysData, calcMethod) => {
    let reportContent = `==================================================\n RELATÓRIO DETALHADO DE FLUXO DE POTÊNCIA (${calcMethod})\n==================================================\n\n`;

    const processSnapshot = (snapshot, stageName) => {
        let txt = `>>> ETAPA: ${stageName}\n--------------------------------------------------\n`;
        const pfResult = runPowerFlow(snapshot.branches, snapshot.faults, calcMethod, sysData);
        const { nodes, lines } = pfResult;

        txt += `TENSÕES NAS BARRAS ENERGIZADAS:\n Barra |   V [p.u.] |  Ang [rad]\n`;
        const poweredNodes = Object.keys(nodes).map(Number).filter(id => nodes[id].v > 0.1).sort((a, b) => a - b);
        poweredNodes.forEach(nodeId => {
            const v = nodes[nodeId].v;
            const angRad = nodes[nodeId].angle * (Math.PI / 180);
            txt += `${String(nodeId).padStart(6, ' ')} | ${pad(v, 10, 5)} | ${pad(angRad, 10, 5)}\n`;
        });

        txt += `\nFLUXO DE POTÊNCIA NOS CIRCUITOS ATIVOS (kW / kVAr):\n  De |  Para |        Pij |        Qij |        Pji |        Qji\n`;
        snapshot.branches.filter(b => b.state === 1).forEach(b => {
            const flow = lines[b.id];
            if (!flow) return;
            const iMag = flow.current;
            const pLoss = (3 * b.r * Math.pow(iMag, 2)) / 1000;
            const qLoss = (3 * b.x * Math.pow(iMag, 2)) / 1000;
            const p_ji = -flow.pFlow + pLoss;
            const q_ji = -flow.qFlow + qLoss;
            txt += `${String(b.from).padStart(4, ' ')} | ${String(b.to).padStart(5, ' ')} | ${pad(flow.pFlow, 10)} | ${pad(flow.qFlow, 10)} | ${pad(p_ji, 10)} | ${pad(q_ji, 10)}\n`;
        });

        txt += `\nGERAÇÃO ATIVA NAS FONTES (kW):\n`;
        sysData.sources.forEach(sourceId => {
            let totalP = 0;
            snapshot.branches.filter(b => b.state === 1).forEach(b => {
                if (b.from === sourceId && lines[b.id]) totalP += lines[b.id].pFlow;
                if (b.to === sourceId && lines[b.id]) totalP -= lines[b.id].pFlow;
            });
            txt += `Barra ${String(sourceId).padStart(4, ' ')}: ${pad(Math.abs(totalP), 10)} kW\n`;
        });

        txt += `\n==================================================\n\n`;
        return txt;
    };

    if (type === 'current') {
        reportContent += processSnapshot(currentSnapshot, "Estado Atual (Manual)");
    } else if (type === 'sequence') {
        sequenceData.snapshots.forEach((snap, idx) => {
            const stageName = idx === 0 ? "Estado Inicial" : (sequenceData.steps[idx - 1]?.description || `Passo ${idx}`);
            reportContent += processSnapshot(snap, stageName);
        });
    } else if (type === 'summary') {
        // 👇 NOVO MODO: Filtra apenas o final de cada etapa 👇
        const stagesProcessed = new Set();
        const summaryIndices = [];
        
        // Pega o último passo de cada etapa
        for (let i = sequenceData.steps.length - 1; i >= 0; i--) {
            const sName = sequenceData.steps[i].stage || "Sem Etapa";
            if (!stagesProcessed.has(sName)) {
                summaryIndices.push(i);
                stagesProcessed.add(sName);
            }
        }
        summaryIndices.sort((a, b) => a - b);

        summaryIndices.forEach(idx => {
            const step = sequenceData.steps[idx];
            const snap = sequenceData.snapshots[idx + 1]; // O snapshot resultante do passo
            reportContent += processSnapshot(snap, `Relatório Pós-Restauração: ${step.stage}`);
        });
    }

    // ... (restante do código anterior)

    // Gatilho de Download Corrigido
    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = `relatorio_fluxo_${type}.txt`;
    link.style.display = 'none'; // Garante que não apareça visualmente
    
    document.body.appendChild(link); // 👈 CRUCIAL: Adiciona ao DOM
    link.click(); 
    document.body.removeChild(link); // Remove logo após o clique
    
    // Pequeno delay para liberar a memória do arquivo
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};