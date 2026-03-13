import { useEffect, useMemo, useState } from 'react';
import apiWorkbenchCatalog, { matchApiWorkbenchPath } from './apiWorkbenchCatalog';
import './ApiWorkbench.css';

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const PATH_PARAM_PATTERN = /\{([^}]+)\}/g;
const CATALOG_ORDER = new Map(apiWorkbenchCatalog.map((entry, index) => [entry.id, index]));

function startCase(value) {
    const normalized = String(value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) {
        return '通用';
    }

    return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveRefObject(target, spec, visited = new Set()) {
    if (!target || typeof target !== 'object' || !target.$ref) {
        return target || null;
    }

    if (visited.has(target.$ref)) {
        return null;
    }

    const segments = target.$ref.replace(/^#\//, '').split('/').map(decodeURIComponent);
    let current = spec;

    for (const segment of segments) {
        current = current?.[segment];
    }

    if (!current) {
        return null;
    }

    return resolveRefObject(current, spec, new Set([...visited, target.$ref])) || current;
}

function resolveSchema(schema, spec) {
    return resolveRefObject(schema, spec) || schema || null;
}

function getFirstExampleValue(examples) {
    if (!examples || typeof examples !== 'object') {
        return undefined;
    }

    const firstExample = Object.values(examples)[0];

    if (!firstExample) {
        return undefined;
    }

    if (firstExample.value !== undefined) {
        return firstExample.value;
    }

    return firstExample.example;
}

function buildExampleFromSchema(schema, spec, depth = 0) {
    const resolvedSchema = resolveSchema(schema, spec) || schema;

    if (!resolvedSchema || depth > 5) {
        return {};
    }

    if (resolvedSchema.example !== undefined) {
        return resolvedSchema.example;
    }

    if (resolvedSchema.default !== undefined) {
        return resolvedSchema.default;
    }

    if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length > 0) {
        return resolvedSchema.enum[0];
    }

    if (Array.isArray(resolvedSchema.allOf) && resolvedSchema.allOf.length > 0) {
        return resolvedSchema.allOf.reduce((accumulator, item) => {
            const value = buildExampleFromSchema(item, spec, depth + 1);

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return { ...accumulator, ...value };
            }

            return accumulator;
        }, {});
    }

    if (Array.isArray(resolvedSchema.oneOf) && resolvedSchema.oneOf.length > 0) {
        return buildExampleFromSchema(resolvedSchema.oneOf[0], spec, depth + 1);
    }

    if (Array.isArray(resolvedSchema.anyOf) && resolvedSchema.anyOf.length > 0) {
        return buildExampleFromSchema(resolvedSchema.anyOf[0], spec, depth + 1);
    }

    const schemaType = resolvedSchema.type || (resolvedSchema.properties ? 'object' : null);

    switch (schemaType) {
        case 'object': {
            const properties = resolvedSchema.properties || {};

            return Object.entries(properties).reduce((accumulator, [key, value]) => {
                accumulator[key] = buildExampleFromSchema(value, spec, depth + 1);
                return accumulator;
            }, {});
        }
        case 'array':
            return [buildExampleFromSchema(resolvedSchema.items, spec, depth + 1)];
        case 'integer':
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'string':
            if (resolvedSchema.format === 'date-time') {
                return '1970-01-01T00:00:00Z';
            }

            if (resolvedSchema.format === 'date') {
                return '1970-01-01';
            }

            if (resolvedSchema.format === 'uri') {
                return 'https://example.com';
            }

            return '';
        default:
            return {};
    }
}

function mergeParameters(pathParameters = [], operationParameters = [], spec) {
    const parameterMap = new Map();

    [...pathParameters, ...operationParameters].forEach((parameter) => {
        const resolvedParameter = resolveRefObject(parameter, spec) || parameter;

        if (!resolvedParameter?.name || !resolvedParameter?.in) {
            return;
        }

        parameterMap.set(`${resolvedParameter.in}:${resolvedParameter.name}`, resolvedParameter);
    });

    return Array.from(parameterMap.values());
}

function getParameterSeed(parameter, spec) {
    if (!parameter) {
        return '';
    }

    const resolvedParameter = resolveRefObject(parameter, spec) || parameter;
    const resolvedSchema = resolveSchema(resolvedParameter.schema, spec);
    const sampleValue = resolvedParameter.example
        ?? getFirstExampleValue(resolvedParameter.examples)
        ?? resolvedSchema?.example
        ?? resolvedSchema?.default
        ?? (Array.isArray(resolvedSchema?.enum) ? resolvedSchema.enum[0] : undefined);

    if (sampleValue === undefined || sampleValue === null) {
        return '';
    }

    return typeof sampleValue === 'string' ? sampleValue : JSON.stringify(sampleValue);
}

function getRequestBodyMeta(operation, spec) {
    const requestBody = resolveRefObject(operation?.requestBody, spec) || operation?.requestBody;

    if (!requestBody?.content || typeof requestBody.content !== 'object') {
        return null;
    }

    const contentType = requestBody.content['application/json']
        ? 'application/json'
        : Object.keys(requestBody.content)[0];

    if (!contentType) {
        return null;
    }

    const content = requestBody.content[contentType] || {};
    const schema = resolveSchema(content.schema, spec) || content.schema || null;
    const example = content.example
        ?? getFirstExampleValue(content.examples)
        ?? buildExampleFromSchema(schema, spec);

    return {
        required: Boolean(requestBody.required),
        description: requestBody.description || '',
        contentType,
        schema,
        example
    };
}

function getInitialBodyText(requestBodyMeta) {
    if (!requestBodyMeta) {
        return '';
    }

    if (requestBodyMeta.contentType === 'application/json') {
        return JSON.stringify(requestBodyMeta.example ?? {}, null, 2);
    }

    return typeof requestBodyMeta.example === 'string'
        ? requestBodyMeta.example
        : JSON.stringify(requestBodyMeta.example ?? '', null, 2);
}

function extractPathParamNames(pathname) {
    return Array.from(String(pathname || '').matchAll(PATH_PARAM_PATTERN), (match) => match[1]);
}

function buildRequestUrl(pathname, pathParams, queryParameters, queryParams) {
    const resolvedPath = String(pathname || '').replace(PATH_PARAM_PATTERN, (_, name) => {
        const value = String(pathParams[name] ?? '').trim();
        return encodeURIComponent(value || `{${name}}`);
    });

    const searchParams = new URLSearchParams();

    queryParameters.forEach((parameter) => {
        const value = String(queryParams[parameter.name] ?? '').trim();

        if (!value) {
            return;
        }

        searchParams.append(parameter.name, value);
    });

    const queryString = searchParams.toString();
    return queryString ? `${resolvedPath}?${queryString}` : resolvedPath;
}

function stringifyPretty(value) {
    if (value === undefined || value === null || value === '') {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
}

function escapeSingleQuotes(value) {
    return String(value).replace(/'/g, "'\"'\"'");
}

function compactValueMap(values) {
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => String(value ?? '').trim() !== '')
    );
}

function buildOperations(spec) {
    if (!spec?.paths || typeof spec.paths !== 'object') {
        return [];
    }

    return Object.entries(spec.paths)
        .flatMap(([path, pathItem]) => {
            if (!pathItem || typeof pathItem !== 'object') {
                return [];
            }

            const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

            return SUPPORTED_METHODS.map((methodKey) => {
                const operation = pathItem[methodKey];

                if (!operation) {
                    return null;
                }

                const catalogEntry = matchApiWorkbenchPath(path)
                    || apiWorkbenchCatalog.find((entry) => entry.matchers.includes(path))
                    || null;
                const parameters = mergeParameters(pathParameters, operation.parameters, spec);
                const requestBody = getRequestBodyMeta(operation, spec);
                const group = catalogEntry?.group || operation.tags?.[0] || 'general';
                const feature = catalogEntry?.feature || operation.tags?.[0] || group;
                const groupTitle = catalogEntry?.title || startCase(feature);
                const sortIndex = catalogEntry ? (CATALOG_ORDER.get(catalogEntry.id) ?? 9999) : 9999;

                return {
                    id: `${methodKey}:${path}`,
                    method: methodKey.toUpperCase(),
                    path,
                    operationId: operation.operationId || '',
                    title: operation.summary || startCase(operation.operationId) || `${methodKey.toUpperCase()} ${path}`,
                    description: operation.description || catalogEntry?.description || 'OpenAPI 中未提供接口说明。',
                    tags: operation.tags || catalogEntry?.tags || [],
                    parameters,
                    requestBody,
                    responses: operation.responses || {},
                    group,
                    feature,
                    groupTitle,
                    groupKey: `${group}:${feature}`,
                    sortIndex,
                    openClaw: catalogEntry?.openClaw || null
                };
            });
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (left.sortIndex !== right.sortIndex) {
                return left.sortIndex - right.sortIndex;
            }

            if (left.groupTitle !== right.groupTitle) {
                return left.groupTitle.localeCompare(right.groupTitle);
            }

            if (left.path !== right.path) {
                return left.path.localeCompare(right.path);
            }

            return left.method.localeCompare(right.method);
        });
}

function ApiWorkbench({ token }) {
    const [openApiDocument, setOpenApiDocument] = useState(null);
    const [isLoadingSpec, setIsLoadingSpec] = useState(true);
    const [specError, setSpecError] = useState('');
    const [searchValue, setSearchValue] = useState('');
    const [selectedOperationId, setSelectedOperationId] = useState('');
    const [pathParams, setPathParams] = useState({});
    const [queryParams, setQueryParams] = useState({});
    const [requestBody, setRequestBody] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [requestError, setRequestError] = useState('');
    const [responseState, setResponseState] = useState(null);

    useEffect(() => {
        let isActive = true;

        async function loadOpenApi() {
            setIsLoadingSpec(true);
            setSpecError('');

            try {
                const response = await fetch('/openapi.json');

                if (!response.ok) {
                    throw new Error(`加载 OpenAPI 文档失败 (${response.status})`);
                }

                const data = await response.json();

                if (isActive) {
                    setOpenApiDocument(data);
                }
            } catch (error) {
                if (isActive) {
                    setSpecError(error.message || '加载 OpenAPI 文档失败');
                    setOpenApiDocument(null);
                }
            } finally {
                if (isActive) {
                    setIsLoadingSpec(false);
                }
            }
        }

        loadOpenApi();

        return () => {
            isActive = false;
        };
    }, []);

    const operations = useMemo(() => buildOperations(openApiDocument), [openApiDocument]);

    const filteredOperations = useMemo(() => {
        const normalizedSearch = searchValue.trim().toLowerCase();

        if (!normalizedSearch) {
            return operations;
        }

        return operations.filter((operation) => {
            const searchTarget = [
                operation.title,
                operation.path,
                operation.method,
                operation.description,
                operation.groupTitle,
                operation.group,
                operation.feature,
                ...(operation.tags || [])
            ]
                .join(' ')
                .toLowerCase();

            return searchTarget.includes(normalizedSearch);
        });
    }, [operations, searchValue]);

    const groupedOperations = useMemo(() => {
        const groupMap = new Map();

        filteredOperations.forEach((operation) => {
            if (!groupMap.has(operation.groupKey)) {
                groupMap.set(operation.groupKey, {
                    key: operation.groupKey,
                    title: operation.groupTitle,
                    sortIndex: operation.sortIndex,
                    items: []
                });
            }

            groupMap.get(operation.groupKey).items.push(operation);
        });

        return Array.from(groupMap.values()).sort((left, right) => {
            if (left.sortIndex !== right.sortIndex) {
                return left.sortIndex - right.sortIndex;
            }

            return left.title.localeCompare(right.title);
        });
    }, [filteredOperations]);

    useEffect(() => {
        if (!operations.length) {
            setSelectedOperationId('');
            return;
        }

        setSelectedOperationId((currentValue) => {
            if (operations.some((operation) => operation.id === currentValue)) {
                return currentValue;
            }

            return operations[0].id;
        });
    }, [operations]);

    useEffect(() => {
        if (!filteredOperations.length) {
            return;
        }

        if (!filteredOperations.some((operation) => operation.id === selectedOperationId)) {
            setSelectedOperationId(filteredOperations[0].id);
        }
    }, [filteredOperations, selectedOperationId]);

    const selectedOperation = useMemo(
        () => operations.find((operation) => operation.id === selectedOperationId) || null,
        [operations, selectedOperationId]
    );

    const pathParameters = useMemo(
        () => selectedOperation?.parameters.filter((parameter) => parameter.in === 'path') || [],
        [selectedOperation]
    );

    const queryParameters = useMemo(
        () => selectedOperation?.parameters.filter((parameter) => parameter.in === 'query') || [],
        [selectedOperation]
    );

    useEffect(() => {
        if (!selectedOperation) {
            return;
        }

        const nextPathParams = {};
        const pathParamNames = new Set(extractPathParamNames(selectedOperation.path));

        pathParameters.forEach((parameter) => {
            pathParamNames.add(parameter.name);
        });

        pathParamNames.forEach((name) => {
            const parameter = pathParameters.find((item) => item.name === name);
            nextPathParams[name] = getParameterSeed(parameter, openApiDocument);
        });

        const nextQueryParams = {};

        queryParameters.forEach((parameter) => {
            nextQueryParams[parameter.name] = getParameterSeed(parameter, openApiDocument);
        });

        setPathParams(nextPathParams);
        setQueryParams(nextQueryParams);
        setRequestBody(getInitialBodyText(selectedOperation.requestBody));
        setRequestError('');
        setResponseState(null);
    }, [selectedOperation, pathParameters, queryParameters, openApiDocument]);

    const compiledRequest = useMemo(() => {
        if (!selectedOperation) {
            return null;
        }

        const url = buildRequestUrl(selectedOperation.path, pathParams, queryParameters, queryParams);
        const trimmedBody = requestBody.trim();
        const shouldSendBody = trimmedBody && !['GET', 'HEAD'].includes(selectedOperation.method);
        let parsedBody = null;
        let bodyError = '';

        if (shouldSendBody) {
            if (selectedOperation.requestBody?.contentType === 'application/json') {
                try {
                    parsedBody = JSON.parse(trimmedBody);
                } catch (error) {
                    bodyError = error.message || 'Invalid JSON body.';
                }
            } else {
                parsedBody = trimmedBody;
            }
        }

        return {
            url,
            trimmedBody,
            parsedBody,
            bodyError,
            shouldSendBody,
            contentType: shouldSendBody ? selectedOperation.requestBody?.contentType || null : null
        };
    }, [selectedOperation, pathParams, queryParameters, queryParams, requestBody]);

    const curlSnippet = useMemo(() => {
        if (!selectedOperation || !compiledRequest) {
            return '';
        }

        const origin = typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : '{{origin}}';
        const lines = [`curl -X ${selectedOperation.method} '${origin}${compiledRequest.url}'`];

        if (token) {
            lines.push(`  -H 'Authorization: Bearer ${escapeSingleQuotes(token)}'`);
        }

        if (compiledRequest.contentType) {
            lines.push(`  -H 'Content-Type: ${compiledRequest.contentType}'`);
        }

        if (compiledRequest.shouldSendBody) {
            lines.push(`  --data-raw '${escapeSingleQuotes(compiledRequest.trimmedBody)}'`);
        }

        return lines.join(' \\\n');
    }, [selectedOperation, compiledRequest, token]);

    const openClawSnippet = useMemo(() => {
        if (!selectedOperation || !compiledRequest) {
            return '';
        }

        return JSON.stringify(
            {
                tool: 'openclaw.http',
                title: selectedOperation.title,
                feature: selectedOperation.feature,
                group: selectedOperation.group,
                target: selectedOperation.openClaw,
                auth: token ? { type: 'bearer' } : null,
                request: {
                    method: selectedOperation.method,
                    pathTemplate: selectedOperation.path,
                    path: compiledRequest.url,
                    pathParams: compactValueMap(pathParams),
                    query: compactValueMap(queryParams),
                    headers: token ? { Authorization: 'Bearer <token>' } : {},
                    contentType: compiledRequest.contentType,
                    body: compiledRequest.shouldSendBody
                        ? (compiledRequest.bodyError
                            ? { raw: compiledRequest.trimmedBody, parseError: compiledRequest.bodyError }
                            : compiledRequest.parsedBody)
                        : null
                },
                response: responseState
                    ? {
                        status: responseState.status,
                        ok: responseState.ok,
                        statusText: responseState.statusText
                    }
                    : null
            },
            null,
            2
        );
    }, [selectedOperation, compiledRequest, pathParams, queryParams, token, responseState]);

    const responseBodyText = useMemo(() => {
        if (!responseState) {
            return '暂未返回结果。';
        }

        if (responseState.hasJsonBody) {
            return JSON.stringify(responseState.parsedBody, null, 2);
        }

        return responseState.rawText || '(empty response body)';
    }, [responseState]);

    async function handleExecute() {
        if (!selectedOperation || !compiledRequest) {
            return;
        }

        if (selectedOperation.path.startsWith('/ws')) {
            setRequestError('WebSocket 接口仅供查阅，当前页面不会通过 fetch 直接执行。');
            setResponseState(null);
            return;
        }

        const missingPathParams = pathParameters
            .filter((parameter) => parameter.required)
            .filter((parameter) => !String(pathParams[parameter.name] ?? '').trim())
            .map((parameter) => parameter.name);

        if (missingPathParams.length > 0) {
            setRequestError(`缺少必填路径参数：${missingPathParams.join(', ')}`);
            setResponseState(null);
            return;
        }

        if (compiledRequest.bodyError) {
            setRequestError(`请求体必须是合法的 JSON：${compiledRequest.bodyError}`);
            setResponseState(null);
            return;
        }

        const headers = {};

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        if (compiledRequest.contentType) {
            headers['Content-Type'] = compiledRequest.contentType;
        }

        const requestOptions = {
            method: selectedOperation.method,
            headers
        };

        if (compiledRequest.shouldSendBody) {
            requestOptions.body = compiledRequest.contentType === 'application/json'
                ? JSON.stringify(compiledRequest.parsedBody)
                : compiledRequest.trimmedBody;
        }

        setIsExecuting(true);
        setRequestError('');
        setResponseState(null);

        try {
            const response = await fetch(compiledRequest.url, requestOptions);
            const rawText = await response.text();
            let parsedBody = null;
            let hasJsonBody = false;

            if (rawText) {
                try {
                    parsedBody = JSON.parse(rawText);
                    hasJsonBody = true;
                } catch (error) {
                    hasJsonBody = false;
                }
            }

            setResponseState({
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                rawText,
                parsedBody,
                hasJsonBody
            });
        } catch (error) {
            setRequestError(error.message || '请求执行失败。');
        } finally {
            setIsExecuting(false);
        }
    }

    return (
        <div className="api-workbench-container">
            <aside className="workbench-sidebar">
                <input
                    type="search"
                    className="workbench-search"
                    placeholder="搜索接口、路径、标签或分组"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                />

                <div className="workbench-catalog">
                    {groupedOperations.length > 0 ? (
                        groupedOperations.map((group) => (
                            <div key={group.key} className="workbench-group">
                                <h3 className="workbench-group-title">{group.title}</h3>
                                <div className="workbench-op-list">
                                    {group.items.map((operation) => (
                                        <button
                                            key={operation.id}
                                            type="button"
                                            className={`workbench-op-item ${selectedOperationId === operation.id ? 'active' : ''}`}
                                            onClick={() => setSelectedOperationId(operation.id)}
                                        >
                                            <span>
                                                <strong>{operation.title}</strong>
                                                <br />
                                                <small>{operation.path}</small>
                                            </span>
                                            <span className={`method-badge method-${operation.method.toLowerCase()}`}>
                                                {operation.method}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="workbench-empty">
                            {searchValue.trim()
                                ? '没有匹配当前搜索条件的接口。'
                                : '在 /openapi.json 中未找到接口定义。'}
                        </div>
                    )}
                </div>
            </aside>

            <main className="workbench-main">
                {isLoadingSpec ? (
                    <div className="workbench-loading">正在从 /openapi.json 加载 OpenAPI 文档…</div>
                ) : specError ? (
                    <div className="workbench-error">{specError}</div>
                ) : !selectedOperation ? (
                    <div className="workbench-empty">请先从左侧目录选择一个接口，以查看详情并进行调试。</div>
                ) : (
                    <div className="workbench-detail-layout">
                        <div className="workbench-detail-content">
                            <section id="section-overview" className="card-panel">
                            <div className="op-header">
                                <div className="op-summary">
                                    <h2>{selectedOperation.title}</h2>
                                    <p>{selectedOperation.description}</p>
                                    <div className="op-metadata">
                                        <span className={`method-badge method-${selectedOperation.method.toLowerCase()}`}>
                                            {selectedOperation.method}
                                        </span>
                                        <code className="meta-path">{selectedOperation.path}</code>
                                        <span className="meta-group">{selectedOperation.groupTitle}</span>
                                        {token && <span className="meta-auth">🔒 Bearer</span>}
                                    </div>
                                </div>
                            </div>
                            </section>

                            <section id="section-params" className="card-panel">
                            <div className="param-section">
                                <h4>路径参数</h4>
                                {pathParameters.length > 0 ? (
                                    pathParameters.map((parameter) => (
                                        <div key={`path-${parameter.name}`} className="param-row">
                                            <label htmlFor={`path-${parameter.name}`}>
                                                {parameter.name}{parameter.required ? ' *' : ''}
                                            </label>
                                            <input
                                                id={`path-${parameter.name}`}
                                                type="text"
                                                value={pathParams[parameter.name] ?? ''}
                                                onChange={(event) => {
                                                    setPathParams((currentValue) => ({
                                                        ...currentValue,
                                                        [parameter.name]: event.target.value
                                                    }));
                                                }}
                                            />
                                        </div>
                                    ))
                                ) : (
                                    <div className="param-row">
                                        <span className="param-label">无</span>
                                        <span>当前接口不需要路径参数。</span>
                                    </div>
                                )}
                            </div>

                            <div className="param-section">
                                <h4>查询参数</h4>
                                {queryParameters.length > 0 ? (
                                    queryParameters.map((parameter) => (
                                        <div key={`query-${parameter.name}`} className="param-row">
                                            <label htmlFor={`query-${parameter.name}`}>
                                                {parameter.name}{parameter.required ? ' *' : ''}
                                            </label>
                                            <input
                                                id={`query-${parameter.name}`}
                                                type="text"
                                                value={queryParams[parameter.name] ?? ''}
                                                onChange={(event) => {
                                                    setQueryParams((currentValue) => ({
                                                        ...currentValue,
                                                        [parameter.name]: event.target.value
                                                    }));
                                                }}
                                            />
                                        </div>
                                    ))
                                ) : (
                                    <div className="param-row">
                                        <span className="param-label">无</span>
                                        <span>当前接口未定义查询参数。</span>
                                    </div>
                                )}
                            </div>

                            </section>

                            <section id="section-body" className="card-panel">
                            <div className="param-section">
                                <h4>JSON 请求体</h4>
                                <textarea
                                    className="json-body-input"
                                    value={requestBody}
                                    onChange={(event) => setRequestBody(event.target.value)}
                                    placeholder="请输入原始 JSON 请求体"
                                    spellCheck={false}
                                />
                            </div>

                            <button
                                type="button"
                                className="execute-btn"
                                onClick={handleExecute}
                                disabled={isExecuting}
                            >
                                {isExecuting ? '执行中…' : '执行请求'}
                            </button>

                            {requestError ? (
                                <div className="workbench-error" style={{ minHeight: 'auto', marginTop: '16px', padding: '16px' }}>{requestError}</div>
                            ) : null}
                            </section>

                            <section id="section-response" className="response-output">
                                <div className="op-summary">
                                    <h3>响应结果</h3>
                                    <p>
                                        {responseState
                                            ? `状态： ${responseState.status} ${responseState.statusText}`
                                            : '执行当前接口后，可在此查看返回结果。'}
                                    </p>
                                </div>
                                <pre className="response-body">{responseBodyText}</pre>
                            </section>
                        <section id="section-snippets" className="snippet-grid">
                            <div className="snippet-block">
                                <h4>cURL</h4>
                                <p>以可直接执行的 shell 命令形式展示当前请求。</p>
                                <pre>{curlSnippet}</pre>
                            </div>
                            <div className="snippet-block">
                                <h4>OpenClaw JSON</h4>
                                <p>面向 OpenClaw / MCP 的结构化请求元数据。</p>
                                <pre>{openClawSnippet}</pre>
                            </div>
                        </section>
                        </div>
                        <aside className="workbench-detail-nav">
                            <div className="sticky-nav">
                                <h3 className="nav-title">页面导航</h3>
                                <ul className="nav-list">
                                    <li><button type="button" onClick={() => document.getElementById('section-overview')?.scrollIntoView({ behavior: 'smooth' })}>概览</button></li>
                                    <li><button type="button" onClick={() => document.getElementById('section-params')?.scrollIntoView({ behavior: 'smooth' })}>参数</button></li>
                                    <li><button type="button" onClick={() => document.getElementById('section-body')?.scrollIntoView({ behavior: 'smooth' })}>请求体</button></li>
                                    <li><button type="button" onClick={() => document.getElementById('section-response')?.scrollIntoView({ behavior: 'smooth' })}>响应</button></li>
                                    <li><button type="button" onClick={() => document.getElementById('section-snippets')?.scrollIntoView({ behavior: 'smooth' })}>调用片段</button></li>
                                </ul>
                            </div>
                        </aside>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ApiWorkbench;
