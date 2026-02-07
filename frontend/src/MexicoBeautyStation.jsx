import { useState, useRef, useEffect, useMemo } from 'react'
import './MexicoBeautyStation.css'
import ProductDescriptionModule from './components/ProductDescriptionModule'

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
    DESCRIPTION: 'description',
    CORE_KEYWORD: 'core_keyword'
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

    // History state (for 核心词提取)
    const [showHistory, setShowHistory] = useState(false)
    const [history, setHistory] = useState([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(null)
    const [historySearch, setHistorySearch] = useState('')

    useEffect(() => {
        itemsRef.current = items
    }, [items])

    const stats = useMemo(() => ({
        total: items.length,
        completed: items.filter(t => t.status === STATUS.COMPLETED).length,
        processing: items.filter(t => t.status === STATUS.PROCESSING).length,
        failed: items.filter(t => t.status === STATUS.FAILED).length,
        pending: items.filter(t => t.status === STATUS.PENDING).length
    }), [items])

    const analyzeItem = async (item, module) => {
        const endpoint = {
            [MODULES.KEYWORD]: '/api/v1/mexico-beauty/keyword-analysis-single',
            [MODULES.TITLE]: '/api/v1/mexico-beauty/title-optimization-single',
            [MODULES.IMAGE]: '/api/v1/mexico-beauty/image-prompt-single',
            [MODULES.DESCRIPTION]: '/api/v1/mexico-beauty/description-single',
            [MODULES.CORE_KEYWORD]: '/api/v1/keywords/analyze-single'
        }[module]

        if (module === MODULES.KEYWORD || module === MODULES.CORE_KEYWORD) {
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

    const parseItems = () => {
        if (activeModule === MODULES.KEYWORD || activeModule === MODULES.CORE_KEYWORD) {
            const lines = inputText.trim().split('\n').filter(l => l.trim())
            if (lines.length === 0) return []
            
            return lines.map((line, i) => ({
                id: Date.now() + i,
                input: line.trim(),
                output: '',
                status: STATUS.PENDING,
                error: null
            }))
        } else if (activeModule === MODULES.TITLE || activeModule === MODULES.DESCRIPTION) {
            const lines = inputText.trim().split('\n').filter(l => l.trim())
            if (lines.length === 0 && selectedFiles.length === 0) return []
            
            if (lines.length !== selectedFiles.length && lines.length > 0 && selectedFiles.length > 0) {
                const confirmed = window.confirm(
                    `标题数量(${lines.length})与图片数量(${selectedFiles.length})不匹配。\n` +
                    `将自动对齐到最大数量(${Math.max(lines.length, selectedFiles.length)})。\n` +
                    `缺失的标题将为空，缺失的图片将跳过。\n\n确定继续?`
                )
                if (!confirmed) return []
            }
            
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
            return newItems
        } else if (activeModule === MODULES.IMAGE) {
            if (selectedFiles.length === 0) return []
            
            return selectedFiles.map((file, i) => ({
                id: Date.now() + i,
                input: file.name,
                image: file,
                output: '',
                status: STATUS.PENDING,
                error: null
            }))
        }
        return []
    }

    const handleParse = () => {
        const newItems = parseItems()
        if (newItems.length > 0) {
            setItems(newItems)
        }
    }

    const handleStartProcess = async () => {
        let itemsToProcess = items
        
        if (itemsToProcess.length === 0) {
            itemsToProcess = parseItems()
            if (itemsToProcess.length === 0) {
                alert('没有可处理的数据，请输入标题或上传图片')
                return
            }
            setItems(itemsToProcess)
        }

        setIsProcessing(true)
        setIsPaused(false)
        pauseRef.current = false

        const queue = itemsToProcess
            .map((t, i) => ({ index: i, data: t }))
            .filter(item => item.data.status === STATUS.PENDING || item.data.status === STATUS.FAILED)
        
        itemsRef.current = itemsToProcess
        
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
                        setItems(prev => prev.map((t, idx) => {
                            if (idx !== index) return t
                            
                            const currentModule = activeModule
                            
                            if (currentModule === MODULES.CORE_KEYWORD) {
                                return {
                                    ...t,
                                    translation: result.translation || '',
                                    keywords: result.keywords || '',
                                    output: result.result || JSON.stringify(result),
                                    status: STATUS.COMPLETED,
                                    error: null
                                }
                            } else if (currentModule === MODULES.KEYWORD) {
                                return {
                                    ...t,
                                    analysisReport: result.result || '',
                                    output: result.result || '',
                                    status: STATUS.COMPLETED,
                                    error: null
                                }
                            } else if (currentModule === MODULES.TITLE) {
                                return {
                                    ...t,
                                    optimizedTitles: result.result || '',
                                    output: result.result || '',
                                    status: STATUS.COMPLETED,
                                    error: null
                                }
                            } else if (currentModule === MODULES.IMAGE) {
                                return {
                                    ...t,
                                    imagePrompt: result.result || '',
                                    output: result.result || '',
                                    status: STATUS.COMPLETED,
                                    error: null
                                }
                            } else {
                                return {
                                    ...t,
                                    output: result.result || JSON.stringify(result),
                                    status: STATUS.COMPLETED,
                                    error: null
                                }
                            }
                        }))
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
                            setTimeout(() => autoSaveHistory(), 500)
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

    const autoSaveHistory = async () => {
        const currentItems = itemsRef.current
        const completedItems = currentItems.filter(t => t.status === STATUS.COMPLETED)
        if (completedItems.length === 0) return
        
        try {
            const titles = completedItems.map(item => ({
                original: item.input,
                translation: item.translation || '',
                keywords: item.keywords || '',
                status: 'completed'
            }))
            await fetch(`${BACKEND_URL}/api/v1/keywords/history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles })
            })
        } catch (error) {
            console.error('Auto save history failed:', error)
        }
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

    const loadHistory = async () => {
        setLoadingHistory(true)
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/keywords/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                const data = await res.json()
                setHistory(data.records || [])
            }
        } catch (error) {
            console.error('Load history failed:', error)
        }
        setLoadingHistory(false)
    }

    const deleteHistory = async (index) => {
        if (!confirm('确定删除这条历史记录？')) return
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/keywords/history/${index}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                loadHistory()
                if (selectedHistoryIndex === index) {
                    setSelectedHistoryIndex(null)
                }
            }
        } catch (error) {
            console.error('Delete history failed:', error)
        }
    }

    const exportHistoryItem = async (record) => {
        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/keywords/export-excel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles: record.titles })
            })

            if (!response.ok) throw new Error('导出失败')

            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `keywords_${new Date(record.created_at).toISOString().slice(0, 10)}.xlsx`
            link.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            alert('导出失败: ' + error.message)
        }
    }

    const handleExportExcel = async () => {
        const completedItems = items.filter(t => t.status === STATUS.COMPLETED)
        if (completedItems.length === 0) {
            alert('没有已完成的记录可以导出')
            return
        }
        try {
            const titles = completedItems.map(item => ({
                original: item.input,
                translation: item.translation || '',
                keywords: item.keywords || '',
                status: 'completed'
            }))
            const response = await fetch(`${BACKEND_URL}/api/v1/keywords/export-excel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles })
            })
            if (!response.ok) throw new Error('导出失败')
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `keywords_${new Date().toISOString().slice(0, 10)}.xlsx`
            link.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            alert('导出失败: ' + error.message)
        }
    }

    const filteredHistory = history.filter(record => {
        if (!historySearch.trim()) return true
        const search = historySearch.toLowerCase()
        return record.titles.some(t => 
            t.original?.toLowerCase().includes(search) ||
            t.translation?.toLowerCase().includes(search) ||
            t.keywords?.toLowerCase().includes(search)
        )
    })

    return (
        <div className="mexico-beauty-container">
            <div className="mb-header">
                <h2>🎯 营销助手</h2>
                <p className="mb-subtitle">AI-Powered Marketing Tools - 5个智能工具模块</p>
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
                            <p className="mb-card-desc">产品图+标题 → 10个AI图片生成提示词</p>
                            <div className="mb-card-example">
                                <small>2张主图 + 8张详情图策略</small>
                            </div>
                        </div>
                    </div>

                    <div 
                        className="mb-card" 
                        onClick={() => setActiveModule(MODULES.CORE_KEYWORD)}
                    >
                        <div className="mb-card-header">
                            <span className="mb-card-icon">🎯</span>
                            <h3>核心词提取</h3>
                        </div>
                        <div className="mb-card-body">
                            <p className="mb-card-desc">标题 → 中文翻译 + 4个核心关键词</p>
                            <div className="mb-card-example">
                                <small>快速提取产品核心卖点词</small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeModule === MODULES.DESCRIPTION && (
                <ProductDescriptionModule 
                    token={token} 
                    onBack={handleClear}
                />
            )}

            {activeModule && activeModule !== MODULES.DESCRIPTION && (
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
                            {activeModule === MODULES.CORE_KEYWORD && '🎯 核心词提取'}
                        </h3>
                    </div>

                    {items.length === 0 && (
                        <div className="mb-input-section">
                            <div className="mb-input-header">
                                <label>输入数据</label>
                            </div>
                            
                            {(activeModule === MODULES.KEYWORD || activeModule === MODULES.CORE_KEYWORD) && (
                                <div>
                                    <textarea
                                        className="mb-textarea"
                                        placeholder={activeModule === MODULES.CORE_KEYWORD 
                                            ? "粘贴产品标题，每行一个..." 
                                            : "粘贴竞品标题，每行一个..."}
                                        rows={8}
                                        value={inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                    />
                                    <button 
                                        className="mb-btn mb-btn-primary"
                                        onClick={handleParse}
                                        disabled={!inputText.trim()}
                                    >
                                        {activeModule === MODULES.CORE_KEYWORD ? '开始提取' : '开始分析'}
                                    </button>
                                </div>
                            )}

                            {activeModule === MODULES.TITLE && (
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
                                    className="mb-btn mb-btn-success" 
                                    onClick={handleExportExcel}
                                    disabled={!items.some(t => t.status === STATUS.COMPLETED)}
                                >
                                    📥 导出 Excel
                                </button>
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
                                            <th style={{ width: '50px' }}>#</th>
                                            <th style={{ width: '50px' }}>状态</th>
                                            {activeModule === MODULES.CORE_KEYWORD && (
                                                <>
                                                    <th style={{ width: '30%' }}>标题</th>
                                                    <th style={{ width: '30%' }}>中文翻译</th>
                                                    <th style={{ width: '30%' }}>核心词</th>
                                                </>
                                            )}
                                            {activeModule === MODULES.KEYWORD && (
                                                <>
                                                    <th style={{ width: '25%' }}>输入标题</th>
                                                    <th style={{ width: '65%' }}>分析报告</th>
                                                </>
                                            )}
                                            {activeModule === MODULES.TITLE && (
                                                <>
                                                    <th style={{ width: '30%' }}>原标题</th>
                                                    <th style={{ width: '60%' }}>优化标题</th>
                                                </>
                                            )}
                                            {activeModule === MODULES.IMAGE && (
                                                <>
                                                    <th style={{ width: '20%' }}>图片</th>
                                                    <th style={{ width: '70%' }}>生成结果</th>
                                                </>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, index) => (
                                            <tr key={item.id} className={`mb-row mb-row-${item.status}`}>
                                                <td>{index + 1}</td>
                                                <td>{getStatusIndicator(item.status)}</td>
                                                
                                                {activeModule === MODULES.CORE_KEYWORD && (
                                                    <>
                                                        <td className="mb-cell-input">
                                                            {item.input || '-'}
                                                        </td>
                                                        <td className="mb-cell-translation">
                                                            {item.status === STATUS.PROCESSING ? '分析中...' : 
                                                             item.status === STATUS.FAILED ? `❌ ${item.error}` :
                                                             item.translation || '-'}
                                                        </td>
                                                        <td className="mb-cell-keywords">
                                                            {item.keywords || '-'}
                                                        </td>
                                                    </>
                                                )}
                                                
                                                {activeModule === MODULES.KEYWORD && (
                                                    <>
                                                        <td className="mb-cell-input">
                                                            {item.input || '-'}
                                                        </td>
                                                        <td className="mb-cell-result">
                                                            {item.status === STATUS.PROCESSING ? '分析中...' : 
                                                             item.status === STATUS.FAILED ? `❌ ${item.error}` :
                                                             <pre className="mb-result-pre">{item.analysisReport || '-'}</pre>}
                                                        </td>
                                                    </>
                                                )}
                                                
                                                {activeModule === MODULES.TITLE && (
                                                    <>
                                                        <td className="mb-cell-input">
                                                            {item.input || item.title || '-'}
                                                        </td>
                                                        <td className="mb-cell-result">
                                                            {item.status === STATUS.PROCESSING ? '分析中...' : 
                                                             item.status === STATUS.FAILED ? `❌ ${item.error}` :
                                                             <pre className="mb-result-pre">{item.optimizedTitles || '-'}</pre>}
                                                        </td>
                                                    </>
                                                )}
                                                
                                                {activeModule === MODULES.IMAGE && (
                                                    <>
                                                        <td className="mb-cell-input">
                                                            {item.input || '-'}
                                                        </td>
                                                        <td className="mb-cell-result">
                                                            {item.status === STATUS.PROCESSING ? '分析中...' : 
                                                             item.status === STATUS.FAILED ? `❌ ${item.error}` :
                                                             <pre className="mb-result-pre">{item.imagePrompt || '-'}</pre>}
                                                        </td>
                                                    </>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}
        {showHistory && (
                <div className="mb-modal-overlay" onClick={() => { setShowHistory(false); setSelectedHistoryIndex(null); }}>
                    <div className="mb-modal mb-modal-large" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-modal-header">
                            <h3>📜 核心词提取历史记录</h3>
                            <div className="mb-history-search">
                                <input 
                                    type="text"
                                    placeholder="搜索历史记录..."
                                    value={historySearch}
                                    onChange={(e) => setHistorySearch(e.target.value)}
                                    className="mb-search-input"
                                />
                            </div>
                            <button className="mb-modal-close" onClick={() => { setShowHistory(false); setSelectedHistoryIndex(null); }}>×</button>
                        </div>
                        <div className="mb-modal-body mb-history-body">
                            {loadingHistory ? (
                                <div className="mb-loading">加载中...</div>
                            ) : filteredHistory.length === 0 ? (
                                <div className="mb-empty">{historySearch ? '没有匹配的记录' : '暂无历史记录'}</div>
                            ) : (
                                <div className="mb-history-container">
                                    <div className="mb-history-list">
                                        {filteredHistory.map((record, idx) => (
                                            <div 
                                                key={idx} 
                                                className={`mb-history-item ${selectedHistoryIndex === idx ? 'mb-history-item-selected' : ''}`}
                                                onClick={() => setSelectedHistoryIndex(idx)}
                                            >
                                                <div className="mb-history-item-info">
                                                    <span className="mb-history-date">
                                                        {new Date(record.created_at).toLocaleString()}
                                                    </span>
                                                    <span className="mb-history-count">
                                                        {record.count} 条记录
                                                    </span>
                                                </div>
                                                <div className="mb-history-item-actions">
                                                    <button 
                                                        className="mb-btn-small mb-btn-primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            const coreKeywordItems = record.titles.map((t, i) => ({
                                                                id: Date.now() + i,
                                                                input: t.original,
                                                                output: `翻译: ${t.translation}\n核心词: ${t.keywords}`,
                                                                status: STATUS.COMPLETED,
                                                                error: null
                                                            }))
                                                            setItems(coreKeywordItems)
                                                            setActiveModule(MODULES.CORE_KEYWORD)
                                                            setShowHistory(false)
                                                            setSelectedHistoryIndex(null)
                                                        }}
                                                        title="加载"
                                                    >
                                                        📂
                                                    </button>
                                                    <button 
                                                        className="mb-btn-small mb-btn-success"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            exportHistoryItem(record)
                                                        }}
                                                        title="导出"
                                                    >
                                                        📥
                                                    </button>
                                                    <button 
                                                        className="mb-btn-small mb-btn-danger"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            deleteHistory(idx)
                                                        }}
                                                        title="删除"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {selectedHistoryIndex !== null && filteredHistory[selectedHistoryIndex] && (
                                        <div className="mb-history-detail">
                                            <div className="mb-history-detail-header">
                                                <h4>详细内容</h4>
                                                <span className="mb-history-detail-count">
                                                    共 {filteredHistory[selectedHistoryIndex].titles.length} 条
                                                </span>
                                            </div>
                                            <div className="mb-history-detail-table">
                                                <table className="mb-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>原标题</th>
                                                            <th>中文翻译</th>
                                                            <th>核心大词</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {filteredHistory[selectedHistoryIndex].titles.map((item, i) => (
                                                            <tr key={i}>
                                                                <td>{i + 1}</td>
                                                                <td className="mb-cell-original">{item.original}</td>
                                                                <td className="mb-cell-translation">{item.translation || '-'}</td>
                                                                <td className="mb-cell-keywords">{item.keywords || '-'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <button 
                className="mb-history-btn"
                onClick={() => {
                    setShowHistory(true)
                    loadHistory()
                }}
                title="查看核心词提取历史记录"
            >
                📜
            </button>
        </div>
    )
}

export default MexicoBeautyStation
