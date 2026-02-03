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

    const handleStartProcess = () => {
        // TODO: Implement batch processing logic (Task 5)
        alert('批量处理功能将在 Task 5 实现')
    }

    const handleSyncFeishu = () => {
        // TODO: Implement Feishu sync (Task 6)
        alert('飞书同步功能将在 Task 6 实现')
    }

    const handleClear = () => {
        setItems([])
        setActiveModule(null)
    }

    return (
        <div className="mexico-beauty-container">
            <div className="mb-header">
                <h2>💄 墨西哥美妆工作台</h2>
                <p className="mb-subtitle">TikTok Mexico E-commerce AI Tools - 4个AI工具模块</p>
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
                            onClick={() => { setActiveModule(null); setItems([]); }}
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
                                    />
                                    <button className="mb-btn mb-btn-primary">
                                        开始分析
                                    </button>
                                </div>
                            )}

                            {(activeModule === MODULES.TITLE || 
                              activeModule === MODULES.IMAGE || 
                              activeModule === MODULES.DESCRIPTION) && (
                                <div>
                                    <textarea
                                        className="mb-textarea"
                                        placeholder="粘贴标题，每行一个..."
                                        rows={5}
                                    />
                                    <div className="mb-file-upload">
                                        <label className="mb-upload-label">
                                            <input type="file" multiple accept="image/*" />
                                            <span>📁 上传图片（可多选）</span>
                                        </label>
                                    </div>
                                    <button className="mb-btn mb-btn-primary">
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
                                    <button className="mb-btn mb-btn-warning" onClick={() => { setIsPaused(true); pauseRef.current = true; }}>
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
                                            <th>输入</th>
                                            <th>输出</th>
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
                                                    {item.output || (item.status === STATUS.PROCESSING ? '分析中...' : '-')}
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
