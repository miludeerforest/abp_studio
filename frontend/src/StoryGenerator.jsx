import React, { useState, useEffect, useRef } from 'react';
import './StoryGenerator.css';

const StoryGenerator = ({ token, config, onSelectForVideo }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const abortControllerRef = useRef(null);

    // Step 1: Input
    const [topic, setTopic] = useState('一个产品的故事');
    const [productImg, setProductImg] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [shotCount, setShotCount] = useState(5);
    const [category, setCategory] = useState('daily'); // Product category
    const [visualStyle, setVisualStyle] = useState(''); // Visual art style

    // Product Categories
    const CATEGORIES = [
        { id: 'security', label: '安防监控', icon: '📹' },
        { id: 'daily', label: '日用百货', icon: '🧴' },
        { id: 'beauty', label: '美妆护肤', icon: '💄' },
        { id: 'electronics', label: '数码3C', icon: '🎧' },
        { id: 'other', label: '其他品类', icon: '📦' }
    ];

    // Visual Art Styles
    const VISUAL_STYLES = [
        { id: '', label: '不指定风格', prompt: '' },
        { id: 'cyberpunk', label: '赛博朋克/霓虹', prompt: 'Cyberpunk neon style, vibrant neon lights, futuristic urban aesthetic, high contrast colors, glowing effects.' },
        { id: 'cinematic', label: '电影写实', prompt: 'Cinematic realistic style, professional film lighting, shallow depth of field, dramatic shadows.' },
        { id: 'watercolor', label: '水彩画', prompt: 'Watercolor painting style, soft edges, flowing colors, artistic brush strokes.' },
        { id: 'anime', label: '动漫风', prompt: 'Anime style, clean lines, vibrant colors, Japanese animation aesthetic.' },
        { id: 'bw_film', label: '黑白胶片', prompt: 'Black and white film photography style, classic noir aesthetic, high contrast, film grain.' },
        { id: 'ghibli', label: '吉卜力风', prompt: 'Studio Ghibli style, whimsical and dreamy, soft pastel colors, hand-painted look.' },
        { id: 'oil_painting', label: '油画风', prompt: 'Oil painting style, rich textures, visible brush strokes, classical art aesthetic.' },
        { id: 'pixar3d', label: '皮克斯3D', prompt: 'Pixar 3D animation style, smooth rendering, vibrant colors, friendly aesthetic.' },
        { id: 'chinese_ink', label: '水墨国风', prompt: 'Chinese ink wash painting style, traditional brushwork, minimalist elegance.' },
        { id: 'scifi_future', label: '科幻未来', prompt: 'Sci-fi futuristic style, sleek metallic surfaces, holographic elements.' },
        { id: 'fantasy_magic', label: '奇幻魔法', prompt: 'Fantasy magical style, ethereal glow, mystical atmosphere, enchanted elements.' },
        { id: 'vintage_retro', label: '复古怀旧', prompt: 'Vintage retro style, nostalgic color grading, faded tones, 70s/80s vibe.' },
        { id: 'minimalist', label: '极简主义', prompt: 'Minimalist style, clean composition, negative space, simple forms.' },
        { id: 'steampunk', label: '蒸汽朋克', prompt: 'Steampunk style, Victorian industrial aesthetic, brass and copper tones.' }
    ];

    // Step 2: Storyboard
    const [shots, setShots] = useState([]);

    // Step 3: Chain Status
    const [chainId, setChainId] = useState(null);
    const [chainStatus, setChainStatus] = useState(null);
    const [polling, setPolling] = useState(false);

    const BACKEND_URL = ''; // Relative path via proxy

    // Reset polling when stepping back
    useEffect(() => {
        if (step !== 3) {
            setPolling(false);
            setChainId(null);
            setChainStatus(null);
        }
    }, [step]);

    // Polling Effect
    useEffect(() => {
        let intervalId;
        if (polling && chainId) {
            intervalId = setInterval(async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/story-chain/${chainId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setChainStatus(data);
                        if (data.status === 'completed' || data.status === 'failed') {
                            setPolling(false);
                        }
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }, 2000);
        }
        return () => clearInterval(intervalId);
    }, [polling, chainId, token]);


    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProductImg(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleAnalyze = async () => {
        if (!productImg) return;
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('image', productImg);
        formData.append('topic', topic);
        formData.append('shot_count', shotCount);
        formData.append('category', category); // Pass product category
        if (config.api_url) formData.append('api_url', config.api_url);
        if (config.api_key) formData.append('gemini_api_key', config.api_key);
        if (config.model_name) formData.append('model_name', config.analysis_model_name || config.model_name);

        // Abort Controller Init
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/story-analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
                signal: abortControllerRef.current.signal
            });
            const data = await res.json();
            if (res.ok) {
                // Integrate visual style into each shot's prompt if selected
                let processedShots = data.shots;
                if (visualStyle) {
                    const stylePrompt = VISUAL_STYLES.find(s => s.id === visualStyle)?.prompt || '';
                    if (stylePrompt) {
                        processedShots = data.shots.map(shot => ({
                            ...shot,
                            prompt: `[Visual Style: ${stylePrompt}] ${shot.prompt}`
                        }));
                    }
                }
                setShots(processedShots);

                // AUTO MODE: Skip step 2 and directly start chain generation
                // Pass processed shots directly to avoid state timing issues
                await startChainGeneration(processedShots);
            } else {
                setError(data.detail || 'Analysis failed');
                setLoading(false);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log("Story Analysis Aborted");
            } else {
                setError(e.message);
            }
            setLoading(false);
        }
        // Note: loading state is managed by startChainGeneration
    };

    const stopAnalysis = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
        }
    }

    // Auto-triggered chain generation (skips step 2)
    const startChainGeneration = async (processedShots) => {
        setError(null);
        // Loading is already true from handleAnalyze

        // Convert productImg to Base64 for the chain request
        const reader = new FileReader();
        reader.readAsDataURL(productImg);

        reader.onload = async () => {
            const base64Image = reader.result;

            const payload = {
                initial_image_url: base64Image,
                shots: processedShots,
                api_url: config.video_api_url,
                api_key: config.video_api_key,
                model_name: config.video_model_name,
                visual_style: visualStyle,
                visual_style_prompt: VISUAL_STYLES.find(s => s.id === visualStyle)?.prompt || ''
            };

            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/story-chain`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (res.ok) {
                    setChainId(data.chain_id);
                    setStep(3);  // Skip step 2, go directly to step 3
                    setPolling(true);
                } else {
                    setError(data.detail || 'Failed to start story generation');
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        reader.onerror = () => {
            setLoading(false);
            setError("Failed to read image file");
        };
    };

    const handleStartChain = async () => {
        setLoading(true);
        setError(null);

        // Convert productImg to Base64 for the chain request
        const reader = new FileReader();
        reader.readAsDataURL(productImg);
        reader.onload = async () => {
            const base64Image = reader.result;

            const payload = {
                initial_image_url: base64Image,
                shots: shots,
                api_url: config.video_api_url, // Use Video API config specifically
                api_key: config.video_api_key,
                model_name: config.video_model_name
            };

            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/story-chain`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (res.ok) {
                    setChainId(data.chain_id);
                    setStep(3);
                    setPolling(true);
                } else {
                    setError(data.detail || 'Failed to start story generation');
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        reader.onerror = () => {
            setLoading(false);
            setError("Failed to read image file");
        };
    };

    const handleShotChange = (index, field, value) => {
        const newShots = [...shots];
        newShots[index] = { ...newShots[index], [field]: value };
        setShots(newShots);
    };

    return (
        <div className="story-generator-root">
            {/* Progress Header */}
            <div className="steps-header">
                {[1, 2, 3].map(s => (
                    <div key={s} className={`step-item ${step >= s ? 'active' : ''}`}>
                        <div className="step-number">{s}</div>
                        <div className="step-label">
                            {s === 1 ? '上传与设定' : s === 2 ? '剧本确认' : '生成中'}
                        </div>
                    </div>
                ))}
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="workspace">
                {/* Step 1: Input */}
                {step === 1 && (
                    <div className="input-section">
                        <div className="upload-area">
                            <div className="upload-box" onClick={() => document.getElementById('story-upload').click()}>
                                {previewUrl ? (
                                    <img src={previewUrl} alt="Product" className="preview-img" />
                                ) : (
                                    <div className="upload-placeholder">
                                        <span className="icon">📁</span>
                                        <p>点击上传初始图片</p>
                                    </div>
                                )}
                                <input
                                    id="story-upload"
                                    type="file"
                                    hidden
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                />
                            </div>
                        </div>
                        <div className="config-panel">
                            <h3>故事设定</h3>

                            {/* Product Category */}
                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>产品类别</label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setCategory(cat.id)}
                                            style={{
                                                padding: '8px 12px',
                                                borderRadius: '6px',
                                                border: category === cat.id ? '2px solid #6d28d9' : '1px solid #444',
                                                background: category === cat.id ? 'rgba(109, 40, 217, 0.2)' : 'transparent',
                                                color: category === cat.id ? '#a78bfa' : '#888',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            {cat.icon} {cat.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Visual Style */}
                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>视觉风格</label>
                                <select
                                    value={visualStyle}
                                    onChange={(e) => setVisualStyle(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        background: '#1a1a2e',
                                        border: '1px solid #444',
                                        borderRadius: '6px',
                                        color: '#fff',
                                        fontSize: '0.95rem'
                                    }}
                                >
                                    {VISUAL_STYLES.map(style => (
                                        <option key={style.id} value={style.id}>{style.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                                    镜头数量: {shotCount}
                                </label>
                                <input
                                    type="range"
                                    min="3"
                                    max="10"
                                    value={shotCount}
                                    onChange={(e) => setShotCount(parseInt(e.target.value))}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <textarea
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="输入故事主题..."
                                rows={4}
                                className="script-input"
                            />
                            <button
                                className="primary-btn"
                                disabled={!productImg || loading}
                                onClick={handleAnalyze}
                            >
                                {loading ? '正在分析...' : '生成分镜脚本'}
                            </button>
                            {loading && (
                                <button className="secondary-btn" onClick={stopAnalysis} style={{ marginTop: '10px', width: '100%', borderColor: 'var(--error-color)', color: 'var(--error-color)' }}>
                                    ⏹ 停止分析
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Storyboard Edit */}
                {step === 2 && (
                    <div className="storyboard-editor">
                        <h3>确认分镜脚本 (共 {shots.length} 个镜头)</h3>
                        <p style={{ color: '#888', marginBottom: '10px' }}>
                            无需生成关键帧。系统将自动串行生成视频，保证画面连贯。
                        </p>
                        <div className="shots-grid">
                            {shots.map((shot, idx) => (
                                <div key={idx} className="shot-card">
                                    <div className="shot-header">Shot {shot.shot} ({shot.duration}s)</div>
                                    <div className="shot-body">
                                        <label>剧情:</label>
                                        <textarea
                                            value={shot.description}
                                            onChange={(e) => handleShotChange(idx, 'description', e.target.value)}
                                            rows={2}
                                        />
                                        <label>Cue (English):</label>
                                        <textarea
                                            value={shot.prompt}
                                            onChange={(e) => handleShotChange(idx, 'prompt', e.target.value)}
                                            rows={3}
                                            className="code-font"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="actions-bar">
                            <button className="secondary-btn" onClick={() => setStep(1)}>上一步</button>
                            <button className="primary-btn" onClick={handleStartChain} disabled={loading}>
                                {loading ? '启动中...' : '开始生成故事 (串行)'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Chain Progress */}
                {step === 3 && (
                    <div className="results-view">
                        <div className="status-display" style={{ textAlign: 'center', padding: '40px' }}>
                            {(!chainStatus || chainStatus.status === 'processing' || chainStatus.status === 'merging') && (
                                <div className="processing-state">
                                    <div className="spinner"></div>
                                    <h2>正在生成故事...</h2>
                                    {chainStatus && (
                                        <div style={{ marginTop: '20px' }}>
                                            <p style={{ fontSize: '1.2em' }}>
                                                {chainStatus.status === 'merging'
                                                    ? '所有镜头完成，正在合并视频...'
                                                    : `正在生成镜头 ${chainStatus.current_shot} / ${chainStatus.total_shots}`}
                                            </p>
                                            <div className="progress-bar-container" style={{ width: '300px', height: '10px', background: '#333', margin: '20px auto', borderRadius: '5px' }}>
                                                <div
                                                    className="progress-bar-fill"
                                                    style={{
                                                        width: `${(chainStatus.current_shot / chainStatus.total_shots) * 100}%`,
                                                        height: '100%',
                                                        background: '#6d28d9',
                                                        borderRadius: '5px',
                                                        transition: 'width 0.5s ease'
                                                    }}
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {chainStatus && chainStatus.status === 'completed' && (
                                <div className="completed-state">
                                    <h2>✨ 故事生成完成!</h2>
                                    <div className="video-result" style={{ margin: '30px auto', maxWidth: '600px' }}>
                                        <video
                                            src={chainStatus.merged_video_url}
                                            controls
                                            autoPlay
                                            style={{ width: '100%', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                                        />
                                    </div>
                                    <div className="actions-bar">
                                        <a
                                            href={chainStatus.merged_video_url}
                                            download={`story_chain_${chainId}.mp4`}
                                            className="primary-btn"
                                            style={{ textDecoration: 'none', display: 'inline-block', lineHeight: '36px' }}
                                        >
                                            ⬇️ 下载完整视频
                                        </a>
                                        <button className="secondary-btn" onClick={() => setStep(1)}>再做一个</button>
                                    </div>
                                </div>
                            )}

                            {chainStatus && chainStatus.status === 'failed' && (
                                <div className="failed-state">
                                    <h2 style={{ color: '#ef4444' }}>生成失败</h2>
                                    <p>{chainStatus.error}</p>
                                    <button className="secondary-btn" onClick={() => setStep(1)} style={{ marginTop: '20px' }}>返回重试</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StoryGenerator;
