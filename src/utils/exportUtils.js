// Arquivo: src/utils/exportUtils.js

const PUB_THEME = {
    background: '#ffffff', // Fundo Branco para o artigo
    text: '#000000',       // Texto Preto geral
    sub101: '#2e7d32',     // Verde (Sub 101)
    sub102: '#e65100',     // Laranja (Sub 102)
    sub104: '#7b1fa2',     // Roxo (Sub 104)
    fault: '#d32f2f',      // Vermelho (Falta)
    loop: '#fbc02d',       // Amarelo (Loop)
    de: '#757575',         // Cinza (DE)
};

/**
 * Exporta o SVG do sistema.
 * Agora recebe o calcMethod para colocar na legenda.
 */
export const exportSVG = (svgId, filename = 'diagrama_sistema_artigo.svg', calcMethod = 'NR') => {
    const svgElement = document.getElementById(svgId);
    
    if (!svgElement) {
        alert(`❌ Erro: Não encontrei o gráfico na tela. Verifique se o <svg> tem o id="${svgId}".`);
        return;
    }

    try {
        const clonedSvg = svgElement.cloneNode(true);
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        // 3. INJETA ESTILOS (Com os números brancos mantidos!)
        const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleElement.textContent = `
            /* Números das barras em BRANCO */
            .node-label { fill: #ffffff !important; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-weight: bold; }
            text { user-select: none; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
            .edge-line { transition: none !important; opacity: 1 !important; }
            [fill="#4caf50"] { fill: ${PUB_THEME.sub101} !important; } 
            [fill="#e65100"] { fill: ${PUB_THEME.sub102} !important; } 
            [fill="#7b1fa2"] { fill: ${PUB_THEME.sub104} !important; } 
            [fill="#ff1744"] { fill: ${PUB_THEME.fault} !important; }  
        `;
        clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);


        // ==========================================================
        // 4. DESENHA A LEGENDA VETORIZADA (Idêntica ao Simulador)
        // ==========================================================
        const legendData = [
            { color: PUB_THEME.sub101, text: "SUB 101" },
            { color: PUB_THEME.sub102, text: "SUB 102" },
            { color: PUB_THEME.sub104, text: "SUB 104" },
            { color: PUB_THEME.fault,  text: "Falta/Sobrecarga" },
            { color: PUB_THEME.loop,   text: "Loop" },
            { color: PUB_THEME.de,     text: "Desenergizado" },
        ];

        // Grupo principal da legenda
        const legendG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        legendG.setAttribute('class', 'export-legend');
        
        // Posição no canto inferior direito
        legendG.setAttribute('transform', 'translate(700, 470)'); 

        // CAIXA DE FUNDO DA LEGENDA (Escura, como no app)
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', '130');
        bgRect.setAttribute('height', '140'); // Altura da caixa
        bgRect.setAttribute('rx', '8'); // Bordas arredondadas
        bgRect.setAttribute('fill', '#1e1e1e'); // Cor de fundo escura
        bgRect.setAttribute('stroke', '#444444'); // Borda cinza
        bgRect.setAttribute('stroke-width', '1');
        // Sombra suave (simulada com um filtro básico ou cor)
        legendG.appendChild(bgRect);

        // Itera e desenha cada item da legenda (Bolinhas e Textos)
        legendData.forEach((item, i) => {
            const itemG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            itemG.setAttribute('transform', `translate(10, ${15 + (i * 22)})`);

            // Bolinha de cor (circle em vez de rect)
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', '6'); // Centro X
            dot.setAttribute('cy', '0'); // Centro Y
            dot.setAttribute('r', '6');  // Raio (tamanho da bolinha)
            dot.setAttribute('fill', item.color);
            itemG.appendChild(dot);

            // Texto da legenda
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '20'); // Espaço após a bolinha
            text.setAttribute('y', '4');  // Alinhamento vertical com o centro da bolinha
            text.setAttribute('fill', '#ffffff'); // Texto branco
            text.setAttribute('font-size', '12px');
            text.textContent = item.text;
            itemG.appendChild(text);

            legendG.appendChild(itemG);
        });

        /*

        // LINHA DIVISÓRIA E MÉTODO DE CÁLCULO
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '15');
        line.setAttribute('y1', '160');
        line.setAttribute('x2', '165');
        line.setAttribute('y2', '160');
        line.setAttribute('stroke', '#444444');
        line.setAttribute('stroke-width', '1');
        legendG.appendChild(line);

        const methodText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        methodText.setAttribute('x', '15');
        methodText.setAttribute('y', '178');
        methodText.setAttribute('fill', '#aaaaaa'); // Cinza clarinho
        methodText.setAttribute('font-size', '10px');
        
        // Pega a string completa do método
        const methodString = calcMethod === 'NR' ? 'Newton-Raphson' : 'Gauss-Seidel';
        methodText.innerHTML = `Método: <tspan fill="#ffffff" font-weight="bold">${methodString}</tspan>`;
        legendG.appendChild(methodText);

        */
        // Adiciona a legenda pronta ao SVG
        clonedSvg.appendChild(legendG);

        

        // ==========================================================


        // 5. SERIALIZA E BAIXA
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(clonedSvg);
        source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.style.display = "none";
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        setTimeout(() => URL.revokeObjectURL(url), 500);

    } catch (error) {
        console.error("Erro ao gerar SVG:", error);
        alert("Houve um erro ao gerar a imagem. Verifique o console.");
    }
};