# Manual do Usuário — Simulador IEEE 53 Barras

> Simulador de fluxo de potência e reconfiguração de redes de distribuição, com visualização interativa e sequenciamento temporal de restauração.

**Versão do documento:** rascunho preliminar (em revisão)
**Repositório:** [Prof-Pissinati/Simulador_Pissinati](https://github.com/Prof-Pissinati/Simulador_Pissinati)

---

## Índice

1. [Introdução](#1-introdução)
2. [Acesso ao Simulador](#2-acesso-ao-simulador)
3. [Importação de Dados](#3-importação-de-dados)
4. [Interface Geral](#4-interface-geral)
5. [Visualização da Rede](#5-visualização-da-rede)
6. [Edição da Rede](#6-edição-da-rede)
7. [Simulação de Faltas](#7-simulação-de-faltas)
8. [Chaveamento Manual](#8-chaveamento-manual)
9. [Fluxo de Potência](#9-fluxo-de-potência)
10. [Reconfiguração Automática](#10-reconfiguração-automática)
11. [Sequenciamento de Restauração](#11-sequenciamento-de-restauração)
12. [Solução de Problemas (FAQ)](#12-solução-de-problemas-faq)
13. [Como Citar](#13-como-citar)

---

## 1. Introdução

O **Simulador IEEE 53 Barras** é uma ferramenta interativa para estudo de fluxo de potência e reconfiguração de redes de distribuição de energia elétrica. Ele foi desenvolvido para apoiar a visualização e a análise de sistemas de distribuição no contexto de uma pesquisa de doutorado sobre planejamento da restauração de sistemas de distribuição, com foco em reconfiguração de rede e sequenciamento de chaveamento ao longo do processo de restauração.

Diferente de abordagens que mostram apenas o estado inicial (pré-falta) e o estado final (pós-restauração) de uma rede, o simulador permite visualizar e navegar **cada instante intermediário** do processo de restauração — ou seja, qual é a topologia da rede a cada manobra de chaveamento, e não apenas no início e no fim.

### 1.1 Principais funcionalidades

- **Fluxo de potência**, calculado por dois métodos numéricos: Newton-Raphson e Gauss-Seidel
- **Duas formas de visualização** da rede: diagrama esquemático (SVG, com layout automático) e mapa geográfico (via Leaflet, para sistemas com coordenadas reais)
- **Simulação de faltas**, com sinalização de barras energizadas, desenergizadas, em falta, ou em condição de malha (loop)
- **Chaveamento manual** de linhas, com possibilidade de restringir manobras a chaves existentes ou de habilitar manobra em trechos normalmente fixos (útil, por exemplo, para estudar onde instalar uma nova chave)
- **Reconfiguração automática** da rede, por heurística gulosa ou por busca em vizinhança variável (VNS)
- **Sequenciamento de restauração**, com player passo a passo, edição manual da sequência (reordenar, excluir, agrupar por etapas) e cálculo de energia não suprida (ENS) acumulada
- **Importação de sistemas** a partir de arquivos no formato AMPL (`.dat`), com geração automática de layout
- **Importação/exportação de sequências de chaveamento**, permitindo salvar e reproduzir cenários de restauração
- Suporte a **geração distribuída (GD)**, **bancos de capacitores shunt** e **reguladores de tensão (tap)** — recursos completos no simulador, disponíveis para estudos gerais de operação de rede

### 1.2 Para quem é este manual

Este manual é dirigido tanto a usuários que desejam operar o simulador para fins de estudo e pesquisa em sistemas de distribuição, quanto a colaboradores que venham a dar manutenção ou continuidade ao desenvolvimento do projeto.

---

## 2. Acesso ao Simulador

Atualmente, o simulador é executado localmente, a partir do código-fonte. Não é necessário nenhum passo de compilação prévia além dos descritos abaixo — o ambiente de desenvolvimento (Vite) já inicia o simulador pronto para uso no navegador.

### 2.1 Pré-requisitos

- [Node.js](https://nodejs.org/) (recomendado: versão 18 ou superior)
- Um navegador atualizado (Chrome, Firefox, Edge ou similar)

### 2.2 Passo a passo

1. Clone o repositório:
   ```bash
   git clone https://github.com/Prof-Pissinati/Simulador_Pissinati.git
   cd Simulador_Pissinati
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Inicie o simulador em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

4. Abra o endereço exibido no terminal (por padrão, algo como `http://localhost:5173`) em seu navegador.

O simulador será carregado já com um sistema de exemplo (IEEE 53 barras), pronto para uso.

### 2.3 Nota sobre acesso via navegador (sem instalação)

> **Ponto de melhoria planejado.** Está prevista, para uma fase mais madura do projeto, a disponibilização de uma versão do simulador hospedada na web, acessível diretamente pelo navegador, sem necessidade de instalar Node.js ou clonar o repositório. Esta seção do manual será atualizada com o endereço de acesso assim que essa versão estiver disponível.

---

## 3. Importação de Dados

O simulador permite trabalhar tanto com o sistema de exemplo pré-carregado (IEEE 53 barras) quanto com sistemas próprios, importados em dois formatos distintos: **topologia de rede** (formato AMPL) e **sequências de chaveamento** (formato próprio do simulador). Esta seção trata da importação de topologias; a importação de sequências de chaveamento é abordada na Seção 11 (Sequenciamento de Restauração).

### 3.1 Importando um sistema (arquivo `.dat`)

Para importar um novo sistema elétrico, clique no botão **📂 Abrir** no cabeçalho da barra lateral. Isso abre a janela **"Importar Sistema (.dat)"**, com o seguinte fluxo:

1. **Selecione o arquivo**: clique em "Selecionar arquivo .dat..." e escolha o arquivo desejado. O simulador aceita arquivos com extensão `.dat` ou `.txt`, desde que estejam no formato AMPL esperado.

2. **Revise o preview**: após selecionar o arquivo, o simulador exibe automaticamente um resumo do sistema identificado:
   - Número de barras
   - Número de linhas
   - Subestações (ou "Auto-detectar", caso não estejam explicitamente indicadas no arquivo)
   - Número de faltas iniciais, se houver

   Caso o arquivo apresente inconsistências que não impeçam a importação, avisos são exibidos nesta etapa (ex.: dados incompletos, valores fora do esperado).

3. **Escolha o layout inicial**, entre três opções de disposição automática dos nós no diagrama:
   - 🌿 **Orgânico** — layout por simulação de forças (force-directed), adequado a topologias variadas
   - ⭕ **Radial** — disposição em torno de um centro, útil para destacar hierarquia a partir da(s) subestação(ões)
   - 📊 **Hierárquico** — disposição em níveis, útil para visualizar profundidade elétrica a partir da fonte

4. **Nomeie o sistema**: por padrão, o nome sugerido é o nome do próprio arquivo (sem extensão), mas pode ser alterado livremente.

5. Clique em **"✓ Importar e Criar"** para concluir. O botão permanece desabilitado até que um arquivo válido tenha sido selecionado e um nome de sistema tenha sido informado.

### 3.2 Importação geográfica

Para sistemas que devem ser visualizados no modo mapa (ver Seção 5), é possível associar coordenadas geográficas reais às barras do sistema, através da janela de importação geográfica (aceita arquivos `.json`, `.csv` ou `.txt`).

> **Ponto de atenção (limitação atual):** a associação de coordenadas geográficas reais está implementada e funcional apenas para o sistema de exemplo IEEE 53 barras, cujas coordenadas já estão previamente cadastradas no simulador. Sistemas importados via arquivo `.dat` não possuem, por enquanto, um fluxo automático de associação de coordenadas geográficas próprias — este é um ponto de desenvolvimento futuro.

---

## 4. Interface Geral

> 📸 *[Espaço reservado para captura de tela: visão geral da interface completa, com anotações numeradas apontando cada área.]*

A interface do simulador é dividida em três grandes áreas:

- **Barra lateral principal** (esquerda) — controles gerais, indicadores agregados de carga, e inspetor do elemento selecionado.
- **Área central** — a visualização da rede propriamente dita, alternável entre modo diagrama (esquemático) e modo mapa (geográfico).
- **Painel direito "Diretório de Elementos"** — lista pesquisável de subestações, alimentadores, barras e linhas, com controle de faltas e chaveamento (detalhado na Seção 7).

### 4.1 Cabeçalho da barra lateral

No topo da barra lateral, uma grade de botões dá acesso rápido às ações mais frequentes:

| Botão | Ícone | Ação |
|---|---|---|
| Tema | 🌙 / ☀️ | Alterna entre modo escuro e modo claro |
| PDF | 🖼️ | Exporta a visualização atual para PDF |
| Abrir | 📂 | Importa um sistema (`.dat`) ou uma sequência de chaveamento (`.txt`/`.log`) — ver Seções 3 e 11 |
| Reset | 🔄 | Reinicia o sistema ao seu estado original |
| NR / GS | ⚡ / 🌊 | Alterna o método de cálculo de fluxo de potência entre Newton-Raphson e Gauss-Seidel (ver Seção 9) |
| Labels | 🏷️ | Mostra/esconde os rótulos de identificação no diagrama |
| Relatório | 📄 | Baixa um relatório de fluxo de potência em formato `.txt` |
| Ver Mapa / Diagrama | 🗺️ / 📐 | Alterna entre a visualização esquemática (SVG) e a visualização geográfica (mapa) |

Em telas menores ou quando a barra lateral está recolhida, os botões passam a exibir apenas o ícone (modo compacto).

### 4.2 Painel de cargas

Logo abaixo do cabeçalho, um conjunto de cartões exibe, para cada subestação e cada alimentador, a potência total (kW/MW, conforme a magnitude), a corrente aproximada em Ampères e o número de barras atendidas. Um cartão adicional **"SUB (Off)"** aparece quando há subestações desconectadas da rede, mostrando a carga que ficou fora de serviço.

### 4.3 Painel de estatísticas

Um resumo rápido do estado global do sistema, com três indicadores: número de linhas fechadas, número de linhas abertas e número de faltas ativas no momento.

### 4.4 Inspetor de elemento

Ao clicar em qualquer barra ou linha (seja no diagrama, no mapa ou no Diretório de Elementos), o inspetor exibe os detalhes daquele elemento:

- **Para barras**: tensão em pu e ângulo de fase. A tensão é sinalizada por cor: verde (faixa normal), amarelo (abaixo de 0,95 pu) e vermelho (abaixo de 0,93 pu ou acima de 1,05 pu) — critério usual de violação de tensão em sistemas de distribuição.
- **Para subestações e alimentadores**: além da tensão, o percentual de carregamento em relação ao limite de potência aparente configurado, com sinalização de "Operação Normal", "Carga Alta" (acima de 80%) ou "⚠️ Sobrecarga" (acima de 100%).
- **Controles adicionais**, quando aplicáveis ao elemento selecionado: banco de capacitores shunt (ajuste de estágio via slider), geração distribuída — GD (ativação/desativação e ajuste de potência ativa, respeitando os limites físicos de capacidade), e regulador de tensão por tap. Estes recursos estão disponíveis para qualquer sistema, mas atualmente não fazem parte do fluxo de pesquisa da tese associada a este simulador — foram implementados visando a utilidade geral da ferramenta (por exemplo, para estudos de alocação ótima de bancos de capacitores ou de impacto de geração distribuída).

---

## 5. Visualização da Rede

O simulador oferece duas formas de visualizar a rede elétrica, alternáveis a qualquer momento pelo botão 🗺️/📐 no cabeçalho da barra lateral.

### 5.1 Modo Diagrama (esquemático)

> 📸 *[Espaço reservado para captura de tela: diagrama esquemático com barras, linhas e cores de status.]*

No modo diagrama, a rede é desenhada como um grafo SVG, com layout calculado automaticamente (ver Seção 3.1 para as opções de layout na importação, e Seção 6 para reorganização manual).

**Navegação:**
- **Arrastar** o fundo para deslocar a visualização (pan).
- **Roda do mouse / gesto de zoom** para aproximar ou afastar.
- Em redes grandes, o simulador ajusta automaticamente o nível de detalhe conforme o zoom, para manter a navegação fluida: em aproximação total, todos os elementos são desenhados em detalhe; em zoom intermediário, o desenho é simplificado; em visão distante (rede inteira), a renderização passa a usar uma técnica de alta performance baseada em canvas.

**Interações principais (fora do modo de edição):**

| Ação | Efeito |
|---|---|
| Clique simples numa linha | Abre/fecha a chave daquela linha (se ela possuir chave, ou se o modo de manutenção estiver habilitado — ver Seção 7) |
| Clique simples numa barra | Insere ou remove uma falta naquela barra |
| Ctrl/Cmd + clique (barra ou linha) | Apenas seleciona o elemento no inspetor, sem alterar seu estado |
| Shift + clique (barra ou linha) | Fixa um cartão de informação flutuante sobre o elemento, que permanece visível mesmo sem o cursor sobre ele |
| Passar o mouse sobre um elemento | Exibe um tooltip com informações rápidas, e destaca o elemento correspondente no Diretório de Elementos (e vice-versa) |

**Cores de status**, aplicadas tanto a barras quanto a chaves conforme o caso:

- 🟢 **Verde** — energizado / chave fechada
- 🔴 **Vermelho** — em falta
- 🟠 **Laranja/Amarelo** — em loop (mais de uma fonte alimentando o mesmo trecho — condição admissível quando intencional, mas sinalizada como alerta de segurança da rede)
- ⚪ **Cinza** — desenergizado / chave aberta

> 📸 *[Espaço reservado: exemplo lado a lado das quatro cores de status.]*

### 5.2 Modo Mapa (geográfico)

> 📸 *[Espaço reservado para captura de tela: mesma rede exibida sobre o mapa geográfico.]*

No modo mapa, a rede é sobreposta a um mapa real (via OpenStreetMap/Leaflet), útil quando se deseja associar a topologia elétrica à sua localização física. As interações de clique, seleção e cores de status seguem o mesmo padrão do modo diagrama.

**Traçado de linhas por vias reais.** Por padrão, as linhas entre barras não são desenhadas em linha reta: o simulador consulta um serviço de roteamento (OSRM — Open Source Routing Machine) para traçar a linha seguindo o trajeto de ruas entre as duas coordenadas. Isso exige conexão com a internet; caso o serviço de roteamento não responda, o simulador usa automaticamente uma linha reta como alternativa, sem interromper o uso.

É possível, para qualquer trecho, forçar um segmento em linha reta (substituindo o traçado por rua), adicionar pontos de passagem manuais ao traçado, e importar ou exportar esses ajustes de rota em formato JSON — útil para reaproveitar um traçado já refinado em outra sessão.

**Cobertura geográfica automática.** Ao carregar um sistema, o simulador verifica quantas barras possuem coordenadas geográficas cadastradas. Se menos da metade da rede tiver coordenadas, a janela de importação geográfica (Seção 3.2) é aberta automaticamente, solicitando que o usuário complete essas informações.

> ⚠️ **Lembrete da limitação atual** (já mencionada na Seção 3.2): a cobertura completa de coordenadas geográficas, hoje, está garantida apenas para o sistema de exemplo IEEE 53 barras.

---

## 6. Edição da Rede

> 📸 *[Espaço reservado para captura de tela: painel de edição aberto, com o diagrama ao fundo.]*

O **Modo de Edição** dá acesso a ferramentas para reorganizar visualmente a rede — reposicionar barras, ajustar o traçado das linhas e recalcular o layout automaticamente. Ele é voltado à disposição gráfica dos elementos, não à alteração de seus dados elétricos (carga, impedância, etc.).

Para ativar, use o atalho de teclado `E` ou o controle correspondente na interface. Um painel lateral adicional é exibido enquanto o modo de edição está ativo.

### 6.1 Movendo elementos

- **Arrastar uma barra** reposiciona-a livremente no diagrama.
- **Shift + clique** em múltiplas barras permite selecioná-las em grupo, para movê-las juntas.
- **Duplo-clique numa linha** insere um ponto de dobra (waypoint) naquele ponto do traçado, permitindo curvar a linha.
- **Duplo-clique num waypoint existente** o remove, retornando a linha a um traçado mais direto naquele trecho.
- **↩️ Desfazer Move** reverte a última movimentação realizada.
- **↺ -10° / +10° ↻** giram todo o layout atual em torno de seu centro.

### 6.2 Gerador Geométrico (layout automático)

Além do reposicionamento manual, um painel permite recalcular a disposição de toda a rede automaticamente, com quatro algoritmos disponíveis:

- **Orgânico (D3 Force)** — layout por simulação de forças físicas (nós se repelem, linhas atuam como molas). Parâmetros ajustáveis: distância das linhas, força de repulsão entre nós, e peso atribuído a chaves abertas no cálculo.
- **Ortogonal (Grid Expansion)** — dispõe os elementos em um grid, com linhas preferencialmente retas na horizontal/vertical. Parâmetro ajustável: tamanho da malha.
- **Hierárquico (Árvore Sugiyama)** — organiza a rede em níveis a partir da(s) fonte(s), adequado para visualizar profundidade elétrica. Parâmetro ajustável: espaçamento entre níveis.
- **Compactador VNS** — utiliza uma heurística de busca em vizinhança variável (VNS) para reduzir cruzamentos de linhas no desenho do grafo. Parâmetros ajustáveis: tamanho da célula de grade e número de iterações.

  > ⚠️ **Atenção à nomenclatura:** este VNS otimiza a **disposição visual** dos elementos no diagrama (minimizando cruzamentos de linhas para facilitar a leitura), e é conceitualmente distinto do algoritmo VND de **reconfiguração da rede elétrica** apresentado na Seção 10. Os dois compartilham a família de técnicas de busca em vizinhanças, mas resolvem problemas diferentes — um é estético/topológico no desenho, o outro é elétrico/operacional na rede.

Após ajustar os parâmetros desejados, clique em "Aplicar Layout" (ou "🧬 Executar VNS", no caso do Compactador VNS) para recalcular as posições.

### 6.3 Recursos de depuração visual

O painel de edição também inclui ferramentas voltadas à depuração do próprio algoritmo de layout ("👁️ Ver Esqueleto", "👁️ Manter Esqueleto"), que exibem uma versão simplificada (compactada) do grafo usada internamente pelo motor de layout. Estes recursos são de interesse principalmente para desenvolvimento e ajuste fino do simulador, não sendo necessários para o uso corrido da ferramenta.

### 6.4 Atalhos de teclado

| Atalho | Ação |
|---|---|
| `P` | Alternar modo tela cheia / moldura A4 |
| `Ctrl` + `P` | Imprimir / exportar para PDF |
| `E` | Entrar ou sair do modo de edição |
| `Z` | Centralizar a visualização na rede |
| `Ctrl` + `Z` | Desfazer última ação |
| `D` | Alternar tema escuro |
| `Shift` + Arrastar | Seleção múltipla de elementos |

Para salvar as alterações de layout e sair do modo de edição, use o botão **"🚪 Sair e Salvar"**.

---

## 7. Simulação de Faltas

> 📸 *[Espaço reservado para captura de tela: painel "Diretório de Elementos" com uma falta ativa, e o diagrama mostrando a área isolada.]*

O simulador permite inserir faltas em qualquer barra da rede, seja diretamente no diagrama/mapa (clique simples sobre a barra) ou pelo painel lateral direito, o **Diretório de Elementos** (ver Seção 4).

### 7.1 Atuação automática da proteção

Ao inserir uma falta numa barra, o simulador **localiza e abre automaticamente a chave de proteção mais próxima**, isolando a área afetada — de forma análoga à atuação de um esquema de proteção real. A busca parte da barra em falta e percorre a rede energizada até encontrar, em cada direção, a primeira chave existente, que é então aberta. Trechos sem chave alguma no caminho permanecem conectados à área isolada (e, portanto, também desenergizados), até que se alcance uma chave ou os limites da rede.

Ao remover a falta (restauração), o simulador não fecha automaticamente as chaves que foram abertas — a reenergização da área isolada é uma decisão do usuário (manual) ou do otimizador de reconfiguração (Seção 10), permitindo estudar diferentes estratégias de restauração.

### 7.2 Estados possíveis de uma barra

O Diretório de Elementos classifica cada barra em um dos quatro estados a seguir, cada qual associado a uma cor no diagrama e no mapa (ver também Seção 5.1):

| Estado | Significado |
|---|---|
| 🟢 **ENERGIZADO** | A barra recebe energia normalmente. |
| 🔴 **EM FALTA** | A barra foi marcada com uma falta ativa. |
| ⚪ **DESENERGIZADO** | A barra está sem energia, por estar isolada da(s) fonte(s) — geralmente como consequência da atuação da proteção após uma falta. |
| 🟠 **EM LOOP** | A barra está sendo alimentada simultaneamente por mais de uma fonte (subestação ou alimentador) através de um mesmo ramo. Esta é uma condição operacionalmente aceitável, desde que estabelecida de forma proposital — mas é sinalizada como alerta, pois representa um risco do ponto de vista de segurança da rede caso não seja intencional. |

### 7.3 Buscando e localizando elementos

O campo de busca no topo do Diretório de Elementos filtra simultaneamente subestações, alimentadores, barras e linhas — basta digitar um número de barra ou trecho de nome. Passar o mouse sobre qualquer item da lista destaca o elemento correspondente no diagrama ou mapa, e vice-versa.

---

## 8. Chaveamento Manual

> 📸 *[Espaço reservado para captura de tela: uma chave sendo aberta/fechada, com o destaque de cor correspondente.]*

Além da reconfiguração automática (Seção 10) e do sequenciamento (Seção 11), é possível manobrar chaves manualmente a qualquer momento, de duas formas equivalentes:

- **Pelo diagrama ou mapa**: clique simples sobre a linha desejada.
- **Pelo Diretório de Elementos**: clique no botão de estado da linha ("FECHADO" ou "ABERTO"), na seção "Chaves e Linhas".

### 8.1 Linhas com chave vs. linhas fixas

Nem toda linha do sistema possui uma chave de manobra. O Diretório de Elementos separa as linhas em dois grupos:

- **Chaveáveis** — possuem uma chave de manobra real, podendo ser abertas ou fechadas livremente a qualquer momento.
- **Fixas** — não possuem chave, e por padrão aparecem bloqueadas (rótulo "FIXO"), não podendo ser manobradas.

### 8.2 Habilitando manobra em linhas fixas

O botão **"🔓 Habilitar Manobra (Fixas)"**, ao final da lista de linhas chaveáveis, permite destravar temporariamente a manobra de linhas normalmente fixas. Isso é útil, por exemplo, para **estudos de planejamento** — como avaliar em qual ponto da rede seria vantajoso instalar uma nova chave de manobra, testando o efeito de "cortar" um trecho hoje fixo. Quando habilitado, o botão muda de cor (vermelho) como lembrete visual de que o modo está ativo; um clique adicional o desativa novamente ("🔒 Bloquear Barras Fixas").

> ⚠️ Esta opção existe para fins de estudo e exploração da rede, e não representa uma chave real instalada no sistema — trate-a como uma simulação hipotética de "e se houvesse uma chave aqui?".

---

## 9. Fluxo de Potência

O cálculo de fluxo de potência é executado automaticamente sempre que o estado da rede muda (chaveamento, falta, alteração de carga, etc.), atualizando tensões, ângulos e fluxos em tempo real na interface.

### 9.1 Métodos disponíveis

O botão ⚡/🌊 no cabeçalho da barra lateral (Seção 4.1) alterna entre dois métodos numéricos clássicos de solução do fluxo de potência:

- **Newton-Raphson (NR)** — método padrão, com convergência mais rápida (até 20 iterações) e maior robustez numérica para a maioria dos cenários.
- **Gauss-Seidel (GS)** — método iterativo alternativo (até 1000 iterações, com fator de aceleração de convergência), útil como referência cruzada ou para comparação de desempenho entre métodos.

Ambos os métodos usam tolerância de convergência de 1×10⁻⁴ por padrão.

> 💡 Para fins de pesquisa que envolvam comparação entre métodos de solução, o simulador já oferece essa alternância pronta — não é necessário reimplementar ou trocar manualmente o solver. Note, porém, a observação sobre o futuro do Gauss-Seidel na Seção 9.6.

### 9.2 Tratamento de redes fragmentadas (ilhas)

Quando a rede se encontra fragmentada em mais de uma parte desconectada — por exemplo, após a atuação da proteção isolando uma área em falta (Seção 7.1) — o simulador identifica cada sub-rede (“ilha”) separadamente e resolve o fluxo de potência de forma independente para cada uma, em vez de tratar a rede como um bloco único. Isso garante resultados corretos mesmo com múltiplas áreas isoladas simultaneamente na rede.

### 9.3 Indicadores na interface

Os principais resultados do fluxo de potência ficam visíveis diretamente na interface, sem necessidade de exportar relatório:

- **Tensão em pu e ângulo de fase**, para qualquer barra selecionada (inspetor, Seção 4.4), com sinalização de cor para violação de tensão.
- **Carregamento percentual**, para subestações e alimentadores, com sinalização de sobrecarga.
- **Potência e corrente aproximada**, nos cartões de carga (Seção 4.2).

### 9.4 Exportando relatórios

O botão **📄 Relatório**, no cabeçalho da barra lateral, gera um arquivo de texto (`.txt`) com os resultados detalhados do fluxo de potência: tensão e ângulo de cada barra energizada, fluxo de potência ativa e reativa em cada circuito ativo (nos dois sentidos, já contemplando as perdas), e a geração ativa total em cada fonte. Quando há geração distribuída ativa no sistema, um resumo de sua operação (potência ativa, reativa e capacidade) também é incluído.

Três modalidades de relatório estão disponíveis, dependendo do contexto em que são solicitadas:

- **Estado atual** — um único relatório, referente à configuração manual da rede no momento.
- **Sequência completa** — um relatório para **cada** snapshot da sequência de restauração ativa (Seção 11), incluindo o estado inicial e o resultado de cada passo individual. Esta é a modalidade mais indicada para análises detalhadas do processo de restauração, já que fornece o fluxo de potência de cada instante intermediário.
- **Resumo por etapa** — um relatório apenas para o estado final de cada etapa da sequência (ignorando os passos intermediários dentro da etapa), útil para uma visão mais compacta do progresso da restauração.

### 9.5 Arquitetura de cálculo (nota técnica avançada)

> Esta seção é dirigida a quem for dar manutenção ao simulador ou avaliar seu comportamento em maior profundidade — não é necessária para o uso corrente da ferramenta.

Embora o método Newton-Raphson implementado siga a formulação polar clássica (P/Q especificado vs. calculado, Jacobiano H-N-M-L), o desempenho e a fidelidade dos resultados dependem fortemente de três mecanismos que envolvem o solver, aplicados a cada recálculo de fluxo de potência:

**a) Particionamento em ilhas elétricas.** Antes de qualquer cálculo, a rede é dividida em sub-redes eletricamente independentes — cada conjunto de barras conectado a uma fonte, isolado das demais por chaves abertas ou faltas. Cada ilha é resolvida separadamente. Isso evita que uma falta isolando uma pequena região da rede exija o reprocessamento de todo o sistema.

**b) Redução topológica por poda de folhas, com compensação de perdas.** Antes de submeter cada ilha ao solver, o simulador identifica recursivamente nós-folha (grau 1) não protegidos e os remove, transferindo sua carga ao nó pai. Diferente de uma simples soma de cargas, essa transferência **compensa a perda estimada** (I²R e I²X, assumindo tensão ≈ 1,0 pu) que existiria no trecho podado, preservando a fidelidade do resultado mesmo com a rede reduzida. Um "histórico de poda" é mantido para permitir a expansão do resultado de volta a todas as barras originais após o cálculo.

São protegidos contra a poda (isto é, permanecem no sistema reduzido): as barras-fonte, barras em falta, barras envolvidas no evento de chaveamento sendo processado, e barras com banco de capacitores shunt ativo — estas últimas para que o efeito de V² do capacitor seja calculado com exatidão, e não estimado por agregação. Geração distribuída ativa numa barra-folha **não** protege aquele nó contra a poda — ela apenas é contabilizada (como injeção negativa de carga) antes da carga ser transferida ao nó pai.

Como consequência, o Newton-Raphson **não** é executado apenas quando há malhas (loops) na rede: ele é executado sempre que sobra ao menos um ramo após a poda. Isso inclui redes radiais que contenham qualquer nó protegido no meio da árvore (uma falta ativa, um evento de chaveamento em processamento, ou uma barra com banco de capacitores ativo) — nesses casos, a poda para antes de alcançar a fonte, deixando ramos residuais que são resolvidos pelo solver. O único caso em que o solver é dispensado por completo é quando uma ilha é uma árvore radial pura, sem nenhum nó protegido além da própria fonte: a poda então consome a árvore inteira, e o resultado é obtido diretamente pela agregação de cargas, sem necessidade de resolver um sistema de equações.

**c) Cache de resultados por ilha.** Cada ilha recebe uma chave de cache derivada do estado exato de seus ramos e nós (chaveamento, faltas, taps de regulador, estágio de capacitores, geração distribuída ativa). Se essa combinação de estado já foi calculada anteriormente, o resultado é reaproveitado, sem nova execução do solver.

> ⚠️ **Pendências de desenvolvimento identificadas nesta seção:**
> 1. O ganho de desempenho proporcionado por ilhas, redução topológica e cache ainda não foi medido formalmente. Uma medição comparativa (tempo de execução com e sem cada mecanismo, em função do tamanho do sistema e do número de reavaliações) está planejada, com potencial uso como dado de desempenho computacional em publicação futura.
> 2. A estimativa de perdas usada na poda assume tensão fixa (V≈1,0 pu) em todas as barras, sem realimentação do valor de tensão efetivamente calculado pelo Newton-Raphson. Está prevista uma melhoria que reintroduza essa realimentação — podar com V≈1,0 pu, resolver, repetir a poda usando a tensão calculada na iteração anterior, repetindo até convergência ou um número fixo de iterações externas — visando maior precisão em sistemas com quedas de tensão mais acentuadas.

### 9.6 Sobre o método Gauss-Seidel

> ⚠️ **Nota de desenvolvimento:** o método Gauss-Seidel foi mantido no simulador principalmente por completude histórica e para fins de comparação pontual. Ao longo do desenvolvimento, o nível de eficiência e robustez alcançado pelo Newton-Raphson — em conjunto com a arquitetura de ilhas descrita na Seção 9.5 — tornou o Gauss-Seidel menos relevante para o uso corrente do simulador, e sua remoção é considerada para versões futuras.

---

## 10. Reconfiguração Automática

> 📸 *[Espaço reservado para captura de tela: sequência gerada automaticamente após uma falta, com a barra de progresso da otimização.]*

Sempre que uma falta é inserida (ou uma topologia-alvo é importada, Seção 3), o simulador gera automaticamente uma sequência de manobras de restauração, através de um processo em duas etapas: uma **heurística gulosa construtiva**, que gera uma sequência inicial viável, seguida — sob demanda, pelo botão **✨ Otimizar** na barra de sequenciamento (Seção 11) — de um refinamento por **VND (Variable Neighborhood Descent)**.

> ⚠️ **Nota de nomenclatura:** versões anteriores deste simulador (e eventualmente o próprio código-fonte, em processo de atualização) referem-se a este segundo estágio como "VNS". Adotou-se aqui o termo mais preciso **VND**, por se tratar de uma busca local sistemática (exaustiva) sobre múltiplas estruturas de vizinhança, sem a etapa de perturbação aleatória (*shaking*) que caracteriza o VNS clássico da literatura de metaheurísticas. Ver também a nota equivalente na Seção 6.2, sobre o algoritmo homônimo (porém distinto) usado para layout visual do diagrama.

### 10.1 Etapa 1 — Heurística Gulosa Construtiva

A heurística gulosa constrói a sequência de restauração passo a passo, escolhendo a cada iteração o melhor movimento disponível entre as manobras ainda pendentes (comparando o estado atual da rede ao estado-alvo desejado).

**Princípios de decisão:**

- **Make-Before-Break preferencial.** Sempre que fisicamente seguro, o simulador fecha a chave de restauração *antes* de abrir a chave de isolamento correspondente, formando um anel temporário — evitando uma interrupção de fornecimento que seria desnecessária caso a manobra pudesse ser feita sem desligar ninguém.
- **Critério de não-piora da ENS.** Nenhum movimento é aceito se ele aumentar a energia não suprida (ENS) em relação ao estado atual. Um movimento que **mantém** a ENS inalterada é aceito normalmente — é o caso típico de manobras em chaves cujas duas extremidades já estão desenergizadas, que não desligam nenhum cliente adicional.
- **Validação em duas camadas.** Cada candidato a movimento é primeiro avaliado por uma checagem linear rápida (LinDistFlow), e só submetido ao cálculo completo de fluxo de potência (Newton-Raphson) quando essa checagem rápida aprova o movimento ou identifica uma possível malha (loop) segura — evitando o custo computacional de rodar o solver completo para cada candidato descartável.

**Quando a heurística "trava":** se, numa dada iteração, nenhum movimento disponível atende aos critérios acima (nem melhora, nem mantém a ENS), o simulador aciona uma manobra de alívio de carga — abrindo uma chave de seccionamento para reduzir sobrecarga em algum trecho da rede. Esta manobra, por construção, **também não piora a ENS**: ela atua sobre trechos já desenergizados, e é sinalizada explicitamente na interface como manobra de alívio de carga. Se mesmo essa estratégia não resolver a situação, o simulador recorre, como último recurso, a uma fragmentação da área ainda não restaurada em uma sub-ilha separada, permitindo que o restante da sequência prossiga.

**Agrupamento em pacotes de manobra.** Cada passo gerado pela heurística é internamente marcado como pertencente a um pacote (por exemplo: o par abertura/fechamento de um Make-Before-Break; um fechamento de restauração e as aberturas preparatórias associadas a ele; ou o bloco de manobras de alívio de carga). Este agrupamento é o que permite à etapa de VND, a seguir, reordenar a sequência de forma segura — movendo pacotes inteiros, e não passos isolados que poderiam perder seu sentido operacional se separados.

### 10.2 Etapa 2 — Refinamento por VND

Uma vez gerada a sequência pela heurística gulosa, o botão **✨ Otimizar** (na barra de controle do sequenciamento, Seção 11) aciona uma busca local sistemática sobre a ordem dos pacotes de manobra, buscando reduzir ainda mais a ENS acumulada ao longo da sequência, sem violar limites de tensão ou de corrente em nenhum passo intermediário.

O refinamento é organizado em duas estruturas de vizinhança, aplicadas em sequência:

- **Reordenação de pacotes.** Todos os pares de pacotes móveis (excluindo os fixos no início — a condição inicial de faltas e proteção — e no final — blocos de alívio de carga) são testados par a par, trocando sua ordem relativa. A troca é aceita quando reduz a ENS total da sequência.
- **Substituição de chave de alívio.** Para cada manobra de alívio de carga que possua alternativas mapeadas pela heurística gulosa (outras chaves que também poderiam ter sido escolhidas para o mesmo alívio), o VND testa cada alternativa, adotando-a caso reduza ainda mais a ENS.

**Validação em duas camadas, também aqui.** Assim como na heurística gulosa, cada candidato de reordenação ou substituição passa primeiro por uma avaliação rápida (LinDistFlow + ENS por topologia); apenas candidatos que indicam melhora real são submetidos à validação completa por Newton-Raphson antes de serem aceitos definitivamente. Isso mantém o refinamento viável computacionalmente mesmo em sequências mais longas.

### 10.3 Interpretando o resultado

Ao final da otimização (gulosa ou gulosa + VND), a sequência resultante fica disponível no player de sequenciamento (Seção 11), com a "Penalidade ENS" acumulada exibida em tempo real conforme se navega pelos passos — permitindo observar não apenas o resultado final da restauração, mas o comportamento da rede em cada instante intermediário do processo.

---

## 11. Sequenciamento de Restauração

> 📸 *[Espaço reservado para captura de tela: barra de controle do sequenciamento, com o player, a lista expandida de manobras e a penalidade ENS visível.]*

O sequenciamento é a peça central do simulador para o estudo do processo de restauração — não apenas o estado final, mas **cada instante intermediário** entre a ocorrência de uma falta e a restauração completa da rede (ou o melhor estado possível dentro das restrições vigentes). Ele é apresentado como uma barra de controle flutuante na parte inferior da tela, sempre que há uma sequência ativa.

### 11.1 Player de sequência

A barra de controle central permite navegar pela sequência como se fosse um player de vídeo:

| Controle | Função |
|---|---|
| ◀ / ▶ | Avança ou retrocede um passo por vez |
| ▶ Play / ⏸ Pausa | Reproduz a sequência automaticamente, passo a passo |
| Controle de velocidade | Ajusta o intervalo entre passos na reprodução automática (0,4 s a 3,0 s por passo) |

A cada passo, o simulador **aplica de fato** o estado correspondente da rede — chaves abrem/fecham, faltas surgem/são removidas, e o diagrama (ou mapa) é atualizado em tempo real, permitindo observar visualmente a evolução da topologia ao longo de toda a restauração.

### 11.2 Métrica de energia não suprida (ENS)

Durante a navegação, a barra exibe a **Penalidade ENS** acumulada até o passo atual, em kWh. Ela é calculada considerando:

- A **potência desconectada** em cada passo (soma da carga de todas as barras que não estão energizadas nem marcadas como em falta naquele instante);
- O **tempo estimado da manobra** que originou aquele passo, segundo valores padrão por tipo de evento: abertura ou fechamento de chave (1 minuto), mudança de tap ou de estágio de banco de capacitores (0,5 minuto), atuação da proteção ao inserir uma falta (praticamente instantânea), e restauração de uma falta (atualmente, 2 minutos).

> ⚠️ **Pendências conhecidas sobre esta métrica**, já identificadas para correção futura:
> 1. A barra que está em falta é atualmente **excluída** do cálculo de potência desconectada. A formulação usual na literatura de restauração de sistemas de distribuição soma a energia não suprida de **toda** carga fora de serviço, incluindo a barra onde o defeito ocorreu — sua exclusão hoje deixa a métrica artificialmente otimista.
> 2. O tempo de restauração de falta (2 minutos, fixo) representa, por ora, apenas uma manobra de chaveamento — não um tempo de reparo físico realista, que na prática varia bastante conforme o tipo de defeito e pode levar horas. Está prevista uma evolução deste valor para refletir tempos de reparo diferenciados por tipo de falha, e futuramente, o tempo de deslocamento de equipes de manutenção até o local.

### 11.3 Editando a sequência

A lista completa de manobras pode ser expandida (botão 🔼/🔽), exibindo cada passo agrupado por etapa. Nela, é possível:

- **Reordenar passos** por arrastar-e-soltar, inclusive em seleção múltipla (Shift+clique para selecionar um intervalo, Ctrl/Cmd+clique para selecionar itens individuais);
- **Excluir passos** individualmente, ou etapas inteiras;
- **Mover ou excluir etapas** completas.

Cada tipo de evento é identificado por um ícone e uma cor: 🔓 abrir chave (vermelho), 🔒 fechar chave (verde), ⚙️ mudança de tap (laranja), ⚡ falta inserida (vermelho escuro), ✅ falta restaurada (ciano), ⟛ mudança de estágio de banco de capacitores (ciano).

### 11.4 Gravação manual de manobras

O botão **⏺ Gravar** ativa um modo de gravação manual: enquanto ativo (indicado por um aviso pulsante no topo da tela), qualquer clique realizado diretamente no diagrama ou no mapa é registrado como um novo passo na sequência, em vez de ser aplicado imediatamente à rede como uma ação isolada. Isso permite construir uma sequência personalizada manobra a manobra, útil para reproduzir um cenário específico de restauração idealizado pelo usuário.

### 11.5 Otimizando a sequência

O botão **✨ Otimizar** aciona o refinamento por VND sobre a sequência atual, conforme descrito na Seção 10.2. Isso pode ser aplicado tanto sobre uma sequência gerada automaticamente pela heurística gulosa quanto sobre uma sequência editada manualmente ou importada.

### 11.6 Exportando e importando sequências

- **Exportar**: gera um arquivo de texto (`sequenciamento_exportado.txt`) contendo a sequência completa, em um formato próprio do simulador (linhas como `ETAPA ...`, `FECHAR <de> <para>`, `ABRIR <de> <para>`, `FALTA_ADICIONAR <barra>`, `FALTA_RESTAURAR <barra>`).
- **Importar**: pelo botão 📂 Abrir (Seção 4.1), é possível reimportar um arquivo exportado anteriormente — o simulador reconhece automaticamente o formato pelo conteúdo do arquivo (e não pela sua extensão) e reproduz a sequência exatamente como foi salva. Também é possível importar uma topologia-alvo (ao invés de uma sequência pronta), caso em que o simulador gera automaticamente, via heurística gulosa, os passos necessários para alcançá-la (ver Seção 3.1).

Isso permite salvar cenários de restauração para reapresentação posterior, comparação entre diferentes estratégias, ou documentação de casos de estudo.

---

## 12. Solução de Problemas (FAQ)

*Esta seção será preenchida com perguntas frequentes conforme o simulador for utilizado por outros usuários. Por enquanto, consulte as notas de "Ponto de atenção" e "Pendência" distribuídas ao longo deste manual, que documentam as limitações conhecidas até o momento.*

---

## 13. Como Citar

Se você utilizou este simulador em trabalho acadêmico, por favor cite tanto o artigo associado (quando publicado) quanto o repositório do software.

### Artigo (a preencher após publicação)

```bibtex
@inproceedings{pissinati_AAAA_simulador,
  author    = {Pissinati, [Nome completo do autor]},
  title     = {[Título do artigo — a definir]},
  booktitle = {[Nome do congresso/journal — a definir]},
  year      = {AAAA},
  address   = {[Local]},
  note      = {No prelo / Aceito para publicação}
}
```

### Software (repositório)

```bibtex
@software{pissinati_simulador_ieee53,
  author = {Pissinati, [Nome completo do autor]},
  title  = {Simulador IEEE 53 Barras},
  year   = {2026},
  url    = {https://github.com/Prof-Pissinati/Simulador_Pissinati}
}
```

> Este bloco será atualizado assim que os dados definitivos de publicação (título final, veículo, ano, DOI) estiverem disponíveis.

---

## Apêndice — Lista de Pendências Técnicas

Consolidação das pendências de desenvolvimento identificadas durante a elaboração deste manual, para acompanhamento e priorização futura. Numeração mantida conforme a ordem em que foram identificadas.

| # | Pendência | Seção relacionada | Prioridade sugerida |
|---|---|---|---|
| 1 | ENS exclui a barra em falta do cálculo de potência desconectada (`calculateDisconnectedP`); literatura inclui toda carga fora de serviço. Corrigir removendo a condição `&& !faults.has(id)`. | 11.2 | Alta — afeta diretamente a métrica central da tese |
| 1b | Tempo de restauração de falta é fixo (2 min), representando apenas uma manobra, não um reparo físico real. Evoluir para tempos diferenciados por tipo de falha e, futuramente, tempo de deslocamento de equipe. | 11.2 | Alta — pré-requisito para o problema conjunto da tese |
| 2 | Nomenclatura "VNS" usada tanto para o algoritmo de layout visual (Seção 6.2) quanto, anteriormente, para o de reconfiguração — risco de ambiguidade em documentação e código. | 6.2 / 10 | Baixa — cosmético, mas evita confusão futura |
| 3 | Ganho de desempenho de ilhas + redução topológica + cache não foi medido formalmente. Medir tempo de execução com/sem cada mecanismo. | 9.5 | Média — dado valioso para o paper, não bloqueia a escrita |
| 4 | Redução topológica estima perdas com V≈1,0 pu fixo, sem realimentação da tensão calculada pelo NR. Introduzir laço iterativo externo (podar → resolver → repodar com V atualizado). | 9.5 | Média — afeta precisão em sistemas com quedas de tensão maiores |
| 5 | Algoritmo de reconfiguração era chamado "VNS", mas implementa busca sistemática sem *shaking* — mais próximo de VND. **Resolvido**: nomenclatura ajustada para VND neste manual. | 10 | Concluída (documentação) — pendente apenas atualizar o código-fonte |
| 6 | Código-fonte (`vnsOptimizer.js`, variáveis, mensagens de log e de UI como "🧬 Executar VNS") ainda usa a nomenclatura antiga "VNS" para o algoritmo de reconfiguração. Atualizar para VND, alinhando com a documentação. | 10 | Baixa — cosmético, não afeta funcionamento |

---

*Fim do manual (versão preliminar). Documento sujeito a revisões conforme o desenvolvimento do simulador avança e as pendências listadas acima forem endereçadas.*
