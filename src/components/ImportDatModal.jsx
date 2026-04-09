import React, { useState, useRef } from 'react';
import { parseDatFile, validateParsedData, generateParseReport } from '../utils/datParser';
import { convertToSystemData, validateSystemData } from '../utils/systemConverter';
import { generateLayout } from '../utils/layoutGenerator';

export default function ImportDatModal({ isOpen, onClose, onImport }) {
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [layoutType, setLayoutType] = useState('organic');
    const [systemName, setSystemName] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileSelect = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        setError(null);
        setFile(selectedFile);
        
        // Extrai nome sem extensão
        const name = selectedFile.name.replace(/\.dat$/i, '');
        setSystemName(name);

        try {
            // Lê arquivo
            const content = await selectedFile.text();
            
            // Parse
            const parsed = parseDatFile(content);
            const report = generateParseReport(parsed);
            
            // Gera preview
            setPreview({
                summary: report.summary,
                validation: report.validation
            });

        } catch (err) {
            setError(`Erro ao ler arquivo: ${err.message}`);
            setPreview(null);
        }
    };

    const handleImport = async () => {
        if (!file || !preview) return;

        setIsProcessing(true);
        setError(null);

        try {
            // 1. Parse novamente (garantir dados frescos)
            const content = await file.text();
            const parsed = parseDatFile(content);

            // 2. Valida
            const validation = validateParsedData(parsed);
            if (!validation.valid) {
                throw new Error(`Validação falhou:\n${validation.errors.join('\n')}`);
            }

            // 3. Converte para systemData
            const systemData = convertToSystemData(parsed, systemName);

            // 4. Valida systemData
            const sysValidation = validateSystemData(systemData);
            if (!sysValidation.valid) {
                throw new Error(`Sistema inválido:\n${sysValidation.errors.join('\n')}`);
            }

            // 5. Gera layout
            const positions = generateLayout(systemData, layoutType, {
                width: 900,
                height: 650
            });

            systemData.positions = positions;
            systemData.positionsOrganic = positions;
            systemData.positionsProject = positions;

            // 6. Callback para App
            onImport(systemData);

            // 7. Fecha modal
            handleClose();

        } catch (err) {
            setError(`Erro ao importar: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setPreview(null);
        setError(null);
        setSystemName('');
        setLayoutType('organic');
        setIsProcessing(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div 
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                backdropFilter: 'blur(4px)'
            }}
            onClick={handleClose}
        >
            <div
                style={{
                    background: 'var(--card-bg)',
                    borderRadius: '12px',
                    width: '90%',
                    maxWidth: '550px',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                    border: '1px solid var(--border-color)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* HEADER */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '2px solid var(--border-color)',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: '12px 12px 0 0'
                }}>
                    <h2 style={{
                        margin: 0,
                        color: 'white',
                        fontSize: '20px',
                        fontWeight: '700',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        📂 Importar Sistema (.dat)
                    </h2>
                    <p style={{
                        margin: '8px 0 0 0',
                        color: 'rgba(255, 255, 255, 0.9)',
                        fontSize: '13px'
                    }}>
                        Importe arquivos AMPL para criar um novo sistema
                    </p>
                </div>

                {/* CONTENT */}
                <div style={{ padding: '24px' }}>
                    {/* FILE SELECTOR */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".dat,.txt"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />
                    
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        style={{
                            width: '100%',
                            padding: '16px',
                            background: file ? 'var(--eng-green)' : 'var(--hover-bg)',
                            border: '2px dashed var(--border-color)',
                            borderRadius: '8px',
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '600',
                            color: file ? 'white' : 'var(--text-color)',
                            transition: 'all 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        {file ? '✓ ' + file.name : '📁 Selecionar arquivo .dat...'}
                    </button>

                    {/* ERROR MESSAGE */}
                    {error && (
                        <div style={{
                            marginTop: '16px',
                            padding: '12px',
                            background: '#fee',
                            border: '1px solid #fcc',
                            borderRadius: '6px',
                            color: '#c33',
                            fontSize: '13px',
                            whiteSpace: 'pre-wrap'
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    {/* PREVIEW */}
                    {preview && !error && (
                        <div style={{
                            marginTop: '16px',
                            padding: '16px',
                            background: 'var(--hover-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px'
                        }}>
                            <h3 style={{
                                margin: '0 0 12px 0',
                                fontSize: '14px',
                                fontWeight: '700',
                                color: 'var(--text-color)'
                            }}>
                                📊 Preview do Sistema
                            </h3>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Barras:</span>
                                    <strong>{preview.summary.nodes}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Linhas:</span>
                                    <strong>{preview.summary.lines}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Subestações:</span>
                                    <strong>{preview.summary.sources.length > 0 ? preview.summary.sources : 'Auto-detectar'}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Faltas iniciais:</span>
                                    <strong>{preview.summary.faults}</strong>
                                </div>
                            </div>

                            {/* VALIDATION WARNINGS */}
                            {preview.validation.warnings.length > 0 && (
                                <div style={{
                                    marginTop: '12px',
                                    padding: '8px',
                                    background: '#fff3cd',
                                    border: '1px solid #ffecb5',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    color: '#856404'
                                }}>
                                    <strong>⚠️ Avisos:</strong>
                                    <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                                        {preview.validation.warnings.map((w, i) => (
                                            <li key={i}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* LAYOUT TYPE */}
                    {preview && !error && (
                        <div style={{ marginTop: '16px' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: '8px',
                                fontSize: '13px',
                                fontWeight: '600',
                                color: 'var(--text-color)'
                            }}>
                                Layout Inicial:
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {['organic', 'radial', 'hierarchical'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setLayoutType(type)}
                                        disabled={isProcessing}
                                        style={{
                                            flex: 1,
                                            padding: '10px',
                                            background: layoutType === type ? 'var(--highlight-blue)' : 'var(--hover-bg)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '6px',
                                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                                            fontSize: '12px',
                                            fontWeight: layoutType === type ? '700' : '500',
                                            color: layoutType === type ? 'white' : 'var(--text-color)',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {type === 'organic' && '🌿 Orgânico'}
                                        {type === 'radial' && '⭕ Radial'}
                                        {type === 'hierarchical' && '📊 Hierárquico'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* SYSTEM NAME */}
                    {preview && !error && (
                        <div style={{ marginTop: '16px' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: '8px',
                                fontSize: '13px',
                                fontWeight: '600',
                                color: 'var(--text-color)'
                            }}>
                                Nome do Sistema:
                            </label>
                            <input
                                type="text"
                                value={systemName}
                                onChange={(e) => setSystemName(e.target.value)}
                                disabled={isProcessing}
                                placeholder="Ex: System69"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    background: 'var(--card-bg)',
                                    color: 'var(--text-color)',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        style={{
                            padding: '10px 20px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--card-bg)',
                            color: 'var(--text-color)',
                            borderRadius: '6px',
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '600',
                            transition: 'all 0.2s'
                        }}
                    >
                        Cancelar
                    </button>

                    <button
                        onClick={handleImport}
                        disabled={!preview || error || isProcessing || !systemName.trim()}
                        style={{
                            padding: '10px 24px',
                            border: 'none',
                            background: (!preview || error || !systemName.trim()) 
                                ? '#ccc' 
                                : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            borderRadius: '6px',
                            cursor: (!preview || error || !systemName.trim()) ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '700',
                            transition: 'all 0.2s',
                            opacity: isProcessing ? 0.7 : 1
                        }}
                    >
                        {isProcessing ? '⏳ Processando...' : '✓ Importar e Criar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
