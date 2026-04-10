import React from 'react';
import { SYSTEM_DATA } from '../data/systemData';

// ─── Utilitários de cor ───────────────────────────────────────────────────────

/** Cor HSL para barras de carregamento (verde→amarelo→vermelho). */
function loadBarColor(pct) {
    const p = Math.max(0, Math.min(100, pct));
    return `hsl(${((100 - p) * 1.2).toFixed(0)}, 100%, 40%)`;
}

/** Cor para o ponteiro de tensão. */
function voltColor(v) {
    if (v < 0.93) return '#d50000';
    if (v < 0.95) return '#ffd600';
    return '#2e7d32';
}

// ─── Sub-componentes de layout ────────────────────────────────────────────────

/** Separador horizontal sutil. */
function Divider({ darkMode }) {
    return <div style={{ height: 1, background: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)', margin: '10px 0' }} />;
}

/** Par label / valor alinhados. */
function Row({ label, value, valueColor, mono }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--eng-gray)', flexShrink: 0, marginRight: 8 }}>{label}</span>
            <b style={{ color: valueColor || 'inherit', fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right' }}>{value}</b>
        </div>
    );
}

/** Barra de progresso para carregamento (SE/Alimentador/Linha). */
function LoadBar({ pct, darkMode }) {
    const safe = Math.min(Math.max(pct, 0), 100);
    const color = loadBarColor(pct);
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ height: 22, borderRadius: 11, background: darkMode ? '#111' : '#e0e0e0', overflow: 'hidden', position: 'relative' }}>
                <div style={{ height: '100%', width: `${safe}%`, background: color, borderRadius: 11, transition: 'width 0.4s ease, background 0.4s ease', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {safe > 15 && <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{pct.toFixed(1)}%</span>}
                </div>
                {safe <= 15 && (
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 'bold', color: darkMode ? '#aaa' : '#666' }}>{pct.toFixed(1)}%</span>
                )}
            </div>
        </div>
    );
}

/** Medidor bullet de tensão (0.90 → 1.10 pu). */
function VoltGauge({ v, darkMode }) {
    const pct  = Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100));
    const vCol = voltColor(v);
    return (
        <div style={{ marginTop: 12, padding: '0 4px' }}>
            {/* Régua */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--eng-gray)', marginBottom: 5, fontFamily: 'monospace', fontWeight: 'bold' }}>
                <span>0.90</span><span style={{ color: darkMode ? '#ccc' : '#555' }}>1.00</span><span>1.10</span>
            </div>
            {/* Trilha gradiente */}
            <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'linear-gradient(90deg,#d32f2f 0%,#d32f2f 15%,#fbc02d 25%,#388e3c 40%,#388e3c 60%,#fbc02d 75%,#d32f2f 85%,#d32f2f 100%)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)' }}>
                {/* Centro */}
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.35)', transform: 'translateX(-50%)' }} />
                {/* Ponteiro */}
                <div style={{ position: 'absolute', top: -4, bottom: -4, left: `${pct}%`, width: 6, background: '#fff', border: '1px solid #333', borderRadius: 3, boxShadow: '0 0 5px rgba(0,0,0,0.8)', transform: 'translateX(-50%)', transition: 'left 0.4s cubic-bezier(0.25,1,0.5,1)' }} />
            </div>
            {/* Valor */}
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 14, fontWeight: 'bold', color: vCol, fontFamily: 'monospace' }}>
                {v.toFixed(3)} pu
            </div>
        </div>
    );
}

/** Widget do banco de capacitores (shunt). */
function ShuntWidget({ shunt, nodeId, handleShuntChange, darkMode }) {
    const totalKVar = (shunt.steps * shunt.stepSize);
    const atMax     = shunt.steps >= shunt.maxSteps;
    const atMin     = shunt.steps <= 0;

    const btnBase = {
        flex: 1, padding: '7px 0', borderRadius: 6, fontWeight: 'bold',
        cursor: 'pointer', transition: 'all 0.2s', fontSize: 12
    };
    const btnOff = {
        ...btnBase, cursor: 'not-allowed',
        background: darkMode ? '#2a2a2a' : '#eee',
        color: darkMode ? '#555' : '#aaa',
        border: `1px solid ${darkMode ? '#333' : '#ddd'}`,
    };

    return (
        <div style={{ background: darkMode ? 'rgba(0,188,212,0.05)' : 'rgba(0,188,212,0.06)', border: `1px solid ${darkMode ? 'rgba(0,188,212,0.25)' : 'rgba(0,188,212,0.35)'}`, borderRadius: 8, padding: '12px 14px' }}>
            {/* Título e valor */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--eng-gray)' }}>Banco de Capacitores</span>
                <span style={{ fontSize: 15, fontWeight: 'bold', color: totalKVar > 0 ? '#00bcd4' : (darkMode ? '#555' : '#aaa') }}>
                    {totalKVar} kVAr
                </span>
            </div>

            {/* Controles */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                    disabled={atMin}
                    onClick={() => handleShuntChange && handleShuntChange(nodeId, -1)}
                    style={atMin ? btnOff : {
                        ...btnBase,
                        background: darkMode ? '#2c2c2c' : '#fce4e4',
                        color: darkMode ? '#ff5252' : '#d32f2f',
                        border: `1px solid ${darkMode ? 'rgba(255,82,82,0.3)' : 'rgba(211,47,47,0.3)'}`,
                    }}>
                    − Passo
                </button>

                {/* Indicador de passos */}
                <div style={{ minWidth: 44, textAlign: 'center', padding: '7px 0', borderRadius: 6, background: darkMode ? '#111' : '#fff', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, fontWeight: 'bold', fontSize: 16, color: shunt.steps > 0 ? '#00bcd4' : (darkMode ? '#555' : '#aaa') }}>
                    {shunt.steps}
                </div>

                <button
                    disabled={atMax}
                    onClick={() => handleShuntChange && handleShuntChange(nodeId, 1)}
                    style={atMax ? btnOff : {
                        ...btnBase,
                        background: darkMode ? '#2c2c2c' : '#e8f5e9',
                        color: darkMode ? '#4caf50' : '#2e7d32',
                        border: `1px solid ${darkMode ? 'rgba(76,175,80,0.3)' : 'rgba(46,125,50,0.3)'}`,
                    }}>
                    + Passo
                </button>
            </div>

            {/* Info passos */}
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--eng-gray)', marginTop: 8 }}>
                {shunt.steps} / {shunt.maxSteps} passos · {shunt.stepSize} kVAr por passo
            </div>
        </div>
    );
}

// ─── Inspetor de Nó ───────────────────────────────────────────────────────────

function NodeInspector({ id, sources, feedersList, branches, lineCurrents, nodeData, faultNodes, systemShunts, handleShuntChange, sses, darkMode }) {
    const isMainSource = sources.includes(id);
    const isFeeder     = feedersList.includes(id);
    const isSource     = isMainSource || isFeeder;

    const nd     = nodeData?.[id] || { v: 0, angle: 0 };
    const v      = nd.v    || 0;
    const angle  = nd.angle || 0;
    const vCol   = voltColor(v);
    const loadKW = SYSTEM_DATA.loads?.[id];

    // Cálculo de potência para SE e alimentadores
    let totalP = 0, totalQ = 0, totalS = 0;
    if (isSource && lineCurrents) {
        if (isMainSource) {
            branches.forEach(b => {
                if (b.state !== 1 || !lineCurrents[b.id]) return;
                if      (b.from === id) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; }
                else if (b.to   === id) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
            });
            totalP = Math.abs(totalP); totalQ = Math.abs(totalQ);
        } else {
            let sp = 0, sq = 0;
            branches.forEach(b => {
                if (b.state !== 1 || !lineCurrents[b.id]) return;
                if (b.from === id || b.to === id) {
                    sp += Math.abs(lineCurrents[b.id].pFlow);
                    sq += Math.abs(lineCurrents[b.id].qFlow);
                }
            });
            totalP = sp / 2; totalQ = sq / 2;
        }
        totalS = Math.sqrt(totalP ** 2 + totalQ ** 2);
    }

    const sLimit       = (sses?.[id]) || 1000;
    const loadingPct   = isSource ? (totalS / sLimit) * 100 : 0;
    const loadingColor = loadingPct > 100 ? '#d50000' : (loadingPct > 75 ? '#ff9800' : '#2e7d32');
    const shunt        = systemShunts?.[id];

    const titleLabel = isMainSource ? `Subestação ${id}` : (isFeeder ? `Alimentador ${id}` : `Barra ${id}`);
    const typeLabel  = isMainSource ? 'Subest. Principal' : (isFeeder ? 'Alimentador' : 'Carga');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Título */}
            <div className="inspector-title">{titleLabel}</div>

            {/* Tipo */}
            <Row label="Tipo:" value={typeLabel} />

            {/* Potência: SE ou Alimentador */}
            {isSource && (
                <>
                    <Divider darkMode={darkMode} />
                    <Row label={isFeeder ? 'Demanda P:' : 'Geração P:'} value={`${totalP.toFixed(1)} kW`}   />
                    <Row label={isFeeder ? 'Demanda Q:' : 'Geração Q:'} value={`${totalQ.toFixed(1)} kVAr`} />
                    <Row label={isFeeder ? 'Demanda S:' : 'Geração S:'} value={`${totalS.toFixed(1)} kVA`}  />
                    <Row label="Limite (SSE):" value={`${sLimit.toFixed(0)} kVA`} />
                </>
            )}

            {/* Carga instalada para barras de carga */}
            {!isSource && loadKW && (loadKW.p > 0 || loadKW.q > 0) && (
                <>
                    <Divider darkMode={darkMode} />
                    <Row label="Carga P:" value={`${(loadKW.p).toFixed(1)} kW`}   />
                    <Row label="Carga Q:" value={`${(loadKW.q).toFixed(1)} kVAr`} />
                </>
            )}

            {/* Banco de capacitores */}
            {shunt && (
                <>
                    <Divider darkMode={darkMode} />
                    <ShuntWidget
                        shunt={shunt}
                        nodeId={id}
                        handleShuntChange={handleShuntChange}
                        darkMode={darkMode}
                    />
                </>
            )}

            {/* Tensão */}
            <Divider darkMode={darkMode} />
            <Row label="Tensão:"  value={`${v.toFixed(3)} pu`} valueColor={vCol} mono />
            <Row label="Ângulo:"  value={`${angle.toFixed(2)}°`} mono />

            {/* Medidor visual de tensão/carregamento */}
            {isSource
                ? <LoadBar pct={loadingPct} darkMode={darkMode} />
                : <VoltGauge v={v} darkMode={darkMode} />
            }
        </div>
    );
}

// ─── Inspetor de Linha ────────────────────────────────────────────────────────

function EdgeInspector({ data, branches, lineCurrents, handleTapChange, darkMode }) {
    const liveBranch  = branches.find(b => b.id === data.id) || data;
    const currentInfo = lineCurrents?.[liveBranch.id];
    const barColor    = currentInfo ? loadBarColor(currentInfo.percentage) : '#888';
    const isOpen      = liveBranch.state !== 1;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Título */}
            <div className="inspector-title">
                Linha {liveBranch.from}–{liveBranch.to}
            </div>

            {/* Status com badge colorido */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--eng-gray)' }}>Status:</span>
                <span style={{ fontWeight: 'bold', padding: '2px 10px', borderRadius: 20, fontSize: 11, background: isOpen ? 'rgba(244,67,54,0.15)' : 'rgba(76,175,80,0.15)', color: isOpen ? '#f44336' : '#4caf50' }}>
                    {isOpen ? 'ABERTO' : 'FECHADO'}
                </span>
            </div>

            <Divider darkMode={darkMode} />
            <Row label="Resistência (R):" value={`${liveBranch.r} Ω`} />
            <Row label="Reatância (X):"   value={`${liveBranch.x} Ω`} />
            <Row label="Limite (Imax):"   value={`${liveBranch.Imax} A`} />

            {/* Regulador de tensão (TAP) */}
            {liveBranch.isRegulator && (
                <>
                    <Divider darkMode={darkMode} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--eng-gray)' }}>Regulador de Tensão</span>
                        <b style={{ color: '#00bcd4', fontFamily: 'monospace' }}>
                            Tap {liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap}
                        </b>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => handleTapChange(liveBranch.id, -1)}
                            disabled={liveBranch.currentTap <= -liveBranch.maxTaps}
                            style={{
                                flex: 1, padding: '7px 0', borderRadius: 6, fontWeight: 'bold', fontSize: 12,
                                cursor: liveBranch.currentTap <= -liveBranch.maxTaps ? 'not-allowed' : 'pointer',
                                background: liveBranch.currentTap <= -liveBranch.maxTaps ? (darkMode ? '#2a2a2a' : '#eee') : '#d32f2f',
                                color: liveBranch.currentTap <= -liveBranch.maxTaps ? (darkMode ? '#555' : '#aaa') : '#fff',
                                border: 'none', transition: 'all 0.2s',
                            }}>
                            − TAP
                        </button>
                        <button
                            onClick={() => handleTapChange(liveBranch.id, 1)}
                            disabled={liveBranch.currentTap >= liveBranch.maxTaps}
                            style={{
                                flex: 1, padding: '7px 0', borderRadius: 6, fontWeight: 'bold', fontSize: 12,
                                cursor: liveBranch.currentTap >= liveBranch.maxTaps ? 'not-allowed' : 'pointer',
                                background: liveBranch.currentTap >= liveBranch.maxTaps ? (darkMode ? '#2a2a2a' : '#eee') : '#2e7d32',
                                color: liveBranch.currentTap >= liveBranch.maxTaps ? (darkMode ? '#555' : '#aaa') : '#fff',
                                border: 'none', transition: 'all 0.2s',
                            }}>
                            + TAP
                        </button>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--eng-gray)', marginTop: 6 }}>
                        Faixa operacional: ±{liveBranch.maxTaps} posições
                    </div>
                </>
            )}

            {/* Corrente e carregamento (linha fechada) */}
            {!isOpen && currentInfo && (
                <>
                    <Divider darkMode={darkMode} />
                    <Row label="Corrente:"    value={`${currentInfo.current.toFixed(1)} A`} />
                    <Row label="Perdas (I²R):" value={`${(3 * currentInfo.current ** 2 * liveBranch.r / 1000).toFixed(2)} kW`} />
                    <LoadBar pct={currentInfo.percentage} darkMode={darkMode} />
                    <div style={{ textAlign: 'center', fontSize: 11, marginTop: 6, fontWeight: 'bold', color: currentInfo.percentage > 100 ? '#d50000' : (currentInfo.percentage > 80 ? '#ff9800' : (darkMode ? '#aaa' : '#666')) }}>
                        {currentInfo.percentage >= 100 ? '⚠️ SOBRECARGA' : currentInfo.percentage > 80 ? 'Carga Alta' : 'Normal'}
                    </div>
                </>
            )}
        </div>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function FaultPanel({
    isFaultSidebarOpen,
    setFaultSidebarOpen,
    sources,
    loadNodes,
    faultNodes,
    nodeFeeds,
    toggleFault,
    selectedElement,
    setSelectedElement,
    setHoveredNodeId,
    getNodeColor,
    darkMode,
    THEME,
    nodeData,
    lineCurrents,
    loads,
    branches,
    sses,
    feedersList    = [],
    handleTapChange,
    systemShunts   = {},
    handleShuntChange,
}) {
    const getStatusText = (id) => {
        if (faultNodes.has(id)) return 'EM FALTA';
        const feeds = nodeFeeds[id];
        if (!feeds || feeds.size === 0) return 'DESENERGI.';
        if (feeds.size > 1) return 'EM LOOP';
        return 'ENERGIZADO';
    };

    return (
        <div className={`right-sidebar ${isFaultSidebarOpen ? 'open' : ''}`}>

            {/* ═══════════════════════════════════════════
                INSPETOR DE ELEMENTO
                ═══════════════════════════════════════════ */}
            <div
                className="inspector"
                style={{
                    borderBottom: '2px solid var(--border-color)',
                    background: 'var(--card-bg)',
                    padding: '18px 18px 14px',
                    // Altura automática com máximo — scroll quando necessário
                    maxHeight: '52vh',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    // Scrollbar fina e discreta
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,255,255,0.15) transparent',
                }}
            >
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                        <NodeInspector
                            id={selectedElement.id}
                            sources={sources}
                            feedersList={feedersList}
                            branches={branches}
                            lineCurrents={lineCurrents}
                            nodeData={nodeData}
                            faultNodes={faultNodes}
                            systemShunts={systemShunts}
                            handleShuntChange={handleShuntChange}
                            sses={sses}
                            darkMode={darkMode}
                        />
                    ) : (
                        <EdgeInspector
                            data={selectedElement.data}
                            branches={branches}
                            lineCurrents={lineCurrents}
                            handleTapChange={handleTapChange}
                            darkMode={darkMode}
                        />
                    )
                ) : (
                    <div className="inspector-empty" style={{ margin: 'auto', padding: '40px 0', textAlign: 'center' }}>
                        Passe o mouse sobre um elemento
                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════════
                CABEÇALHO DO GERENCIADOR
                ═══════════════════════════════════════════ */}
            <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)', flexShrink: 0 }}>
                <h2 style={{ fontSize: 14, margin: 0, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--eng-gray)' }}>
                    Gerenciador de Faltas
                </h2>
            </div>

            {/* ═══════════════════════════════════════════
                LISTA DE BARRAS
                ═══════════════════════════════════════════ */}
            <div className="fault-list">

                {/* Subestações principais */}
                <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--eng-gray)', letterSpacing: '0.8px', marginBottom: 8, textTransform: 'uppercase' }}>
                    Subestação Principal
                </div>
                {sources.map(id => (
                    <FaultItem
                        key={id}
                        id={id}
                        label={`SUB ${id}`}
                        selectedId={selectedElement?.id}
                        faultNodes={faultNodes}
                        getNodeColor={getNodeColor}
                        darkMode={darkMode}
                        THEME={THEME}
                        statusText={getStatusText(id)}
                        setSelectedElement={setSelectedElement}
                        setHoveredNodeId={setHoveredNodeId}
                        toggleFault={toggleFault}
                    />
                ))}

                {/* Alimentadores */}
                {feedersList.length > 0 && (
                    <>
                        <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--eng-gray)', letterSpacing: '0.8px', margin: '16px 0 8px', textTransform: 'uppercase' }}>
                            Alimentadores
                        </div>
                        {feedersList.map(id => (
                            <FaultItem
                                key={id}
                                id={id}
                                label={`Alim. ${id}`}
                                selectedId={selectedElement?.id}
                                faultNodes={faultNodes}
                                getNodeColor={getNodeColor}
                                darkMode={darkMode}
                                THEME={THEME}
                                statusText={getStatusText(id)}
                                setSelectedElement={setSelectedElement}
                                setHoveredNodeId={setHoveredNodeId}
                                toggleFault={toggleFault}
                            />
                        ))}
                    </>
                )}

                {/* Barras de carga */}
                <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--eng-gray)', letterSpacing: '0.8px', margin: '16px 0 8px', textTransform: 'uppercase' }}>
                    Barras de Carga
                </div>
                {loadNodes.map(id => (
                    <FaultItem
                        key={id}
                        id={id}
                        label={`Barra ${id}`}
                        selectedId={selectedElement?.id}
                        faultNodes={faultNodes}
                        getNodeColor={getNodeColor}
                        darkMode={darkMode}
                        THEME={THEME}
                        statusText={getStatusText(id)}
                        setSelectedElement={setSelectedElement}
                        setHoveredNodeId={setHoveredNodeId}
                        toggleFault={toggleFault}
                    />
                ))}
            </div>
        </div>
    );
}

// ─── Item da lista de faltas ──────────────────────────────────────────────────

function FaultItem({ id, label, selectedId, faultNodes, getNodeColor, darkMode, THEME, statusText, setSelectedElement, setHoveredNodeId, toggleFault }) {
    const isFault      = faultNodes.has(id);
    const nodeColor    = getNodeColor(id);
    const deColor      = darkMode ? THEME.dark.de : THEME.light.de;
    const isDeenergized = nodeColor === deColor;
    const isSelected   = selectedId === id;

    // Cor do badge de status
    const badgeColor =
        isFault        ? '#d50000' :
        statusText === 'EM LOOP'       ? '#ffd600' :
        statusText === 'DESENERGI.' ? (darkMode ? '#555' : '#bbb') :
        nodeColor;

    const badgeTextColor =
        statusText === 'ENERGIZADO' && !isDeenergized ? '#000' : '#fff';

    return (
        <div
            className={`fault-item ${isSelected ? 'selected' : ''}`}
            onClick={() => setSelectedElement({ type: 'node', id })}
            onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id }); }}
            onMouseLeave={() => setHoveredNodeId(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
            <span style={{ fontSize: 13 }}>{label}</span>
            <button
                className={`fault-btn-rect ${isFault ? 'is-fault' : ''}`}
                style={{
                    background: isFault ? '#d50000' : badgeColor,
                    color: isFault ? '#fff' : badgeTextColor,
                    minWidth: 94,
                    fontSize: 11,
                    letterSpacing: '0.4px',
                    border: 'none',
                }}
                onClick={(e) => { e.stopPropagation(); toggleFault(id); }}
            >
                {isFault ? '⚡ FALTA' : statusText}
            </button>
        </div>
    );
}
