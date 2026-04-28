# Plano de Implementação — Interação + Performance

> Para IA colaboradora
> Contexto completo do projeto: ver `PROJETO_VISAO_GERAL.md`

---

## Commit 1 — Ctrl+Clique para Seleção Permanente

**Arquivos:** `src/hooks/useGridInteraction.js` e `src/components/GraphArea.jsx`

### 1.1 `useGridInteraction.js`

Adicionar detecção de `ctrlKey` compatível com Leaflet (evento nativo) e React (evento sintético).

**`handleNodeClick` — novo fluxo completo:**
```js
const handleNodeClick = useCallback((nodeId, event) => {
    if (isEditMode) return;

    const isCtrl = event?.ctrlKey || event?.originalEvent?.ctrlKey || event?.metaKey || event?.originalEvent?.metaKey;
    const isShift = event?.shiftKey || event?.originalEvent?.shiftKey;

    if (isCtrl) {
        setSelectedElement({ type: 'node', id: parseInt(nodeId) });
        return; // SEM tooltip, SEM toggleFault
    }
    if (isShift) {
        setSelectedElement({ type: 'node', id: parseInt(nodeId) });
        if (onPinCard) onPinCard('node', nodeId, event);
        return;
    }
    toggleFault(parseInt(nodeId));
}, [isEditMode, setSelectedElement, toggleFault, onPinCard]);
```

**`handleEdgeClick` — novo fluxo completo:**
```js
const handleEdgeClick = useCallback((branchObj, fallbackId, event) => {
    if (isEditMode) return;

    const branchId = branchObj.id !== undefined ? branchObj.id : fallbackId;
    const isCtrl = event?.ctrlKey || event?.originalEvent?.ctrlKey || event?.metaKey || event?.originalEvent?.metaKey;
    const isShift = event?.shiftKey || event?.originalEvent?.shiftKey;

    if (isCtrl) {
        setSelectedElement({ type: 'edge', data: branchObj });
        return; // SEM tooltip, SEM toggleSwitch
    }
    if (isShift) {
        setSelectedElement({ type: 'edge', data: branchObj });
        if (onPinCard) onPinCard('line', branchId, event);
        return;
    }
    if (branchObj.hasSwitch) toggleSwitch(branchId);
}, [isEditMode, setSelectedElement, toggleSwitch, onPinCard]);
```

### 1.2 `GraphArea.jsx`

**`handleNodeClick` (~linha 456) — novo fluxo completo:**
```js
const handleNodeClick = useCallback((e, nodeId) => {
    e.stopPropagation();
    const ctx = contextRef.current;
    if (ctx.isEditMode || wasDragged.current) return;

    if (e.ctrlKey || e.metaKey) {
        ctx.setSelectedElement({ type: 'node', id: nodeId });
        return; // SEM tooltip, SEM toggleFault
    }
    if (e.shiftKey) {
        ctx.setSelectedElement({ type: 'node', id: nodeId });
        const rawPt = getRawSVGPoint(e.clientX, e.clientY);
        const spawnX = (rawPt.x - transform.x) / transform.scale;
        const spawnY = (rawPt.y - transform.y) / transform.scale;
        setPinnedCards(prev => {
            const exists = prev.find(p => p.id === nodeId && p.type === 'node');
            if (exists) return prev.filter(p => !(p.id === nodeId && p.type === 'node'));
            return [...prev, { id: nodeId, type: 'node', x: spawnX + 20, y: spawnY + 20 }];
        });
        return;
    }
    ctx.toggleFault(nodeId);
}, [getRawSVGPoint, transform]);
```

**`handleLineClick` (~linha 303) — novo fluxo completo:**
```js
const handleLineClick = useCallback((e, branchId) => {
    e.stopPropagation();
    const ctx = contextRef.current;
    if (ctx.isEditMode) return;

    if (e.ctrlKey || e.metaKey) {
        const branch = ctx.branches.find(b => b.id === branchId);
        ctx.setSelectedElement({ type: 'edge', data: branch });
        return; // SEM tooltip, SEM toggleSwitch
    }
    if (e.shiftKey) {
        const branch = ctx.branches.find(b => b.id === branchId);
        ctx.setSelectedElement({ type: 'edge', data: branch });
        const rawPt = getRawSVGPoint(e.clientX, e.clientY);
        const spawnX = (rawPt.x - transform.x) / transform.scale;
        const spawnY = (rawPt.y - transform.y) / transform.scale;
        setPinnedCards(prev => {
            const exists = prev.find(p => p.id === branchId && p.type === 'line');
            if (exists) return prev.filter(p => !(p.id === branchId && p.type === 'line'));
            return [...prev, { id: branchId, type: 'line', x: spawnX + 20, y: spawnY + 20 }];
        });
        return;
    }
    const branch = ctx.branches.find(b => b.id === branchId);
    if (branch.hasSwitch || ctx.maintenanceMode) ctx.toggleSwitch(branchId);
}, [getRawSVGPoint, transform]);
```

---

## Commit 2 — Ajustes MapArea

**Arquivo:** `src/components/MapArea.jsx`

### 2.1 Mover controles de zoom para canto direito

```jsx
import { MapContainer, TileLayer, Tooltip, Polyline, Marker, useMapEvents, ZoomControl } from 'react-leaflet';

// Adicionar zoomControl={false} no MapContainer e renderizar ZoomControl separado:
<MapContainer center={center} zoom={15} doubleClickZoom={false} zoomControl={false} style={...}>
    <ZoomControl position="bottomright" />
    ...
</MapContainer>
```

### 2.2 Reduzir gaps das linhas pontilhadas

Localizar a prop `dashArray` na Polyline:

```jsx
// Antes:
dashArray={isClosed ? null : "10, 10"}

// Depois:
dashArray={isClosed ? null : "10, 3"}
```

---

## Commit 3 — Viewport Culling no GraphArea

**Arquivo:** `src/components/GraphArea.jsx`

### Contexto

Durante pan/zoom, `setTransform` dispara re-render do GraphArea. Sem culling, o React tenta renderizar todos os elementos mesmo os invisíveis. Com 10k barras (espaçamento ~100px) isso é inviável.

### Regras do culling

- **Nós:** renderiza apenas se a posição está dentro do viewport expandido
- **Arestas:** renderiza se **pelo menos um dos extremos** (p1 ou p2) está dentro do viewport expandido. Isso garante que linhas que saem da tela continuam sendo desenhadas — o SVG corta naturalmente o que excede o container
- **Viewport expandido:** viewport real + uma tela inteira de margem em cada direção, adaptada ao zoom atual
- **Modo impressão:** culling desativado — renderiza todos os elementos

### 3.1 Declarar `visibleBounds` antes do `return`

Adicionar logo antes do `return` do componente, após todos os estados e callbacks:

```js
const visibleBounds = useMemo(() => {
    // Modo impressão: renderiza tudo
    if (printFrameMode !== 'none') {
        return { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    }
    // Margem dinâmica = uma tela inteira extra em cada direção, em coordenadas do mundo.
    // Adapta ao zoom: com zoom alto a margem em unidades do mundo fica menor.
    const marginX = containerSize.w / transform.scale;
    const marginY = containerSize.h / transform.scale;
    return {
        minX: (-transform.x) / transform.scale - marginX,
        minY: (-transform.y) / transform.scale - marginY,
        maxX: (-transform.x + containerSize.w) / transform.scale + marginX,
        maxY: (-transform.y + containerSize.h) / transform.scale + marginY,
    };
}, [transform, containerSize, printFrameMode]);
```

### 3.2 Culling de arestas

No `branches.map`, adicionar imediatamente após obter `p1` e `p2`:

```js
{branches.map(b => {
    const p1 = manualPositions[b.from] || renderPositions[b.from];
    const p2 = manualPositions[b.to] || renderPositions[b.to];
    if (!p1 || !p2) return null;

    // CULLING: descarta apenas se AMBOS os extremos estão fora do viewport expandido.
    // Se pelo menos um extremo é visível, a linha pode cruzar o viewport.
    const p1Out = p1.x < visibleBounds.minX || p1.x > visibleBounds.maxX ||
                  p1.y < visibleBounds.minY || p1.y > visibleBounds.maxY;
    const p2Out = p2.x < visibleBounds.minX || p2.x > visibleBounds.maxX ||
                  p2.y < visibleBounds.minY || p2.y > visibleBounds.maxY;
    if (p1Out && p2Out) return null;

    // ... resto do código existente sem nenhuma mudança
})}
```

### 3.3 Culling de nós

No `allNodes.map`, adicionar imediatamente após obter `pos`:

```js
{allNodes.map(nodeId => {
    const pos = manualPositions[nodeId] || renderPositions[nodeId];
    if (!pos) return null;

    // CULLING: descarta se o nó está completamente fora do viewport expandido
    if (pos.x < visibleBounds.minX || pos.x > visibleBounds.maxX ||
        pos.y < visibleBounds.minY || pos.y > visibleBounds.maxY) {
        return null;
    }

    // ... resto do código existente sem nenhuma mudança
})}
```

### Ganho esperado

Com zoom 1x, tela 900x650, margem de 1 tela extra — elementos renderizados ≈ 3x3 viewports:

| Sistema | Sem culling | Com culling zoom 1x | Com culling zoom 4x |
|---|---|---|---|
| 53 barras | 53 | 53 (todos visíveis) | ~20 |
| 417 barras | 417 | ~200 | ~30 |
| 10k barras | 10.000 | ~500 | ~50 |

### O que NÃO muda

- `SvgTooltips` e `pinnedCards` ficam fora dos maps — não são afetados
- Comportamento visual: linhas que saem do viewport são desenhadas até o extremo fora da tela, o SVG corta naturalmente
- Modo de edição: culling continua ativo — para interagir com um elemento fora da tela o usuário navega até ele, trazendo-o para o viewport

---

## Ordem de Implementação

1. **Commit 1** — `useGridInteraction.js` + `GraphArea.jsx`
2. **Commit 2** — `MapArea.jsx`
3. **Commit 3** — `GraphArea.jsx` (aplicar sobre o resultado do Commit 1)

---

## Formato de Resposta Esperado

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
