import { useState, useEffect, useRef } from 'react'
import './VideoGenerator.css'

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
            // Success if HTTP OK (backend returns {status: "processing"} on successful queue)
            if (res.ok) {
                // Success - task queued
            } else {
                // Error - HTTP error
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
        <div className="video-generator">

            {/* Top Controls Area */}
            <div className="video-top-controls">

                {/* Left: Upload Area */}
                <div
                    className={`upload-zone video-upload-zone ${isDragging ? 'dragging' : ''}`}
                    onClick={() => document.getElementById('vid-img-upload').click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="video-upload-content">
                        <div className="video-upload-icon">☁️</div>
                        <p>点击或拖拽上传图片/文本</p>
                        <small>支持 JPG, PNG, TXT (同名自动匹配)</small>
                    </div>
                    <input id="vid-img-upload" type="file" hidden onChange={handleImageUpload} accept="image/*,.txt" multiple />
                </div>

                {/* Right: Controls */}
                <div className="video-right-controls">
                    {/* Category Selector */}
                    <div>
                        <span className="section-title video-category-label">产品类目</span>
                        <select
                            className="video-category-select"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                            ))}
                        </select>

                        {/* Custom Product Name Input */}
                        {category === 'other' && (
                            <input
                                className="video-custom-product-input"
                                type="text"
                                placeholder="请输入产品名称 (如: 运动鞋, 陶瓷花瓶...)"
                                value={customProductName}
                                onChange={(e) => setCustomProductName(e.target.value)}
                            />
                        )}
                    </div>

                    <div className="video-prompt-label-row">
                        <span className="section-title video-prompt-label">默认提示词</span>
                    </div>

<div>
                        <textarea
                            className="video-prompt-textarea"
                            value={globalPrompt}
                            onChange={(e) => setGlobalPrompt(e.target.value)}
                            rows="2"
                            placeholder="当未匹配到同名txt文件时使用此提示词"
                        />
                    </div>

                    <div className="video-queue-status">
                        <div className="video-status-item">
                            <span className="video-status-dot active"></span>
                            进行中: {processingNow}/{CONCURRENT_LIMIT}
                        </div>
                        <div className="video-status-item">
                            <span className="video-status-dot idle"></span>
                            等待中: {pendingCount}
                        </div>
                        <div className="video-config-hint">
                            ⚙️ 更多配置请前往系统设置
                        </div>
                    </div>
                </div>
            </div>

            {connectionWarning && (
                <div className="video-connection-warning">
                    <span className="video-warning-icon">⚠️</span>
                    <div className="video-warning-content">
                        <div className="video-warning-title">
                            网络连接不稳定
                        </div>
                        <div className="video-warning-message">
                            无法获取最新队列状态,但视频生成任务仍在后台执行。<br />
                            请稍候刷新页面或等待连接恢复后查看结果。
                        </div>
                    </div>
                    <button
                        className="video-warning-close"
                        onClick={() => setConnectionWarning(false)}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Queue / Result Area */}
            <div className="video-queue-area">
                <div className="video-queue-header">
                    <div className="video-queue-header-left">
                        <div className="section-title video-queue-title">任务队列 ({queue.length})</div>
                        {/* Merge Button */}
                        {selectedVideoIds.size > 0 && (
                            <button
                                className={`btn-primary video-merge-btn ${isMerging ? 'merging' : ''}`}
                                onClick={handleMergeVideos}
                                disabled={isMerging}
                            >
                                {isMerging ? '🔄 合成中...' : `🔗 合成选中 (${selectedVideoIds.size})`}
                            </button>
                        )}
                    </div>
                    <div className="video-queue-actions">
                        <button className="btn-secondary video-clear-btn" onClick={clearDone}>
                            {userRole === 'admin' ? '清除已完成' : '清除我的已完成'}
                        </button>
                        <button className="btn-secondary video-clear-all-btn" onClick={clearAll}>
                            {userRole === 'admin' ? '清除全部' : '清除我的任务'}
                        </button>
                    </div>
                </div>

                {/* Queue List Item Update: Add Checkbox */}
                {queue.length === 0 ? (
                    <div className="video-queue-empty">
                        <div className="video-queue-empty-content">
                            <div className="video-queue-empty-icon">📹</div>
                            <p className="video-queue-empty-text">暂无任务，请上传图片开始生成</p>
                        </div>
                    </div>
                ) : (
                    <div className="video-queue-list">
                        {queue.map(item => (
                            <div key={item.id} className={`video-queue-item ${selectedVideoIds.has(item.id) ? 'selected' : ''}`}>
                                {/* Checkbox */}
                                <div className="video-item-checkbox-wrapper">
                                    {item.status === 'done' && (
                                        <input
                                            className="video-item-checkbox"
                                            type="checkbox"
                                            checked={selectedVideoIds.has(item.id)}
                                            onChange={() => toggleSelection(item.id)}
                                        />
                                    )}
                                </div>

                                {/* Thumbnail */}
                                <div
                                    className={`video-item-thumbnail ${item.status === 'done' ? 'done' : ''}`}
                                    onClick={() => item.status === 'done' && item.result_url && setSelectedVideo(item.result_url)}
                                >
                                    {item.status === 'done' && item.result_url ? (
                                        <video src={item.result_url} muted />
                                    ) : (
                                        <img
                                            src={item.preview_url ? `${BACKEND_URL}${item.preview_url}` : ''}
                                            alt="preview"
                                        />
                                    )}
                                </div>

                                {/* Info */}
                                <div className="video-item-info">
                                    <div className="video-item-filename">
                                        {item.filename}
                                    </div>
                                    <div className="video-item-prompt" title={item.prompt}>
                                        📝 {item.prompt}
                                    </div>
                                    {item.error_msg && (
                                        <div className="video-item-error">
                                            ❌ {item.error_msg}
                                        </div>
                                    )}
                                    {item.retry_count > 0 && item.status !== 'done' && (
                                        <div className="video-item-retry-count">
                                            🔄 已重试 {item.retry_count} 次
                                        </div>
                                    )}
                                </div>

                                {/* Status */}
                                <div className="video-item-status">
                                    {item.status === 'pending' && <span className="video-item-status-pending">⏳ 等待中</span>}
                                    {item.status === 'processing' && (
                                        <div className="video-item-status-processing">
                                            <div className="status-dot video-item-status-dot"></div>
                                            生成中
                                        </div>
                                    )}
                                    {item.status === 'done' && <span className="video-item-status-done">✅ 完成</span>}
                                    {item.status === 'error' && <span className="video-item-status-error">❌ 失败</span>}
                                </div>

                                {/* Actions */}
                                <div className="video-item-actions">
                                    {item.status === 'done' && item.result_url && (
                                        <a href={item.result_url} download className="btn-icon video-download-btn" title="下载">
                                            ⬇️
                                        </a>
                                    )}
                                    {item.status === 'done' && item.result_url && (
                                        <button
                                            className="btn-icon video-preview-btn"
                                            onClick={() => setSelectedVideo(item.result_url)}
                                            title="预览"
                                        >
                                            ▶️
                                        </button>
                                    )}
                                    {/* 重试按钮 - 所有失败任务都可手动重试 */}
                                    {item.status === 'error' &&
                                        (userRole === 'admin' || item.user_id === currentUserId) && (
                                            <button
                                                className="btn-icon video-retry-btn"
                                                onClick={() => retryItem(item.id)}
                                                title="手动重试"
                                            >
                                                🔄
                                            </button>
                                        )}
                                    {/* 只有管理员或任务所有者能看到删除按钮 */}
                                    {(userRole === 'admin' || item.user_id === currentUserId) && (
                                        <button
                                            className="video-delete-btn"
                                            onClick={() => removeItem(item.id)}
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
                            <div className="video-queue-notice">
                                <p>
                                    🔄 <strong>失败任务自动重试中</strong>（最多 3 次，间隔 30-60 秒）
                                </p>
                                <p>
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
                    <div className="video-lightbox-overlay" onClick={() => setSelectedVideo(null)}>
                        <div className="video-lightbox-content" onClick={e => e.stopPropagation()}>
                            <button
                                className="video-lightbox-close"
                                onClick={() => setSelectedVideo(null)}
                            >
                                ✕
                            </button>
                            <video
                                className="video-lightbox-player"
                                src={selectedVideo}
                                controls
                                autoPlay
                            />
                        </div>
                    </div>
                )
            }

        </div >
    )
}

export default VideoGenerator
