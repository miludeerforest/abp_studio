import React, { useState, useEffect } from 'react';
import './FloatingGallery.css';

// Product categories
const CATEGORIES = [
    { value: 'all', label: '全部', icon: '🏷️' },
    { value: 'security', label: '安防监控', icon: '📹' },
    { value: 'daily', label: '日用百货', icon: '🧴' },
    { value: 'beauty', label: '美妆护肤', icon: '💄' },
    { value: 'digital', label: '数码3C', icon: '🎧' },
    { value: 'other', label: '其他品类', icon: '📦' },
];

// Format timestamp from backend (already in Beijing time UTC+8)
const formatBeijingTime = (timestamp) => {
    if (!timestamp) return '未知';
    let dateStr = timestamp;
    if (!timestamp.includes('+') && !timestamp.includes('Z')) {
        dateStr = timestamp + '+08:00';
    }
    return new Date(dateStr).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
};

const FloatingGallery = ({ isOpen, onClose, onSelectForVideo }) => {
    const [activeTab, setActiveTab] = useState('images');
    const userRole = localStorage.getItem('role') || 'user';
    const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10);

    const [viewMode, setViewMode] = useState(userRole === 'admin' ? 'all' : 'own');

    // Pagination
    const [imgPage, setImgPage] = useState(1);
    const [vidPage, setVidPage] = useState(1);
    const LIMIT = 6; // 减少每页数量以适应浮动面板

    // Filters
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState('all');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Data
    const [images, setImages] = useState([]);
    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(false);

    // Batch Selection
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Portrait tracking
    const [portraitVideos, setPortraitVideos] = useState(new Set());

    // Lightbox
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [reviewDetails, setReviewDetails] = useState(null);
    const [loadingReview, setLoadingReview] = useState(false);

    // Totals
    const [totalImages, setTotalImages] = useState(0);
    const [totalVideos, setTotalVideos] = useState(0);

    // Fetch when open and filters change
    useEffect(() => {
        if (isOpen) {
            if (activeTab === 'images') fetchImages();
            else fetchVideos();
        }
    }, [isOpen, activeTab, imgPage, vidPage, categoryFilter, viewMode, dateFilter, customStartDate, customEndDate]);

    // Reset selection on tab/category change
    useEffect(() => {
        setSelectedIds(new Set());
        setSelectMode(false);
    }, [activeTab, categoryFilter]);

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                if (selectedImage) setSelectedImage(null);
                else if (selectedVideo) setSelectedVideo(null);
                else onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, selectedImage, selectedVideo, onClose]);

    // Fetch review details when a video with review is selected
    useEffect(() => {
        if (selectedVideo && selectedVideo.review_status === 'done') {
            setLoadingReview(true);
            const token = localStorage.getItem('token');
            fetch(`/api/v1/gallery/videos/${selectedVideo.id}/review`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(res => res.json())
                .then(data => {
                    setReviewDetails(data.details);
                    setLoadingReview(false);
                })
                .catch(() => setLoadingReview(false));
        } else {
            setReviewDetails(null);
        }
    }, [selectedVideo]);

    const getDateParams = () => {
        const today = new Date();
        let startDate = '';
        let endDate = '';

        const formatLocalDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        switch (dateFilter) {
            case 'today':
                startDate = formatLocalDate(today);
                endDate = startDate;
                break;
            case 'week':
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                startDate = formatLocalDate(weekAgo);
                endDate = formatLocalDate(today);
                break;
            case 'month':
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                startDate = formatLocalDate(monthAgo);
                endDate = formatLocalDate(today);
                break;
            case 'custom':
                startDate = customStartDate;
                endDate = customEndDate;
                break;
            default:
                break;
        }

        let params = '';
        if (startDate) params += `&start_date=${startDate}`;
        if (endDate) params += `&end_date=${endDate}`;
        return params;
    };

    const fetchImages = async () => {
        setLoading(true);
        const token = localStorage.getItem('token');
        const offset = (imgPage - 1) * LIMIT;
        const categoryParam = categoryFilter !== 'all' ? `&category=${categoryFilter}` : '';
        const viewParam = userRole === 'admin' ? `&view_mode=${viewMode}` : '';
        const dateParams = getDateParams();
        try {
            const res = await fetch(`/api/v1/gallery/images?limit=${LIMIT}&offset=${offset}${categoryParam}${viewParam}${dateParams}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setImages(data.items);
                setTotalImages(data.total);
            }
        } catch (err) {
            console.error("Failed to fetch images", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchVideos = async () => {
        setLoading(true);
        const token = localStorage.getItem('token');
        const offset = (vidPage - 1) * LIMIT;
        const categoryParam = categoryFilter !== 'all' ? `&category=${categoryFilter}` : '';
        const viewParam = userRole === 'admin' ? `&view_mode=${viewMode}` : '';
        const dateParams = getDateParams();
        try {
            const res = await fetch(`/api/v1/gallery/videos?limit=${LIMIT}&offset=${offset}${categoryParam}${viewParam}${dateParams}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setVideos(data.items);
                setTotalVideos(data.total);
            }
        } catch (err) {
            console.error("Failed to fetch videos", err);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        if (activeTab === 'images') await fetchImages();
        else await fetchVideos();
    };

    const toggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (activeTab === 'images') {
            if (selectedIds.size === images.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(images.map(img => img.id)));
        } else {
            if (selectedIds.size === videos.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(videos.map(vid => vid.id)));
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`确定要删除选中的 ${selectedIds.size} 个项目吗？`)) return;
        if (!window.confirm(`再次确认：删除后无法恢复，是否继续？`)) return;

        const token = localStorage.getItem('token');
        const endpoint = activeTab === 'images'
            ? '/api/v1/gallery/images/batch-delete'
            : '/api/v1/gallery/videos/batch-delete';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });

            if (res.ok) {
                const data = await res.json();
                alert(`成功删除 ${data.deleted} 个项目`);
                setSelectedIds(new Set());
                setSelectMode(false);
                handleRefresh();
            } else {
                alert("批量删除失败");
            }
        } catch (err) {
            console.error("Batch delete failed", err);
            alert("批量删除失败: " + err.message);
        }
    };

    const handleBatchShare = async (isShared) => {
        if (selectedIds.size === 0) return;

        const token = localStorage.getItem('token');
        const endpoint = activeTab === 'images'
            ? '/api/v1/gallery/images/batch-share'
            : '/api/v1/gallery/videos/batch-share';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids: Array.from(selectedIds), is_shared: isShared })
            });

            if (res.ok) {
                setSelectedIds(new Set());
                setSelectMode(false);
                handleRefresh();
            } else {
                alert(`批量${isShared ? '分享' : '取消分享'}失败`);
            }
        } catch (err) {
            console.error("Batch share failed", err);
        }
    };

    const handleDelete = async (e, item, type) => {
        e.stopPropagation();
        if (!window.confirm("确定要删除吗？")) return;

        const token = localStorage.getItem('token');
        const url = type === 'image'
            ? `/api/v1/gallery/images/${item.id}`
            : `/api/v1/queue/${item.id}`;

        try {
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                if (type === 'image') fetchImages();
                else fetchVideos();
            } else {
                alert("删除失败");
            }
        } catch (err) {
            console.error(err);
            alert("删除请求错误");
        }
    };

    const handleToggleShare = async (e, item, type) => {
        e.stopPropagation();
        const token = localStorage.getItem('token');
        const url = type === 'image'
            ? `/api/v1/gallery/images/${item.id}/share`
            : `/api/v1/gallery/videos/${item.id}/share`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                if (type === 'image') fetchImages();
                else fetchVideos();
            } else {
                alert("分享状态切换失败");
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleSelectForVideoAndClose = (imgUrl, prompt, category) => {
        onSelectForVideo(imgUrl, prompt, category);
        onClose();
    };

    const totalPagesImg = Math.ceil(totalImages / LIMIT);
    const totalPagesVid = Math.ceil(totalVideos / LIMIT);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="floating-gallery-backdrop" onClick={onClose} />

            {/* Drawer */}
            <div className={`floating-gallery-drawer ${isOpen ? 'open' : ''}`}>
                {/* Header */}
                <div className="fg-header">
                    <div className="fg-title">
                        <span className="fg-title-icon">🖼️</span>
                        <h2>创意画廊</h2>
                    </div>
                    <button className="fg-close-btn" onClick={onClose} title="关闭">
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="fg-tabs">
                    <button
                        className={`fg-tab ${activeTab === 'images' ? 'active' : ''}`}
                        onClick={() => setActiveTab('images')}
                    >
                        🎨 图片
                    </button>
                    <button
                        className={`fg-tab ${activeTab === 'videos' ? 'active' : ''}`}
                        onClick={() => setActiveTab('videos')}
                    >
                        🎬 视频
                    </button>
                </div>

                {/* Filters */}
                <div className="fg-filters">
                    <select
                        value={categoryFilter}
                        onChange={(e) => { setCategoryFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                        className="fg-select"
                    >
                        {CATEGORIES.map(cat => (
                            <option key={cat.value} value={cat.value}>
                                {cat.icon} {cat.label}
                            </option>
                        ))}
                    </select>

                    {userRole === 'admin' && (
                        <select
                            value={viewMode}
                            onChange={(e) => { setViewMode(e.target.value); setImgPage(1); setVidPage(1); }}
                            className="fg-select"
                        >
                            <option value="own">📁 我的</option>
                            <option value="all">🌐 全部</option>
                        </select>
                    )}

                    <select
                        value={dateFilter}
                        onChange={(e) => { setDateFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                        className="fg-select"
                    >
                        <option value="all">📅 全部</option>
                        <option value="today">今日</option>
                        <option value="week">近7天</option>
                        <option value="month">近30天</option>
                        <option value="custom">自定义</option>
                    </select>

                    {/* Custom Date Range */}
                    {dateFilter === 'custom' && (
                        <div className="fg-date-range">
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="fg-date-input"
                            />
                            <span className="fg-date-separator">~</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="fg-date-input"
                            />
                        </div>
                    )}

                    <button onClick={handleRefresh} className="fg-icon-btn" title="刷新">
                        🔄
                    </button>

                    {userRole === 'admin' && (
                        <button
                            onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                            className={`fg-icon-btn ${selectMode ? 'active' : ''}`}
                            title={selectMode ? "退出选择" : "批量管理"}
                        >
                            {selectMode ? '✕' : '☑️'}
                        </button>
                    )}
                </div>

                {/* Batch Actions */}
                {selectMode && userRole === 'admin' && (
                    <div className="fg-batch-actions">
                        <button onClick={toggleSelectAll} className="fg-batch-btn">
                            {selectedIds.size === (activeTab === 'images' ? images.length : videos.length) ? '🚫 取消全选' : '✅ 全选'}
                        </button>
                        <button
                            onClick={() => handleBatchShare(true)}
                            className="fg-batch-btn share"
                            disabled={selectedIds.size === 0}
                        >
                            🔗 公开 ({selectedIds.size})
                        </button>
                        <button
                            onClick={() => handleBatchShare(false)}
                            className="fg-batch-btn"
                            disabled={selectedIds.size === 0}
                        >
                            🔒 私有
                        </button>
                        <button
                            onClick={handleBatchDelete}
                            className="fg-batch-btn delete"
                            disabled={selectedIds.size === 0}
                        >
                            🗑️ 删除
                        </button>
                    </div>
                )}

                {/* Content */}
                <div className="fg-content">
                    {loading && (
                        <div className="fg-loading">
                            <div className="fg-spinner"></div>
                        </div>
                    )}

                    {/* Images Grid */}
                    {activeTab === 'images' && !loading && (
                        <>
                            {images.length === 0 ? (
                                <div className="fg-empty">
                                    <span className="fg-empty-icon">🖼️</span>
                                    <p>暂无图片</p>
                                </div>
                            ) : (
                                <div className="fg-grid">
                                    {images.map((img) => (
                                        <div
                                            key={img.id}
                                            className={`fg-card ${selectMode ? 'selectable' : ''} ${selectedIds.has(img.id) ? 'selected' : ''}`}
                                            onClick={() => selectMode ? toggleSelect(img.id) : setSelectedImage(img)}
                                        >
                                            {selectMode && (
                                                <div className={`fg-checkbox ${selectedIds.has(img.id) ? 'checked' : ''}`}>
                                                    {selectedIds.has(img.id) && '✓'}
                                                </div>
                                            )}
                                            <img src={img.url} alt="" className="fg-card-img" loading="lazy" />
                                            <div className="fg-card-overlay">
                                                <div className="fg-card-actions">
                                                    {onSelectForVideo && (
                                                        <button
                                                            className="fg-action-btn primary"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleSelectForVideoAndClose(img.url, img.prompt, img.category);
                                                            }}
                                                            title="转视频"
                                                        >
                                                            🎬
                                                        </button>
                                                    )}
                                                    {userRole === 'admin' && (
                                                        <button
                                                            className={`fg-action-btn ${img.is_shared ? 'active' : ''}`}
                                                            onClick={(e) => handleToggleShare(e, img, 'image')}
                                                            title={img.is_shared ? "取消分享" : "分享"}
                                                        >
                                                            {img.is_shared ? '🔗' : '🔒'}
                                                        </button>
                                                    )}
                                                    <a
                                                        href={img.url}
                                                        download
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="fg-action-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="下载"
                                                    >
                                                        ⬇️
                                                    </a>
                                                    {(userRole === 'admin' || img.user_id === currentUserId) && (
                                                        <button
                                                            className="fg-action-btn delete"
                                                            onClick={(e) => handleDelete(e, img, 'image')}
                                                            title="删除"
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="fg-card-prompt">{img.prompt}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Videos Grid */}
                    {activeTab === 'videos' && !loading && (
                        <>
                            {videos.length === 0 ? (
                                <div className="fg-empty">
                                    <span className="fg-empty-icon">🎬</span>
                                    <p>暂无视频</p>
                                </div>
                            ) : (
                                <div className="fg-grid">
                                    {videos.map((vid) => (
                                        <div
                                            key={vid.id}
                                            className={`fg-card video ${selectMode ? 'selectable' : ''} ${selectedIds.has(vid.id) ? 'selected' : ''}`}
                                            onClick={() => selectMode ? toggleSelect(vid.id) : setSelectedVideo(vid)}
                                        >
                                            {selectMode && (
                                                <div className={`fg-checkbox ${selectedIds.has(vid.id) ? 'checked' : ''}`}>
                                                    {selectedIds.has(vid.id) && '✓'}
                                                </div>
                                            )}
                                            {/* Review Score Badge */}
                                            {vid.review_status === 'pending' && (
                                                <div className="fg-review-badge pending" title="审查中...">⏳</div>
                                            )}
                                            {vid.review_status === 'done' && vid.review_score != null && (
                                                <div
                                                    className={`fg-review-badge ${vid.review_score >= 8 ? 'good' : vid.review_score >= 5 ? 'warning' : 'bad'}`}
                                                    title={`综合评分: ${vid.review_score}/10 (越高越好)`}
                                                >
                                                    {vid.review_score >= 8 ? '✓' : vid.review_score >= 5 ? '!' : '✗'} {vid.review_score}
                                                </div>
                                            )}
                                            {vid.review_status === 'error' && (
                                                <div className="fg-review-badge error" title="审查失败">⚠</div>
                                            )}
                                            <img
                                                src={vid.preview_url || "/placeholder-video.png"}
                                                alt=""
                                                className="fg-card-img"
                                                loading="lazy"
                                            />
                                            <div className="fg-play-icon">▶</div>
                                            <div className="fg-card-overlay">
                                                <div className="fg-card-actions">
                                                    {userRole === 'admin' && (
                                                        <button
                                                            className={`fg-action-btn ${vid.is_shared ? 'active' : ''}`}
                                                            onClick={(e) => handleToggleShare(e, vid, 'video')}
                                                            title={vid.is_shared ? "取消分享" : "分享"}
                                                        >
                                                            {vid.is_shared ? '🔗' : '🔒'}
                                                        </button>
                                                    )}
                                                    <a
                                                        href={vid.result_url}
                                                        download
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="fg-action-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="下载"
                                                    >
                                                        ⬇️
                                                    </a>
                                                    {(userRole === 'admin' || vid.user_id === currentUserId) && (
                                                        <button
                                                            className="fg-action-btn delete"
                                                            onClick={(e) => handleDelete(e, vid, 'video')}
                                                            title="删除"
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="fg-card-prompt">{vid.prompt}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Pagination */}
                <div className="fg-pagination">
                    {activeTab === 'images' ? (
                        <>
                            <button
                                onClick={() => setImgPage(p => Math.max(1, p - 1))}
                                disabled={imgPage === 1 || loading}
                                className="fg-page-btn"
                            >
                                ← 上一页
                            </button>
                            <span className="fg-page-info">
                                {imgPage} / {totalPagesImg || 1}
                            </span>
                            <button
                                onClick={() => setImgPage(p => p + 1)}
                                disabled={images.length < LIMIT || imgPage >= totalPagesImg || loading}
                                className="fg-page-btn"
                            >
                                下一页 →
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setVidPage(p => Math.max(1, p - 1))}
                                disabled={vidPage === 1 || loading}
                                className="fg-page-btn"
                            >
                                ← 上一页
                            </button>
                            <span className="fg-page-info">
                                {vidPage} / {totalPagesVid || 1}
                            </span>
                            <button
                                onClick={() => setVidPage(p => p + 1)}
                                disabled={videos.length < LIMIT || vidPage >= totalPagesVid || loading}
                                className="fg-page-btn"
                            >
                                下一页 →
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Image Lightbox */}
            {selectedImage && (
                <div className="fg-lightbox" onClick={() => setSelectedImage(null)}>
                    <div className="fg-lightbox-content" onClick={e => e.stopPropagation()}>
                        <img src={selectedImage.url} alt="" className="fg-lightbox-img" />
                        <div className="fg-lightbox-info">
                            <p className="fg-lightbox-prompt">{selectedImage.prompt || '无提示词'}</p>
                            <div className="fg-lightbox-meta">
                                <span>👤 {selectedImage.username || '未知'}</span>
                                <span>🕐 {formatBeijingTime(selectedImage.created_at)}</span>
                            </div>
                            <div className="fg-lightbox-actions">
                                {onSelectForVideo && (
                                    <button
                                        className="fg-lb-btn primary"
                                        onClick={() => handleSelectForVideoAndClose(selectedImage.url, selectedImage.prompt, selectedImage.category)}
                                    >
                                        🎬 转为视频
                                    </button>
                                )}
                                <a href={selectedImage.url} download target="_blank" rel="noreferrer" className="fg-lb-btn">
                                    ⬇️ 下载
                                </a>
                                <button className="fg-lb-btn close" onClick={() => setSelectedImage(null)}>
                                    ✕ 关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Lightbox */}
            {selectedVideo && (
                <div className="fg-lightbox" onClick={() => setSelectedVideo(null)}>
                    <div className="fg-lightbox-content video" onClick={e => e.stopPropagation()}>
                        <video src={selectedVideo.result_url} controls autoPlay className="fg-lightbox-video" />
                        <div className="fg-lightbox-info">
                            <p className="fg-lightbox-prompt">{selectedVideo.prompt || '无提示词'}</p>
                            <div className="fg-lightbox-meta">
                                <span>👤 {selectedVideo.username || '未知'}</span>
                                <span>🕐 {formatBeijingTime(selectedVideo.created_at)}</span>
                            </div>

                            {/* Review Details Section */}
                            {selectedVideo.review_status === 'done' && (
                                <div className="fg-review-section">
                                    <div className="fg-review-header">
                                        <span className="fg-review-title">🔍 AI质量审查报告</span>
                                        <span className={`fg-review-score-badge ${selectedVideo.review_score >= 8 ? 'good' : selectedVideo.review_score >= 5 ? 'warning' : 'bad'}`}>
                                            综合评分: {selectedVideo.review_score}/10
                                        </span>
                                    </div>
                                    {loadingReview ? (
                                        <p className="fg-review-loading">加载详情...</p>
                                    ) : reviewDetails ? (
                                        <div className="fg-review-details">
                                            <div className="fg-review-scores">
                                                <div className="fg-score-item">
                                                    <span className="score-label">自然度</span>
                                                    <span className={`score-value ${reviewDetails.ai_score >= 8 ? 'good' : reviewDetails.ai_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.ai_score}</span>
                                                </div>
                                                <div className="fg-score-item">
                                                    <span className="score-label">一致性</span>
                                                    <span className={`score-value ${reviewDetails.consistency_score >= 8 ? 'good' : reviewDetails.consistency_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.consistency_score}</span>
                                                </div>
                                                <div className="fg-score-item">
                                                    <span className="score-label">真实性</span>
                                                    <span className={`score-value ${reviewDetails.physics_score >= 8 ? 'good' : reviewDetails.physics_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.physics_score}</span>
                                                </div>
                                                <div className="fg-score-item">
                                                    <span className="score-label">卖点</span>
                                                    <span className={`score-value ${reviewDetails.ecommerce_score >= 8 ? 'good' : reviewDetails.ecommerce_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.ecommerce_score}</span>
                                                </div>
                                                <div className="fg-score-item">
                                                    <span className="score-label">安全</span>
                                                    <span className={`score-value ${reviewDetails.platform_risk >= 8 ? 'good' : reviewDetails.platform_risk >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.platform_risk}</span>
                                                </div>
                                            </div>
                                            {reviewDetails.summary && (
                                                <p className="fg-review-summary">
                                                    <strong>总结：</strong>{reviewDetails.summary}
                                                </p>
                                            )}
                                            <div className={`fg-review-recommendation ${reviewDetails.recommendation}`}>
                                                {reviewDetails.recommendation === 'pass' && '✅ 可直接使用'}
                                                {reviewDetails.recommendation === 'warning' && '⚠️ 谨慎使用'}
                                                {reviewDetails.recommendation === 'reject' && '❌ 不建议使用'}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            )}
                            {selectedVideo.review_status === 'pending' && (
                                <div className="fg-review-section pending">
                                    <span>⏳ 审查中...</span>
                                </div>
                            )}
                            {selectedVideo.review_status === 'error' && (
                                <div className="fg-review-section error">
                                    <span>⚠️ 审查失败</span>
                                </div>
                            )}

                            <div className="fg-lightbox-actions">
                                <a href={selectedVideo.result_url} download target="_blank" rel="noreferrer" className="fg-lb-btn primary">
                                    ⬇️ 下载视频
                                </a>
                                <button className="fg-lb-btn close" onClick={() => setSelectedVideo(null)}>
                                    ✕ 关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default FloatingGallery;
