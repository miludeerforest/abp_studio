import { useState, useEffect, useRef } from 'react'

const BACKEND_URL = ''

const CATEGORIES = [
    { value: 'daily', label: '日用百货', icon: '🧴' },
    { value: 'beauty', label: '美妆个护', icon: '💄' },
    { value: 'food', label: '食品饮料', icon: '🍔' },
    { value: 'electronics', label: '数码电子', icon: '📱' },
    { value: 'home', label: '家居家装', icon: '🏠' },
    { value: 'fashion', label: '服饰鞋包', icon: '👗' },
    { value: 'sports', label: '运动户外', icon: '⚽' },
    { value: 'other', label: '其他品类', icon: '📦' }
];

function VideoGenerator({ token, initialImage, initialPrompt, initialCategory, requestTimestamp, config, onConfigChange, isActive }) {
    // 用户权限信息
    const userRole = localStorage.getItem('role') || 'user';
    const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10);

    const [videoApiUrl, setVideoApiUrl] = useState(config.video_api_url || '')
    const [videoApiKey, setVideoApiKey] = useState(config.video_api_key || '')
    const [videoModelName, setVideoModelName] = useState(config.video_model_name || 'sora2-portrait-15s')
    // 从配置读取并发限制
    const CONCURRENT_LIMIT = config.max_concurrent_video || 3;

    // Queue State
    // Item: { id, filename, preview_url, prompt, status: 'pending'|'processing'|'done'|'error', result_url: url, error_msg: msg, created_at }
    const [queue, setQueue] = useState([])
    const [processingCount, setProcessingCount] = useState(0)
    const [globalPrompt, setGlobalPrompt] = useState('Make this image move naturally, high quality, 4k')
    const [showConfig, setShowConfig] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const isQueueRunning = true // 队列永远自动运行
    const [selectedVideo, setSelectedVideo] = useState(null)
    const [category, setCategory] = useState('daily')  // Product category for videos
    const [customProductName, setCustomProductName] = useState('')  // Custom product name for 'other' category
    const [connectionWarning, setConnectionWarning] = useState(false) // 网络连接警告

    // Merge State
    const [selectedVideoIds, setSelectedVideoIds] = useState(new Set())
    const [isMerging, setIsMerging] = useState(false)

    const toggleSelection = (id) => {
        const newSet = new Set(selectedVideoIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedVideoIds(newSet)
    }

    const handleMergeVideos = async () => {
        if (selectedVideoIds.size < 2) {
            alert("请至少选择2个视频进行合成")
            return
        }
        setIsMerging(true)
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/merge-videos`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ video_ids: Array.from(selectedVideoIds) })
            })
            if (res.ok) {
                // Success, refresh queue
                setSelectedVideoIds(new Set()) // Clear selection
                alert("视频合成成功！")
                fetchQueue()
            } else {
                const txt = await res.text()
                alert("合成失败: " + txt)
            }
        } catch (e) {
            console.error("Merge failed", e)
            alert("合成请求失败")
        } finally {
            setIsMerging(false)
        }
    }

    // Refs for latest state in async callbacks
    const queueRef = useRef(queue)
    const processingCountRef = useRef(processingCount)
    const isQueueRunningRef = useRef(isQueueRunning)

    useEffect(() => {
        queueRef.current = queue
    }, [queue])

    useEffect(() => {
        processingCountRef.current = processingCount
    }, [processingCount])

    useEffect(() => {
        isQueueRunningRef.current = isQueueRunning
    }, [isQueueRunning])

    // Sync Config
    useEffect(() => {
        if (config.video_api_url) setVideoApiUrl(config.video_api_url)
        if (config.video_api_key) setVideoApiKey(config.video_api_key)
        if (config.video_model_name) setVideoModelName(config.video_model_name)
    }, [config])

    // Initial Fetch & Polling with dynamic interval
    useEffect(() => {
        fetchQueue()

        // Dynamic polling based on processing state
        let consecutiveErrors = 0;
        let timeoutId;

        const poll = async () => {
            // Determine interval: faster when processing, slower when idle
            // 优化：减少轮询频率，避免过度消耗
            const getInterval = () => {
                if (processingCountRef.current > 0) return 3000;  // 3秒间隔（处理中）
                if (isActive) return 5000;  // 5秒间隔（活跃标签页）
                return 10000;  // 10秒间隔（后台）
            };

            // Always fetch if active OR if processing
            if (isActive || isQueueRunningRef.current || processingCountRef.current > 0) {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/queue`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        consecutiveErrors = 0;
                        setConnectionWarning(false);
                        const data = await res.json();
                        if (data) {
                            setQueue(data);
                            const processing = data.filter(i => i.status === 'processing').length;
                            setProcessingCount(processing);
                        }
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (e) {
                    console.error("Polling error", e);
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        setConnectionWarning(true);
                    }
                }
            }
            // Schedule next poll with dynamic interval
            timeoutId = setTimeout(poll, getInterval());
        };

        timeoutId = setTimeout(poll, 1500);  // Initial poll
        return () => clearTimeout(timeoutId)
    }, [isActive]) // Re-run when active state changes

    const fetchQueue = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/queue`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                const data = await res.json()
                setQueue(data)
                // Update processing count based on server state
                const processing = data.filter(i => i.status === 'processing').length
                setProcessingCount(processing)
                setConnectionWarning(false) // 连接成功，清除警告
            } else {
                // 服务器返回错误，但不立即显示警告
                console.warn("Failed to fetch queue: HTTP", res.status)
            }
        } catch (e) {
            console.error("Failed to fetch queue", e)
            // 网络错误，但由polling effect统一处理
        }
    }

    // Handle Initial Image Transfer
    useEffect(() => {
        if (initialImage && requestTimestamp > 0) {
            console.log("VideoGenerator Triggered:", { requestTimestamp, prompt: initialPrompt, category: initialCategory });
            // Sync category from ImageGenerator
            if (initialCategory) {
                setCategory(initialCategory);
            }
            // Pass initialPrompt explicitly
            addToQueue([initialImage], initialPrompt)
        }
    }, [requestTimestamp, initialImage, initialPrompt, initialCategory]) // Added initialCategory to deps

    // Handle Initial Prompt from Image Gen Tab
    useEffect(() => {
        if (initialPrompt) {
            setGlobalPrompt(initialPrompt)
        }
    }, [initialPrompt])

    // Queue Processor
    useEffect(() => {
        const processQueue = async () => {
            if (!isQueueRunningRef.current) return
            if (processingCountRef.current >= CONCURRENT_LIMIT) return

            // Find next pending item
            // Note: queue is sorted by created_at asc from backend
            const nextItem = queueRef.current.find(item => item.status === 'pending')
            if (nextItem) {
                startProcessing(nextItem.id)
            }
        }
        const timeoutId = setTimeout(processQueue, 500);
        return () => clearTimeout(timeoutId);
    }, [queue, processingCount, isQueueRunning])

    const processFiles = async (files, overridePrompt = null) => {
        const images = []
        const texts = []

        // Separate images and texts
        for (const file of files) {
            // Handle Proxy URL Objects
            if (file.type === 'url_proxy') {
                images.push(file)
                continue
            }

            if (file.type.startsWith('image/')) {
                images.push(file)
            } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
                texts.push(file)
            }
        }

        // Read all text files (same as before)
        const textContents = {}
        for (const txt of texts) {
            try {
                const content = await txt.text()
                const baseName = txt.name.substring(0, txt.name.lastIndexOf('.'))
                textContents[baseName] = content
            } catch (e) {
                console.error("Failed to read text file", txt.name, e)
            }
        }

        if (images.length === 0 && texts.length === 1) {
            const content = await texts[0].text()
            setGlobalPrompt(content)
            return
        }

        // Upload images
        for (const img of images) {
            let specificPrompt = overridePrompt

            // Only try to match text files if it's a real file, not a URL proxy (unless we fake name)
            if (img.name) {
                const baseName = img.name.substring(0, img.name.lastIndexOf('.'))
                specificPrompt = textContents[baseName] || overridePrompt
            }

            if (specificPrompt && globalPrompt) {
                specificPrompt = `${specificPrompt} ${globalPrompt}`
            } else if (!specificPrompt) {
                specificPrompt = globalPrompt
            }

            const formData = new FormData()
            if (img.type === 'url_proxy') {
                formData.append('image_url', img.value)
            } else {
                formData.append('file', img)
            }
            formData.append('prompt', specificPrompt || "Default Prompt") // Ensure prompt is not empty
            formData.append('category', category)  // Send product category
            // Send custom product name if category is 'other'
            if (category === 'other' && customProductName) {
                formData.append('custom_product_name', customProductName)
            }

            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/queue`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                })
                if (!res.ok) {
                    const txt = await res.text()
                    console.error("Upload failed", txt)
                    alert("Upload failed: " + txt)
                }
            } catch (e) {
                console.error("Failed to upload", img.name || 'url', e)
                alert("Upload failed: " + e.message)
            }
        }
        fetchQueue()
    }

    // Helper: Convert Base64 Data URI to Blob
    const dataURItoBlob = (dataURI) => {
        try {
            const byteString = atob(dataURI.split(',')[1]);
            const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            return new Blob([ab], { type: mimeString });
        } catch (e) {
            console.error("Base64 conversion failed", e);
            return null;
        }
    }

    const addToQueue = async (filesOrUrls, overridePrompt = null) => {
        const files = []
        for (const item of filesOrUrls) {
            if (item instanceof File) {
                files.push(item)
            } else if (typeof item === 'string') {
                if (item.startsWith('data:image')) {
                    // Convert Base64 to Blob (File)
                    const blob = dataURItoBlob(item)
                    if (blob) {
                        // Create a specific name to help processFiles identify it
                        const file = new File([blob], "generated_image.png", { type: blob.type })
                        files.push(file)
                    }
                } else {
                    // Handle relative URLs (e.g., /uploads/...)
                    let fullUrl = item;
                    if (item.startsWith('/') && !item.startsWith('//')) {
                        // Relative path - convert to absolute URL
                        fullUrl = `${window.location.origin}${item}`;
                    }

                    // Use Backend Proxy for external URLs
                    files.push({
                        type: 'url_proxy',
                        value: fullUrl,
                        name: 'generated_image.png' // Dummy name for logic
                    })
                }
            }
        }
        processFiles(files, overridePrompt)
    }

    const handleImageUpload = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processFiles(Array.from(e.target.files))
        }
    }

    const handleDragOver = (e) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e) => {
        e.preventDefault()
        setIsDragging(false)
        setIsDragging(false)
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(Array.from(e.dataTransfer.files))
        }
    }

    const startProcessing = async (itemId) => {
        // Optimistic update
        setProcessingCount(prev => prev + 1)
        setQueue(prev => prev.map(i => i.id === itemId ? { ...i, status: 'processing' } : i))

        try {
            const formData = new FormData()
            formData.append('api_url', videoApiUrl)
            formData.append('api_key', videoApiKey)
            formData.append('model_name', videoModelName)

            const res = await fetch(`${BACKEND_URL}/api/v1/queue/${itemId}/generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })

            const data = await res.json()
            // Backend updates DB, we just fetchQueue or update local
            if (data.status === 'success') {
                // Success
            } else {
                // Error
            }
        } catch (e) {
            console.error("Processing failed", e)
        } finally {
            fetchQueue()
            // processingCount will be updated by fetchQueue
        }
    }

    const removeItem = async (id) => {
        try {
            await fetch(`${BACKEND_URL}/api/v1/queue/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            fetchQueue()
        } catch (e) {
            console.error("Failed to delete", e)
        }
    }

    const clearDone = async () => {
        try {
            await fetch(`${BACKEND_URL}/api/v1/queue?status=done`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            fetchQueue()
        } catch (e) {
            console.error("Failed to clear done", e)
        }
    }

    const clearAll = async () => {
        if (!confirm("确定要清空所有任务吗?")) return
        try {
            await fetch(`${BACKEND_URL}/api/v1/queue`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            fetchQueue()
        } catch (e) {
            console.error("Failed to clear all", e)
        }
    }

    const retryItem = async (id) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/queue/${id}/retry`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                fetchQueue()
            } else {
                const txt = await res.text()
                alert("重试失败: " + txt)
            }
        } catch (e) {
            console.error("Failed to retry", e)
            alert("重试请求失败: " + e.message)
        }
    }

    const pendingCount = queue.filter(i => i.status === 'pending').length
    const processingNow = queue.filter(i => i.status === 'processing').length

    return (
        <div className="video-generator" style={{ maxWidth: '1200px', margin: '0 auto' }}>

            {/* Top Controls Area */}
            <div style={{
                background: 'var(--card-bg)',
                backdropFilter: 'blur(20px)',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--card-padding)',
                marginBottom: 'var(--section-gap)',
                display: 'grid',
                gridTemplateColumns: '1fr 280px',
                gap: 'var(--card-gap)'
            }}>

                {/* Left: Upload Area */}
                <div
                    className="upload-zone"
                    style={{
                        minHeight: '160px',
                        borderStyle: 'dashed',
                        borderWidth: '2px',
                        borderColor: isDragging ? 'var(--primary-color)' : 'var(--card-border)',
                        background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        transition: 'all 0.3s ease'
                    }}
                    onClick={() => document.getElementById('vid-img-upload').click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>☁️</div>
                        <p>点击或拖拽上传图片/文本</p>
                        <small>支持 JPG, PNG, TXT (同名自动匹配)</small>
                    </div>
                    <input id="vid-img-upload" type="file" hidden onChange={handleImageUpload} accept="image/*,.txt" multiple />
                </div>

                {/* Right: Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--card-gap)' }}>
                    {/* Category Selector */}
                    <div>
                        <span className="section-title" style={{ marginBottom: '6px', display: 'block', fontSize: '0.85rem' }}>产品类目</span>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                background: 'var(--card-bg)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid var(--card-border)',
                                color: 'var(--text-main)',
                                fontSize: '0.9rem'
                            }}
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                            ))}
                        </select>

                        {/* Custom Product Name Input */}
                        {category === 'other' && (
                            <input
                                type="text"
                                placeholder="请输入产品名称 (如: 运动鞋, 陶瓷花瓶...)"
                                value={customProductName}
                                onChange={(e) => setCustomProductName(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    marginTop: '6px',
                                    borderRadius: '6px',
                                    background: 'var(--input-bg, transparent)',
                                    border: '1px solid var(--primary-color)',
                                    color: 'var(--text-main)',
                                    outline: 'none',
                                    fontSize: '0.9rem'
                                }}
                            />
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="section-title" style={{ marginBottom: 0, fontSize: '0.85rem' }}>默认提示词</span>
                    </div>

<div>
                        <textarea
                            value={globalPrompt}
                            onChange={(e) => setGlobalPrompt(e.target.value)}
                            rows="2"
                            style={{ resize: 'none', fontSize: '0.9rem', padding: '8px 10px' }}
                            placeholder="当未匹配到同名txt文件时使用此提示词"
                        />
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary-color)' }}></span>
                            进行中: {processingNow}/{CONCURRENT_LIMIT}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#666' }}></span>
                            等待中: {pendingCount}
                        </div>
                        <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#666' }}>
                            ⚙️ 更多配置请前往系统设置
                        </div>
                    </div>
                </div>
            </div>

            {connectionWarning && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.15) 0%, rgba(251, 191, 36, 0.15) 100%)',
                    border: '1px solid rgba(251, 146, 60, 0.4)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    marginBottom: 'var(--section-gap)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: '#fb923c', fontWeight: '600', marginBottom: '2px', fontSize: '0.9rem' }}>
                            网络连接不稳定
                        </div>
                        <div style={{ color: '#fbbf24', fontSize: '0.8rem', lineHeight: '1.4' }}>
                            无法获取最新队列状态，但视频生成任务仍在后台执行。<br />
                            请稍候刷新页面或等待连接恢复后查看结果。
                        </div>
                    </div>
                    <button
                        onClick={() => setConnectionWarning(false)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#fb923c',
                            cursor: 'pointer',
                            fontSize: '1.2rem',
                            padding: '4px 8px',
                            opacity: 0.8,
                            transition: 'opacity 0.2s'
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '1'}
                        onMouseLeave={(e) => e.target.style.opacity = '0.8'}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Queue / Result Area */}
            <div style={{
                background: 'var(--card-bg)',
                backdropFilter: 'blur(20px)',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--card-padding)',
                minHeight: '250px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--card-gap)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-gap)' }}>
                        <div className="section-title" style={{ marginBottom: 0, fontSize: '0.95rem' }}>任务队列 ({queue.length})</div>
                        {/* Merge Button */}
                        {selectedVideoIds.size > 0 && (
                            <button
                                className="btn-primary"
                                onClick={handleMergeVideos}
                                disabled={isMerging}
                                style={{
                                    padding: '5px 12px',
                                    fontSize: '0.8rem',
                                    background: 'var(--primary-color)',
                                    opacity: isMerging ? 0.7 : 1
                                }}
                            >
                                {isMerging ? '🔄 合成中...' : `🔗 合成选中 (${selectedVideoIds.size})`}
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-secondary" onClick={clearDone} style={{ fontSize: '0.75rem', padding: '5px 10px' }}>
                            {userRole === 'admin' ? '清除已完成' : '清除我的已完成'}
                        </button>
                        <button className="btn-secondary" onClick={clearAll} style={{ fontSize: '0.75rem', padding: '5px 10px', color: 'var(--error-color)' }}>
                            {userRole === 'admin' ? '清除全部' : '清除我的任务'}
                        </button>
                    </div>
                </div>

                {/* Queue List Item Update: Add Checkbox */}
                {queue.length === 0 ? (
                    <div style={{
                        height: '180px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                        border: '1px dashed var(--card-border)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📹</div>
                            <p style={{ fontSize: '0.9rem' }}>暂无任务，请上传图片开始生成</p>
                        </div>
                    </div>
                ) : (
                    <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {queue.map(item => (
                            <div key={item.id} className="queue-item" style={{
                                display: 'grid',
                                gridTemplateColumns: '32px 64px 1fr 100px 90px',
                                gap: '10px',
                                background: selectedVideoIds.has(item.id) ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary, rgba(255,255,255,0.03))',
                                backdropFilter: 'blur(10px)',
                                border: selectedVideoIds.has(item.id) ? '1px solid var(--primary-color)' : '1px solid var(--card-border)',
                                borderRadius: '6px',
                                padding: '10px',
                                alignItems: 'center',
                                transition: 'all 0.2s'
                            }}>
                                {/* Checkbox */}
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    {item.status === 'done' && (
                                        <input
                                            type="checkbox"
                                            checked={selectedVideoIds.has(item.id)}
                                            onChange={() => toggleSelection(item.id)}
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                    )}
                                </div>

                                {/* Thumbnail */}
                                <div
                                    style={{
                                        width: '64px',
                                        height: '64px',
                                        borderRadius: '4px',
                                        overflow: 'hidden',
                                        background: '#000',
                                        cursor: item.status === 'done' ? 'pointer' : 'default',
                                        border: item.status === 'done' ? '2px solid var(--primary-color)' : 'none'
                                    }}
                                    onClick={() => item.status === 'done' && item.result_url && setSelectedVideo(item.result_url)}
                                >
                                    {item.status === 'done' && item.result_url ? (
                                        <video src={item.result_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                                    ) : (
                                        <img
                                            src={item.preview_url ? `${BACKEND_URL}${item.preview_url}` : ''}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            alt="preview"
                                        />
                                    )}
                                </div>

                                {/* Info */}
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.filename}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.prompt}>
                                        📝 {item.prompt}
                                    </div>
                                    {item.error_msg && (
                                        <div style={{ color: 'var(--error-color)', fontSize: '0.8rem', marginTop: '4px' }}>
                                            ❌ {item.error_msg}
                                        </div>
                                    )}
                                    {item.retry_count > 0 && item.status !== 'done' && (
                                        <div style={{ color: 'var(--warning-color, #f59e0b)', fontSize: '0.75rem', marginTop: '2px' }}>
                                            🔄 已重试 {item.retry_count} 次
                                        </div>
                                    )}
                                </div>

                                {/* Status */}
                                <div style={{ textAlign: 'center' }}>
                                    {item.status === 'pending' && <span style={{ color: '#ccc', fontSize: '0.9rem' }}>⏳ 等待中</span>}
                                    {item.status === 'processing' && (
                                        <div style={{ color: 'var(--primary-color)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                            <div className="status-dot" style={{ background: 'var(--primary-color)', animation: 'pulse 1s infinite' }}></div>
                                            生成中
                                        </div>
                                    )}
                                    {item.status === 'done' && <span style={{ color: '#4ade80', fontSize: '0.9rem' }}>✅ 完成</span>}
                                    {item.status === 'error' && <span style={{ color: 'var(--error-color)', fontSize: '0.9rem' }}>❌ 失败</span>}
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    {item.status === 'done' && item.result_url && (
                                        <a href={item.result_url} download className="btn-icon" title="下载" style={{ textDecoration: 'none', fontSize: '1.2rem' }}>
                                            ⬇️
                                        </a>
                                    )}
                                    {item.status === 'done' && item.result_url && (
                                        <button
                                            onClick={() => setSelectedVideo(item.result_url)}
                                            className="btn-icon"
                                            title="预览"
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                                        >
                                            ▶️
                                        </button>
                                    )}
                                    {/* 重试按钮 - 所有失败任务都可手动重试 */}
                                    {item.status === 'error' &&
                                        (userRole === 'admin' || item.user_id === currentUserId) && (
                                            <button
                                                onClick={() => retryItem(item.id)}
                                                className="btn-icon"
                                                title="手动重试"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--warning-color, #f59e0b)' }}
                                            >
                                                🔄
                                            </button>
                                        )}
                                    {/* 只有管理员或任务所有者能看到删除按钮 */}
                                    {(userRole === 'admin' || item.user_id === currentUserId) && (
                                        <button
                                            onClick={() => removeItem(item.id)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.7 }}
                                            title="删除"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* 队列底部说明 */}
                        {queue.some(item => item.status === 'error') && (
                            <div style={{
                                marginTop: '16px',
                                padding: '12px 16px',
                                background: 'rgba(245, 158, 11, 0.1)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: '8px',
                                fontSize: '0.9rem',
                                color: 'var(--text-muted, #888)'
                            }}>
                                <p style={{ margin: 0, lineHeight: 1.6 }}>
                                    🔄 <strong>失败任务自动重试中</strong>（最多 3 次，间隔 30-60 秒）
                                </p>
                                <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', opacity: 0.8 }}>
                                    💡 超时任务需手动点击 🔄 重试，其他错误将自动重试
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Video Preview Modal */}
            {
                selectedVideo && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        padding: '20px'
                    }} onClick={() => setSelectedVideo(null)}>
                        <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }} onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => setSelectedVideo(null)}
                                style={{
                                    position: 'absolute',
                                    top: '-40px',
                                    right: '-10px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'white',
                                    fontSize: '24px',
                                    cursor: 'pointer'
                                }}
                            >
                                ✕
                            </button>
                            <video
                                src={selectedVideo}
                                controls
                                autoPlay
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: '85vh',
                                    boxShadow: '0 0 20px rgba(0,0,0,0.5)',
                                    borderRadius: '8px'
                                }}
                            />
                        </div>
                    </div>
                )
            }

        </div >
    )
}

export default VideoGenerator
