const apiWorkbenchCatalog = [
    {
        id: 'public',
        group: 'public',
        feature: 'publicGallery',
        title: '公开访问',
        description: '面向公开访问的接口，用于公共配置与无需登录的画廊内容访问。',
        tags: ['public', 'gallery', 'read-only'],
        matchMode: 'prefix',
        matchers: ['/api/v1/public/videos', '/api/v1/public/config'],
        methods: ['GET'],
        uiRoute: null,
        permissions: ['anonymous'],
        openClaw: {
            namespace: 'public',
            resource: 'gallery',
            action: 'browse',
            version: 'v1'
        }
    },
    {
        id: 'auth-login',
        group: 'auth',
        feature: 'authLogin',
        title: '登录认证',
        description: '用于登录并签发访问令牌的接口。',
        tags: ['auth', 'login', 'token'],
        matchMode: 'exact',
        matchers: ['/api/v1/login'],
        methods: ['POST'],
        uiRoute: null,
        permissions: ['anonymous'],
        openClaw: {
            namespace: 'auth',
            resource: 'session',
            action: 'login',
            version: 'v1'
        }
    },
    {
        id: 'profile',
        group: 'account',
        feature: 'profile',
        title: '个人资料',
        description: '用于当前用户资料、头像与使用记录相关操作的接口。',
        tags: ['profile', 'account', 'user'],
        matchMode: 'prefix',
        matchers: ['/api/v1/user/profile', '/api/v1/user/avatar', '/api/v1/user/experience/history'],
        methods: ['GET', 'PUT', 'POST'],
        uiRoute: 'profile',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'account',
            resource: 'profile',
            action: 'manage',
            version: 'v1'
        }
    },
    {
        id: 'settings-config-models',
        group: 'settings',
        feature: 'settingsModels',
        title: '系统配置与模型',
        description: '用于系统配置读取与模型选择相关元数据的接口。',
        tags: ['settings', 'config', 'models'],
        matchMode: 'prefix',
        matchers: ['/api/v1/config', '/api/v1/models'],
        methods: ['GET', 'POST'],
        uiRoute: 'settings',
        permissions: ['authenticated', 'admin'],
        openClaw: {
            namespace: 'settings',
            resource: 'models',
            action: 'configure',
            version: 'v1'
        }
    },
    {
        id: 'users-stats',
        group: 'users',
        feature: 'userStats',
        title: '用户与统计',
        description: '用于用户管理、配额查看与聚合统计的接口。',
        tags: ['users', 'stats', 'analytics'],
        matchMode: 'prefix',
        matchers: ['/api/v1/users', '/api/v1/stats'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        uiRoute: 'users',
        permissions: ['authenticated', 'admin'],
        openClaw: {
            namespace: 'users',
            resource: 'stats',
            action: 'inspect',
            version: 'v1'
        }
    },
    {
        id: 'admin-monitoring',
        group: 'admin',
        feature: 'adminMonitoring',
        title: '管理监控',
        description: '用于管理员查看实时状态、活动记录与用户任务监控的接口。',
        tags: ['admin', 'monitoring', 'activity'],
        matchMode: 'prefix',
        matchers: ['/api/v1/admin/live-status', '/api/v1/admin/activities', '/api/v1/admin/user/{user_id}/tasks'],
        methods: ['GET', 'DELETE'],
        uiRoute: 'monitor',
        permissions: ['admin'],
        openClaw: {
            namespace: 'admin',
            resource: 'monitoring',
            action: 'observe',
            version: 'v1'
        }
    },
    {
        id: 'image-generation',
        group: 'generation',
        feature: 'imageGeneration',
        title: '图像生成',
        description: '用于主要图像生成、图像分析与提示词生成流程的接口。',
        tags: ['image', 'generation', 'prompts'],
        matchMode: 'prefix',
        matchers: ['/api/v1/analyze', '/api/v1/batch-generate', '/api/v1/batch-generate-async', '/api/v1/batch-generate-async/{task_id}', '/api/v1/generate-video-prompt'],
        methods: ['POST', 'GET'],
        uiRoute: 'batch',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'generation',
            resource: 'image',
            action: 'create',
            version: 'v1'
        }
    },
    {
        id: 'simple-batch',
        group: 'generation',
        feature: 'simpleBatch',
        title: '简易批量生成',
        description: '用于基于轻量提示词集合进行批量图像生成的接口。',
        tags: ['batch', 'image', 'bulk'],
        matchMode: 'exact',
        matchers: ['/api/v1/simple-batch-generate'],
        methods: ['POST'],
        uiRoute: 'simple-batch',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'generation',
            resource: 'batch',
            action: 'create',
            version: 'v1'
        }
    },
    {
        id: 'video-queue-merge',
        group: 'video',
        feature: 'videoQueueMerge',
        title: '视频队列与合并',
        description: '用于视频任务排队、重试、生成与视频片段合并的接口。',
        tags: ['video', 'queue', 'merge'],
        matchMode: 'prefix',
        matchers: ['/api/v1/queue', '/api/v1/queue/{item_id}', '/api/v1/queue/{item_id}/retry', '/api/v1/queue/{item_id}/generate', '/api/v1/merge-videos'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        uiRoute: 'video',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'video',
            resource: 'queue',
            action: 'process',
            version: 'v1'
        }
    },
    {
        id: 'story-chain-fission',
        group: 'story',
        feature: 'storyChainFission',
        title: '故事链与裂变',
        description: '用于故事链生成、故事裂变分支与相关分析流程的接口。',
        tags: ['story', 'chain', 'fission'],
        matchMode: 'prefix',
        matchers: ['/api/v1/story-chain', '/api/v1/story-chain/{chain_id}', '/api/v1/story-fission', '/api/v1/story-fission/{fission_id}', '/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry', '/api/v1/story-fission/{fission_id}/remerge', '/api/v1/story-analyze', '/api/v1/story-generate'],
        methods: ['GET', 'POST'],
        uiRoute: 'story',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'story',
            resource: 'workflow',
            action: 'orchestrate',
            version: 'v1'
        }
    },
    {
        id: 'gallery',
        group: 'assets',
        feature: 'gallery',
        title: '媒体画廊',
        description: '用于媒体画廊列表、筛选、预览、审核与资源管理的接口。',
        tags: ['gallery', 'assets', 'media'],
        matchMode: 'prefix',
        matchers: ['/api/v1/gallery/images', '/api/v1/gallery/videos', '/api/v1/gallery/images/batch-delete', '/api/v1/gallery/videos/batch-delete', '/api/v1/gallery/images/batch-share', '/api/v1/gallery/videos/batch-share', '/api/v1/gallery/images/batch-download', '/api/v1/gallery/videos/batch-download', '/api/v1/gallery/videos/{video_id}/review'],
        methods: ['GET', 'POST', 'DELETE'],
        uiRoute: null,
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'assets',
            resource: 'gallery',
            action: 'manage',
            version: 'v1'
        }
    },
    {
        id: 'keywords',
        group: 'analysis',
        feature: 'keywords',
        title: '关键词提取',
        description: '用于关键词提取及相关文本分析流程的接口。',
        tags: ['keywords', 'analysis', 'text'],
        matchMode: 'prefix',
        matchers: ['/api/v1/keywords'],
        methods: ['GET', 'POST', 'DELETE'],
        uiRoute: null,
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'analysis',
            resource: 'keywords',
            action: 'extract',
            version: 'v1'
        }
    },
    {
        id: 'mexico-beauty',
        group: 'verticals',
        feature: 'mexicoBeauty',
        title: '墨西哥美妆站',
        description: '用于墨西哥美妆站点的市场化生成流程接口。',
        tags: ['mexico', 'beauty', 'vertical'],
        matchMode: 'prefix',
        matchers: ['/api/v1/mexico-beauty'],
        methods: ['POST'],
        uiRoute: 'mexico-beauty',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'verticals',
            resource: 'mexico-beauty',
            action: 'generate',
            version: 'v1'
        }
    },
    {
        id: 'voice-clone',
        group: 'audio',
        feature: 'voiceClone',
        title: '声音克隆',
        description: '用于声音克隆配置、训练与合成流程的接口。',
        tags: ['voice', 'clone', 'audio'],
        matchMode: 'prefix',
        matchers: ['/api/v1/voice-clone'],
        methods: ['POST'],
        uiRoute: 'voice-clone',
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'audio',
            resource: 'voice-clone',
            action: 'synthesize',
            version: 'v1'
        }
    },
    {
        id: 'character-video',
        group: 'video',
        feature: 'characterVideo',
        title: '角色视频',
        description: '用于角色视频生成与相关编辑流程的接口。',
        tags: ['character', 'video', 'avatar'],
        matchMode: 'exact',
        matchers: ['/api/v1/character/generate'],
        methods: ['POST'],
        uiRoute: null,
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'video',
            resource: 'character',
            action: 'render',
            version: 'v1'
        }
    },
    {
        id: 'websocket',
        group: 'realtime',
        feature: 'websocket',
        title: '实时连接',
        description: '用于实时状态推送、流式消息与事件通知的 WebSocket 通道。',
        tags: ['websocket', 'realtime', 'events'],
        matchMode: 'prefix',
        matchers: ['/ws', '/ws/{token}'],
        methods: ['GET'],
        uiRoute: null,
        permissions: ['authenticated'],
        openClaw: {
            namespace: 'realtime',
            resource: 'websocket',
            action: 'subscribe',
            version: 'v1'
        }
    }
];

const catalogById = apiWorkbenchCatalog.reduce((index, entry) => {
    index[entry.id] = entry;
    return index;
}, {});

function normalizeApiPath(pathname) {
    if (!pathname) {
        return '/';
    }

    const [withoutQuery] = String(pathname).trim().split(/[?#]/);
    const normalized = withoutQuery.replace(/\/{2,}/g, '/').replace(/\/$/, '');

    return normalized || '/';
}

function doesPathMatch(entry, pathname) {
    const normalizedPath = normalizeApiPath(pathname);

    return entry.matchers.some((matcher) => {
        const normalizedMatcher = normalizeApiPath(matcher);

        if (entry.matchMode === 'exact') {
            return normalizedPath === normalizedMatcher;
        }

        return normalizedPath === normalizedMatcher || normalizedPath.startsWith(`${normalizedMatcher}/`);
    });
}

export function getApiWorkbenchCatalog() {
    return apiWorkbenchCatalog.slice();
}

export function getApiWorkbenchCatalogIds() {
    return apiWorkbenchCatalog.map((entry) => entry.id);
}

export function getApiWorkbenchCatalogEntryById(id) {
    return catalogById[id] || null;
}

export function matchApiWorkbenchPath(pathname) {
    return apiWorkbenchCatalog.find((entry) => doesPathMatch(entry, pathname)) || null;
}

export function resolveApiWorkbenchFeature(pathname, fallbackFeature = 'unknown') {
    return matchApiWorkbenchPath(pathname)?.feature || fallbackFeature;
}

export function resolveApiWorkbenchOpenClawTarget(pathname) {
    return matchApiWorkbenchPath(pathname)?.openClaw || null;
}

export function listApiWorkbenchFeaturesByGroup(group) {
    return apiWorkbenchCatalog.filter((entry) => entry.group === group);
}

export { normalizeApiPath, doesPathMatch };

export default apiWorkbenchCatalog;
