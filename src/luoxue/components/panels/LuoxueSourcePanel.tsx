import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Loader2, Trash2, Upload } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { luoxueSourceRuntime, type LuoxueSourceInfo } from '../../runtime/sourceRuntime';
import { useLuoxueSectionStore } from '../../store/useLuoxueSectionStore';
import { luoxueSourceLabel } from '../LuoxueSongList';

// src/luoxue/components/panels/LuoxueSourcePanel.tsx
// 音源脚本管理面板：只保留「自定义音源」（脚本，播放所必需）的列表与导入。内置平台的浏览切换由
// LuoxuePlatformSwitch 在搜索 / 排行榜 / 歌单面板里负责，这里不再重复展示内置音源。
// 导入脚本对齐 lx 的两种方式：本地文件导入（选文件读文本）与在线导入（经主进程 HTTP 代理取脚本，绕开 CORS）。

type LuoxueSourcePanelProps = {
    isInteractive: boolean;
};

/** 把 list() 报出的音源 id 归一成运行时使用的规范 id（user_api_xxx）；优先用 getSourceIds() 的报文。 */
const canonicalIdOf = (infoId: string, canonicalIds: string[]): string => {
    const matched = canonicalIds.find(id => id === infoId || id === `user_api_${infoId}`);
    if (matched) return matched;
    return /^user_api_/.test(infoId) ? infoId : `user_api_${infoId}`;
};

/** 主进程 HTTP 代理桥（在线导入取脚本用）；键不存在时返回 null，调用方给出明确提示。 */
type ImportHttpBridge = {
    http(params: {
        requestKey: string;
        url: string;
        method: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
    }): Promise<{ statusCode?: number; statusMessage?: string; bodyBase64?: string }>;
};

const getImportHttpBridge = (): ImportHttpBridge | null => {
    if (typeof window === 'undefined') return null;
    const electron = (window as unknown as { electron?: { luoxueSource?: Partial<ImportHttpBridge> } }).electron;
    const bridge = electron?.luoxueSource;
    return bridge && typeof bridge.http === 'function' ? (bridge as ImportHttpBridge) : null;
};

/**
 * 由文件名（或 URL 末段）得到一个可用作脚本 id 的字符串：去扩展名 → 非法字符换成下划线 → 折叠首尾下划线。
 * 主进程只接受 [A-Za-z0-9_-]，这个 id 也只在「覆盖已有同 id 脚本」时生效（新脚本会另分配 id）。
 */
const sanitizeImportId = (name: string): string => {
    const base = name.replace(/\.(js|json)$/i, '');
    const cleaned = base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return cleaned || `source_${Date.now().toString(36)}`;
};

/** 在线导入的脚本大小上限（对齐 lx 的 UserApiOnlineImportModal）。 */
const MAX_SCRIPT_LENGTH = 9_000_000;

// 整个会话里只从本面板主动预初始化一次自定义源运行时，避免每次切到本面板都重启脚本沙箱。
let initRequested = false;

const LuoxueSourcePanel: React.FC<LuoxueSourcePanelProps> = ({ isInteractive }) => {
    const { activeSourceId, selectSource } = useLuoxueSectionStore(useShallow(state => ({
        activeSourceId: state.activeSourceId,
        selectSource: state.selectSource,
    })));

    const [customSources, setCustomSources] = useState<LuoxueSourceInfo[]>([]);
    const [canonicalIds, setCanonicalIds] = useState<string[]>([]);
    const [onlineUrl, setOnlineUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // 防重入：runtime.list() 内部会 notify 订阅者，若不拦一层会自我触发成死循环。
    const refreshingRef = useRef(false);
    const canonicalIdsRef = useRef<string[]>([]);
    const refresh = useCallback(async (): Promise<string[]> => {
        if (refreshingRef.current) return canonicalIdsRef.current;
        refreshingRef.current = true;
        try {
            const list = await luoxueSourceRuntime.list();
            setCustomSources(list);
            const ids = luoxueSourceRuntime.getSourceIds();
            canonicalIdsRef.current = ids;
            setCanonicalIds(ids);
            return ids;
        } finally {
            refreshingRef.current = false;
        }
    }, []);

    useEffect(() => {
        void refresh();
        // 运行时在别处没被初始化过时，这里补一次，让已选中的自定义音源具备播放能力。
        if (!initRequested) {
            initRequested = true;
            void luoxueSourceRuntime.init().then(() => refresh());
        }
        const unsubscribe = luoxueSourceRuntime.subscribe(() => { void refresh(); });
        return unsubscribe;
    }, [refresh]);

    const chooseCustom = async (infoId: string) => {
        if (!isInteractive || busy) return;
        const canonical = canonicalIdOf(infoId, canonicalIds);
        setBusy(true);
        setMessage(null);
        try {
            await luoxueSourceRuntime.setActiveId(canonical);
            await luoxueSourceRuntime.init();
            selectSource(canonical);
            await refresh();
        } catch (error) {
            setMessage(`切换音源失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (infoId: string) => {
        if (!isInteractive || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            await luoxueSourceRuntime.remove(infoId);
            await refresh();
            setMessage('已删除该自定义音源');
        } catch (error) {
            setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    /**
     * 导入共用收尾：主进程会为新脚本分配自己的 id（user_api_xxx_时间戳），返回值才是真正的 id；
     * 传入的 id 只在「覆盖已有同 id 脚本」时生效。这里沿用既有链路：保存 → 刷新 → 设为当前音源 → 初始化 → 再刷新。
     */
    const importScript = async (id: string, text: string, successText: string) => {
        setBusy(true);
        setMessage(null);
        try {
            const saved = await luoxueSourceRuntime.saveFromText(id, text);
            const ids = await refresh();
            const canonical = canonicalIdOf(saved.id || id, ids);
            await luoxueSourceRuntime.setActiveId(canonical);
            await luoxueSourceRuntime.init();
            selectSource(canonical);
            await refresh();
            setMessage(`${successText}（${canonical}），并切换为当前音源`);
        } catch (error) {
            setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    // 本地导入：读文件文本，用文件名（去扩展名、清洗）当 id。
    const handleLocalFile = async (file: File) => {
        if (!isInteractive || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            const text = await file.text();
            if (!text.trim()) {
                setMessage('导入失败：脚本内容为空');
                return;
            }
            await importScript(sanitizeImportId(file.name), text, '音源脚本已导入');
        } catch (error) {
            setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    // 在线导入：脚本必须经主进程 HTTP 代理取（渲染层 webSecurity:true，直连会被 CORS 拦）。
    const handleOnlineImport = async () => {
        if (!isInteractive || busy) return;
        const url = onlineUrl.trim();
        if (!/^https?:\/\//.test(url)) {
            setMessage('请输入以 http:// 或 https:// 开头的脚本地址');
            return;
        }
        const bridge = getImportHttpBridge();
        if (!bridge) {
            setMessage('在线导入仅支持 Electron 桌面端');
            return;
        }
        setBusy(true);
        setMessage('正在下载脚本…');
        try {
            const requestKey = `http__${Math.random().toString(36).slice(2)}`;
            const response = await bridge.http({ requestKey, url, method: 'GET', timeoutMs: 20000 });
            const statusCode = Number(response?.statusCode ?? 0);
            if (statusCode < 200 || statusCode >= 300) {
                setMessage(`导入失败：HTTP ${statusCode}${response?.statusMessage ? ` ${response.statusMessage}` : ''}`);
                return;
            }
            const bodyBase64 = response?.bodyBase64 ?? '';
            if (!bodyBase64) {
                setMessage('导入失败：下载到的脚本内容为空');
                return;
            }
            const text = new TextDecoder().decode(Uint8Array.from(atob(bodyBase64), c => c.charCodeAt(0)));
            if (!text.trim()) {
                setMessage('导入失败：下载到的脚本内容为空');
                return;
            }
            if (text.length > MAX_SCRIPT_LENGTH) {
                setMessage('导入失败：脚本过大');
                return;
            }
            const name = url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
            await importScript(sanitizeImportId(name), text, '音源脚本已在线导入');
            setOnlineUrl('');
        } catch (error) {
            setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const rowBase = 'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed';
    const buttonBase = 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';
    const inputClass = 'w-full rounded-xl border border-white/10 bg-black/5 px-3 py-2 text-sm focus:outline-none focus:border-white/20 dark:bg-white/5';

    return (
        <div className="flex h-full w-full flex-col gap-6 overflow-y-auto pr-1">
            <section className="flex flex-col gap-3">
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>自定义音源</div>
                {customSources.length === 0 ? (
                    <div className="rounded-xl border border-current/10 px-3 py-6 text-center text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        还没有导入自定义音源
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {customSources.map(source => {
                            const canonical = canonicalIdOf(source.id, canonicalIds);
                            const active = canonical === activeSourceId;
                            const meta = [source.version ? `v${source.version}` : null, source.author].filter(Boolean).join(' · ');
                            return (
                                <div
                                    key={source.id}
                                    className={`${rowBase} ${active ? 'border-current/30 bg-current/10' : 'border-current/10'}`}
                                >
                                    <button
                                        type="button"
                                        disabled={!isInteractive || busy}
                                        onClick={() => void chooseCustom(source.id)}
                                        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-not-allowed"
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="truncate text-sm" style={{ color: active ? 'var(--text-accent, var(--text-primary))' : 'var(--text-primary)' }}>
                                                {source.name || luoxueSourceLabel(canonical)}
                                            </span>
                                            {active ? <span className="shrink-0 text-xs opacity-70">当前音源</span> : null}
                                        </span>
                                        {source.description || meta ? (
                                            <span className="mt-0.5 truncate text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                {source.description || meta}
                                            </span>
                                        ) : null}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!isInteractive || busy}
                                        onClick={() => void handleRemove(source.id)}
                                        title="删除"
                                        aria-label="删除"
                                        className="shrink-0 rounded-full p-2 opacity-60 transition-colors enabled:hover:bg-black/10 enabled:hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 dark:enabled:hover:bg-white/10"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>本地导入</div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".js,.json"
                    className="hidden"
                    onChange={event => {
                        const file = event.target.files?.[0];
                        // 清空 input 的值，允许连续两次选同一个文件。
                        event.target.value = '';
                        if (file) void handleLocalFile(file);
                    }}
                />
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        disabled={!isInteractive || busy}
                        onClick={() => fileInputRef.current?.click()}
                        className={buttonBase}
                        style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                    >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                        选择脚本文件
                    </button>
                    <span className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>支持 .js / .json，文件名会作为音源 id</span>
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>在线导入</div>
                <input
                    type="url"
                    value={onlineUrl}
                    onChange={event => setOnlineUrl(event.target.value)}
                    placeholder="脚本地址（https://…/source.js）"
                    className={inputClass}
                    style={{ color: 'var(--text-primary)' }}
                />
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        disabled={!isInteractive || busy}
                        onClick={() => void handleOnlineImport()}
                        className={buttonBase}
                        style={{ backgroundColor: 'var(--text-accent, var(--text-primary))', color: 'var(--bg-color)' }}
                    >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Link size={15} />}
                        在线导入
                    </button>
                </div>
            </section>

            {message ? (
                <div className="min-w-0 break-words rounded-xl border border-current/10 px-3 py-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {message}
                </div>
            ) : null}

            <div className="rounded-xl border border-current/10 bg-current/5 px-3 py-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                浏览平台（搜索 / 排行榜 / 歌单）只提供目录能力，
                <span style={{ color: 'var(--text-primary)' }}>但内置平台不提供播放地址，要播放或下载歌曲，必须导入自定义音源脚本并切换为当前音源</span>。
            </div>
        </div>
    );
};

export default LuoxueSourcePanel;
