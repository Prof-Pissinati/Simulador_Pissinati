# 📐 PLANO DE IMPLEMENTAÇÃO: OTIMIZAÇÃO DE LAYOUT DE BARRAS
**Versão:** 1.0 | **Data:** 02/05/2026 | **Responsável:** Gerente de Projetos com IA  
**Objetivo:** Modernizar o motor de layout do simulador, reduzindo cruzamentos, mantendo performance <3s para ~200 barras e preservando a arquitetura assíncrona atual.

---

## 🧭 COMO USAR ESTE GUIA COM IA
1. **Trabalhe por fases.** Não peça tudo de uma vez. Cada fase é autossuficiente e deve ser validada antes de prosseguir.
2. **Use os prompts prontos.** Copie e cole exatamente como estão. Adicione apenas o contexto do seu repositório se a IA solicitar.
3. **Peça sempre diffs ou patches completos.** Evite alterações parciais. Solicite: `"Retorne o código completo do arquivo modificado, destacando as linhas alteradas com comentários // AI-CHANGE"`
4. **Valide em sandbox.** Rode o worker isoladamente com `console.time` e métricas de cruzamento antes de integrar ao `App.jsx`.
5. **Commit por fase.** `feat(layout): phase-X-<nome>`. Mantenha o histórico limpo para rollback rápido.

---

## 📊 MÉTRICAS DE SUCESSO
| Indicador | Meta Atual | Meta Pós-Implementação |
|-----------|------------|------------------------|
| Cruzamentos totais | ~15–30% das arestas | ≤ 5% das arestas |
| Tempo de cálculo (N=200) | 4–8s | ≤ 3s |
| Sobreposição de nós | 0% (já resolvido) | 0% (mantido) |
| Complexidade global | O(N²) travado | O(N log N) ou O(K²) |
| Compatibilidade com `applySystemData()` | Total | Total |

---

## 📅 FASE 1: CLASSIFICADOR TOPOLÓGICO + SELEÇÃO AUTOMÁTICA DE MOTOR
**Objetivo:** Analisar a topologia importada e escolher o motor ideal automaticamente.

### 🔧 Prompt para IA
```text
Crie uma função JS pura `classifyTopology(nodesArray, branchesArray)` que:
1. Calcule número de vértices (V), arestas (E) e laços: L = E - V + 1.
2. Execute BFS a partir das fontes (serão passadas como config.sources) para obter profundidade máxima e número de níveis hierárquicos.
3. Calcule grau médio dos nós.
4. Retorne: { type: 'radial' | 'weakly_meshed' | 'large', suggestedEngine: 'orthogonal' | 'vns' | 'force', metrics: { loops, maxDepth, avgDegree, nodeCount } }
Regras de decisão:
- loops === 0 && nodeCount < 250 → radial / orthogonal
- loops <= 10 && nodeCount < 300 → weakly_meshed / vns
- nodeCount >= 250 || loops > 10 → large / force
Mantenha a função leve (<50 linhas) e sem dependências externas.
```

### 📍 Integração
- Adicionar em `autoLayout.js`.
- No `layoutWorker.js`, interceptar `type === 'auto'` → chamar classificador → mapear para motor oficial.
- Atualizar `runLayoutWorker.js` para suportar `type: 'auto'`.

### ✅ Validação
- Testar com IEEE 53/54 (radial), sistema sintético com 3 anéis, sistema >300 barras.
- Verificar se o motor retornado corresponde à topologia real.

### ⚠️ Riscos & Mitigação
- **Risco:** Classificação falsa em grafos desconectados.  
- **Mitigação:** Adicionar verificação de componentes conectados antes do BFS.

---

## 📅 FASE 2: BARYCENTER SWEEP (ORDENAÇÃO HIERÁRQUICA)
**Objetivo:** Alinhar alimentadores por profundidade elétrica, reduzindo cruzamentos por construção.

### 🔧 Prompt para IA
```text
Implemente `applyBarycenterSweep(positions, nodesArray, branchesArray, sourcesArray)` que:
1. Calcule níveis hierárquicos via BFS a partir de sourcesArray (fonte = nível 0).
2. Agrupe os nós por nível.
3. Para cada nível > 0, calcule o baricentro X dos pais conectados no nível anterior.
4. Ordene os nós do nível atual pelo baricentro calculado.
5. Reposicione os nós mantendo o grid atual (arredonde para múltiplos do gridSize implícito).
Retorne o novo objeto de posições. Não altere coordenadas Y, apenas reordene X dentro do mesmo nível.
```

### 📍 Integração
- Executar **após** `calculateForceLayout` e **antes** de `applySmartCompaction`.
- Passar `gridSize` via `config` ou inferir do espaçamento médio.

### ✅ Validação
- Verificar visualmente alinhamento de ramais de mesmo alimentador.
- Contar cruzamentos antes/depois em sistema radial com 3+ alimentadores.

### ⚠️ Riscos & Mitigação
- **Risco:** Destruição de layout já otimizado em redes malhadas.  
- **Mitigação:** Aplicar apenas se `type === 'radial'` ou `maxDepth >= 3`.

---

## 📅 FASE 3: PENALIZAÇÃO INTELIGENTE DE CRUZAMENTOS
**Objetivo:** Ponderar cruzamentos na função de custo por contexto elétrico (fonte, mesmo alimentador, alimentadores diferentes).

### 🔧 Prompt para IA
```text
Modifique `getLocalCost` e `getSystemCost` em `autoLayout.js` para aceitar `feederMap` (objeto { nodeId: feederId }).
Regras de penalização de cruzamento entre segmentos:
- 100.000 se cruzar com nó-fonte (sourcesArray.includes(id))
- 50.000 se os ramos pertencem a alimentadores diferentes (feederMap[fromA] !== feederMap[fromB])
- 10.000 se pertencem ao mesmo alimentador
Mantenha a estrutura de custo local atual. Use lookup O(1) para feederMap. Adicione comentários // AI-PENALTY nas linhas alteradas.
```

### 📍 Integração
- Calcular `feederMap` no `layoutWorker.js` a partir de `systemFeeders` ou BFS.
- Passar `config.feederMap` para `calculateOrthogonalLayout` / `calculateVNSLayout`.

### ✅ Validação
- Rodar sistema com 2 alimentadores cruzados. Verificar se o motor prioriza separá-los.
- Medir redução de `cost` final sem aumento de tempo >15%.

### ⚠️ Riscos & Mitigação
- **Risco:** Penalização excessiva travando convergência.  
- **Mitigação:** Adicionar fator de decaimento `penalty * (1 / (pass + 1))` nas primeiras iterações.

---

## 📅 FASE 4: SWAP GLOBAL ESCALÁVEL (CROSSING-AWARE)
**Objetivo:** Substituir o loop `O(N²)` travado em N>150 por heurística seletiva e rápida.

### 🔧 Prompt para IA
```text
Substitua a seção "NÍVEL 1: Swaps Globais" em `applySmartCompaction` por uma função `applySmartGlobalSwap(pos, nodesArray, branchesArray, levels, feederMap)`.
Regras:
1. Só avalie trocas entre nós do mesmo nível hierárquico ou que compartilhem feederId.
2. Pré-filtre candidatos usando `getLocalCost`: só tente swap se a diferença de custo local < 20.000.
3. Limite a 5.000 avaliações por passagem. Use índice aleatório se necessário.
4. Mantenha a verificação de melhoria global apenas nos swaps promissores.
Retorne `improved = true` se algum swap for aplicado.
```

### 📍 Integração
- Substituir bloco `if (nodesArray.length <= 150)` pelo novo algoritmo.
- Garantir que `levels` e `feederMap` estejam disponíveis no escopo do worker.

### ✅ Validação
- Benchmark em N=200 e N=400. Tempo deve cair para <3s.
- Verificar se não há regressão em qualidade (cruzamentos ≤ versão anterior).

### ⚠️ Riscos & Mitigação
- **Risco:** Trocas locais criam novos cruzamentos globais.  
- **Mitigação:** Validar swap com `getSystemCost` apenas nos 5% melhores candidatos.

---

## 📅 FASE 5: ROTEAMENTO DE ARESTAS COM WAYPOINTS
**Objetivo:** Gerar caminhos ortogonais pós-layout para eliminar cruzamentos residuais sem mover nós.

### 🔧 Prompt para IA
```text
Crie `calculateOrthogonalWaypoints(positions, nodesArray, branchesArray, gridSize)` que:
1. Para cada ramo, verifique se a linha direta cruza outros ramos ou nós.
2. Se cruza, calcule 1 ou 2 pontos de inflexão usando canais livres (grid adjacente não ocupado).
3. Priorize rotas ortogonais (M → L → L). Evite curvas desnecessárias.
4. Retorne objeto: { waypoints: { branchId: [{x,y}, ...] }, crossingsResolved: count }
Não altere posições de nós. Use busca em grade simples (A* simplificado ou flood-fill de 1 passo).
```

### 📍 Integração
- Executar **após** `applySmartCompaction`.
- Retornar via `postMessage({ positions, waypoints })`.
- Atualizar `GraphEdge.jsx` para usar `<path>` quando `waypoints[branch.id]` existir.

### ✅ Validação
- Renderizar SVG com e sem waypoints. Contar interseções geométricas.
- Verificar se performance de renderização não degrada (>60fps).

### ⚠️ Riscos & Mitigação
- **Risco:** Waypoints colidem com nós em layout denso.  
- **Mitigação:** Adicionar margem de segurança `gridSize * 0.3` e fallback para linha direta se rota falhar.

---

## 🔄 FLUXO DE TRABALHO PADRÃO (CHECKLIST POR FASE)
1. [ ] Solicitar código à IA usando o prompt exato.
2. [ ] Revisar alterações: buscar `// AI-CHANGE`, `console.log` desnecessários, vazamento de memória.
3. [ ] Rodar teste isolado no worker com `console.time`.
4. [ ] Integrar ao pipeline atual (não sobrescrever `applySystemData()`).
5. [ ] Validar métricas (tempo, cruzamentos, sobreposição).
6. [ ] Commit com tag da fase.
7. [ ] Atualizar este documento com resultados reais.

---

## 🛡️ REGRAS DE ARQUITETURA (NÃO QUEBRAR)
- ✅ Web Worker continua sendo o único responsável por cálculos pesados.
- ✅ `applySystemData()` permanece intocável.
- ✅ Eventos customizados (`applyGraphLayout`, `triggerZoomExtents`) preservados.
- ✅ `isCalculatingLayout` e `layoutProgress` mantidos para UI.
- ✅ Zero dependências externas além de `d3-force` (já presente).

---

## 📈 PRÓXIMOS PASSOS IMEDIATOS
1. Salve este arquivo como `PLANO_IMPLEMENTACAO_LAYOUT.md` na raiz do projeto.
2. Inicie pela **Fase 1**. Execute o ciclo completo antes de abrir a próxima issue.
3. Mantenha um log de métricas por fase: `metrics_layout.csv` com `{ fase, nodeCount, loops, time_ms, crossings_before, crossings_after, memory_mb }`.

Se precisar que eu gere o **template do log de métricas**, o **script de benchmark isolado para o worker**, ou os **prompts de fallback** para cada fase, é só solicitar.