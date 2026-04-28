# Simulador de Sistemas de Potência — Contexto para IA Colaboradora

> **Última atualização:** 27/04/2026

---

## 1. O Que é o Projeto

Aplicação **React (Vite)** para simulação, visualização e otimização de sistemas de distribuição de energia elétrica. Opera 100% no browser, sem backend.

Funcionalidades principais:
- Importar redes via `.dat` (AMPL) ou `.json`
- Visualizar em **diagrama SVG** ou **mapa georreferenciado (Leaflet)**
- Simular faltas, manobrar chaves, ajustar taps e capacitores
- Fluxo de carga Newton-Raphson ou Gauss-Seidel
- Otimização de reconfiguração (Guloso + VNS)
- Sequenciamento de manobras com snapshots por passo

---

## 2. Estrutura de Arquivos

```
src/
├── App.jsx                          ← Orquestrador central (todo o estado React vive aqui)
├── components/
│   ├── Sidebar.jsx                  ← Painel esquerdo (info, controles)
│   ├── editSidebar.jsx              ← Painel de edição de layout (drag de nós)
│   ├── FaultPanel.jsx               ← Painel direito (barras e chaves)
│   ├── GraphArea.jsx                ← Canvas SVG interativo
│   │   ├── GraphNode.jsx            ← Renderiza cada barra
│   │   ├── GraphEdge.jsx            ← Renderiza cada ramal/chave
│   │   └── SvgTooltips.jsx          ← Tooltips flutuantes no diagrama
│   ├── MapArea.jsx                  ← Mapa Leaflet georreferenciado
│   ├── SequenceOverlay.jsx          ← Overlay de sequenciamento
│   ├── ImportDatModal.jsx           ← Modal de importação .dat
│   └── MobileControls.jsx           ← Controles mobile
├── hooks/
│   ├── useColorIntelligence.js      ← Cor de nós/arestas por estado elétrico
│   ├── useFileImport.js             ← Importação de .json e .dat (delega à Engine)
│   ├── useGridInteraction.js        ← Pan/zoom no SVG
│   └── useShortcuts.js             ← Atalhos de teclado
├── utils/
│   ├── powerCalculations.js         ← Motor NR/GS + particionador de ilhas + cache
│   ├── mathSolver.js                ← Solver linear (LU)
│   ├── reconfigOptimizer.js         ← Heurística gulosa de reconfiguração
│   ├── vnsOptimizer.js              ← VNS (Variable Neighborhood Search)
│   ├── switchSequencer.js           ← Snapshots e sequência de manobras
│   ├── datParser.js                 ← Parser .dat AMPL
│   ├── amplParser.js                ← Parser auxiliar AMPL
│   ├── systemConverter.js           ← Converte dados brutos para formato interno
│   ├── layoutGenerator.js           ← Layout automático ortogonal
│   ├── autoLayout.js                ← 3 motores de layout: Force, Ortogonal, VNS
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

## 3. Padrão Arquitetural — "Engine Unificada"

**Regra central:** qualquer entrada de dados (JSON, DAT, exemplo hardcoded) passa obrigatoriamente pela função `applySystemData()` em `App.jsx`. Nenhum setter de estado é chamado diretamente fora dela durante a carga inicial.

```
[Entrada: .json / .dat / exemplo]
        ↓
 useFileImport.js  →  chama applySystemData(data, sourceName)
        ↓
 App.jsx: applySystemData()
   ├─ setBranches / setSystemLoads / setSystemShunts
   ├─ setActiveSources / setSystemFeeders
   ├─ setVBase / setSBase / setSses
   ├─ setProjectPositions / setProjectWaypoints
   └─ runBlackStart()  →  animação de energização
```

**Exceção explícita:** importação de arquivo de sequência `.txt` **não** passa pela Engine. Ela aplica apenas atualizações de chaves e faltas sem disparar reset de mapa ou Black Start.

---

## 4. Fluxo de Cálculo

```
propagateFeeds()    →  nodeFeeds (quem alimenta cada barra)
        ↓
runPowerFlow()      →  { nodes: {V, θ}, lines: {I} }
        ↓
useColorIntelligence()  →  getNodeColor / getEdgeColor
        ↓
GraphArea / MapArea     →  renderização visual
```

---

## 5. Estado Central (App.jsx)

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
| `isCalculatingLayout` | Boolean | Controla overlay de carregamento |
| `layoutProgress` | Object | `{ passes, msg1, msg2 }` para barra de progresso |

---

## 6. Estrutura de Dados

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

## 7. Layout de Diagrama

Três motores disponíveis, todos executam em **Web Worker** (via `runLayoutWorker.js` → `layoutWorker.js`) para não bloquear a UI:

| Motor | Função em autoLayout.js | Uso |
|---|---|---|
| `force` | `calculateForceLayout()` | Importação inicial de .dat |
| `orthogonal` | `calculateOrthogonalLayout()` | Solicitado pelo usuário |
| `vns` | `calculateVNSLayout()` | Solicitado pelo usuário |

Durante o cálculo, `isCalculatingLayout = true` exibe um overlay de progresso controlado por `layoutProgress`.

---

## 8. MapArea — Estado Atual

`MapArea.jsx` usa **React-Leaflet** e está funcional apenas para o sistema exemplo (IEEE 53), pois as posições geográficas estão hardcoded em `systemDataGeo.js` e as rotas em `systemRoutes.json`.

**Limitação crítica:** sistemas importados via `.dat` ou `.json` não possuem coordenadas geográficas — o mapa não renderiza para eles. Geolocalização de redes externas não está implementada.

---

## 9. Problemas Conhecidos / Dívida Técnica

| Severidade | Arquivo | Problema |
|---|---|---|
| Alta | `App.jsx` ~L77 | `console.log` de debug ativo no `useEffect` de `isCalculatingLayout` |
| Alta | `App.jsx` ~L1014 e ~L1475 | Overlay de `isCalculatingLayout` duplicado |
| Média | `App.jsx` | 1491 linhas — candidato a extração de hooks |
| Média | `reconfigOptimizer.js` | `console.log` de debug ativos nas iterações do guloso |
| Baixa | `MobileControls.jsx` | Importa `SYSTEM_DATA` hardcoded diretamente |

---

## 10. Convenções do Projeto

- Sem testes automatizados
- Idioma dos textos: português
- Tema dark/light via `theme.js` e classe `dark-mode` no `body`
- Comunicação global de layout via `window.dispatchEvent` com eventos customizados: `triggerZoomExtents`, `applyGraphLayout`, `resetGraphLayout`, `saveToHistory`

---

## 11. Formato de Resposta Esperado

Ao finalizar uma tarefa, responda neste formato:

```
## Alterações Realizadas

**Arquivos modificados:**
- `caminho/arquivo.js` — descrição curta do que mudou

**Arquivos criados:**
- `caminho/novo.js` — descrição

**Arquivos removidos:**
- `caminho/antigo.js`

**Efeitos colaterais conhecidos:**
- Descrição de qualquer impacto em outros módulos

**Pendências / O que NÃO foi feito:**
- Itens que ficaram fora do escopo
```
