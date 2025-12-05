import { useState, useEffect, useRef } from 'react'

const BACKEND_URL = ''
const CONCURRENT_LIMIT = 3;

function VideoGenerator({ token, initialImage, initialPrompt, requestTimestamp, config, onConfigChange, isActive }) {
    const [videoApiUrl, setVideoApiUrl] = useState(config.video_api_url || '')
    const [videoApiKey, setVideoApiKey] = useState(config.video_api_key || '')
    const [videoModelName, setVideoModelName] = useState(config.video_model_name || 'sora-video-portrait')

    // Queue State
    // Item: { id, filename, preview_url, prompt, status: 'pending'|'processing'|'done'|'error', result_url: url, error_msg: msg, created_at }
    const [queue, setQueue] = useState([])
    const [processingCount, setProcessingCount] = useState(0)
    const [globalPrompt, setGlobalPrompt] = useState('Make this image move naturally, high quality, 4k')
    const [showConfig, setShowConfig] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [isQueueRunning, setIsQueueRunning] = useState(false)
    const [selectedVideo, setSelectedVideo] = useState(null)

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

    // Initial Fetch & Polling
    useEffect(() => {
        fetchQueue()

        // Poll more frequently if active
        // Also ensure we poll even if not 'running' to catch new additions from Auto Mode
        const pollInterval = isActive ? 2000 : 5000;

        const interval = setInterval(() => {
            // Always fetch if active (to see new items) OR if processing
            if (isActive || isQueueRunningRef.current || processingCountRef.current > 0) {
                fetchQueue()
            }
        }, pollInterval)
        return () => clearInterval(interval)
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
            }
        } catch (e) {
            console.error("Failed to fetch queue", e)
        }
    }

    // Handle Initial Image Transfer
    useEffect(() => {
        if (initialImage && requestTimestamp > 0) {
            console.log("VideoGenerator Triggered:", { requestTimestamp, prompt: initialPrompt });
            // Pass initialPrompt explicitly
            addToQueue([initialImage], initialPrompt)
        }
    }, [requestTimestamp, initialImage, initialPrompt]) // Added initialPrompt to deps

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

    const addToQueue = async (filesOrUrls, overridePrompt = null) => {
        const files = []
        for (const item of filesOrUrls) {
            if (item instanceof File) {
                files.push(item)
            } else if (typeof item === 'string') {
                // Use Backend Proxy instead of fetch
                files.push({
                    type: 'url_proxy',
                    value: item,
                    name: 'generated_image.png' // Dummy name for logic
                })
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
        if (!confirm("确定要清空所有任务吗？")) return
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

    const pendingCount = queue.filter(i => i.status === 'pending').length
    const processingNow = queue.filter(i => i.status === 'processing').length

    return (
        <div className="video-generator" style={{ maxWidth: '1200px', margin: '0 auto' }}>

            {/* Top Controls Area */}
            <div style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                marginBottom: '24px',
                display: 'grid',
                gridTemplateColumns: '1fr 300px',
                gap: '24px'
            }}>

                {/* Left: Upload Area */}
                <div
                    className="upload-zone"
                    style={{
                        minHeight: '200px',
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
                        <div style={{ fontSize: '2rem', marginBottom: '10px' }}>☁️</div>
                        <p>点击或拖拽上传图片/文本</p>
                        <small>支持 JPG, PNG, TXT (同名自动匹配)</small>
                    </div>
                    <input id="vid-img-upload" type="file" hidden onChange={handleImageUpload} accept="image/*,.txt" multiple />
                </div>

                {/* Right: Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="section-title" style={{ marginBottom: 0 }}>默认提示词</span>
                    </div>

                    <div>
                        <textarea
                            value={globalPrompt}
                            onChange={(e) => setGlobalPrompt(e.target.value)}
                            rows="3"
                            style={{ resize: 'none' }}
                            placeholder="当未匹配到同名txt文件时使用此提示词"
                        />
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary-color)' }}></span>
                            进行中: {processingNow}/{CONCURRENT_LIMIT}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#666' }}></span>
                            等待中: {pendingCount}
                        </div>
                        <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#666' }}>
                            ⚙️ 更多配置请前往系统设置
                        </div>
                    </div>
                </div>
            </div>

            {/* Queue / Result Area */}
            <div style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                minHeight: '300px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div className="section-title" style={{ marginBottom: 0 }}>任务队列 ({queue.length})</div>
                        <button
                            className={isQueueRunning ? "btn-secondary" : "btn-primary"}
                            onClick={() => setIsQueueRunning(!isQueueRunning)}
                            style={{ padding: '6px 16px', fontSize: '0.9rem' }}
                        >
                            {isQueueRunning ? '⏸️ 暂停队列' : '▶️ 开始生成'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn-secondary" onClick={clearDone} style={{ fontSize: '0.8rem' }}>清除已完成</button>
                        <button className="btn-secondary" onClick={clearAll} style={{ fontSize: '0.8rem', color: 'var(--error-color)' }}>清除全部</button>
                    </div>
                </div>

                {queue.length === 0 ? (
                    <div style={{
                        height: '200px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                        border: '1px dashed var(--card-border)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📹</div>
                            <p>暂无任务，请上传图片开始生成</p>
                        </div>
                    </div>
                ) : (
                    <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {queue.map(item => (
                            <div key={item.id} className="queue-item" style={{
                                display: 'grid',
                                gridTemplateColumns: '80px 1fr 120px 100px',
                                gap: '16px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--card-border)',
                                borderRadius: '8px',
                                padding: '12px',
                                alignItems: 'center'
                            }}>
                                {/* Thumbnail */}
                                <div
                                    style={{
                                        width: '80px',
                                        height: '80px',
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
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.7 }}
                                        title="删除"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
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
