import { useState, useRef, useEffect } from 'react'
import './MexicoBeautyStation.css'

const BACKEND_URL = ''
const CONCURRENCY = 5

const STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
}

const MODULES = {
    KEYWORD: 'keyword',
    TITLE: 'title',
    IMAGE: 'image',
    DESCRIPTION: 'description'
}

function MexicoBeautyStation({ token }) {
    const [activeModule, setActiveModule] = useState(null)
    const [items, setItems] = useState([])
    const [inputText, setInputText] = useState('')
    const [selectedFiles, setSelectedFiles] = useState([])
    const [isProcessing, setIsProcessing] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const pauseRef = useRef(false)
    const itemsRef = useRef([])
    const [syncingFeishu, setSyncingFeishu] = useState(false)

    useEffect(() => {
        itemsRef.current = items
    }, [items])

    const stats = {
        total: items.length,
        completed: items.filter(t => t.status === STATUS.COMPLETED).length,
        processing: items.filter(t => t.status === STATUS.PROCESSING).length,
        failed: items.filter(t => t.status === STATUS.FAILED).length,
        pending: items.filter(t => t.status === STATUS.PENDING).length
    }

    const analyzeItem = async (item, module) => {
        const endpoint = {
            [MODULES.KEYWORD]: '/api/v1/mexico-beauty/keyword-analysis-single',
            [MODULES.TITLE]: '/api/v1/mexico-beauty/title-optimization-single',
            [MODULES.IMAGE]: '/api/v1/mexico-beauty/image-prompt-single',
            [MODULES.DESCRIPTION]: '/api/v1/mexico-beauty/description-single'
        }[module]

        if (module === MODULES.KEYWORD) {
            const response = await fetch(`${BACKEND_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ title: item.input })
            })
            if (!response.ok) throw new Error(await response.text())
            return await response.json()
        } else {
            const formData = new FormData()
            if (item.title) formData.append('title', item.title)
            if (item.image) formData.append('image', item.image)
            
            const response = await fetch(`${BACKEND_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })
            if (!response.ok) throw new Error(await response.text())
            return await response.json()
        }
    }

    const handleParse = () => {
        if (activeModule === MODULES.KEYWORD) {
            const lines = inputText.trim().split('\n').filter(l => l.trim())
            if (lines.length === 0) return
            
            const newItems = lines.map((line, i) => ({
                id: Date.now() + i,
                input: line.trim(),
                output: '',
                status: STATUS.PENDING,
                error: null
            }))
            setItems(newItems)
        } else if (activeModule === MODULES.TITLE || activeModule === MODULES.DESCRIPTION) {
            const lines = inputText.trim().split('\n').filter(l => l.trim())
            if (lines.length === 0 && selectedFiles.length === 0) return
            
            const count = Math.max(lines.length, selectedFiles.length)
            const newItems = []
            for (let i = 0; i < count; i++) {
                newItems.push({
                    id: Date.now() + i,
                    input: lines[i] || '',
                    title: lines[i] || '',
                    image: selectedFiles[i] || null,
                    output: '',
                    status: STATUS.PENDING,
                    error: null
                })
            }
            setItems(newItems)
        } else if (activeModule === MODULES.IMAGE) {
            if (selectedFiles.length === 0) return
            
            const newItems = selectedFiles.map((file, i) => ({
                id: Date.now() + i,
                input: file.name,
                image: file,
                output: '',
                status: STATUS.PENDING,
                error: null
            }))
            setItems(newItems)
        }
    }

    const handleStartProcess = async () => {
        if (items.length === 0) {
            handleParse()
            return
        }

        setIsProcessing(true)
        setIsPaused(false)
        pauseRef.current = false

        const queue = items
            .map((t, i) => ({ index: i, data: t }))
            .filter(item => item.data.status === STATUS.PENDING || item.data.status === STATUS.FAILED)
        
        let queueIndex = 0
        let activeCount = 0
        
        const processNext = () => {
            while (queueIndex < queue.length && activeCount < CONCURRENCY && !pauseRef.current) {
                const current = queue[queueIndex]
                queueIndex++
                activeCount++
                
                const index = current.index
                const itemData = itemsRef.current[index]
                
                setItems(prev => prev.map((t, idx) => 
                    idx === index ? { ...t, status: STATUS.PROCESSING } : t
                ))

                analyzeItem(itemData, activeModule)
                    .then(result => {
                        setItems(prev => prev.map((t, idx) => 
                            idx === index ? {
                                ...t,
                                output: result.result || JSON.stringify(result),
                                status: STATUS.COMPLETED,
                                error: null
                            } : t
                        ))
                    })
                    .catch(error => {
                        setItems(prev => prev.map((t, idx) => 
                            idx === index ? {
                                ...t,
                                status: STATUS.FAILED,
                                error: error.message
                            } : t
                        ))
                    })
                    .finally(() => {
                        activeCount--
                        if (!pauseRef.current) {
                            processNext()
                        }
                        if (activeCount === 0 && (queueIndex >= queue.length || pauseRef.current)) {
                            setIsProcessing(false)
                        }
                    })
            }
            
            if (queueIndex >= queue.length && activeCount === 0) {
                setIsProcessing(false)
            }
        }

        processNext()
    }

    const handlePause = () => {
        pauseRef.current = true
        setIsPaused(true)
    }

    const handleSyncFeishu = async () => {
        const completedItems = items.filter(t => t.status === STATUS.COMPLETED)
        if (completedItems.length === 0) {
            alert('没有已完成的记录可以同步')
            return
        }

        setSyncingFeishu(true)
        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/mexico-beauty/sync-feishu`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    module: activeModule,
                    results: completedItems 
                })
            })

            const data = await response.json()
            
            if (!response.ok) {
                throw new Error(data.detail || '同步失败')
            }

            alert(data.message || `成功同步 ${completedItems.length} 条记录`)
        } catch (error) {
            console.error('Feishu sync failed:', error)
            alert('同步到飞书失败: ' + error.message)
        } finally {
            setSyncingFeishu(false)
        }
    }

    const handleClear = () => {
        setItems([])
        setInputText('')
        setSelectedFiles([])
        setActiveModule(null)
    }

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files)
        setSelectedFiles(files)
    }

    const getStatusIndicator = (status) => {
        switch (status) {
            case STATUS.COMPLETED:
                return <span className="status-dot status-completed" title="已完成">🟢</span>
            case STATUS.PROCESSING:
                return <span className="status-dot status-processing" title="处理中">🔵</span>
            case STATUS.FAILED:
                return <span className="status-dot status-failed" title="失败">🔴</span>
            default:
                return <span className="status-dot status-pending" title="待处理">⚪</span>
        }
    }

    return (
        <div className="mexico-beauty-container">
            <div className="mb-header">
                <h2>🎯 营销助手</h2>
                <p className="mb-subtitle">AI-Powered Marketing Tools - 4个智能工具模块</p>
            </div>

            {!activeModule && (
                <div className="mb-cards-grid">
                    <div 
                        className="mb-card" 
                        onClick={() => setActiveModule(MODULES.KEYWORD)}
                    >
                        <div className="mb-card-header">
                            <span className="mb-card-icon">🔍</span>
                            <h3>关键词分析</h3>
                        </div>
                        <div className="mb-card-body">
                            <p className="mb-card-desc">竞品标题 → 核心大词 + 属性 + 搜索组合</p>
                            <div className="mb-card-example">
                                <small>输入: Crema Hidratante Facial...</small>
                            </div>
                        </div>
                    </div>

                    <div 
                        className="mb-card" 
                        onClick={() => setActiveModule(MODULES.TITLE)}
                    >
                        <div className="mb-card-header">
                            <span className="mb-card-icon">✍️</span>
                            <h3>标题优化</h3>
                        </div>
                        <div className="mb-card-body">
                            <p className="mb-card-desc">竞品标题+图片 → 3个SEO优化标题</p>
                            <div className="mb-card-example">
                                <small>输出: 墨西哥西班牙语标题</small>
                            </div>
                        </div>
                    </div>

                    <div 
                        className="mb-card" 
                        onClick={() => setActiveModule(MODULES.IMAGE)}
                    >
                        <div className="mb-card-header">
                            <span className="mb-card-icon">🎨</span>
                            <h3>图片提示词</h3>
                        </div>
                        <div className="mb-card-body">
                            <p className="mb-card-desc">参考图 → AI图片生成提示词 + 营销文案</p>
                            <div className="mb-card-example">
                                <small>仅输出提示词，用户自行生成图片</small>
                            </div>
                        </div>
                    </div>

                    <div 
                        className="mb-card" 
                        onClick={() => setActiveModule(MODULES.DESCRIPTION)}
                    >
                        <div className="mb-card-header">
                            <span className="mb-card-icon">📝</span>
                            <h3>产品描述</h3>
                        </div>
                        <div className="mb-card-body">
                            <p className="mb-card-desc">产品图+标题 → 使用说明（Modo de Uso）</p>
                            <div className="mb-card-example">
                                <small>TikTok商品详情页专用</small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeModule && (
                <>
                    <div className="mb-module-header">
                        <button 
                            className="mb-back-btn" 
                            onClick={handleClear}
                        >
                            ← 返回模块选择
                        </button>
                        <h3>
                            {activeModule === MODULES.KEYWORD && '🔍 关键词分析'}
                            {activeModule === MODULES.TITLE && '✍️ 标题优化'}
                            {activeModule === MODULES.IMAGE && '🎨 图片提示词生成'}
                            {activeModule === MODULES.DESCRIPTION && '📝 产品描述生成'}
                        </h3>
                    </div>

                    {items.length === 0 && (
                        <div className="mb-input-section">
                            <div className="mb-input-header">
                                <label>输入数据</label>
                            </div>
                            
                            {activeModule === MODULES.KEYWORD && (
                                <div>
                                    <textarea
                                        className="mb-textarea"
                                        placeholder="粘贴竞品标题，每行一个..."
                                        rows={8}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                    />
                                    <button 
                                        className="mb-btn mb-btn-primary"
                                        onClick={handleParse}
                                        disabled={!inputText.trim()}
                                    >
                                        开始分析
                                    </button>
                                </div>
                            )}

                            {(activeModule === MODULES.TITLE || activeModule === MODULES.DESCRIPTION) && (
                                <div>
                                    <textarea
                                        className="mb-textarea"
                                        placeholder="粘贴标题，每行一个..."
                                        rows={5}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                    />
                                    <div className="mb-file-upload">
                                        <label className="mb-upload-label">
                                            <input 
                                                type="file" 
                                                multiple 
                                                accept="image/*"
                                                onChange={handleFileSelect}
                                            />
                                            <span>📁 上传图片（可多选）- {selectedFiles.length}个已选</span>
                                        </label>
                                    </div>
                                    <button 
                                        className="mb-btn mb-btn-primary"
                                        onClick={handleParse}
                                        disabled={!inputText.trim() && selectedFiles.length === 0}
                                    >
                                        开始分析
                                    </button>
                                </div>
                            )}

                            {activeModule === MODULES.IMAGE && (
                                <div>
                                    <div className="mb-file-upload">
                                        <label className="mb-upload-label">
                                            <input 
                                                type="file" 
                                                multiple 
                                                accept="image/*"
                                                onChange={handleFileSelect}
                                            />
                                            <span>📁 上传参考图片（可多选）- {selectedFiles.length}个已选</span>
                                        </label>
                                    </div>
                                    <button 
                                        className="mb-btn mb-btn-primary"
                                        onClick={handleParse}
                                        disabled={selectedFiles.length === 0}
                                    >
                                        开始分析
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {items.length > 0 && (
                        <>
                            <div className="mb-stats-bar">
                                <div className="mb-stat">
                                    <span className="mb-stat-label">总计</span>
                                    <span className="mb-stat-value">{stats.total}</span>
                                </div>
                                <div className="mb-stat mb-stat-completed">
                                    <span className="mb-stat-label">🟢 已完成</span>
                                    <span className="mb-stat-value">{stats.completed}</span>
                                </div>
                                <div className="mb-stat mb-stat-processing">
                                    <span className="mb-stat-label">🔵 处理中</span>
                                    <span className="mb-stat-value">{stats.processing}</span>
                                </div>
                                <div className="mb-stat mb-stat-failed">
                                    <span className="mb-stat-label">🔴 失败</span>
                                    <span className="mb-stat-value">{stats.failed}</span>
                                </div>
                                <div className="mb-stat mb-stat-pending">
                                    <span className="mb-stat-label">⚪ 待处理</span>
                                    <span className="mb-stat-value">{stats.pending}</span>
                                </div>
                            </div>

                            <div className="mb-controls">
                                {!isProcessing && (stats.pending > 0 || stats.failed > 0) && (
                                    <button className="mb-btn mb-btn-primary" onClick={handleStartProcess}>
                                        {isPaused ? '▶️ 继续' : '▶️ 开始处理'}
                                    </button>
                                )}
                                {isProcessing && (
                                    <button className="mb-btn mb-btn-warning" onClick={handlePause}>
                                        ⏸️ 暂停
                                    </button>
                                )}
                                <button 
                                    className="mb-btn mb-btn-feishu" 
                                    onClick={handleSyncFeishu}
                                    disabled={syncingFeishu || !items.some(t => t.status === STATUS.COMPLETED)}
                                >
                                    {syncingFeishu ? '⏳ 同步中...' : '📋 同步到飞书'}
                                </button>
                                <button className="mb-btn mb-btn-danger" onClick={handleClear}>
                                    🗑️ 清空
                                </button>
                            </div>

                            <div className="mb-table-container">
                                <table className="mb-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px' }}>#</th>
                                            <th style={{ width: '50px' }}>状态</th>
                                            <th style={{ width: '30%' }}>输入</th>
                                            <th style={{ width: '60%' }}>输出</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, index) => (
                                            <tr key={item.id} className={`mb-row mb-row-${item.status}`}>
                                                <td>{index + 1}</td>
                                                <td>{getStatusIndicator(item.status)}</td>
                                                <td className="mb-cell-input">
                                                    {item.input || '-'}
                                                </td>
                                                <td className="mb-cell-output">
                                                    {item.status === STATUS.PROCESSING ? '分析中...' : 
                                                     item.status === STATUS.FAILED ? `❌ ${item.error}` :
                                                     item.output || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    )
}

export default MexicoBeautyStation
