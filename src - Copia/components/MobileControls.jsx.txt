import React from 'react';
import { SYSTEM_DATA } from '../data/systemData';

export default function MobileControls({
    selectedElement,
    setSelectedElement,
    nodeData,
    lineCurrents,
    toggleSwitch,
    toggleFault,
    faultNodes,
    branches,
    getNodeColor
}) {
    if (!selectedElement) return null;

    const isNode = selectedElement.type === 'node';
    const id = selectedElement.id || selectedElement.data.id;
    
    // Dados para exibição
    const voltage = nodeData[id] ? nodeData[id].v.toFixed(3) : '-';
    const angle = nodeData[id] ? nodeData[id].angle.toFixed(1) : '-';
    
    // Busca linha atualizada
    const branch = !isNode ? (branches.find(b => b.id === id) || selectedElement.data) : null;
    const currentInfo = !isNode && lineCurrents[id] ? lineCurrents[id] : null;

    return (
        <div className={`mobile-bottom-sheet ${selectedElement ? 'visible' : ''}`}>
            
            {/* Header do Card: Título e Botão Fechar */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                <div>
                    <h2 style={{fontSize:'18px', margin:0, color:'var(--text-color)'}}>
                        {isNode ? `Barra ${id}` : `Linha ${branch.from}-${branch.to}`}
                    </h2>
                    <span style={{fontSize:'12px', color:'var(--eng-gray)'}}>
                        {isNode ? 'Informações do Nó' : 'Informações do Circuito'}
                    </span>
                </div>
                <button onClick={() => setSelectedElement(null)} 
                        style={{background:'transparent', border:'none', fontSize:'24px', color:'var(--eng-gray)'}}>
                    &times;
                </button>
            </div>

            {/* Conteúdo Dinâmico */}
            {isNode ? (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px'}}>
                    <div className="stat-item">
                        <div className="stat-label">Tensão</div>
                        <div className="stat-value" style={{color: parseFloat(voltage) < 0.93 ? 'var(--eng-red)' : 'var(--eng-green)'}}>
                            {voltage} pu
                        </div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-label">Ângulo</div>
                        <div className="stat-value">{angle}°</div>
                    </div>
                    {SYSTEM_DATA.loads[id] && (
                        <div className="stat-item" style={{gridColumn:'span 2'}}>
                            <div className="stat-label">Carga</div>
                            <div className="stat-value">
                                {SYSTEM_DATA.loads[id].p.toFixed(0)} kW / {SYSTEM_DATA.loads[id].q.toFixed(0)} kVAr
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px'}}>
                    <div className="stat-item">
                        <div className="stat-label">Estado</div>
                        <div className="stat-value" style={{color: branch.state===1 ? 'var(--eng-green)' : 'var(--eng-gray)'}}>
                            {branch.state === 1 ? 'FECHADO' : 'ABERTO'}
                        </div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-label">Carregamento</div>
                        <div className="stat-value">
                            {currentInfo ? currentInfo.percentage.toFixed(1) : 0}%
                        </div>
                    </div>
                </div>
            )}

            {/* BOTÕES DE AÇÃO GRANDES (THUMB FRIENDLY) */}
            <div className="mobile-actions">
                {isNode ? (
                    <button className="mobile-btn-action" 
                            style={{background: faultNodes.has(id) ? 'var(--eng-gray)' : 'var(--color-fault)'}}
                            onClick={() => toggleFault(id)}>
                        {faultNodes.has(id) ? 'REMOVER FALTA' : 'APLICAR FALTA'}
                    </button>
                ) : (
                    branch.hasSwitch ? (
                        <button className="mobile-btn-action" 
                                style={{background: branch.state === 1 ? 'var(--eng-gray)' : 'var(--sub-101)'}}
                                onClick={() => toggleSwitch(branch.id)}>
                            {branch.state === 1 ? 'ABRIR CHAVE' : 'FECHAR CHAVE'}
                        </button>
                    ) : (
                        <button className="mobile-btn-action" disabled style={{background: '#eee', color:'#999'}}>
                            CHAVE FIXA
                        </button>
                    )
                )}
            </div>
        </div>
    );
}