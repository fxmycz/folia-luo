import { describe, expect, it, vi } from 'vitest';
import { loadPrompts } from '../../../.github/scripts/triage/io/context.mjs';
import { runIssueTriage } from '../../../.github/scripts/triage/io/run-issue.mjs';
import { renderMarker } from '../../../.github/scripts/triage/lib/comments.mjs';
import { extractQrReport, matchPlaybook, mergeDiagnosis, reportForLlm } from '../../../.github/scripts/triage/lib/login-diagnosis.mjs';
import { validateDiagnosis } from '../../../.github/scripts/triage/lib/schema.mjs';
import { formatQrLoginDiagnosticReport } from '@/utils/qrLoginDiagnosticReport';
import { config, makeIssue, NOW, templateLines } from './helpers';

// test/unit/triage/login-diagnosis.test.ts
// 扫码登录诊断：报告提取、已知原因规则、LLM 输出校验与合并，以及在 triage 流程里的接入。

const playbook = config.loginPlaybook;

// 用应用里真实的格式化函数拼一份报告；providerLines 模拟主进程排好的 details 行。
const report = (providerId: 'qq' | 'netease' | 'kugou', { appVersion = '0.7.17', userAgent = 'Mozilla/5.0 Folia/0.7.17 Electron/43.7.5', timeline = [] as { at: number; event: string; detail: Record<string, unknown> }[], providerLines = [] as string[] } = {}) => formatQrLoginDiagnosticReport({
    generatedAt: NOW, appVersion, userAgent, providerId, methodId: providerId, failure: 'check-error', timeline, providerLines,
});

const deviceLimitReport = report('qq', {
    timeline: [{ at: NOW, event: 'state', detail: { state: 'error', message: 'code 800: QR login failed (stage credential-validation, reason upstream-rejected)' } }],
    providerLines: [
        'auth events (2, oldest first, UTC):',
        '  14:26:27.974 info qq-auth.upstream-result phase=credential-exchange httpStatus=200 globalCode=0 upstreamCode=20279',
        '  14:26:28.009 info qq-auth.upstream-result phase=get-login-user httpStatus=200 globalCode=0 upstreamCode=1000',
        '      at callMusicu (C:\\Folia\\resources\\app.asar\\node_modules\\qrLogin.js:961:15)',
    ],
});

const webMissingApiReport = report('netease', {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/153.0.0.0 Mobile Safari/537.36',
    timeline: [{ at: NOW, event: 'start:error', detail: { name: 'Error', message: 'Failed to access environment variables for API base. Please configure VITE_NETEASE_API_BASE.' } }],
    providerLines: ['runtime: web (remote API not configured)'],
});

const webFetchFailedReport = (userAgent: string) => report('kugou', {
    userAgent,
    timeline: [{ at: NOW, event: 'start:error', detail: { name: 'TypeError', message: 'Failed to fetch' } }],
});

const networkResetReport = report('netease', {
    providerLines: ['login requests (1, oldest first, UTC):', '  20:07:34.253 /api/login/qrcode/client/login rejected status=502 code=502 msg="read ECONNRESET" 114ms'],
});

describe('login playbook rules', () => {
    it('extracts the last report from body and author comments', () => {
        const first = report('qq', { appVersion: '0.7.16' });
        const second = report('qq', { appVersion: '0.7.17' });
        expect(extractQrReport([`前言${first}`, '无关评论', second])).toContain('app: 0.7.17');
        expect(extractQrReport(['没有报告'])).toBeNull();
    });

    it('recognises the known causes seen in past issues', () => {
        expect(matchPlaybook(deviceLimitReport, 'qq', playbook)).toEqual(['qq-device-limit']);
        expect(matchPlaybook(webMissingApiReport, 'netease', playbook)).toEqual(['web-api-not-configured']);
        expect(matchPlaybook(webFetchFailedReport('Mozilla/5.0 (Linux; Android 16) Chrome/148 Mobile Safari/537.36'), 'kugou', playbook)).toEqual(['web-api-unreachable']);
        expect(matchPlaybook(networkResetReport, 'netease', playbook)).toEqual(['network-reset']);
    });

    it('does not apply provider-specific or web-only causes elsewhere', () => {
        expect(matchPlaybook(deviceLimitReport, 'netease', playbook)).toEqual([]);
        expect(matchPlaybook(webFetchFailedReport('Mozilla/5.0 Folia/0.7.17 Electron/43.7.5'), 'kugou', playbook)).toEqual([]);
    });

    it('drops stack frames and credentials before sending the report to the LLM', () => {
        const out = reportForLlm(`${deviceLimitReport}\nCookie: qm_keyst=secret`, playbook.reportChars);
        expect(out).not.toContain('at callMusicu');
        expect(out).not.toContain('secret');
        expect(out).toContain('upstreamCode=20279');
    });

    it('renders the playbook into the diagnose prompt', () => {
        const prompt = loadPrompts(config).loginDiagnose;
        expect(prompt).not.toContain('{{playbook}}');
        expect(prompt).toContain('`qq-device-limit`（qq）');
    });
});

describe('validateDiagnosis', () => {
    it('keeps known, applicable causes sorted by confidence and neutralizes text', () => {
        const verdict = validateDiagnosis({
            causes: [{ id: 'network-reset', confidence: 0.4 }, { id: 'qq-device-limit', confidence: 0.9 }, { id: 'made-up', confidence: 1 }],
            analysis: '请看 https://evil.example 并 @someone 处理 #12，配置 VITE_NETEASE_API_BASE',
            suggestions: ['- 换个网络', 3],
        }, playbook, 'qq');
        expect(verdict.ok).toBe(false);

        const ok = validateDiagnosis({
            causes: [{ id: 'network-reset', confidence: 0.4 }, { id: 'qq-device-limit', confidence: 0.9 }, { id: 'made-up', confidence: 1 }],
            analysis: '请看 https://evil.example 并 @someone 处理 #12，配置 VITE_NETEASE_API_BASE',
            suggestions: ['- 换个网络'],
            needs_maintainer: false,
        }, playbook, 'qq');
        expect(ok.ok).toBe(true);
        expect(ok.value?.causes.map((item: { id: string }) => item.id)).toEqual(['qq-device-limit', 'network-reset']);
        expect(ok.value?.analysis).not.toMatch(/https?:/);
        expect(ok.value?.analysis).not.toContain('@s');
        expect(ok.value?.analysis).not.toContain('#1');
        expect(ok.value?.analysis).toContain('VITE\\_NETEASE\\_API\\_BASE');
        expect(ok.value?.suggestions).toEqual(['换个网络']);
    });

    it('rejects causes that do not apply to the provider', () => {
        const verdict = validateDiagnosis({ causes: [{ id: 'qq-device-limit', confidence: 0.95 }] }, playbook, 'netease');
        expect(verdict.ok).toBe(true);
        expect(verdict.value?.causes).toEqual([]);
    });
});

describe('mergeDiagnosis', () => {
    const llmValue = { causes: [{ id: 'network-reset', confidence: 0.7 }, { id: 'clock-skew', confidence: 0.3 }], analysis: '分析', suggestions: [], needsMaintainer: false };

    it('puts rule hits first and drops low-confidence LLM causes', () => {
        const merged = mergeDiagnosis({ reportHash: 'r', ruleCauses: ['qq-device-limit'], llm: { status: 'ok', value: llmValue }, previous: null, playbook });
        expect(merged?.causes).toEqual(['qq-device-limit', 'network-reset']);
        expect(merged?.source).toBe('llm');
    });

    it('reuses the previous LLM verdict while the report is unchanged', () => {
        const previous = mergeDiagnosis({ reportHash: 'r', ruleCauses: [], llm: { status: 'ok', value: llmValue }, previous: null, playbook });
        expect(mergeDiagnosis({ reportHash: 'r', ruleCauses: [], llm: null, previous, playbook })?.analysis).toBe('分析');
        expect(mergeDiagnosis({ reportHash: 'other', ruleCauses: [], llm: null, previous, playbook })).toBeNull();
    });
});

// 不联网的 runIssueTriage：评论、时间线、汇总 issue 都用 overrides 注入，LLM 用假的客户端。
function run(issuePatch: Record<string, unknown>, { llmReply, comments = [], trigger = 'opened' }: { llmReply?: unknown; comments?: unknown[]; trigger?: string } = {}) {
    const completeJson = vi.fn(async () => llmReply);
    const llmClient = llmReply === undefined ? null : { completeJson, usage: { promptTokens: 0, completionTokens: 0 }, callsUsed: 0 };
    const issueRaw = { ...makeIssue(issuePatch), user: { login: 'someone', type: 'User' }, author_association: 'NONE', labels: ((issuePatch.labels as string[]) ?? []).map(name => ({ name })) };
    const result = runIssueTriage({
        gh: {}, llmClient, config, prompts: loadPrompts(config), templateLines, mode: 'live', issueRaw, trigger, now: NOW,
        overrides: { comments, timeline: [], skipBreaker: true, aggregateTargets: { 484: { number: 484, open: true } } },
    });
    return { result, completeJson };
}

describe('login diagnosis in issue triage', () => {
    it('replies with the playbook steps and the AI analysis', async () => {
        const { result, completeJson } = run({ title: '[QR login] qq login failed', body: deviceLimitReport }, {
            llmReply: { causes: [{ id: 'qq-device-limit', confidence: 0.95 }], analysis: '凭据交换阶段返回 20279。', suggestions: [], needs_maintainer: false },
        });
        const { plan } = await result;
        expect(completeJson).toHaveBeenCalledTimes(1);
        expect(plan.upsert?.body).toContain('### 登录问题初步诊断');
        expect(plan.upsert?.body).toContain('由 AI 根据诊断报告自动生成');
        expect(plan.upsert?.body).toContain('凭据交换阶段返回 20279。');
        expect(plan.upsert?.body).toContain('设置 → 设备管理');
        expect(plan.close).toBeNull();
    });

    it('falls back to the rules when the LLM is unavailable or returns garbage', async () => {
        const offline = await run({ title: '[QR login] netease login failed', body: webMissingApiReport }).result;
        expect(offline.plan.upsert?.body).toContain('根据诊断报告自动匹配到以下已知问题');
        expect(offline.plan.upsert?.body).toContain('VITE_NETEASE_API_BASE');

        const garbage = await run({ title: '[QR login] netease login failed', body: webMissingApiReport }, { llmReply: { causes: 'x' } }).result;
        expect(garbage.plan.upsert?.body).toContain('网页版部署没有配置音源 API 地址');
        expect(garbage.plan.notes.join()).toContain('登录诊断输出未通过校验');
    });

    it('posts AI suggestions when no known cause matches', async () => {
        const { plan } = await run({ title: '[QR login] qq login failed', body: report('qq') }, {
            llmReply: { causes: [], analysis: '扫码后上游拒绝，原因不明。', suggestions: ['退出 QQ 音乐客户端后重试'], needs_maintainer: true },
        }).result;
        expect(plan.upsert?.body).toContain('**排查建议**（AI 生成）');
        expect(plan.upsert?.body).toContain('维护者会进一步排查');
    });

    it('skips the LLM for old reports that get merged into the aggregate issue', async () => {
        const { result, completeJson } = run({ title: '[QR login] qq login failed', body: report('qq', { appVersion: '0.7.10' }) }, { llmReply: { causes: [] } });
        const { plan } = await result;
        expect(completeJson).not.toHaveBeenCalled();
        expect(plan.close?.reason).toBe('qr-aggregate');
    });

    it('diagnoses a report the author adds later and replies in a new comment', async () => {
        const previous = { kind: 'triage', module: 'omni', missing: ['qrDiagnostics'], askedAt: new Date(NOW).toISOString() };
        const botComment = { id: 1, author: config.botLogin, authorType: 'Bot', authorAssociation: 'NONE', body: renderMarker(previous), createdAt: new Date(NOW).toISOString() };
        const authorComment = { id: 2, author: 'someone', authorType: 'User', authorAssociation: 'NONE', body: deviceLimitReport, createdAt: new Date(NOW).toISOString() };
        const { result, completeJson } = run({ title: '[QR login] qq login failed', body: '扫码后失败', labels: ['needs-info'] }, {
            trigger: 'author-comment', comments: [botComment, authorComment],
            llmReply: { causes: [{ id: 'qq-device-limit', confidence: 0.95 }], analysis: '设备超限。', suggestions: [], needs_maintainer: false },
        });
        const { plan } = await result;
        expect(completeJson).toHaveBeenCalledTimes(1);
        expect(plan.labelsRemove).toContain('needs-info');
        expect(plan.comments).toHaveLength(1);
        expect(plan.comments[0]).toContain('设置 → 设备管理');
    });

    it('does not call the LLM again for an unchanged report', async () => {
        const first = await run({ title: '[QR login] qq login failed', body: deviceLimitReport }, {
            llmReply: { causes: [{ id: 'qq-device-limit', confidence: 0.95 }], analysis: '设备超限。', suggestions: [] },
        }).result;
        const marker = /<!-- folia-triage:v1 [\s\S]*? -->/.exec(first.plan.upsert?.body ?? '')?.[0] ?? '';
        const botComment = { id: 1, author: config.botLogin, authorType: 'Bot', authorAssociation: 'NONE', body: marker, createdAt: new Date(NOW).toISOString() };
        const { result, completeJson } = run({ title: '[QR login] qq login failed', body: `${deviceLimitReport}\n补充：开了代理` }, {
            trigger: 'edited', comments: [botComment], llmReply: { causes: [] },
        });
        const { plan } = await result;
        expect(completeJson).not.toHaveBeenCalled();
        expect(plan.upsert?.body).toContain('设备超限。');
        expect(plan.comments).toHaveLength(0);
    });
});
