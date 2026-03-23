import React, { useRef } from 'react';

export default function EditSidebar({
    isEditMode,
    setIsEditMode,
    darkMode,
    onUndo = () => {},
    canUndo = false,
    onReset = () => {}
}) {
    const fileInputRef = useRef(null);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.positions) {
                    window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: data }));
                    alert("✅ Layout importado com sucesso!");
                } else {
                    alert("❌ Arquivo inválido. O arquivo precisa conter o layout do simulador.");
                }
            } catch (err) {
                alert("❌ Erro ao ler o arquivo. Certifique-se de que é um JSON válido.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    const glassContainerStyle = {
        background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)',
        borderLeft: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)'}`,
        display: 'flex', flexDirection: 'column', width: '230px', height: '100%', boxSizing: 'border-box', overflow: 'hidden',
        boxShadow: darkMode ? '-5px 0 20px rgba(0,0,0,0.4)' : '-5px 0 15px rgba(0,0,0,0.05)', transition: 'background 0.3s, border 0.3s'
    };

    const ghostBtnOrangeStyle = {
        background: 'transparent', border: '1.5px solid #ff9800', color: '#ff9800', borderRadius: '8px',
        fontWeight: 'bold', fontSize: '13px', padding: '10px 4px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s ease-in-out', width: '100%', marginBottom: '10px'
    };

    const shortcutBadgeStyle = {
        display: 'inline-block', background: darkMode ? 'rgba(255,152,0,0.2)' : '#FFE0B2',
        color: darkMode ? '#ffb74d' : '#E65100', borderRadius: '5px', padding: '2px 6px',
        fontWeight: 'bold', fontFamily: 'monospace', fontSize: '11px', margin: '0 2px'
    };

    const shortcuts = [
        { keys: ['P'], desc: 'Alternar Tela Cheia/Folha A4' },
        { keys: ['Ctrl', 'P'], desc: 'Imprimir PDF' },
        { keys: ['E'], desc: 'Entrar/Sair da Edição' },
        { keys: ['Z'], desc: 'Centralizar Sistema' },
        { keys: ['Ctrl', 'Z'], desc: 'Desfazer' },
        { keys: ['D'], desc: 'Alternar Tema Escuro' },
        { keys: ['L'], desc: 'Mostrar/Ocultar Labels' },
        { keys: ['Shift', 'Arrastar'], desc: 'Seleção Múltipla' },
        { keys: ['M'], desc: 'Mudar Método de Cálculo' },
        { keys: ['R'], desc: 'Redefinir Sistema' },
        { keys: ['H'], desc: 'Mostrar Atalhos' }
    ];

    if (!isEditMode) return null;

    return (
        <div className="edit-sidebar" style={glassContainerStyle}>
            <style>
                {`
                .edit-ghost-btn:hover { background-color: var(--hover-color, #ff9800) !important; color: #ffffff !important; transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); }
                .edit-ghost-btn:active { transform: translateY(1px); }
                .edit-ghost-btn:disabled { opacity: 0.3 !important; cursor: not-allowed !important; pointer-events: none; }
                `}
            </style>

            <div style={{ padding: '20px', borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`, background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>
                <h2 style={{ color: '#ff9800', margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>✏️ Modo Edição</h2>
                <div style={{ fontSize: '11px', color: darkMode ? '#888' : '#666', marginTop: '5px' }}>Arraste barras e linhas para ajustar o layout.</div>
            </div>

            <div style={{ padding: '15px', flex: 1, overflowY: 'auto' }}>
                <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleFileUpload} />
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, border: '1.5px solid #00bcd4', color: '#00bcd4', '--hover-color': '#00bcd4', margin: 0}} onClick={() => fileInputRef.current.click()}>📂 Importar</button>
                    <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, border: '1.5px solid #4caf50', color: '#4caf50', '--hover-color': '#4caf50', margin: 0}} onClick={() => window.dispatchEvent(new CustomEvent('requestLayoutExport'))}>💾 Exportar</button>
                </div>

                <div style={{ height: '1px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)', margin: '15px 0' }}></div>

                <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, '--hover-color': '#ff9800'}} onClick={onUndo} disabled={!canUndo}>↩️ Desfazer Move</button>
                <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, '--hover-color': '#ff9800'}} onClick={onReset}>🚨 Resetar Layout</button>
                
                <div style={{ height: '1px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)', margin: '15px 0' }}></div>
                
                <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, background: 'rgba(255, 152, 0, 0.05)', '--hover-color': '#ff9800'}} onClick={() => setIsEditMode(false)}>🚪 Sair e Salvar</button>

                <div style={{ background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '10px', padding: '15px', marginTop: '20px' }}>
                    <h4 style={{ margin: '0 0 15px 0', color: darkMode ? '#eee' : '#333', fontSize: '13px', borderBottom: `1px solid ${darkMode ? '#444' : '#ccc'}`, paddingBottom: '8px' }}>⌨️ Atalhos:</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {shortcuts.map((shortcut, index) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '3px' }}>{shortcut.keys.map((key, kIndex) => <span key={kIndex} style={shortcutBadgeStyle}>{key}</span>)}</div>
                                <div style={{ fontSize: '11px', color: darkMode ? '#aaa' : '#555', textAlign: 'right', flex: 1 }}>{shortcut.desc}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}