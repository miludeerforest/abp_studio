import { useState, useEffect, useMemo } from 'react'

const BACKEND_URL = ''
const STORAGE_KEY = 'mexico_beauty_prompts_history'

const ImageType = {
    MAIN: 'Main Image',
    FEATURE: 'Feature Graphic',
    DETAIL: 'Detail/Scenario'
}

const ASPECT_RATIOS = [
    { id: '1:1', label: '1:1 方形', icon: '⬜' },
    { id: '9:16', label: '9:16 竖版', icon: '📱' },
    { id: '16:9', label: '16:9 横版', icon: '🖥️' },
    { id: '4:5', label: '4:5 社交', icon: '📷' },
    { id: '3:4', label: '3:4 竖版', icon: '📐' }
]

const TARGET_LANGUAGES = [
    { id: 'es-MX', label: '西班牙语 (墨西哥)', icon: '🇲🇽', region: 'Mexico', language: 'Mexican Spanish' },
    { id: 'th-TH', label: '泰语 (泰国)', icon: '🇹🇭', region: 'Thailand', language: 'Thai' },
    { id: 'zh-CN', label: '中文 (中国)', icon: '🇨🇳', region: 'China', language: 'Simplified Chinese' },
    { id: 'en-US', label: '英语 (美国)', icon: '🇺🇸', region: 'United States', language: 'American English' },
    { id: 'id-ID', label: '印尼语 (印尼)', icon: '🇮🇩', region: 'Indonesia', language: 'Indonesian' },
    { id: 'vi-VN', label: '越南语 (越南)', icon: '🇻🇳', region: 'Vietnam', language: 'Vietnamese' },
    { id: 'ms-MY', label: '马来语 (马来西亚)', icon: '🇲🇾', region: 'Malaysia', language: 'Malay' },
    { id: 'tl-PH', label: '菲律宾语 (菲律宾)', icon: '🇵🇭', region: 'Philippines', language: 'Filipino/Tagalog' }
]

function ProductDescriptionModule({ token, onBack }) {
    const [formData, setFormData] = useState({
        title: '',
        keywords: '',
        description: '',
        images: [],           // Array of { file, preview }
        aspectRatio: '1:1',
        targetLanguage: 'es-MX'
    })
    
    const [prompts, setPrompts] = useState([])
    const [isGenerating, setIsGenerating] = useState(false)
    const [refiningPromptId, setRefiningPromptId] = useState(null)
    const [submittingRefineId, setSubmittingRefineId] = useState(null)
    const [refineFeedback, setRefineFeedback] = useState('')
    
    const [history, setHistory] = useState([])
    const [activeSessionId, setActiveSessionId] = useState(null)
    const [syncingFeishu, setSyncingFeishu] = useState(false)
    
    const [isBatchGenerating, setIsBatchGenerating] = useState(false)
    const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 })
    const [maxConcurrent, setMaxConcurrent] = useState(5)

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/config`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                if (res.ok) {
                    const config = await res.json()
                    if (config.max_concurrent_image) {
                        setMaxConcurrent(config.max_concurrent_image)
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch config:', e)
            }
        }
        fetchConfig()
    }, [token])

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
            try {
                setHistory(JSON.parse(saved))
            } catch (e) {
                console.error('Failed to load history:', e)
            }
        }
    }, [])

    useEffect(() => {
        if (history.length > 0) {
            try {
                const historyToSave = history.slice(0, 10).map(item => ({
                    ...item,
                    productInput: {
                        ...item.productInput,
                        imagePreviews: (item.productInput?.imagePreviews || []).slice(0, 1),
                        imagePreview: item.productInput?.imagePreview ? 
                            item.productInput.imagePreview.substring(0, 50000) : null
                    },
                    prompts: item.prompts.map(p => ({
                        ...p,
                        generatedImage: null
                    }))
                }))
                localStorage.setItem(STORAGE_KEY, JSON.stringify(historyToSave))
            } catch (e) {
                console.warn('Failed to save history to localStorage:', e)
                try {
                    localStorage.removeItem(STORAGE_KEY)
                } catch (clearErr) {
                    console.warn('Failed to clear localStorage:', clearErr)
                }
            }
        }
    }, [history])

    const activeSession = useMemo(() => 
        history.find(h => h.id === activeSessionId), 
        [history, activeSessionId]
    )

    const displayPrompts = activeSession?.prompts || prompts

    const mainPrompts = useMemo(() => 
        displayPrompts.filter(p => p.type === ImageType.MAIN),
        [displayPrompts]
    )

    const featurePrompts = useMemo(() => 
        displayPrompts.filter(p => p.type === ImageType.FEATURE),
        [displayPrompts]
    )

    const detailPrompts = useMemo(() => 
        displayPrompts.filter(p => p.type === ImageType.DETAIL),
        [displayPrompts]
    )

    const handleImageUpload = (e) => {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return

        const promises = files.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve({ file, preview: reader.result })
                reader.readAsDataURL(file)
            })
        })

        Promise.all(promises).then(newImages => {
            setFormData(prev => ({ ...prev, images: [...prev.images, ...newImages] }))
        })

        e.target.value = ''
    }

    const handleRemoveImage = (index) => {
        setFormData(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }))
    }

    const handleGenerate = async () => {
        if (formData.images.length === 0) {
            alert('请上传产品图片')
            return
        }

        setIsGenerating(true)
        setPrompts([])
        setActiveSessionId(null)

        try {
            const fd = new FormData()
            if (formData.images.length > 0) {
                fd.append('image', formData.images[0].file)
            }
            if (formData.title) fd.append('title', formData.title)
            if (formData.keywords) fd.append('keywords', formData.keywords)
            if (formData.description) fd.append('description', formData.description)
            fd.append('aspect_ratio', formData.aspectRatio)
            fd.append('target_language', formData.targetLanguage)

            const response = await fetch(`${BACKEND_URL}/api/v1/mexico-beauty/image-prompts-batch`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: fd
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(errorText)
            }

            const data = await response.json()
            const generatedPrompts = (data.prompts || []).map(p => ({
                ...p,
                generatedImage: null,
                isGenerating: false,
                generateError: null
            }))
            
            setPrompts(generatedPrompts)

            const firstPreview = formData.images[0]?.preview || null
            const newHistoryItem = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
productInput: {
                     title: formData.title,
                     keywords: formData.keywords,
                     description: formData.description,
                     imagePreviews: formData.images.map(img => img.preview),
                     imagePreview: firstPreview,
                     aspectRatio: formData.aspectRatio,
                     targetLanguage: formData.targetLanguage
                 },
                prompts: generatedPrompts
            }

            setHistory(prev => [newHistoryItem, ...prev].slice(0, 20))
            setActiveSessionId(newHistoryItem.id)
            
            alert('策略生成完毕!')

        } catch (error) {
            console.error('Generation failed:', error)
            alert('生成失败: ' + error.message)
        } finally {
            setIsGenerating(false)
        }
    }

    const handleRefineSubmit = async (promptId, feedbackImages = []) => {
        if (!refineFeedback.trim() && feedbackImages.length === 0) return

        const originalPrompt = displayPrompts.find(p => p.id === promptId)
        if (!originalPrompt) return

        setSubmittingRefineId(promptId)

        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/mexico-beauty/refine-prompt`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    original_prompt: originalPrompt,
                    feedback: refineFeedback,
                    feedback_images: feedbackImages,
                    product_title: activeSession?.productInput?.title || formData.title,
                    product_description: activeSession?.productInput?.description || formData.description
                })
            })

            if (!response.ok) {
                throw new Error(await response.text())
            }

            const refinedPrompt = await response.json()
            const enrichedPrompt = {
                ...refinedPrompt,
                generatedImage: null,
                isGenerating: false,
                generateError: null
            }

            if (activeSessionId) {
                setHistory(prev => prev.map(item => {
                    if (item.id === activeSessionId) {
                        return {
                            ...item,
                            prompts: item.prompts.map(p => 
                                p.id === promptId ? enrichedPrompt : p
                            )
                        }
                    }
                    return item
                }))
            } else {
                setPrompts(prev => prev.map(p => 
                    p.id === promptId ? enrichedPrompt : p
                ))
            }

            setRefineFeedback('')
            setRefiningPromptId(null)
            alert('提示词已更新!')

        } catch (error) {
            console.error('Refine failed:', error)
            alert('优化失败: ' + error.message)
        } finally {
            setSubmittingRefineId(null)
        }
    }

    const handleHistorySelect = (id) => {
        const session = history.find(h => h.id === id)
        if (session) {
            setActiveSessionId(id)
            setPrompts([])
            if (session.productInput) {
                const imagePreviews = session.productInput.imagePreviews || 
                    (session.productInput.imagePreview ? [session.productInput.imagePreview] : [])
setFormData({
                     title: session.productInput.title || '',
                     keywords: session.productInput.keywords || '',
                     description: session.productInput.description || '',
                     images: imagePreviews.map(preview => ({ file: null, preview })),
                     aspectRatio: session.productInput.aspectRatio || '1:1',
                     targetLanguage: session.productInput.targetLanguage || 'es-MX'
                 })
            }
        }
    }

    const handleDeleteHistory = (id) => {
        if (!confirm('确定删除这条历史记录？')) return
        setHistory(prev => prev.filter(h => h.id !== id))
        if (activeSessionId === id) {
            setActiveSessionId(null)
            setPrompts([])
        }
    }

    const handleCopyPrompt = (text) => {
        navigator.clipboard.writeText(text)
        alert('已复制到剪贴板')
    }

    const handleGenerateImage = async (promptId) => {
        const prompt = displayPrompts.find(p => p.id === promptId)
        if (!prompt) return

        const updatePromptState = (updates) => {
            if (activeSessionId) {
                setHistory(prev => prev.map(item => {
                    if (item.id === activeSessionId) {
                        return {
                            ...item,
                            prompts: item.prompts.map(p =>
                                p.id === promptId ? { ...p, ...updates } : p
                            )
                        }
                    }
                    return item
                }))
            } else {
                setPrompts(prev => prev.map(p =>
                    p.id === promptId ? { ...p, ...updates } : p
                ))
            }
        }

        updatePromptState({ isGenerating: true, generateError: null })

        try {
            const fd = new FormData()
            fd.append('prompt_text', prompt.promptText)
            fd.append('aspect_ratio', activeSession?.productInput?.aspectRatio || formData.aspectRatio)
            
            let refImageBlob = null
            
            if (formData.images.length > 0 && formData.images[0]?.file) {
                refImageBlob = formData.images[0].file
            } else if (activeSession?.productInput?.imagePreviews?.length > 0) {
                const base64 = activeSession.productInput.imagePreviews[0]
                const base64Data = base64.split(',')[1] || base64
                const byteChars = atob(base64Data)
                const byteNumbers = new Array(byteChars.length)
                for (let i = 0; i < byteChars.length; i++) {
                    byteNumbers[i] = byteChars.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                refImageBlob = new Blob([byteArray], { type: 'image/jpeg' })
            } else if (activeSession?.productInput?.imagePreview) {
                const base64 = activeSession.productInput.imagePreview
                const base64Data = base64.split(',')[1] || base64
                const byteChars = atob(base64Data)
                const byteNumbers = new Array(byteChars.length)
                for (let i = 0; i < byteChars.length; i++) {
                    byteNumbers[i] = byteChars.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                refImageBlob = new Blob([byteArray], { type: 'image/jpeg' })
            }
            
            if (!refImageBlob) {
                throw new Error('缺少参考产品图')
            }
            
            fd.append('reference_image', refImageBlob, 'product.jpg')

            const response = await fetch(`${BACKEND_URL}/api/v1/mexico-beauty/generate-image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: fd
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(errorText)
            }

            const data = await response.json()
            updatePromptState({ 
                generatedImage: data.image_url,
                isGenerating: false,
                generateError: null
            })

        } catch (error) {
            console.error('Image generation failed:', error)
            updatePromptState({ 
                isGenerating: false, 
                generateError: error.message 
            })
        }
    }

    const handleDownloadImage = (imageUrl, promptId) => {
        const link = document.createElement('a')
        link.href = imageUrl
        link.download = `mexico-beauty-${promptId}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handleSyncToFeishu = async () => {
        if (displayPrompts.length === 0) {
            alert('没有可同步的数据')
            return
        }

        setSyncingFeishu(true)
        try {
            const productTitle = activeSession?.productInput?.title || formData.title || '未命名产品'
            
            const response = await fetch(`${BACKEND_URL}/api/v1/mexico-beauty/sync-description-feishu`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    product_title: productTitle,
                    prompts: displayPrompts
                })
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.detail || '同步失败')
            }

            const result = await response.json()
            alert(`同步成功! ${result.message}`)
        } catch (error) {
            console.error('Feishu sync failed:', error)
            alert('同步到飞书失败: ' + error.message)
        } finally {
            setSyncingFeishu(false)
        }
    }

    const handleBatchGenerateImages = async () => {
        const promptsToGenerate = displayPrompts.filter(p => !p.generatedImage && !p.isGenerating)
        if (promptsToGenerate.length === 0) {
            alert('没有需要生成的图片（所有图片已生成或正在生成中）')
            return
        }

        setIsBatchGenerating(true)
        setBatchProgress({ completed: 0, total: promptsToGenerate.length })

        const queue = [...promptsToGenerate]
        let completed = 0

        const processPrompt = async (prompt) => {
            await handleGenerateImage(prompt.id)
            completed++
            setBatchProgress({ completed, total: promptsToGenerate.length })
        }

        for (let i = 0; i < queue.length; i += maxConcurrent) {
            const batch = queue.slice(i, i + maxConcurrent)
            await Promise.all(batch.map(processPrompt))
        }

        setIsBatchGenerating(false)
        setBatchProgress({ completed: 0, total: 0 })
    }

    const productContext = activeSession?.productInput || {
        title: formData.title,
        imagePreview: formData.images[0]?.preview,
        imagePreviews: formData.images.map(img => img.preview)
    }

    return (
        <div className="pdm-container">
            <div className="pdm-header">
                <button className="mb-back-btn" onClick={onBack}>
                    ← 返回模块选择
                </button>
                <h3>📝 产品图片提示词生成</h3>
            </div>

            <div className="pdm-layout">
                <div className="pdm-left-column">
                    <div className="pdm-input-form">
                        <div className="pdm-form-header">
                            <h4>商品详情</h4>
                            <p>上传产品图片，可选填标题和描述</p>
                        </div>

                        <div className="pdm-image-upload">
                            <label>参考产品图 (必填, 支持多张)</label>
                            
                            {formData.images.length > 0 && (
                                <div className="pdm-images-grid">
                                    {formData.images.map((img, index) => (
                                        <div key={index} className="pdm-grid-image">
                                            <img src={img.preview} alt={`Product ${index + 1}`} />
                                            <button 
                                                type="button" 
                                                className="pdm-grid-remove"
                                                onClick={() => handleRemoveImage(index)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className={`pdm-upload-area ${formData.images.length > 0 ? 'has-images' : ''}`}>
                                <label className="pdm-upload-label">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleImageUpload}
                                    />
                                    <span className="pdm-upload-icon">📷</span>
                                    <span>{formData.images.length > 0 ? '添加更多图片' : '点击上传图片'}</span>
                                    <small>PNG, JPG, GIF up to 10MB</small>
                                </label>
                            </div>
                        </div>

                        <div className="pdm-form-field">
                            <label>产品标题 (选填)</label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="例如：无线降噪耳机"
                            />
                        </div>

                        <div className="pdm-form-field">
                            <label>核心关键词 (选填)</label>
                            <input
                                type="text"
                                value={formData.keywords}
                                onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
                                placeholder="例如：蓝牙, 长续航, 重低音"
                            />
                        </div>

                        <div className="pdm-form-field">
                            <label>详细描述与痛点 (选填)</label>
                            <textarea
                                rows={3}
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="描述使用场景、解决的问题等..."
                            />
                        </div>

                        <div className="pdm-form-field">
                            <label>图片比例</label>
                            <div className="pdm-aspect-ratio-selector">
                                {ASPECT_RATIOS.map(ratio => (
                                    <button
                                        key={ratio.id}
                                        type="button"
                                        className={`pdm-ratio-btn ${formData.aspectRatio === ratio.id ? 'active' : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, aspectRatio: ratio.id }))}
                                    >
                                        <span className="pdm-ratio-icon">{ratio.icon}</span>
                                        <span className="pdm-ratio-label">{ratio.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pdm-form-field">
                            <label>目标语言/地区</label>
                            <div className="pdm-language-selector">
                                {TARGET_LANGUAGES.map(lang => (
                                    <button
                                        key={lang.id}
                                        type="button"
                                        className={`pdm-lang-btn ${formData.targetLanguage === lang.id ? 'active' : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, targetLanguage: lang.id }))}
                                        title={`${lang.region} - ${lang.language}`}
                                    >
                                        <span className="pdm-lang-icon">{lang.icon}</span>
                                        <span className="pdm-lang-label">{lang.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            className="pdm-generate-btn"
                            onClick={handleGenerate}
                            disabled={isGenerating || formData.images.length === 0}
                        >
                            {isGenerating ? (
                                <>
                                    <span className="pdm-spinner"></span>
                                    生成策略中...
                                </>
                            ) : (
                                <>✨ 生成图片策略</>
                            )}
                        </button>
                    </div>

                    {history.length > 0 && (
                        <div className="pdm-history">
                            <h4>📜 历史记录</h4>
                            <div className="pdm-history-list">
                                {history.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`pdm-history-item ${activeSessionId === item.id ? 'active' : ''}`}
                                        onClick={() => handleHistorySelect(item.id)}
                                    >
                                        {item.productInput?.imagePreview && (
                                            <img 
                                                src={item.productInput.imagePreview} 
                                                alt="thumb" 
                                                className="pdm-history-thumb"
                                            />
                                        )}
                                        <div className="pdm-history-info">
                                            <div className="pdm-history-title">
                                                {item.productInput?.title || '未命名产品'}
                                            </div>
                                            <div className="pdm-history-time">
                                                {new Date(item.timestamp).toLocaleString('zh-CN', {
                                                    month: 'numeric',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </div>
                                        </div>
                                        <button
                                            className="pdm-history-delete"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDeleteHistory(item.id)
                                            }}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="pdm-right-column">
                    {displayPrompts.length === 0 ? (
                        <div className="pdm-empty-state">
                            <div className="pdm-empty-icon">🖼️</div>
                            <p className="pdm-empty-title">暂无生成策略</p>
                            <p className="pdm-empty-desc">
                                请上传产品图片（标题/描述选填）以生成策略。历史记录将显示在左下方。
                            </p>
                        </div>
                    ) : (
                        <div className="pdm-results">
                            <div className="pdm-results-header">
                                {productContext?.imagePreview && (
                                    <div className="pdm-context-header">
                                        <img src={productContext.imagePreview} alt="Product" />
                                        <div>
                                            <h2>{productContext.title || '未命名产品'}</h2>
                                            {activeSession?.productInput?.description && (
                                                <p>{activeSession.productInput.description}</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div className="pdm-header-actions">
                                    <button
                                        className="pdm-batch-generate-btn"
                                        onClick={handleBatchGenerateImages}
                                        disabled={isBatchGenerating || displayPrompts.every(p => p.generatedImage || p.isGenerating)}
                                    >
                                        {isBatchGenerating ? (
                                            <>
                                                <span className="pdm-spinner"></span>
                                                生成中 ({batchProgress.completed}/{batchProgress.total})
                                            </>
                                        ) : (
                                            <>✨ 一键生成图片</>
                                        )}
                                    </button>
                                    <button
                                        className="pdm-sync-btn"
                                        onClick={handleSyncToFeishu}
                                        disabled={syncingFeishu}
                                    >
                                        {syncingFeishu ? '⏳ 同步中...' : '📋 同步到飞书'}
                                    </button>
                                </div>
                            </div>

                            <section className="pdm-section">
                                <div className="pdm-section-header">
                                    <span className="pdm-section-badge pdm-badge-main">1</span>
                                    <h2>主图 (Hero Shots)</h2>
                                    <span className="pdm-count-badge">{mainPrompts.length} 张</span>
                                </div>
                                <div className="pdm-cards-grid pdm-grid-2">
                                    {mainPrompts.map(prompt => (
                                        <PromptCard
                                            key={prompt.id}
                                            prompt={prompt}
                                            isRefining={submittingRefineId === prompt.id}
                                            refineFeedback={refineFeedback}
                                            setRefineFeedback={setRefineFeedback}
                                            onRefineSubmit={handleRefineSubmit}
                                            onCopy={handleCopyPrompt}
                                            refiningPromptId={refiningPromptId}
                                            setRefiningPromptId={setRefiningPromptId}
                                            onGenerateImage={handleGenerateImage}
                                            onDownloadImage={handleDownloadImage}
                                        />
                                    ))}
                                </div>
                            </section>

                            <section className="pdm-section">
                                <div className="pdm-section-header">
                                    <span className="pdm-section-badge pdm-badge-feature">2</span>
                                    <h2>功能信息图 (Feature Graphics)</h2>
                                    <span className="pdm-count-badge">{featurePrompts.length} 张</span>
                                </div>
                                <div className="pdm-cards-grid pdm-grid-2">
                                    {featurePrompts.map(prompt => (
                                        <PromptCard
                                            key={prompt.id}
                                            prompt={prompt}
                                            isRefining={submittingRefineId === prompt.id}
                                            refineFeedback={refineFeedback}
                                            setRefineFeedback={setRefineFeedback}
                                            onRefineSubmit={handleRefineSubmit}
                                            onCopy={handleCopyPrompt}
                                            refiningPromptId={refiningPromptId}
                                            setRefiningPromptId={setRefiningPromptId}
                                            onGenerateImage={handleGenerateImage}
                                            onDownloadImage={handleDownloadImage}
                                        />
                                    ))}
                                </div>
                            </section>

                            <section className="pdm-section">
                                <div className="pdm-section-header">
                                    <span className="pdm-section-badge pdm-badge-detail">3</span>
                                    <h2>详情与痛点图</h2>
                                    <span className="pdm-count-badge">{detailPrompts.length} 张</span>
                                </div>
                                <div className="pdm-cards-grid pdm-grid-2">
                                    {detailPrompts.map(prompt => (
                                        <PromptCard
                                            key={prompt.id}
                                            prompt={prompt}
                                            isRefining={submittingRefineId === prompt.id}
                                            refineFeedback={refineFeedback}
                                            setRefineFeedback={setRefineFeedback}
                                            onRefineSubmit={handleRefineSubmit}
                                            onCopy={handleCopyPrompt}
                                            refiningPromptId={refiningPromptId}
                                            setRefiningPromptId={setRefiningPromptId}
                                            onGenerateImage={handleGenerateImage}
                                            onDownloadImage={handleDownloadImage}
                                        />
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function PromptCard({ 
    prompt, 
    isRefining, 
    refineFeedback, 
    setRefineFeedback, 
    onRefineSubmit, 
    onCopy,
    refiningPromptId,
    setRefiningPromptId,
    onGenerateImage,
    onDownloadImage
}) {
    const isMain = prompt.type === ImageType.MAIN
    const isFeature = prompt.type === ImageType.FEATURE
    const [showRefineForm, setShowRefineForm] = useState(false)
    const [feedbackImages, setFeedbackImages] = useState([])
    const fileInputRef = useState(null)

    const handleStartRefine = () => {
        setShowRefineForm(true)
        setRefiningPromptId(prompt.id)
        setRefineFeedback('')
        setFeedbackImages([])
    }

    const handleCancelRefine = () => {
        setShowRefineForm(false)
        setRefiningPromptId(null)
        setRefineFeedback('')
        setFeedbackImages([])
    }

    const handleSubmit = async () => {
        try {
            await onRefineSubmit(prompt.id, feedbackImages)
        } finally {
            setShowRefineForm(false)
            setFeedbackImages([])
        }
    }

    const handleFeedbackImageUpload = (e) => {
        const files = Array.from(e.target.files || [])
        if (files.length === 0) return

        const promises = files.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result)
                reader.readAsDataURL(file)
            })
        })

        Promise.all(promises).then(newImages => {
            setFeedbackImages(prev => [...prev, ...newImages])
        })

        e.target.value = ''
    }

    const removeFeedbackImage = (index) => {
        setFeedbackImages(prev => prev.filter((_, i) => i !== index))
    }

    return (
        <div className={`pdm-card ${isMain ? 'pdm-card-main' : isFeature ? 'pdm-card-feature' : 'pdm-card-detail'}`}>
            <div className="pdm-card-header">
                <div className="pdm-card-badges">
                    <span className={`pdm-type-badge ${isMain ? 'pdm-type-main' : isFeature ? 'pdm-type-feature' : 'pdm-type-detail'}`}>
                        {isMain ? '主图' : isFeature ? '功能图' : '详情'}
                    </span>
                    {prompt.review_status === 'passed' && (
                        <span className="pdm-review-badge pdm-review-passed">✓ 已审核</span>
                    )}
                    {prompt.review_status === 'modified' && (
                        <span className="pdm-review-badge pdm-review-modified">⚠ 已修改</span>
                    )}
                    {prompt.review_status === 'failed' && (
                        <span className="pdm-review-badge pdm-review-failed">✗ 审核失败</span>
                    )}
                </div>
                <div className="pdm-card-actions">
                    <span className="pdm-prompt-id">#{prompt.id}</span>
                </div>
            </div>

            {showRefineForm && refiningPromptId === prompt.id ? (
                <div className="pdm-refine-form">
                    <h4>修改需求</h4>
                    <p className="pdm-refine-hint">
                        输入修改意见或上传参考图，AI 将重新优化提示词
                    </p>
                    <textarea
                        value={refineFeedback}
                        onChange={(e) => setRefineFeedback(e.target.value)}
                        placeholder="例如：背景换成明亮的客厅..."
                        autoFocus
                    />
                    
                    <div className="pdm-refine-images">
                        <label className="pdm-refine-upload-btn">
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleFeedbackImageUpload}
                                style={{ display: 'none' }}
                            />
                            📷 上传参考图 (可选)
                        </label>
                        {feedbackImages.length > 0 && (
                            <div className="pdm-refine-images-grid">
                                {feedbackImages.map((img, idx) => (
                                    <div key={idx} className="pdm-refine-image-item">
                                        <img src={img} alt={`ref-${idx}`} />
                                        <button 
                                            type="button" 
                                            onClick={() => removeFeedbackImage(idx)}
                                            className="pdm-refine-image-remove"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pdm-refine-actions">
                        <button className="pdm-btn-cancel" onClick={handleCancelRefine}>
                            取消
                        </button>
                        <button 
                            className="pdm-btn-confirm" 
                            onClick={handleSubmit}
                            disabled={(!refineFeedback.trim() && feedbackImages.length === 0) || isRefining}
                        >
                            {isRefining ? '优化中...' : '确认'}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="pdm-card-body">
                        <h3 className="pdm-card-title">{prompt.title}</h3>
                        
                        <div className="pdm-card-section">
                            <label>策略思路</label>
                            <p>{prompt.rationale}</p>
                        </div>

                        <div className="pdm-card-section" style={{flex: 1}}>
                            <label>提示词</label>
                            <div className="pdm-prompt-text">
                                <pre>{prompt.promptText}</pre>
                            </div>
                        </div>
                    </div>

                    {prompt.generatedImage ? (
                        <div className="pdm-generated-image-section">
                            <div className="pdm-generated-image-container">
                                <img src={prompt.generatedImage} alt="Generated" />
                                <div className="pdm-generated-image-overlay">
                                    <button 
                                        className="pdm-download-btn"
                                        onClick={() => onDownloadImage(prompt.generatedImage, prompt.id)}
                                    >
                                        ⬇️ 下载
                                    </button>
                                </div>
                            </div>
                            <div className="pdm-generated-actions">
                                <button 
                                    type="button"
                                    className="pdm-btn-modify"
                                    onClick={handleStartRefine}
                                    disabled={prompt.isGenerating}
                                >
                                    ✏️ 修改
                                </button>
                                <button 
                                    type="button"
                                    className="pdm-btn-retry"
                                    onClick={() => onGenerateImage(prompt.id)}
                                    disabled={prompt.isGenerating}
                                >
                                    {prompt.isGenerating ? (
                                        <>
                                            <span className="pdm-spinner"></span>
                                            生成中...
                                        </>
                                    ) : (
                                        <>🔄 重试</>
                                    )}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="pdm-image-gen-section">
                            {prompt.generateError && (
                                <div className="pdm-gen-error">
                                    ❌ {prompt.generateError}
                                </div>
                            )}
                            <div className="pdm-image-gen-actions">
                                <button 
                                    type="button"
                                    className="pdm-btn-edit"
                                    onClick={handleStartRefine}
                                    disabled={prompt.isGenerating}
                                >
                                    ✏️
                                </button>
                                <button 
                                    type="button"
                                    className="pdm-btn-generate"
                                    onClick={() => onGenerateImage(prompt.id)}
                                    disabled={prompt.isGenerating}
                                >
                                    {prompt.isGenerating ? (
                                        <>
                                            <span className="pdm-spinner"></span>
                                            生成中...
                                        </>
                                    ) : (
                                        <>✨ 生成图片</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="pdm-card-footer">
                        <button 
                            type="button"
                            className="pdm-btn-copy"
                            onClick={() => onCopy(prompt.promptText)}
                        >
                            📋 复制
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}

export default ProductDescriptionModule
