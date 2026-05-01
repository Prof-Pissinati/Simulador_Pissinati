# Simulador de Sistemas de Potência — Contexto para IA Colaboradora

> **Última atualização:** 01/05/2026

---

## 1. O Que é o Projeto

Aplicação **React (Vite)** para simulação, visualização e otimização de sistemas de distribuição de energia elétrica. Opera 100% no browser, sem backend.

Funcionalidades principais:
- Importar redes via `.dat` (AMPL) ou `.json`
- Visualizar em **diagrama SVG** (esquemático) ou **mapa georreferenciado (Leaflet)**
- Simular faltas, manobrar chaves, ajustar taps e capacitores
- Fluxo de carga Newton-Raphson ou Gauss-Seidel com cache
- Otimização de reconfiguração (Guloso + VNS)
- Sequenciamento de manobras com snapshots por passo

---

## 2. Estrutura de Arquivos

```
src/
├── App.jsx                          ← Orquestrador central (todo o estado React vive aqui)
├── components/
│   ├── Sidebar.jsx                  ← Painel esquerdo (info, controles, inspetor de elementos)
│   ├── editSidebar.jsx              ← Painel de edição de layout (drag de nós)
│   ├── FaultPanel.jsx               ← Painel direito (barras e chaves)
│   ├── GraphArea.jsx                ← Canvas SVG interativo + Canvas híbrido (LOD)
│   │   ├── GraphNode.jsx            ← Renderiza cada barra (SVG, LOD 0)
│   │   ├── GraphEdge.jsx            ← Renderiza cada ramal/chave (SVG, LOD 0)
│   │   ├── CanvasOverlay.jsx        ← Renderizador Canvas (LOD 1, zoom < 0.9)
│   │   └── SvgTooltips.jsx          ← Tooltips flutuantes no diagrama
│   ├── MapArea.jsx                  ← Mapa Leaflet georreferenciado
│   ├── SequenceOverlay.jsx          ← Overlay de sequenciamento de manobras
│   ├── ImportDatModal.jsx           ← Modal de importação .dat
│   └── MobileControls.jsx           ← Controles mobile
├── hooks/
│   ├── useColorIntelligence.js      ← Cor de nós/arestas por estado elétrico
│   ├── useFileImport.js             ← Importação .json e .dat (delega à Engine)
│   ├── useGridInteraction.js        ← Interação de pan/zoom + Ctrl/Shift clique
│   └── useShortcuts.js             ← Atalhos de teclado
├── utils/
│   ├── powerCalculations.js         ← Motor NR/GS + particionador de ilhas + cache + computeVisualZones
│   ├── mathSolver.js                ← Solver linear (LU)
│   ├── reconfigOptimizer.js         ← Heurística gulosa de reconfiguração
│   ├── vnsOptimizer.js              ← VNS (Variable Neighborhood Search)
│   ├── switchSequencer.js           ← Snapshots e sequência de manobras
│   ├── datParser.js                 ← Parser .dat AMPL
│   ├── amplParser.js                ← Parser auxiliar AMPL
│   ├── systemConverter.js           ← Converte dados brutos para formato interno
│   ├── layoutGenerator.js           ← Layout automático ortogonal
│   ├── autoLayout.js                ← 3 motores: Force, Ortogonal, VNS
│   ├── runLayoutWorker.js           ← Wrapper Promise para Web Worker de layout
│   ├── layoutWorker.js              ← Web Worker: executa os motores de layout
│   ├── exportUtils.js               ← Exportação SVG e relatório TXT
│   ├── geoRouting.js                ← Roteamento via OSM
│   ├── osmApi.js                    ← API OpenStreetMap
│   └── theme.js                     ← Constantes de cor (dark/light)
└── data/
    ├── systemData.js                ← Sistema exemplo IEEE 53 barras
    ├── systemData54.js              ← Sistema exemplo IEEE 54 barras (com shunts)
    ├── systemDataGeo.js             ← Posições geográficas do exemplo IEEE 53
    └── systemRoutes.json            ← Rotas georreferenciadas pré-calculadas
```

---

## 3. Padrão Arquitetural — Engine Unificada

**Regra central:** qualquer entrada de dados (JSON, DAT, exemplo hardcoded) passa obrigatoriamente pela função `applySystemData()` em `App.jsx`.

```
[Entrada: .json / .dat / exemplo]
        ↓
 useFileImport.js  →  applySystemData(data, sourceName)
        ↓
 App.jsx: applySystemData()
   ├─ setBranches / setSystemLoads / setSystemShunts
   ├─ setActiveSources / setSystemFeeders
   ├─ setVBase / setSBase / setSses
   ├─ setProjectPositions / setProjectWaypoints
   └─ runBlackStart()  →  animação de energização (BFS com agrupamento de loops)
```

**Exceção:** importação de arquivo de sequência `.txt` não passa pela Engine — aplica apenas atualizações de chaves e faltas sem reset de mapa ou Black Start.

---

## 4. Fluxo de Cálculo

```
propagateFeeds()    →  nodeFeeds { [nodeId]: Set<sourceId> }
        ↓
calculateLoads()    →  loads { [nodeId]: { p, q } }
        ↓
runPowerFlow()      →  { nodes: {V, θ}, lines: {I, %} }  [com cache]
        ↓
useColorIntelligence()  →  getNodeColor / getEdgeColor
        ↓
GraphArea (SVG ou Canvas)  →  renderização visual
```

---

## 5. Sistema de LOD (Level of Detail) — GraphArea

O GraphArea opera em 2 modos determinados pelo zoom atual:

| Modo | Condição | Renderizador | Descrição |
|---|---|---|---|
| **LOD 0** — Detalhado | `transform.scale >= 0.9` | SVG (`GraphNode` + `GraphEdge`) | Todos os detalhes, interação completa |
| **LOD 1** — Canvas | `transform.scale < 0.9` | `CanvasOverlay` | Alta performance, geometria diferenciada |

**CanvasOverlay (LOD 1):**
- Subestações/feeders: hexágono
- Barras com shunt: losango
- Barras comuns: círculo
- Linhas com waypoints respeitados
- Raycasting via `mousemove` para hover (`localHoveredNode`, `localHoveredLine`)
- Tooltips SVG overlay sobre o canvas
- Drag de nós funcional no modo Canvas
- Clique delega para `handleNodeClick` / `handleLineClick` do GraphArea

---

## 6. Interação do Usuário

| Ação | Resultado |
|---|---|
| Clique simples em nó | `toggleFault(nodeId)` |
| Clique simples em linha | `toggleSwitch(branchId)` (se hasSwitch) |
| `Shift+Clique` em nó/linha | Seleciona elemento + abre tooltip fixo (pinned card) |
| `Ctrl+Clique` em nó/linha | Seleciona elemento permanentemente (sem tooltip, sem toggle) |
| Clique no fundo | Limpa seleção |

Implementado em `useGridInteraction.js` (MapArea) e diretamente em `GraphArea.jsx`.

---

## 7. Estado Central (App.jsx)

| Variável | Tipo | Descrição |
|---|---|---|
| `branches` | Array | Ramos com estado aberto/fechado, impedâncias, taps |
| `faultNodes` | Set | Barras em falta |
| `systemLoads` | Object | `{ [nodeId]: { p, q } }` |
| `systemShunts` | Object | `{ [nodeId]: { steps, maxSteps, qPerStep } }` |
| `activeSources` | Array | Barras de subestação (fontes de tensão) |
| `systemFeeders` | Array | Barras de alimentador (fronteiras) |
| `vBase` | Number | Tensão base em kV |
| `sBase` | Number | Potência base em kVA |
| `sses` | Object | Dados das subestações |
| `sequenceData` | Object | `{ steps, snapshots, method }` |
| `viewMode` | String | `'schematic'` ou `'map'` |
| `nodeFeeds` | Object | `{ [nodeId]: Set<sourceId> }` — calculado via `propagateFeeds` |
| `lineCurrents` | Object | `{ [branchId]: { current, percentage, pFlow, qFlow } }` |
| `nodeData` | Object | `{ [nodeId]: { v, ang, p, q } }` |

---

## 8. Estrutura de Dados

### Branch
```js
{
  id: Number,
  from: Number, to: Number,
  state: 0 | 1,
  initialState: 0 | 1,
  r: Number, x: Number,
  hasSwitch: Boolean,
  isRegulator: Boolean,
  currentTap: Number, maxTaps: Number,
  Imax: Number
}
```

### SystemData (formato de importação/exportação JSON)
```js
{
  version: "1.0",
  systemName: String,
  baseKV: Number, sBase: Number,
  sources: [Number],
  feeders: [Number],
  sses: { [id]: {...} },
  shunts: { [id]: { steps, maxSteps, qPerStep } },
  loads: { [id]: { p, q } },
  branches: [Branch],
  faults: [Number],
  layout: { positions: {}, waypoints: {} }
}
```

---

## 9. Funções Exportadas de `powerCalculations.js`

| Função | Descrição |
|---|---|
| `runPowerFlow(branches, faultNodes, method, sysData, eventNodes)` | Motor NR/GS com cache e particionamento por ilhas |
| `propagateFeeds(branches, faultNodes, sysData)` | BFS para calcular qual fonte alimenta cada barra |
| `computeVisualZones(branches, sources, feeders, faultNodes)` | Zonas radiais para clustering visual — 1 zona por ramal de saída de source/feeder |
| `calculateLoads(nodeFeeds, faultNodes, sysData)` | Calcula cargas por barra |
| `reduceSystemTopology(...)` | Reduz topologia para NR otimizado |
| `expandSystemResults(...)` | Expande resultados de volta ao sistema completo |

---

## 10. Layout de Diagrama

Três motores via Web Worker (`runLayoutWorker.js` → `layoutWorker.js`):

| Motor | Uso |
|---|---|
| `force` | Importação inicial de .dat |
| `orthogonal` | Solicitado pelo usuário |
| `vns` | Solicitado pelo usuário |

Durante cálculo: `isCalculatingLayout = true` exibe overlay de progresso.

---

## 11. MapArea — Estado Atual e Pendências

Usa **React-Leaflet v5** + **Leaflet 1.9.4**. Funcional apenas para sistema exemplo (IEEE 53) — coordenadas hardcoded em `systemDataGeo.js`.

**Pendências conhecidas no MapArea:**
- `dashArray` ainda em `"10, 10"` — deve ser `"10, 3"` para reduzir gaps
- Controle de zoom ainda no canto padrão — deve ir para `bottomright` via `<ZoomControl position="bottomright" />`
- Geolocalização de sistemas importados não implementada

---

## 12. Dívida Técnica

| Severidade | Arquivo | Problema |
|---|---|---|
| Média | `App.jsx` | 1550 linhas — candidato a extração de hooks |
| Média | `reconfigOptimizer.js` | `console.log` de debug ativos |
| Baixa | `MobileControls.jsx` | Importa `SYSTEM_DATA` hardcoded |
| Baixa | Projeto geral | Sem testes automatizados |

---

## 13. Dependências Principais

```json
{
  "react": "^19.2.0",
  "react-leaflet": "^5.0.0",
  "leaflet": "^1.9.4",
  "d3": "^7.9.0",
  "dagre": "^0.8.5",
  "vite": "rolldown-vite@7.2.5"
}
```

---

## 14. Convenções

- Sem testes automatizados
- Idioma dos textos: português
- Tema dark/light via `theme.js` e classe `dark-mode` no `body`
- Comunicação global via `window.dispatchEvent`: `triggerZoomExtents`, `applyGraphLayout`, `resetGraphLayout`, `saveToHistory`

---

## 15. Formato de Resposta Esperado

Ao finalizar uma tarefa:

```
## Alterações Realizadas

**Arquivos modificados:**
- `caminho/arquivo.js` — descrição curta do que mudou

**Arquivos criados:**
- nenhum

**Efeitos colaterais conhecidos:**
- Descrição de qualquer impacto em outros módulos

**Pendências / O que NÃO foi feito:**
- Itens que ficaram fora do escopo
```
