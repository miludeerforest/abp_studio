import { useState, useRef } from 'react'
import './SimpleBatchGenerator.css'

const BACKEND_URL = ''

const CATEGORIES = [
    { id: 'security', label: '安防监控', icon: '📹' },
    { id: 'daily', label: '日用百货', icon: '🧴' },
    { id: 'beauty', label: '美妆护肤', icon: '💄' },
    { id: 'digital', label: '数码3C', icon: '🎧' },
    { id: 'other', label: '其他品类', icon: '📦' }
]

const SCENE_STYLES = [
    { id: '', label: '🎬 不指定风格', prompt: '' },
    { id: 'cyberpunk', label: '🌃 赛博朋克/霓虹', prompt: 'Cyberpunk neon style, vibrant neon lights, futuristic urban aesthetic.' },
    { id: 'cinematic', label: '🎥 电影写实', prompt: 'Cinematic realistic style, professional film lighting, dramatic shadows.' },
    { id: 'watercolor', label: '🎨 水彩画', prompt: 'Watercolor painting style, soft edges, flowing colors, artistic.' },
    { id: 'anime', label: '🌸 动漫风', prompt: 'Anime style, clean lines, vibrant colors, Japanese animation aesthetic.' },
    { id: 'minimalist', label: '⬜ 极简主义', prompt: 'Minimalist style, clean composition, negative space, modern design.' },
    { id: 'fantasy_magic', label: '🔮 奇幻魔法', prompt: 'Fantasy magical style, ethereal glow, mystical atmosphere.' },
    { id: 'vintage_retro', label: '📻 复古怀旧', prompt: 'Vintage retro style, nostalgic color grading, 70s/80s vibe.' }
]

const ASPECT_RATIOS = [
    { id: '1:1', label: '1:1', icon: '🖼️' },
    { id: '4:3', label: '4:3', icon: '📺' },
    { id: '16:9', label: '16:9', icon: '🎬' },
    { id: '9:16', label: '9:16', icon: '📱' }
]

function SimpleBatchGenerator({ token, config, onTabChange }) {
    const [step, setStep] = useState('upload')
    const [uploadedImages, setUploadedImages] = useState([])
    const [prompt, setPrompt] = useState('')
    const [videoPrompt, setVideoPrompt] = useState('')
    const [category, setCategory] = useState('other')
    const [aspectRatio, setAspectRatio] = useState('1:1')
    const [sceneStyle, setSceneStyle] = useState('')
    const [genCountPerImage, setGenCountPerImage] = useState(3)
    const [generatedImages, setGeneratedImages] = useState([])
    const [selectedForVideo, setSelectedForVideo] = useState(new Set())
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' })
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const abortControllerRef = useRef(null)

    const handleImageUpload = (e, index) => {
        const file = e.target.files[0]
        if (file) {
            const newImages = [...uploadedImages]
            newImages[index] = file
            setUploadedImages(newImages.filter(Boolean))
        }
    }

    const removeImage = (index) => {
        const newImages = uploadedImages.filter((_, i) => i !== index)
        setUploadedImages(newImages)
    }

    const handleGenerate = async () => {
        if (uploadedImages.length === 0) {
            setError("请至少上传1张产品图")
            return
        }
        if (!prompt.trim()) {
            setError("请输入场景描述")
            return
        }

        setLoading(true)
        setError(null)
        setStep('generating')
        setProgress({ current: 0, total: genCountPerImage, status: '准备中...' })

        if (abortControllerRef.current) abortControllerRef.current.abort()
        abortControllerRef.current = new AbortController()

        try {
            const formData = new FormData()
            uploadedImages.forEach(img => formData.append('product_imgs', img))
            formData.append('prompt', prompt)
            formData.append('category', category)
            formData.append('aspect_ratio', aspectRatio)
            const stylePrompt = SCENE_STYLES.find(s => s.id === sceneStyle)?.prompt || ''
            formData.append('scene_style_prompt', stylePrompt)
            formData.append('gen_count', genCountPerImage)

            setProgress({ current: 0, total: genCountPerImage, status: '正在生成图片...' })

            const response = await fetch(`${BACKEND_URL}/api/v1/simple-batch-generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
                signal: abortControllerRef.current.signal
            })

            if (!response.ok) {
                const text = await response.text()
                const isHtml = text.trim().toLowerCase().startsWith('<!doctype') || text.includes('<html')
                if (isHtml) {
                    throw new Error('服务器暂时不可用，请稍后重试')
                }
                throw new Error(`生成失败: ${text.slice(0, 100)}`)
            }

            const data = await response.json()
            
            const successResults = (data.results || []).filter(r => !r.error && (r.saved_url || r.image_url || r.image_base64))
            const errorResults = (data.results || []).filter(r => r.error)
            
            if (successResults.length === 0 && errorResults.length > 0) {
                const firstError = errorResults[0].error
                const friendlyError = firstError.includes('<!doctype') || firstError.includes('<html') 
                    ? '服务器暂时不可用，请稍后重试'
                    : firstError
                throw new Error(friendlyError)
            }
            
            setGeneratedImages(successResults)
            setStep('results')
        } catch (err) {
            if (err.name === 'AbortError') {
                setError("已取消生成")
            } else {
                setError(err.message)
            }
            setStep('upload')
        } finally {
            setLoading(false)
        }
    }

    const toggleImageSelection = (index) => {
        const newSelected = new Set(selectedForVideo)
        if (newSelected.has(index)) {
            newSelected.delete(index)
        } else {
            newSelected.add(index)
        }
        setSelectedForVideo(newSelected)
    }

    const selectAll = () => {
        const all = new Set(generatedImages.map((_, i) => i))
        setSelectedForVideo(all)
    }

    const selectNone = () => {
        setSelectedForVideo(new Set())
    }

    const handleBatchVideo = async () => {
        if (selectedForVideo.size === 0) {
            setError("请至少选择1张图片生成视频")
            return
        }
        if (!videoPrompt.trim()) {
            setError("请输入视频提示词")
            return
        }

        setLoading(true)
        setError(null)

        try {
            const selectedImages = Array.from(selectedForVideo).map(i => generatedImages[i])
            
            for (const img of selectedImages) {
                const imageUrl = img.saved_url || img.image_url
                if (!imageUrl) continue

                const formData = new FormData()
                
                const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${window.location.origin}${imageUrl}`
                const imgResponse = await fetch(fullUrl)
                const blob = await imgResponse.blob()
                formData.append('file', blob, 'image.png')
                formData.append('prompt', videoPrompt)
                formData.append('category', category)

                await fetch(`${BACKEND_URL}/api/v1/queue`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                })
            }

            if (onTabChange) {
                onTabChange('video')
            }
        } catch (err) {
            setError(`添加到视频队列失败: ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    const resetAll = () => {
        setStep('upload')
        setUploadedImages([])
        setPrompt('')
        setVideoPrompt('')
        setGeneratedImages([])
        setSelectedForVideo(new Set())
        setError(null)
    }

    return (
        <div className="simple-batch-generator">
            <div className="page-header">
                <h2>📦 单图批量生成</h2>
                <p>上传1张产品图，AI生成多张不同场景的效果图</p>
            </div>

            {error && (
                <div className="error-banner">
                    ❌ {error}
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {step === 'upload' && (
                <div className="upload-section">
                    <div className="section-title">📸 上传产品图</div>
                    <div className="upload-grid" style={{justifyContent: 'center'}}>
                        <div className="upload-slot" style={{width: '200px', height: '200px'}}>
                            {uploadedImages[0] ? (
                                <div className="image-preview">
                                    <img src={URL.createObjectURL(uploadedImages[0])} alt="产品图" />
                                    <button className="remove-btn" onClick={() => removeImage(0)}>✕</button>
                                </div>
                            ) : (
                                <label className="upload-zone">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e, 0)}
                                            style={{ display: 'none' }}
                                        />
                                        <div className="upload-placeholder">
                                            <span className="upload-icon">+</span>
                                            <span>点击上传</span>
                                        </div>
                                    </label>
                                )}
                            </div>
                    </div>

                    <div className="section-title">✨ 场景描述</div>
                    <textarea
                        className="prompt-input"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="描述你想要的场景，例如：现代简约的客厅环境，柔和的自然光，产品放置在白色大理石桌面上..."
                        rows={4}
                    />

                    <div className="config-section">
                        <div className="config-group">
                            <label>产品类目</label>
                            <div className="category-grid">
                                {CATEGORIES.map(cat => (
                                    <button
                                        key={cat.id}
                                        className={`category-btn ${category === cat.id ? 'active' : ''}`}
                                        onClick={() => setCategory(cat.id)}
                                    >
                                        {cat.icon} {cat.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="config-row">
                            <div className="config-group">
                                <label>图片比例</label>
                                <div className="ratio-grid">
                                    {ASPECT_RATIOS.map(ar => (
                                        <button
                                            key={ar.id}
                                            className={`ratio-btn ${aspectRatio === ar.id ? 'active' : ''}`}
                                            onClick={() => setAspectRatio(ar.id)}
                                        >
                                            {ar.icon} {ar.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="config-group">
                                <label>视觉风格</label>
                                <select
                                    value={sceneStyle}
                                    onChange={(e) => setSceneStyle(e.target.value)}
                                    className="style-select"
                                >
                                    {SCENE_STYLES.map(style => (
                                        <option key={style.id} value={style.id}>{style.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="config-group">
                                <label>生成数量: {genCountPerImage}</label>
                                <input
                                    type="range"
                                    min="1"
                                    max="9"
                                    value={genCountPerImage}
                                    onChange={(e) => setGenCountPerImage(parseInt(e.target.value))}
                                    className="count-slider"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="section-title">🎬 视频提示词 (可选)</div>
                    <textarea
                        className="prompt-input"
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        placeholder="描述视频动作效果，例如：缓慢推进镜头，产品轻微旋转展示细节..."
                        rows={2}
                    />

                    <div className="action-bar">
                        <button
                            className="generate-btn"
                            onClick={handleGenerate}
                            disabled={uploadedImages.length === 0 || !prompt.trim() || loading}
                        >
                            🚀 开始生成 (生成 {genCountPerImage} 张场景图)
                        </button>
                    </div>
                </div>
            )}

            {step === 'generating' && (
                <div className="generating-section">
                    <div className="loading-spinner"></div>
                    <div className="progress-text">{progress.status}</div>
                    <div className="progress-detail">
                        正在生成 {genCountPerImage} 张场景图...
                    </div>
                    <button className="cancel-btn" onClick={() => {
                        if (abortControllerRef.current) abortControllerRef.current.abort()
                    }}>
                        取消生成
                    </button>
                </div>
            )}

            {step === 'results' && (
                <div className="results-section">
                    <div className="results-header">
                        <h3>📸 生成结果 (共 {generatedImages.length} 张)</h3>
                        <div className="selection-controls">
                            <button onClick={selectAll}>✓ 全选</button>
                            <button onClick={selectNone}>✕ 取消全选</button>
                            <span className="selected-count">已选: {selectedForVideo.size}</span>
                        </div>
                    </div>

                    <div className="results-grid">
                        {generatedImages.map((img, idx) => (
                            <div
                                key={idx}
                                className={`result-card ${selectedForVideo.has(idx) ? 'selected' : ''}`}
                                onClick={() => toggleImageSelection(idx)}
                            >
                                {img.error ? (
                                    <div className="error-card">❌ {img.error}</div>
                                ) : (
                                    <>
                                        <img
                                            src={img.saved_url || img.image_url || `data:image/png;base64,${img.image_base64}`}
                                            alt={`Result ${idx + 1}`}
                                        />
                                        <div className="card-overlay">
                                            <span className="check-icon">{selectedForVideo.has(idx) ? '✓' : ''}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="video-section">
                        <div className="section-title">🎬 视频提示词</div>
                        <textarea
                            className="prompt-input"
                            value={videoPrompt}
                            onChange={(e) => setVideoPrompt(e.target.value)}
                            placeholder="描述视频动作效果..."
                            rows={2}
                        />
                    </div>

                    <div className="action-bar">
                        <button className="secondary-btn" onClick={resetAll}>
                            ↩️ 重新开始
                        </button>
                        <button
                            className="generate-btn"
                            onClick={handleBatchVideo}
                            disabled={selectedForVideo.size === 0 || !videoPrompt.trim() || loading}
                        >
                            🎬 批量生成视频 ({selectedForVideo.size} 个)
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SimpleBatchGenerator
