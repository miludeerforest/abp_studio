import { useState, useRef, useEffect } from 'react'
import './KeywordExtractor.css'

const BACKEND_URL = ''
const CONCURRENCY = 5

const STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
}

function KeywordExtractor({ token }) {
    const [inputText, setInputText] = useState('')
    const [titles, setTitles] = useState([])
    
    const [isProcessing, setIsProcessing] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const pauseRef = useRef(false)
    const titlesRef = useRef([])
    
    const [showHistory, setShowHistory] = useState(false)
    const [history, setHistory] = useState([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(null)
    const [historySearch, setHistorySearch] = useState('')
    const [syncingFeishu, setSyncingFeishu] = useState(false)

    useEffect(() => {
        titlesRef.current = titles
    }, [titles])

    const handleParseInput = () => {
        const lines = inputText.trim().split('\n').filter(line => line.trim())
        if (lines.length === 0) return
        
        const newTitles = lines.map((line, index) => ({
            id: Date.now() + index,
            original: line.trim(),
            translation: '',
            keywords: '',
            status: STATUS.PENDING,
            error: null
        }))
        setTitles(newTitles)
    }

    const analyzeTitle = async (title) => {
        const response = await fetch(`${BACKEND_URL}/api/v1/keywords/analyze-single`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ title })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(errorText || '分析失败')
        }

        return await response.json()
    }

    const handleStartProcess = async () => {
        if (titles.length === 0) {
            handleParseInput()
            return
        }

        setIsProcessing(true)
        setIsPaused(false)
        pauseRef.current = false

        const queue = titles
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
                const titleData = titlesRef.current[index]
                
                setTitles(prev => prev.map((t, idx) => 
                    idx === index ? { ...t, status: STATUS.PROCESSING } : t
                ))

                analyzeTitle(titleData.original)
                    .then(result => {
                        setTitles(prev => prev.map((t, idx) => 
                            idx === index ? {
                                ...t,
                                translation: result.translation || '',
                                keywords: result.keywords || '',
                                status: STATUS.COMPLETED,
                                error: null
                            } : t
                        ))
                    })
                    .catch(error => {
                        setTitles(prev => prev.map((t, idx) => 
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

    const handleRetry = async (index) => {
        const title = titlesRef.current[index]
        
        setTitles(prev => prev.map((t, idx) => 
            idx === index ? { ...t, status: STATUS.PROCESSING, error: null } : t
        ))

        try {
            const result = await analyzeTitle(title.original)
            
            setTitles(prev => prev.map((t, idx) => 
                idx === index ? {
                    ...t,
                    translation: result.translation || '',
                    keywords: result.keywords || '',
                    status: STATUS.COMPLETED,
                    error: null
                } : t
            ))
        } catch (error) {
            setTitles(prev => prev.map((t, idx) => 
                idx === index ? {
                    ...t,
                    status: STATUS.FAILED,
                    error: error.message
                } : t
            ))
        }
    }

    const handleExportExcel = async () => {
        const hasData = titles.some(t => t.translation || t.keywords)
        if (!hasData) {
            alert('没有可导出的数据')
            return
        }

        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/keywords/export-excel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles })
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(errorText || '导出失败')
            }

            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `keywords_${new Date().toISOString().slice(0, 10)}.xlsx`
            link.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Export failed:', error)
            alert('导出失败: ' + error.message)
        }
    }

    const handleSaveHistory = async () => {
        try {
            await fetch(`${BACKEND_URL}/api/v1/keywords/history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles })
            })
            alert('已保存到历史记录')
        } catch (error) {
            console.error('Save history failed:', error)
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

    const filteredHistory = history.filter(record => {
        if (!historySearch.trim()) return true
        const search = historySearch.toLowerCase()
        return record.titles.some(t => 
            t.original?.toLowerCase().includes(search) ||
            t.translation?.toLowerCase().includes(search) ||
            t.keywords?.toLowerCase().includes(search)
        )
    })

    const handleClear = () => {
        if (isProcessing) {
            handlePause()
        }
        setTitles([])
        setInputText('')
    }

    const handleSyncFeishu = async () => {
        const completedTitles = titles.filter(t => t.status === STATUS.COMPLETED)
        if (completedTitles.length === 0) {
            alert('没有已完成的记录可以同步')
            return
        }

        setSyncingFeishu(true)
        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/keywords/sync-feishu`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ titles })
            })

            const data = await response.json()
            
            if (!response.ok) {
                throw new Error(data.detail || '同步失败')
            }

            alert(data.message || `成功同步 ${data.synced_count} 条记录`)
        } catch (error) {
            console.error('Feishu sync failed:', error)
            alert('同步到飞书失败: ' + error.message)
        } finally {
            setSyncingFeishu(false)
        }
    }

    const stats = {
        total: titles.length,
        completed: titles.filter(t => t.status === STATUS.COMPLETED).length,
        processing: titles.filter(t => t.status === STATUS.PROCESSING).length,
        failed: titles.filter(t => t.status === STATUS.FAILED).length,
        pending: titles.filter(t => t.status === STATUS.PENDING).length
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
        <div className="keyword-extractor">
            <div className="ke-header">
                <h2>📊 核心词提取工具</h2>
                <p className="ke-subtitle">批量分析产品标题，提取中文翻译和核心大词</p>
            </div>

            {titles.length === 0 && (
                <div className="ke-input-section">
                    <div className="ke-input-header">
                        <label>粘贴产品标题（每行一个）</label>
                        <span className="ke-line-count">
                            {inputText.trim().split('\n').filter(l => l.trim()).length} 条标题
                        </span>
                    </div>
                    <textarea
                        className="ke-textarea"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="在此粘贴产品标题，每行一个..."
                        rows={10}
                    />
                    <button 
                        className="ke-btn ke-btn-primary"
                        onClick={handleParseInput}
                        disabled={!inputText.trim()}
                    >
                        开始分析
                    </button>
                </div>
            )}

            {titles.length > 0 && (
                <>
                    <div className="ke-stats-bar">
                        <div className="ke-stat">
                            <span className="ke-stat-label">总计</span>
                            <span className="ke-stat-value">{stats.total}</span>
                        </div>
                        <div className="ke-stat ke-stat-completed">
                            <span className="ke-stat-label">🟢 已完成</span>
                            <span className="ke-stat-value">{stats.completed}</span>
                        </div>
                        <div className="ke-stat ke-stat-processing">
                            <span className="ke-stat-label">🔵 处理中</span>
                            <span className="ke-stat-value">{stats.processing}</span>
                        </div>
                        <div className="ke-stat ke-stat-failed">
                            <span className="ke-stat-label">🔴 失败</span>
                            <span className="ke-stat-value">{stats.failed}</span>
                        </div>
                        <div className="ke-stat ke-stat-pending">
                            <span className="ke-stat-label">⚪ 待处理</span>
                            <span className="ke-stat-value">{stats.pending}</span>
                        </div>
                    </div>

                    <div className="ke-controls">
                        {!isProcessing && (stats.pending > 0 || stats.failed > 0) && (
                            <button className="ke-btn ke-btn-primary" onClick={handleStartProcess}>
                                {isPaused ? '▶️ 继续' : '▶️ 开始处理'}
                            </button>
                        )}
                        {isProcessing && (
                            <button className="ke-btn ke-btn-warning" onClick={handlePause}>
                                ⏸️ 暂停
                            </button>
                        )}
                        <button 
                            className="ke-btn ke-btn-success" 
                            onClick={handleExportExcel}
                            disabled={!titles.some(t => t.translation || t.keywords)}
                        >
                            📥 导出 Excel
                        </button>
                        <button 
                            className="ke-btn ke-btn-secondary" 
                            onClick={handleSaveHistory}
                            disabled={!titles.some(t => t.translation || t.keywords)}
                        >
                            💾 保存历史
                        </button>
                        <button 
                            className="ke-btn ke-btn-feishu" 
                            onClick={handleSyncFeishu}
                            disabled={syncingFeishu || !titles.some(t => t.status === STATUS.COMPLETED)}
                            title="同步到飞书多维表格"
                        >
                            {syncingFeishu ? '⏳ 同步中...' : '📋 同步到飞书'}
                        </button>
                        <button className="ke-btn ke-btn-danger" onClick={handleClear}>
                            🗑️ 清空
                        </button>
                    </div>

                    <div className="ke-table-container">
                        <table className="ke-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', minWidth: '40px' }}>#</th>
                                    <th style={{ width: '50px', minWidth: '50px' }}>状态</th>
                                    <th style={{ width: '28%', minWidth: '200px' }}>原标题</th>
                                    <th style={{ width: '28%', minWidth: '200px' }}>中文翻译</th>
                                    <th style={{ width: '28%', minWidth: '200px' }}>核心大词</th>
                                    <th style={{ width: '60px', minWidth: '60px' }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {titles.map((title, index) => (
                                    <tr key={title.id} className={`ke-row ke-row-${title.status}`}>
                                        <td>{index + 1}</td>
                                        <td>{getStatusIndicator(title.status)}</td>
                                        <td className="ke-cell-original" title={title.original}>
                                            {title.original}
                                        </td>
                                        <td className="ke-cell-translation">
                                            {title.translation || (title.status === STATUS.PROCESSING ? '分析中...' : '-')}
                                        </td>
                                        <td className="ke-cell-keywords">
                                            {title.keywords || '-'}
                                        </td>
                                        <td className="ke-cell-actions">
                                            {title.status === STATUS.FAILED && (
                                                <button 
                                                    className="ke-btn-small ke-btn-retry"
                                                    onClick={() => handleRetry(index)}
                                                    title="重试"
                                                >
                                                    🔄
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {showHistory && (
                <div className="ke-modal-overlay" onClick={() => { setShowHistory(false); setSelectedHistoryIndex(null); }}>
                    <div className="ke-modal ke-modal-large" onClick={(e) => e.stopPropagation()}>
                        <div className="ke-modal-header">
                            <h3>📜 历史记录</h3>
                            <div className="ke-history-search">
                                <input 
                                    type="text"
                                    placeholder="搜索历史记录..."
                                    value={historySearch}
                                    onChange={(e) => setHistorySearch(e.target.value)}
                                    className="ke-search-input"
                                />
                            </div>
                            <button className="ke-modal-close" onClick={() => { setShowHistory(false); setSelectedHistoryIndex(null); }}>×</button>
                        </div>
                        <div className="ke-modal-body ke-history-body">
                            {loadingHistory ? (
                                <div className="ke-loading">加载中...</div>
                            ) : filteredHistory.length === 0 ? (
                                <div className="ke-empty">{historySearch ? '没有匹配的记录' : '暂无历史记录'}</div>
                            ) : (
                                <div className="ke-history-container">
                                    <div className="ke-history-list">
                                        {filteredHistory.map((record, idx) => (
                                            <div 
                                                key={idx} 
                                                className={`ke-history-item ${selectedHistoryIndex === idx ? 'ke-history-item-selected' : ''}`}
                                                onClick={() => setSelectedHistoryIndex(idx)}
                                            >
                                                <div className="ke-history-item-info">
                                                    <span className="ke-history-date">
                                                        {new Date(record.created_at).toLocaleString()}
                                                    </span>
                                                    <span className="ke-history-count">
                                                        {record.count} 条记录
                                                    </span>
                                                </div>
                                                <div className="ke-history-item-actions">
                                                    <button 
                                                        className="ke-btn-small ke-btn-primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setTitles(record.titles)
                                                            setShowHistory(false)
                                                            setSelectedHistoryIndex(null)
                                                        }}
                                                        title="加载"
                                                    >
                                                        📂
                                                    </button>
                                                    <button 
                                                        className="ke-btn-small ke-btn-success"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            exportHistoryItem(record)
                                                        }}
                                                        title="导出"
                                                    >
                                                        📥
                                                    </button>
                                                    <button 
                                                        className="ke-btn-small ke-btn-danger"
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
                                        <div className="ke-history-detail">
                                            <div className="ke-history-detail-header">
                                                <h4>详细内容</h4>
                                                <span className="ke-history-detail-count">
                                                    共 {filteredHistory[selectedHistoryIndex].titles.length} 条
                                                </span>
                                            </div>
                                            <div className="ke-history-detail-table">
                                                <table className="ke-table">
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
                                                                <td className="ke-cell-original">{item.original}</td>
                                                                <td className="ke-cell-translation">{item.translation || '-'}</td>
                                                                <td className="ke-cell-keywords">{item.keywords || '-'}</td>
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
                className="ke-history-btn"
                onClick={() => {
                    setShowHistory(true)
                    loadHistory()
                }}
                title="查看历史记录"
            >
                📜
            </button>
        </div>
    )
}

export default KeywordExtractor
