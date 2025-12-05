import React, { useState, useRef } from 'react';
import './StoryGenerator.css';

const StoryGenerator = ({ token, config, onSelectForVideo }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Step 1: Input
    const [topic, setTopic] = useState('一个产品的故事');
    const [productImg, setProductImg] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);

    // Step 2: Storyboard
    const [shots, setShots] = useState([]);

    // Step 3: Results
    const [results, setResults] = useState([]);

    const BACKEND_URL = ''; // Relative path via proxy

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
        if (config.api_url) formData.append('api_url', config.api_url);
        if (config.api_key) formData.append('gemini_api_key', config.api_key);
        if (config.model_name) formData.append('model_name', config.analysis_model_name || config.model_name);

        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/story-analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                setShots(data.shots);
                setStep(2);
            } else {
                setError(data.detail || 'Analysis failed');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateImages = async () => {
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('image', productImg);
        formData.append('shots_json', JSON.stringify(shots));
        if (config.api_url) formData.append('api_url', config.api_url);
        if (config.api_key) formData.append('gemini_api_key', config.api_key);
        if (config.model_name) formData.append('model_name', config.model_name);

        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/story-generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                setResults(data.results);
                setStep(3);
            } else {
                setError(data.detail || 'Generation failed');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
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
                            {s === 1 ? '上传与主题' : s === 2 ? '分镜确认' : '生成结果'}
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
                                        <p>点击上传产品图片</p>
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
                            <h3>故事主题</h3>
                            <textarea
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="输入故事主题，例如：女子在咖啡店的偶遇..."
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
                        </div>
                    </div>
                )}

                {/* Step 2: Storyboard Edit */}
                {step === 2 && (
                    <div className="storyboard-editor">
                        <h3>确认分镜脚本 (可编辑)</h3>
                        <div className="shots-grid">
                            {shots.map((shot, idx) => (
                                <div key={idx} className="shot-card">
                                    <div className="shot-header">Shot {shot.shot} ({shot.duration}s)</div>
                                    <div className="shot-body">
                                        <label>剧情描述 (中文):</label>
                                        <textarea
                                            value={shot.description}
                                            onChange={(e) => handleShotChange(idx, 'description', e.target.value)}
                                            rows={2}
                                        />
                                        <label>画面提示词 (English):</label>
                                        <textarea
                                            value={shot.prompt}
                                            onChange={(e) => handleShotChange(idx, 'prompt', e.target.value)}
                                            rows={3}
                                            className="code-font"
                                        />
                                        <label>叙事旁白:</label>
                                        <p className="story-text">{shot.shotStory}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="actions-bar">
                            <button className="secondary-btn" onClick={() => setStep(1)}>上一步</button>
                            <button className="primary-btn" onClick={handleGenerateImages} disabled={loading}>
                                {loading ? '正在生成画面...' : '确认并生成画面'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Results */}
                {step === 3 && (
                    <div className="results-view">
                        <div className="results-grid">
                            {Array.isArray(results) && results.map((res, idx) => (
                                <div key={idx} className="result-card">
                                    <div className="card-header">
                                        <span className="badge">Shot {res.shot}</span>
                                    </div>
                                    <div className="image-container">
                                        {res.image_base64 ? (
                                            <img src={`data:image/jpeg;base64,${res.image_base64}`} alt={`Shot ${res.shot}`} />
                                        ) : (
                                            <div className="error-placeholder">{res.error}</div>
                                        )}
                                    </div>
                                    <div className="card-footer">
                                        <p className="result-desc">{res.description}</p>
                                        <div className="btn-group">
                                            <button
                                                className="icon-btn"
                                                onClick={() => {
                                                    // Convert base64 to blob/file to pass to VideoGenerator
                                                    fetch(`data:image/jpeg;base64,${res.image_base64}`)
                                                        .then(r => r.blob())
                                                        .then(blob => {
                                                            const file = new File([blob], `shot_${res.shot}.jpg`, { type: 'image/jpeg' });
                                                            // We pass prompt as well
                                                            // Combine shotStory + prompt? User requested overlay logic is in VideoGenerator. 
                                                            // We pass the raw prompt here.
                                                            // Actually VideoGenerator takes (files, overridePrompt).
                                                            // If we want to pass specific prompt per file, we rely on App.jsx state.
                                                            // But onSelectForVideo takes (imageFile, promptText).
                                                            onSelectForVideo(file, res.shotStory + "\n" + res.prompt);
                                                        });
                                                }}
                                            >
                                                🎬 转视频
                                            </button>
                                            <button
                                                className="icon-btn"
                                                onClick={() => {
                                                    const link = document.createElement("a");
                                                    link.href = `data:image/jpeg;base64,${res.image_base64}`;
                                                    link.download = `story_shot_${res.shot}.jpg`;
                                                    link.click();
                                                }}
                                            >
                                                ⬇️ 下载
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="actions-bar">
                            <button className="secondary-btn" onClick={() => setStep(2)}>返回修改</button>
                            <button className="primary-btn" onClick={() => setStep(1)}>开始新故事</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StoryGenerator;
