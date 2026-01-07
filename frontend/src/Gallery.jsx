import React, { useState, useEffect } from 'react';
import './Gallery.css';

// Product categories
const CATEGORIES = [
    { value: 'all', label: '全部', icon: '🏷️' }, // Wrapped in usage
    { value: 'security', label: '安防监控', icon: '📹' },
    { value: 'daily', label: '日用百货', icon: '🧴' },
    { value: 'beauty', label: '美妆护肤', icon: '💄' },
    { value: 'digital', label: '数码3C', icon: '🎧' },
    { value: 'other', label: '其他品类', icon: '📦' },
];

// Format timestamp from backend (already in Beijing time UTC+8)
const formatBeijingTime = (timestamp) => {
    if (!timestamp) return '未知';
    // Backend stores time in China timezone (UTC+8) directly
    // Add +08:00 suffix if no timezone info to prevent browser treating as UTC
    let dateStr = timestamp;
    if (!timestamp.includes('+') && !timestamp.includes('Z')) {
        dateStr = timestamp + '+08:00';
    }
    return new Date(dateStr).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
};

const Gallery = ({ onSelectForVideo }) => {
    const [activeTab, setActiveTab] = useState('images'); // 'images' or 'videos'
    const userRole = localStorage.getItem('role') || 'user';
    const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10);

    // View Mode for admin: 'own' (only own content) or 'all' (all users)
    // Admin defaults to 'all' to see all members' content
    const [viewMode, setViewMode] = useState(userRole === 'admin' ? 'all' : 'own');

    // Pagination State
    const [imgPage, setImgPage] = useState(1);
    const [vidPage, setVidPage] = useState(1);
    const LIMIT = 9;

    // Filter State
    const [categoryFilter, setCategoryFilter] = useState('all');

    // Date Filter State
    const [dateFilter, setDateFilter] = useState('all'); // 'all' | 'today' | 'week' | 'month' | 'custom'
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Data State
    const [images, setImages] = useState([]);
    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(false);

    // Batch Selection State (admin only)
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Portrait video tracking (for layout)
    const [portraitVideos, setPortraitVideos] = useState(new Set());

    // Detailed items for lightbox
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedVideo, setSelectedVideo] = useState(null);

    // Totals for pagination
    const [totalImages, setTotalImages] = useState(0);
    const [totalVideos, setTotalVideos] = useState(0);

    // Fetch data when page/filter/viewMode/date changes
    useEffect(() => {
        if (activeTab === 'images') fetchImages();
        else fetchVideos();
    }, [activeTab, imgPage, vidPage, categoryFilter, viewMode, dateFilter, customStartDate, customEndDate]);

    // Reset selection only when switching tabs or category (not when changing pages)
    useEffect(() => {
        setSelectedIds(new Set());
        setSelectMode(false);
    }, [activeTab, categoryFilter]);

    // Calculate date range based on filter
    const getDateParams = () => {
        const today = new Date();
        let startDate = '';
        let endDate = '';

        // Helper to format date as YYYY-MM-DD in local timezone (not UTC)
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

    // Toggle item selection
    const toggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    // Select/Deselect all
    const toggleSelectAll = () => {
        if (activeTab === 'images') {
            if (selectedIds.size === images.length) {
                setSelectedIds(new Set());
            } else {
                setSelectedIds(new Set(images.map(img => img.id)));
            }
        } else {
            if (selectedIds.size === videos.length) {
                setSelectedIds(new Set());
            } else {
                setSelectedIds(new Set(videos.map(vid => vid.id)));
            }
        }
    };

    // Batch delete (admin only)
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

    // Batch share (admin only)
    const handleBatchShare = async (isShared) => {
        if (selectedIds.size === 0) return;
        const action = isShared ? "分享" : "取消分享";

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
                alert(`批量${action}失败`);
            }
        } catch (err) {
            console.error("Batch share failed", err);
            alert(`批量${action}失败: ` + err.message);
        }
    };

    // Batch download
    const handleBatchDownload = async () => {
        if (selectedIds.size === 0) return;

        const token = localStorage.getItem('token');
        const endpoint = activeTab === 'images'
            ? '/api/v1/gallery/images/batch-download'
            : '/api/v1/gallery/videos/batch-download';

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
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `gallery_${activeTab}_${Date.now()}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                const errorText = await res.text();
                alert(`批量下载失败: ${errorText}`);
            }
        } catch (err) {
            console.error("Batch download failed", err);
            alert("批量下载失败: " + err.message);
        }
    };

    const handleDelete = async (e, item, type) => {
        e.stopPropagation(); // Prevent opening lightbox
        if (!window.confirm("确定要删除吗？")) return;

        const token = localStorage.getItem('token');
        try {
            const url = type === 'image'
                ? `/api/v1/gallery/images/${item.id}`
                : `/api/v1/queue/${item.id}`;

            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                // Refresh list
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

    const handleDownload = (e, url) => {
        e.stopPropagation();
        // Native browser behavior for download link, no special js needed other than stopping prop
        // We use a helper here if we want to force simple window open, 
        // but explicit <a> tag logic in render is better.
        // Actually, we'll implement this directly in the JSX as an <a> tag to avoid messy JS clicks.
    };

    // Toggle share status (admin only)
    const handleToggleShare = async (e, item, type) => {
        e.stopPropagation();
        const token = localStorage.getItem('token');
        try {
            const url = type === 'image'
                ? `/api/v1/gallery/images/${item.id}/share`
                : `/api/v1/gallery/videos/${item.id}/share`;

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                // Refresh list to show updated share status
                if (type === 'image') fetchImages();
                else fetchVideos();
            } else {
                alert("分享状态切换失败");
            }
        } catch (err) {
            console.error(err);
            alert("分享请求错误");
        }
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        // Reset pages on tab switch if desired, or keep state
    };

    const totalPagesImg = Math.ceil(totalImages / LIMIT);
    const totalPagesVid = Math.ceil(totalVideos / LIMIT);

    return (
        <div className="gallery-container">
            {/* Header - Two Row Layout */}
            <div className="gallery-header">
                {/* Row 1: Title + Tabs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
                    <div className="gallery-title">
                        <h1><span className="gallery-title-gradient">创意画廊</span></h1>
                    </div>

                    {/* Tab Switcher */}
                    <div className="gallery-tabs">
                        <button
                            onClick={() => handleTabChange('images')}
                            className={`gallery-tab-btn ${activeTab === 'images' ? 'active' : ''}`}
                        >
                            🎨 图片
                        </button>
                        <button
                            onClick={() => handleTabChange('videos')}
                            className={`gallery-tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
                        >
                            🎬 视频
                        </button>
                    </div>

                    {/* Spacer */}
                    <div style={{ flex: 1 }} />

                    {/* Filters Group */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {/* Category Filter */}
                        <select
                            value={categoryFilter}
                            onChange={(e) => { setCategoryFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                            className="gallery-filter-select"
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>
                                    {cat.icon} {cat.label}
                                </option>
                            ))}
                        </select>

                        {/* View Mode (Admin) */}
                        {userRole === 'admin' && (
                            <select
                                value={viewMode}
                                onChange={(e) => { setViewMode(e.target.value); setImgPage(1); setVidPage(1); }}
                                className="gallery-filter-select"
                            >
                                <option value="own">📁 我的</option>
                                <option value="all">🌐 全部</option>
                            </select>
                        )}

                        {/* Date Filter */}
                        <select
                            value={dateFilter}
                            onChange={(e) => { setDateFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                            className="gallery-filter-select"
                        >
                            <option value="all">📅 全部</option>
                            <option value="today">今日</option>
                            <option value="week">近7天</option>
                            <option value="month">近30天</option>
                            <option value="custom">自定义</option>
                        </select>

                        {/* Custom Date Range */}
                        {dateFilter === 'custom' && (
                            <>
                                <input
                                    type="date"
                                    value={customStartDate}
                                    onChange={(e) => setCustomStartDate(e.target.value)}
                                    className="gallery-filter-select"
                                    style={{ width: 'auto', minWidth: '120px' }}
                                />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>~</span>
                                <input
                                    type="date"
                                    value={customEndDate}
                                    onChange={(e) => setCustomEndDate(e.target.value)}
                                    className="gallery-filter-select"
                                    style={{ width: 'auto', minWidth: '120px' }}
                                />
                            </>
                        )}
                    </div>

                    {/* Actions - Right Aligned */}
                    <div className="batch-actions">
                        <button onClick={handleRefresh} className="batch-btn" title="刷新列表">
                            🔄
                        </button>
                        {userRole === 'admin' && (
                            <>
                                <button
                                    onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                                    className={`batch-btn ${selectMode ? 'active' : ''}`}
                                    title={selectMode ? "退出选择" : "批量管理"}
                                >
                                    {selectMode ? '✕' : '☑️'}
                                </button>

                                {selectMode && (
                                    <>
                                        <div className="batch-separator" />

                                        <button onClick={toggleSelectAll} className="batch-btn text-btn" title="全选/取消">
                                            {selectedIds.size === (activeTab === 'images' ? images.length : videos.length) ? '🚫' : '✅'}
                                        </button>

                                        <button onClick={handleBatchDownload} className="batch-btn" disabled={selectedIds.size === 0} title="批量下载">
                                            📦 {selectedIds.size > 0 && <span className="btn-badge">{selectedIds.size}</span>}
                                        </button>

                                        <button
                                            onClick={() => handleBatchShare(true)}
                                            className="batch-btn"
                                            disabled={selectedIds.size === 0}
                                            title="公开所选"
                                        >
                                            🔗 {selectedIds.size > 0 && <span className="btn-badge">{selectedIds.size}</span>}
                                        </button>
                                        <button
                                            onClick={() => handleBatchShare(false)}
                                            className="batch-btn"
                                            disabled={selectedIds.size === 0}
                                            title="私有化所选"
                                        >
                                            🔒
                                        </button>
                                        <button
                                            onClick={handleBatchDelete}
                                            className="batch-btn delete"
                                            disabled={selectedIds.size === 0}
                                            title="删除所选"
                                        >
                                            🗑️
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="gallery-content">
                <div className="gallery-grid-wrapper">
                    {activeTab === 'images' && (
                        <div className="gallery-inner">
                            {images.length === 0 && !loading ? (
                                <div className="gallery-empty">
                                    <div className="gallery-empty-icon">🖼️</div>
                                    <h3 className="gallery-empty-text">暂无图片</h3>
                                </div>
                            ) : (
                                <div className="gallery-grid">
                                    {images.map((img) => (
                                        <div
                                            key={img.id}
                                            className={`gallery-card image-card ${selectMode ? 'selectable' : ''} ${selectedIds.has(img.id) ? 'selected' : ''}`}
                                            onClick={() => selectMode ? toggleSelect(img.id) : setSelectedImage(img)}
                                        >
                                            {/* Selection Checkbox */}
                                            {selectMode && (
                                                <div
                                                    className={`select-checkbox ${selectedIds.has(img.id) ? 'checked' : ''}`}
                                                    onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}
                                                />
                                            )}
                                            <img
                                                src={img.url}
                                                alt="Generated"
                                                className="gallery-card-img"
                                                loading="lazy"
                                            />
                                            <div className="gallery-overlay">
                                                {/* Creator Badge - Right Side */}
                                                {img.username && !selectMode && (
                                                    <div className="gallery-creator">
                                                        👤 {img.username}
                                                    </div>
                                                )}

                                                {/* Hover Actions - Right Side Vertical */}
                                                <div className="gallery-actions">
                                                    {onSelectForVideo && (
                                                        <button
                                                            className="action-btn video"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onSelectForVideo(img.url, img.prompt);
                                                            }}
                                                            title="转视频"
                                                        >
                                                            🎬
                                                        </button>
                                                    )}
                                                    {/* Share button - admin only */}
                                                    {userRole === 'admin' && (
                                                        <button
                                                            className={`action-btn share ${img.is_shared ? 'active' : ''}`}
                                                            onClick={(e) => handleToggleShare(e, img, 'image')}
                                                            title={img.is_shared ? "取消分享" : "分享给普通用户"}
                                                        >
                                                            {img.is_shared ? '🔗' : '🔒'}
                                                        </button>
                                                    )}
                                                    <a
                                                        href={img.url}
                                                        download
                                                        target="_blank"
                                                        className="action-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="下载"
                                                    >
                                                        ⬇️
                                                    </a>
                                                    {/* Delete button - only for own content or admin */}
                                                    {(userRole === 'admin' || img.user_id === currentUserId) && (
                                                        <button
                                                            className="action-btn delete"
                                                            onClick={(e) => handleDelete(e, img, 'image')}
                                                            title="删除"
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>

                                                <p className="gallery-prompt">
                                                    {img.prompt}
                                                </p>
                                                <div className="gallery-hint">
                                                    点击查看大图
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Fillers */}
                                    {[...Array(Math.max(0, LIMIT - images.length))].map((_, i) => (
                                        <div key={`filler-${i}`} className="filler-card"></div>
                                    ))}
                                </div>
                            )}

                            {/* Pagination */}
                            <div className="gallery-pagination">
                                <button
                                    onClick={() => setImgPage(p => Math.max(1, p - 1))}
                                    disabled={imgPage === 1 || loading}
                                    className="page-btn"
                                >
                                    <span>←</span> 上一页
                                </button>
                                <span className="page-info">
                                    Page <span className="page-current">{imgPage}</span> {totalImages > 0 && `/ ${totalPagesImg || 1}`}
                                </span>
                                <button
                                    onClick={() => setImgPage(p => p + 1)}
                                    disabled={images.length < LIMIT || (totalPagesImg > 0 && imgPage >= totalPagesImg) || loading}
                                    className="page-btn"
                                >
                                    下一页 <span>→</span>
                                </button>
                                {/* Page Jump Input */}
                                {totalPagesImg > 1 && (
                                    <div className="page-jump">
                                        <span className="page-jump-label">跳至</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max={totalPagesImg}
                                            className="page-jump-input"
                                            placeholder={imgPage}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const val = parseInt(e.target.value, 10);
                                                    if (val >= 1 && val <= totalPagesImg) {
                                                        setImgPage(val);
                                                        e.target.value = '';
                                                    }
                                                }
                                            }}
                                        />
                                        <span className="page-jump-label">页</span>
                                        <button
                                            className="page-jump-btn"
                                            onClick={(e) => {
                                                const input = e.target.previousElementSibling?.previousElementSibling;
                                                const val = parseInt(input?.value, 10);
                                                if (val >= 1 && val <= totalPagesImg) {
                                                    setImgPage(val);
                                                    input.value = '';
                                                }
                                            }}
                                        >
                                            GO
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'videos' && (
                        <div className="gallery-inner">
                            {videos.length === 0 && !loading ? (
                                <div className="gallery-empty">
                                    <div className="gallery-empty-icon">🎬</div>
                                    <h3 className="gallery-empty-text">暂无视频</h3>
                                </div>
                            ) : (
                                <div className="gallery-grid">
                                    {videos.map((vid) => (
                                        <div
                                            key={vid.id}
                                            className={`gallery-card video-card ${portraitVideos.has(vid.id) ? 'portrait' : ''} ${selectMode && selectedIds.has(vid.id) ? 'selected' : ''}`}
                                            onClick={() => setSelectedVideo(vid)}
                                        >
                                            {/* Select checkbox - bottom right, only in select mode */}
                                            {selectMode && (
                                                <div
                                                    className={`select-checkbox-corner ${selectedIds.has(vid.id) ? 'checked' : ''}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleSelect(vid.id);
                                                    }}
                                                >
                                                    {selectedIds.has(vid.id) && '✓'}
                                                </div>
                                            )}
                                            <div className="w-full h-full relative overflow-hidden group-video-thumb">
                                                <img
                                                    src={vid.preview_url || "/placeholder-video.png"}
                                                    alt="Video Thumbnail"
                                                    className="gallery-card-img"
                                                    onLoad={(e) => {
                                                        // Detect portrait orientation (height > width)
                                                        if (e.target.naturalHeight > e.target.naturalWidth) {
                                                            setPortraitVideos(prev => new Set([...prev, vid.id]));
                                                        }
                                                    }}
                                                    onError={(e) => { e.target.style.display = 'none' }}
                                                />
                                                <div className="video-play-icon">
                                                    <div className="play-button">
                                                        <svg style={{ width: '32px', height: '32px', color: 'white', marginLeft: '4px', filter: 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07))' }} fill="currentColor" viewBox="0 0 24 24">
                                                            <path d="M8 5v14l11-7z" />
                                                        </svg>
                                                    </div>
                                                </div>
                                                {/* Merged/Composite Video Badge */}
                                                {(vid.is_merged || vid.prompt?.includes('Story Chain') || vid.prompt?.includes('Story Fission') || vid.filename?.includes('story_chain') || vid.filename?.includes('story_fission')) && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: '12px',
                                                        left: '12px',
                                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                        padding: '4px 10px',
                                                        borderRadius: '6px',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold',
                                                        color: '#fff',
                                                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                                                        border: '1px solid rgba(255,255,255,0.2)'
                                                    }}>
                                                        ✨ 合成
                                                    </div>
                                                )}
                                                <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', color: '#d1d5db', fontFamily: 'monospace', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                    ID: {vid.id.slice(0, 4)}
                                                </div>
                                            </div>

                                            <div className="gallery-overlay">
                                                {/* Creator Badge - Right Side */}
                                                {vid.username && (
                                                    <div className="gallery-creator">
                                                        👤 {vid.username}
                                                    </div>
                                                )}

                                                {/* Hover Actions - Right Side Vertical */}
                                                <div className="gallery-actions">
                                                    {/* Share button - admin only */}
                                                    {userRole === 'admin' && (
                                                        <button
                                                            className={`action-btn share ${vid.is_shared ? 'active' : ''}`}
                                                            onClick={(e) => handleToggleShare(e, vid, 'video')}
                                                            title={vid.is_shared ? "取消分享" : "分享给普通用户"}
                                                        >
                                                            {vid.is_shared ? '🔗' : '🔒'}
                                                        </button>
                                                    )}
                                                    <a
                                                        href={vid.result_url}
                                                        download
                                                        target="_blank"
                                                        className="action-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="下载"
                                                    >
                                                        ⬇️
                                                    </a>
                                                    {/* Delete button - only for own content or admin */}
                                                    {(userRole === 'admin' || vid.user_id === currentUserId) && (
                                                        <button
                                                            className="action-btn delete"
                                                            onClick={(e) => handleDelete(e, vid, 'video')}
                                                            title="删除"
                                                        >
                                                            🗑️
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="gallery-prompt">
                                                    {vid.prompt}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Fillers */}
                                    {[...Array(Math.max(0, LIMIT - videos.length))].map((_, i) => (
                                        <div key={`filler-vid-${i}`} className="filler-card video-filler"></div>
                                    ))}
                                </div>
                            )}

                            {/* Pagination */}
                            <div className="gallery-pagination">
                                <button
                                    onClick={() => setVidPage(p => Math.max(1, p - 1))}
                                    disabled={vidPage === 1 || loading}
                                    className="page-btn"
                                >
                                    <span>←</span> 上一页
                                </button>
                                <span className="page-info">
                                    Page <span className="page-current">{vidPage}</span> {totalVideos > 0 && `/ ${totalPagesVid || 1}`}
                                </span>
                                <button
                                    onClick={() => setVidPage(p => p + 1)}
                                    disabled={videos.length < LIMIT || (totalPagesVid > 0 && vidPage >= totalPagesVid) || loading}
                                    className="page-btn"
                                >
                                    下一页 <span>→</span>
                                </button>
                                {/* Page Jump Input */}
                                {totalPagesVid > 1 && (
                                    <div className="page-jump">
                                        <span className="page-jump-label">跳至</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max={totalPagesVid}
                                            className="page-jump-input"
                                            placeholder={vidPage}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const val = parseInt(e.target.value, 10);
                                                    if (val >= 1 && val <= totalPagesVid) {
                                                        setVidPage(val);
                                                        e.target.value = '';
                                                    }
                                                }
                                            }}
                                        />
                                        <span className="page-jump-label">页</span>
                                        <button
                                            className="page-jump-btn"
                                            onClick={(e) => {
                                                const input = e.target.previousElementSibling?.previousElementSibling;
                                                const val = parseInt(input?.value, 10);
                                                if (val >= 1 && val <= totalPagesVid) {
                                                    setVidPage(val);
                                                    input.value = '';
                                                }
                                            }}
                                        >
                                            GO
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Image Lightbox - Enhanced with Prompt Panel */}
            {selectedImage && (
                <div className="lightbox-overlay" onClick={() => setSelectedImage(null)}>
                    <div className="lightbox-content lightbox-two-column" onClick={e => e.stopPropagation()}>
                        {/* Left: Image */}
                        <div className="lightbox-media-wrapper">
                            <img
                                src={selectedImage.url}
                                alt="Full View"
                                className="lightbox-img"
                            />
                        </div>

                        {/* Right: Info Panel */}
                        <div className="lightbox-info-panel">
                            {/* Creator Info */}
                            <div className="lightbox-creator">
                                <span className="creator-icon">👤</span>
                                <span className="creator-name">{selectedImage.username || '未知用户'}</span>
                            </div>

                            {/* Metadata Section */}
                            <div className="lightbox-metadata">
                                {selectedImage.width && selectedImage.height && (
                                    <div className="metadata-item">
                                        <span className="metadata-icon">📐</span>
                                        <span className="metadata-label">分辨率</span>
                                        <span className="metadata-value">{selectedImage.width} × {selectedImage.height}</span>
                                    </div>
                                )}
                                <div className="metadata-item">
                                    <span className="metadata-icon">{CATEGORIES.find(c => c.value === selectedImage.category)?.icon || '📦'}</span>
                                    <span className="metadata-label">产品类目</span>
                                    <span className="metadata-value">{CATEGORIES.find(c => c.value === selectedImage.category)?.label || '其他品类'}</span>
                                </div>
                                <div className="metadata-item">
                                    <span className="metadata-icon">🕐</span>
                                    <span className="metadata-label">创作时间</span>
                                    <span className="metadata-value">{formatBeijingTime(selectedImage.created_at)}</span>
                                </div>
                            </div>

                            {/* Prompt Section */}
                            <div className="lightbox-prompt-section">
                                <h4 className="prompt-title">生成提示词</h4>
                                <div className="prompt-content">
                                    {selectedImage.prompt || '无提示词信息'}
                                </div>
                                <button
                                    className="copy-prompt-btn"
                                    onClick={() => {
                                        navigator.clipboard.writeText(selectedImage.prompt || '');
                                        alert('提示词已复制到剪贴板！');
                                    }}
                                >
                                    📋 复制提示词
                                </button>
                            </div>

                            {/* Actions */}
                            <div className="lightbox-actions">
                                <a
                                    href={selectedImage.url}
                                    download
                                    target="_blank"
                                    rel="noreferrer"
                                    className="action-button download"
                                >
                                    ⬇️ 下载原图
                                </a>
                                <button
                                    onClick={() => setSelectedImage(null)}
                                    className="action-button close"
                                >
                                    ✕ 关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Lightbox - Enhanced with Info Panel */}
            {selectedVideo && (
                <div className="lightbox-overlay" onClick={() => setSelectedVideo(null)}>
                    <div className="lightbox-content lightbox-two-column" onClick={e => e.stopPropagation()}>
                        {/* Left: Video */}
                        <div className="lightbox-media-wrapper video-card">
                            <video
                                src={selectedVideo.result_url}
                                controls
                                autoPlay
                                className="lightbox-video"
                            />
                        </div>

                        {/* Right: Info Panel */}
                        <div className="lightbox-info-panel">
                            {/* Creator Info */}
                            <div className="lightbox-creator">
                                <span className="creator-icon">👤</span>
                                <span className="creator-name">{selectedVideo.username || '未知用户'}</span>
                            </div>

                            {/* Metadata Section */}
                            <div className="lightbox-metadata">
                                <div className="metadata-item">
                                    <span className="metadata-icon">{CATEGORIES.find(c => c.value === selectedVideo.category)?.icon || '📦'}</span>
                                    <span className="metadata-label">产品类目</span>
                                    <span className="metadata-value">{CATEGORIES.find(c => c.value === selectedVideo.category)?.label || '其他品类'}</span>
                                </div>
                                <div className="metadata-item">
                                    <span className="metadata-icon">🕐</span>
                                    <span className="metadata-label">创作时间</span>
                                    <span className="metadata-value">{formatBeijingTime(selectedVideo.created_at)}</span>
                                </div>
                            </div>

                            {/* Prompt Section */}
                            <div className="lightbox-prompt-section">
                                <h4 className="prompt-title">生成提示词</h4>
                                <div className="prompt-content">
                                    {selectedVideo.prompt || '无提示词信息'}
                                </div>
                                <button
                                    className="copy-prompt-btn"
                                    onClick={() => {
                                        navigator.clipboard.writeText(selectedVideo.prompt || '');
                                        alert('提示词已复制到剪贴板！');
                                    }}
                                >
                                    📋 复制提示词
                                </button>
                            </div>

                            {/* Actions */}
                            <div className="lightbox-actions">
                                <a
                                    href={selectedVideo.result_url}
                                    download
                                    target="_blank"
                                    rel="noreferrer"
                                    className="action-button primary"
                                >
                                    ⬇️ 下载视频
                                </a>
                                <button
                                    onClick={() => setSelectedVideo(null)}
                                    className="action-button secondary"
                                >
                                    ✕ 关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Gallery;
