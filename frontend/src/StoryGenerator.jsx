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
                setShots(data.shots);
                setStep(2);
            } else {
                setError(data.detail || 'Analysis failed');
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log("Story Analysis Aborted");
            } else {
                setError(e.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const stopAnalysis = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
        }
    }

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
