import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function SequenceOverlay({
    steps       = [],
    snapshots   = [],
    method      = '',
    isRecording = false,     
    onToggleRecording,       
    onApplySnapshot,
    onHoverBranch,
    onReorderSteps, 
    onDeleteStep,
    onToggleStepAction,
    onUpdateStepValue,
    onActiveStepChange, 
    onExportSequence, 
    onOptimizeSequence, 
    optimizerStatus,    
    onClose,
    darkMode    = true,
    onMoveStage,   // 👈 Nova Prop: Mover etapa
    onDeleteStage  // 👈 Nova Prop: Deletar etapa
}) {

    const [collapsedStages, setCollapsedStages] = useState({});
    
    const toggleStage = (stageName) => {
        setCollapsedStages(prev => ({ ...prev, [stageName]: !prev[stageName] }));
    };

    const [currentStep,  setCurrentStep]  = useState(0);
    const [isPlaying,    setIsPlaying]    = useState(false);
    const [playInterval, setPlayInterval] = useState(1500); 
    const [isExpanded,   setIsExpanded]   = useState(false); 
    const [draggedIdx,   setDraggedIdx]   = useState(null);
    
    const [selectedIndices, setSelectedIndices] = useState([]);
    const [lastClickedIdx, setLastClickedIdx]   = useState(null);

    const intervalRef    = useRef(null);
    const listRef        = useRef(null);

    const bg      = darkMode ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    const surface = darkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)';
    const border  = darkMode ? '#444' : '#ddd';
    const text    = darkMode ? '#eee' : '#222';
    const muted   = darkMode ? '#aaa' : '#666';

    const STEP_COLORS = { open: '#f44336', close: '#4caf50', tap: '#ff9800', fault_add: '#d50000', fault_remove: '#00bcd4', shunt_step: '#00bcd4' };
    const STEP_ICONS  = { open: '🔓', close: '🔒', tap: '⚙️', fault_add: '⚡', fault_remove: '✅', shunt_step: '⟛' };

    const goToStep = useCallback((idx) => {
        const clamped = Math.max(0, Math.min(steps.length, idx));
        setCurrentStep(clamped);
    }, [steps.length]);

    useEffect(() => {
        if (!isPlaying) { clearInterval(intervalRef.current); return; }
        intervalRef.current = setInterval(() => {
            setCurrentStep(prev => prev >= steps.length ? prev : prev + 1);
        }, playInterval);
        return () => clearInterval(intervalRef.current);
    }, [isPlaying, playInterval, steps.length]);

    useEffect(() => {
        if (snapshots[currentStep] && onApplySnapshot) onApplySnapshot(snapshots[currentStep]);
        if (onActiveStepChange) {
            const stepData = currentStep > 0 && currentStep <= steps.length ? steps[currentStep - 1] : null;
            onActiveStepChange(stepData);
        }
        if (isPlaying && currentStep >= steps.length) setIsPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentStep]);

    useEffect(() => {
        if (!isExpanded || !listRef.current) return;
        const active = listRef.current.querySelector('[data-active="true"]');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [currentStep, isExpanded]);

    const handleRowClick = (e, idx, stepNum) => {
        if (e.shiftKey && lastClickedIdx !== null) {
            const start = Math.min(lastClickedIdx, idx);
            const end = Math.max(lastClickedIdx, idx);
            const range = [];
            for (let i = start; i <= end; i++) range.push(i);
            setSelectedIndices(range);
        } else if (e.ctrlKey || e.metaKey) {
            if (selectedIndices.includes(idx)) setSelectedIndices(selectedIndices.filter(i => i !== idx));
            else setSelectedIndices([...selectedIndices, idx]);
            setLastClickedIdx(idx);
        } else {
            setSelectedIndices([idx]);
            setLastClickedIdx(idx);
            goToStep(stepNum);
        }
    };

    const handleDragStart = (e, index) => { 
        if (!selectedIndices.includes(index)) {
            setSelectedIndices([index]);
        }
        setDraggedIdx(index); 
        e.dataTransfer.effectAllowed = "move"; 
        e.dataTransfer.setData("text/plain", index.toString()); 
    };
    
    const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
    
    const handleDrop = (e, dropIdx) => {
        e.preventDefault();
        if (selectedIndices.length === 0) return;

        const indicesToMove = [...selectedIndices].sort((a, b) => a - b);
        if (indicesToMove.includes(dropIdx)) return; 

        const newSteps = [...steps];
        const itemsToMove = indicesToMove.map(i => newSteps[i]);

        for (let i = indicesToMove.length - 1; i >= 0; i--) {
            newSteps.splice(indicesToMove[i], 1);
        }

        const adjustedDropIdx = dropIdx - indicesToMove.filter(i => i < dropIdx).length;
        newSteps.splice(adjustedDropIdx, 0, ...itemsToMove);

        const newSelection = itemsToMove.map((_, i) => adjustedDropIdx + i);
        setSelectedIndices(newSelection);
        setDraggedIdx(null);

        if (onReorderSteps) onReorderSteps(newSteps); 
    };

    const progress = steps.length > 0 ? (currentStep / steps.length) * 100 : 0;
    const currentStepData = currentStep > 0 && currentStep <= steps.length ? steps[currentStep - 1] : null;
    const currentSnapshot = snapshots[currentStep] || snapshots[0] || { disconnectedP: 0, accumulatedENS: 0 };

    return (
        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10500, pointerEvents: 'none', padding: '0 20px', gap: '10px' }}>
            
            {isRecording && (
                <div style={{ background: '#f44336', color: '#fff', padding: '6px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(244, 67, 54, 0.4)', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ animation: 'pulse 1.5s infinite' }}>🔴</span> MODO GRAVAÇÃO ATIVO - Cliques no diagrama serão adicionados à lista
                </div>
            )}

            <div style={{ pointerEvents: 'auto', background: bg, backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)', border: `1px solid ${border}`, borderRadius: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.4)', width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)' }}>
                <div style={{ height: 4, background: surface, position: 'relative', width: '100%' }}>
                    <div style={{ height: '100%', background: '#00bcd4', width: `${progress}%`, transition: 'width 0.3s ease', boxShadow: '0 0 10px rgba(0, 188, 212, 0.8)' }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', gap: '20px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: 11, color: muted, background: surface, padding: '2px 8px', borderRadius: '12px' }}>Passo {currentStep} de {steps.length}</span>
                            <span style={{ fontSize: 10, color: '#ff9800', background: 'rgba(255, 152, 0, 0.1)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(255,152,0,0.3)' }}>{method}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#00bcd4', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentStep === 0 ? (<span style={{ color: muted }}>Pronto para iniciar...</span>) : currentStep === steps.length && !isPlaying ? (<span style={{ color: '#4caf50' }}>✅ Sequenciamento concluído!</span>) : currentStepData ? (<span>{STEP_ICONS[currentStepData.type]} {currentStepData.description.split('→')[0]}</span>) : null}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={() => { setIsPlaying(false); goToStep(currentStep - 1); }} disabled={currentStep === 0} title="Anterior" style={ctrlBtnStyle(darkMode, currentStep === 0)}>◀</button>
                        <button onClick={() => setIsPlaying(p => !p)} disabled={currentStep === steps.length} style={{...ctrlBtnStyle(darkMode, currentStep === steps.length), background: isPlaying ? '#f44336' : '#00bcd4', color: '#000', fontWeight: 'bold', width: '110px'}}> {isPlaying ? '⏸ Pausar' : '▶ Play'} </button>
                        <button onClick={() => { setIsPlaying(false); goToStep(currentStep + 1); }} disabled={currentStep === steps.length} title="Próximo" style={ctrlBtnStyle(darkMode, currentStep === steps.length)}>▶</button>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: muted, marginLeft: 10 }}>
                            <span>{(playInterval / 1000).toFixed(1)}s</span>
                            <input type="range" min={400} max={3000} step={100} value={playInterval} onChange={e => setPlayInterval(Number(e.target.value))} style={{ width: '50px', cursor: 'pointer' }} title="Velocidade" />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', borderLeft: `1px solid ${border}`, paddingLeft: '15px' }}>
                        <div style={{ fontSize: '12px', color: muted }}>Penalidade ENS: <span style={{ color: '#ff9800', fontWeight: 'bold' }}>{currentSnapshot.accumulatedENS.toFixed(0)} kW</span></div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 15 }}>
                        {optimizerStatus && (
                            <div style={{ fontSize: '11px', color: '#00bcd4', marginRight: 'auto', fontStyle: 'italic', animation: 'pulse 1.5s infinite' }}>
                                {optimizerStatus}
                            </div>
                        )}
                        {onOptimizeSequence && (
                            <button 
                                onClick={onOptimizeSequence}
                                style={{ background: 'rgba(0, 188, 212, 0.15)', border: `1px solid #00bcd4`, color: '#00bcd4', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s' }}
                                title="Rodar Algoritmo de Otimização (VND)"
                                onMouseOver={e => e.target.style.background = 'rgba(0, 188, 212, 0.3)'}
                                onMouseOut={e => e.target.style.background = 'rgba(0, 188, 212, 0.15)'}
                            >
                                ✨ Otimizar
                            </button>
                        )}
                        {onExportSequence && (
                            <button 
                                onClick={onExportSequence}
                                style={{ background: 'transparent', border: `1px solid ${border}`, color: text, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s' }}
                                title="Exportar Sequência Modificada (.txt)"
                                onMouseOver={e => e.target.style.background = surface}
                                onMouseOut={e => e.target.style.background = 'transparent'}
                            >
                                Exportar
                            </button>
                        )}

                        <button 
                            onClick={onToggleRecording}
                            style={{ background: isRecording ? 'rgba(244, 67, 54, 0.15)' : 'transparent', border: `1px solid ${isRecording ? '#f44336' : border}`, color: isRecording ? '#f44336' : muted, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s' }}
                            title="Ativar/Desativar Gravação de Cliques no Diagrama"
                        >
                            <span style={{ animation: isRecording ? 'pulse 1.5s infinite' : 'none' }}>⏺</span>
                            {isRecording ? 'Gravando' : 'Gravar'}
                        </button>
                        
                        <div style={{ width: '1px', height: '24px', background: border }}></div>
                        <button onClick={() => setIsExpanded(!isExpanded)} style={iconBtnStyle(darkMode)} title={isExpanded ? "Ocultar Lista" : "Mostrar Lista"}>{isExpanded ? '🔽' : '🔼'}</button>
                        <button onClick={onClose} style={{...iconBtnStyle(darkMode), color: '#f44336'}} title="Fechar (Esc)">✖</button>
                    </div>
                </div>

                <div style={{ maxHeight: isExpanded ? '45vh' : '0px', opacity: isExpanded ? 1 : 0, overflowY: 'auto', transition: 'max-height 0.3s ease, opacity 0.3s ease', borderTop: isExpanded ? `1px solid ${border}` : 'none', background: darkMode ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.02)' }} ref={listRef}>
                    {steps.length === 0 ? (
                        <div style={{ padding: 20, color: muted, textAlign: 'center', fontSize: 13 }}>Lista vazia. Ative a gravação e clique no diagrama para injetar manobras.</div>
                    ) : (
                        Object.entries(
                            steps.reduce((acc, step, idx) => {
                                const stage = step.stage || 'Etapa 1'; 
                                if (!acc[stage]) acc[stage] = [];
                                acc[stage].push({ ...step, globalIdx: idx }); 
                                return acc;
                            }, {})
                        ).map(([stageName, stageSteps]) => {
                            const isCollapsed = collapsedStages[stageName];

                            return (
                                <div key={stageName} style={{ marginBottom: '4px' }}>
                                    
                                    {/* 👇 O NOVO CABEÇALHO DA PASTA COM OS BOTÕES 👇 */}
                                    <div 
                                        onClick={() => toggleStage(stageName)}
                                        style={{ background: darkMode ? '#222' : '#eee', padding: '6px 15px', fontSize: '12px', fontWeight: 'bold', color: '#00bcd4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}` }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '10px' }}>{isCollapsed ? '▶' : '▼'}</span> 
                                            {stageName} 
                                            <span style={{color: muted, fontWeight: 'normal', fontSize: '11px'}}>({stageSteps.length} passos)</span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            {onMoveStage && (
                                                <>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); onMoveStage(stageName, -1); }} 
                                                        title="Mover Etapa para Cima" 
                                                        style={{ background: 'transparent', border: 'none', color: text, cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', transition: 'background 0.2s' }}
                                                        onMouseOver={e => e.target.style.background = surface}
                                                        onMouseOut={e => e.target.style.background = 'transparent'}
                                                    >↑</button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); onMoveStage(stageName, 1); }} 
                                                        title="Mover Etapa para Baixo" 
                                                        style={{ background: 'transparent', border: 'none', color: text, cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', transition: 'background 0.2s' }}
                                                        onMouseOver={e => e.target.style.background = surface}
                                                        onMouseOut={e => e.target.style.background = 'transparent'}
                                                    >↓</button>
                                                </>
                                            )}
                                            {onDeleteStage && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onDeleteStage(stageName); }} 
                                                    title="Excluir Etapa Inteira" 
                                                    style={{ background: 'transparent', border: 'none', color: '#f44336', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', marginLeft: '4px', transition: 'background 0.2s' }}
                                                    onMouseOver={e => e.target.style.background = 'rgba(244, 67, 54, 0.15)'}
                                                    onMouseOut={e => e.target.style.background = 'transparent'}
                                                >✕</button>
                                            )}
                                        </div>
                                    </div>

                                    {!isCollapsed && stageSteps.map((stepWrapper) => {
                                        const step = stepWrapper;
                                        const idx = stepWrapper.globalIdx; 
                                        const stepNum = idx + 1; 
                                        const isDone = stepNum <= currentStep; 
                                        const isCurrent = stepNum === currentStep; 
                                        const isSelected = selectedIndices.includes(idx);
                                        const color = STEP_COLORS[step.type] ?? '#888';
                                        
                                        const canToggle = step.type === 'open' || step.type === 'close' || step.type === 'fault_add' || step.type === 'fault_remove';
                                        const isTap = step.type === 'tap';
                                        const isShunt = step.type === 'shunt_step';

                                        let rowBackground = 'transparent';
                                        if (isCurrent) rowBackground = darkMode ? 'rgba(0, 188, 212, 0.15)' : 'rgba(0, 188, 212, 0.1)';
                                        else if (isSelected) rowBackground = darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

                                        return (
                                            <div 
                                                key={idx} 
                                                data-active={isCurrent} 
                                                draggable 
                                                onDragStart={(e) => handleDragStart(e, idx)} 
                                                onDragOver={handleDragOver} 
                                                onDrop={(e) => handleDrop(e, idx)} 
                                                onClick={(e) => handleRowClick(e, idx, stepNum)} 
                                                onMouseEnter={() => step.branchId !== undefined && onHoverBranch?.(step.branchId)} 
                                                onMouseLeave={() => onHoverBranch?.(null)} 
                                                style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '10px 20px', cursor: 'pointer', background: rowBackground, borderLeft: isCurrent ? `4px solid #00bcd4` : (isSelected ? `4px solid ${border}` : '4px solid transparent'), borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'}`, opacity: isDone ? 1 : 0.45, transition: 'all 0.15s ease' }}
                                            >
                                                <div style={{ fontSize: '14px', color: isSelected ? text : muted, cursor: 'grab' }}>☰</div>
                                                <div style={{ minWidth: 28, height: 28, borderRadius: '50%', background: isDone ? color : surface, border: `2px solid ${isDone ? color : border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 'bold', color: isDone ? '#fff' : muted }}>{isDone ? (isCurrent ? stepNum : '✓') : stepNum}</div>
                                                
                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                    <div style={{ fontSize: 13, color: isDone || isSelected ? text : muted, fontWeight: isCurrent ? 'bold' : 'normal' }}>
                                                        {STEP_ICONS[step.type]} {step.description.split('→')[0]}
                                                    </div>
                                                    
                                                    {isTap && (
                                                        <div style={{ display: 'flex', alignItems: 'center', background: surface, borderRadius: '4px', border: `1px solid ${border}`, overflow: 'hidden' }}>
                                                            <button onClick={(e) => { e.stopPropagation(); onUpdateStepValue?.(idx, step.tapValue - 1); }} style={{ background: 'transparent', border: 'none', color: text, padding: '2px 8px', cursor: 'pointer' }}>-</button>
                                                            <div style={{ fontSize: '11px', width: '35px', textAlign: 'center', fontWeight: 'bold', color: color, borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}` }}>
                                                                {step.tapValue > 0 ? `+${step.tapValue}` : step.tapValue}
                                                            </div>
                                                            <button onClick={(e) => { e.stopPropagation(); onUpdateStepValue?.(idx, step.tapValue + 1); }} style={{ background: 'transparent', border: 'none', color: text, padding: '2px 8px', cursor: 'pointer' }}>+</button>
                                                        </div>
                                                    )}

                                                    {isShunt && (
                                                        <div style={{ display: 'flex', alignItems: 'center', background: surface, borderRadius: '4px', border: `1px solid ${border}`, overflow: 'hidden' }}>
                                                            <button onClick={(e) => { e.stopPropagation(); onUpdateStepValue?.(idx, step.steps - 1); }} style={{ background: 'transparent', border: 'none', color: text, padding: '2px 8px', cursor: 'pointer' }}>-</button>
                                                            <div style={{ fontSize: '11px', width: '35px', textAlign: 'center', fontWeight: 'bold', color: color, borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}` }}>
                                                                Est {step.steps}
                                                            </div>
                                                            <button onClick={(e) => { e.stopPropagation(); onUpdateStepValue?.(idx, step.steps + 1); }} style={{ background: 'transparent', border: 'none', color: text, padding: '2px 8px', cursor: 'pointer' }}>+</button>
                                                        </div>
                                                    )}
                                                </div>

                                                {canToggle && (
                                                    <div 
                                                        onClick={(e) => { e.stopPropagation(); onToggleStepAction?.(idx); }}
                                                        title="Clique para alternar a manobra"
                                                        style={{ fontSize: 10, fontWeight: 'bold', color: color, background: `${color}18`, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', border: `1px solid ${color}50`, transition: 'all 0.2s' }}
                                                    >
                                                        {step.type.replace('_', ' ')}
                                                    </div>
                                                )}
                                                
                                                {onDeleteStep && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); onDeleteStep(idx); }}
                                                        title="Remover Manobra"
                                                        style={{ background: 'transparent', border: 'none', color: '#f44336', cursor: 'pointer', fontSize: '15px', padding: '4px', opacity: 0.7, transition: 'opacity 0.2s', ...(!isDone ? {} : { display: 'none' }) }}
                                                        onMouseOver={e => e.target.style.opacity = 1}
                                                        onMouseOut={e => e.target.style.opacity = 0.7}
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
            <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`}</style>
        </div>
    );
}

function ctrlBtnStyle(darkMode, disabled) { return { padding: '6px 12px', borderRadius: 8, border: `1px solid ${darkMode ? '#555' : '#ccc'}`, background: darkMode ? '#333' : '#f0f0f0', color: disabled ? '#555' : (darkMode ? '#fff' : '#333'), cursor: disabled ? 'default' : 'pointer', fontSize: 14, opacity: disabled ? 0.4 : 1, transition: 'all 0.15s' }; }
function iconBtnStyle(darkMode) { return { background: 'transparent', border: 'none', color: darkMode ? '#aaa' : '#555', fontSize: 18, cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', transition: 'background 0.2s' }; }