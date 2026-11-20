import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PluginActivate,
  PluginContext,
  UsageLimitProvider,
  UsageLimitProviderId,
  UsageStatRow,
} from "@saga/plugin-sdk";
import "./styles.css";

let host: PluginContext | null = null;

interface ModelOption {
  key: string;
  engine: string;
  model: string;
  label: string;
  tokens: number;
}

interface ModelTotals {
  requests: number;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  todayTokens: number;
}

const numberFormat = new Intl.NumberFormat("zh-CN");

function dayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function modelLabel(row: UsageStatRow): string {
  return row.model || "未知模型";
}

function buildModels(rows: UsageStatRow[]): ModelOption[] {
  const map = new Map<string, ModelOption>();
  for (const row of rows) {
    const key = `${row.engine}\u0000${row.model}`;
    const existing = map.get(key);
    const tokens = row.input + row.output;
    if (existing) {
      existing.tokens += tokens;
    } else {
      map.set(key, {
        key,
        engine: row.engine,
        model: row.model,
        label: `${row.engine} · ${modelLabel(row)}`,
        tokens,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function totalsFor(rows: UsageStatRow[], model: ModelOption | undefined, today: string): ModelTotals {
  const totals: ModelTotals = {
    requests: 0,
    sessions: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    todayTokens: 0,
  };
  if (!model) return totals;
  for (const row of rows) {
    if (row.engine !== model.engine || row.model !== model.model) continue;
    totals.requests += row.requests;
    totals.sessions += row.sessions;
    totals.input += row.input;
    totals.output += row.output;
    totals.cacheRead += row.cacheRead;
    totals.cacheWrite += row.cacheWrite;
    totals.cost += row.cost ?? 0;
    if (row.bucket === today) totals.todayTokens += row.input + row.output;
  }
  return totals;
}

function providerFor(model: ModelOption | undefined): UsageLimitProviderId | null {
  if (!model) return null;
  if (model.engine === "claude") return "claude";
  if (model.engine === "codex") return "codex";
  return null;
}

function relevantWindows(provider: UsageLimitProvider | undefined, model: ModelOption | undefined) {
  if (!provider) return [];
  return provider.windows.filter((window) => {
    if (!model) return true;
    if (!window.label) return true;
    const label = window.label.toLowerCase();
    const modelName = model.model.toLowerCase();
    return modelName.includes(label) || label.includes(modelName);
  });
}

function QuotaPanel() {
  const [rows, setRows] = useState<UsageStatRow[]>([]);
  const [providers, setProviders] = useState<UsageLimitProvider[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);

  const today = dayString(new Date());
  const models = useMemo(() => {
    const options = buildModels(rows);
    if (options.length > 0) return options;
    // 没有本地用量时仍然能看订阅配额：给出 Claude / Codex 两个入口。
    return [
      { key: "claude\u0000", engine: "claude", model: "", label: "Claude · 订阅配额", tokens: 0 },
      { key: "codex\u0000", engine: "codex", model: "", label: "Codex · 订阅配额", tokens: 0 },
    ];
  }, [rows]);
  const selectedModel = models.find((model) => model.key === selected) ?? models[0];
  const totals = useMemo(() => totalsFor(rows, selectedModel, today), [rows, selectedModel, today]);
  const providerId = providerFor(selectedModel);
  const provider = providers.find((item) => item.id === providerId);
  const windows = relevantWindows(provider, selectedModel);

  const load = useCallback(async (refreshLimits: boolean) => {
    const ctx = host;
    if (!ctx) return;
    setError(null);
    setLimitError(null);
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    try {
      const usage = await ctx.usage.query({
        from: dayString(start),
        to: dayString(end),
        bucket: "day",
      });
      setRows(usage.rows);
      if (!selected) {
        const stored = await ctx.storage.get<string>("selectedModel");
        const options = buildModels(usage.rows);
        const next = options.find((option) => option.key === stored) ?? options[0];
        if (next) setSelected(next.key);
      }
    } catch (caught) {
      setRows([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    try {
      const limits = await ctx.limits.get({
        providers: ["claude", "codex"],
        refresh: refreshLimits,
      });
      setProviders(limits.providers);
    } catch (caught) {
      setProviders([]);
      const message = caught instanceof Error ? caught.message : String(caught);
      setLimitError(
        message.includes("CredentialConsentRequired")
          ? "需要先在插件详情页同意读取本机 CLI 登录状态，才能显示订阅配额。"
          : message,
      );
    }
  }, [selected]);

  useEffect(() => {
    void load(false).finally(() => setLoading(false));
    // 只在挂载时加载；刷新走按钮。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const ctx = host;
    if (!ctx) return;
    setRefreshing(true);
    try {
      await ctx.usage.refresh().catch(() => undefined);
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const choose = (key: string) => {
    setSelected(key);
    void host?.storage.set("selectedModel", key);
  };

  const bars = useMemo(() => {
    if (!selectedModel) return [];
    const byDay = new Map<string, number>();
    for (const row of rows) {
      if (row.engine !== selectedModel.engine || row.model !== selectedModel.model) continue;
      byDay.set(row.bucket, (byDay.get(row.bucket) ?? 0) + row.input + row.output);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, tokens]) => ({ day, tokens }));
  }, [rows, selectedModel]);
  const maxBar = Math.max(1, ...bars.map((bar) => bar.tokens));

  if (loading) {
    return <div className="quota-panel quota-empty">正在读取本机用量…</div>;
  }

  return (
    <div className="quota-panel">
      <header className="quota-header">
        <div className="quota-heading">
          <span className="quota-title">AI 配额与用量</span>
          <span className="quota-subtitle">选择模型，只看该模型</span>
        </div>
        <button
          type="button"
          className="quota-button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </header>

      <label className="quota-select-wrap">
        <span>模型</span>
        <select
          className="quota-select"
          value={selectedModel?.key ?? ""}
          onChange={(event) => choose(event.target.value)}
        >
          {models.length === 0 ? <option value="">暂无本机用量</option> : null}
          {models.map((model) => (
            <option key={model.key} value={model.key}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      {error ? <div className="quota-error">{error}</div> : null}

      {selectedModel ? (
        <>
          <section className="quota-cards">
            <div className="quota-card">
              <span className="quota-card-label">今日 Token</span>
              <strong>{numberFormat.format(totals.todayTokens)}</strong>
            </div>
            <div className="quota-card">
              <span className="quota-card-label">近 30 天 Token</span>
              <strong>{numberFormat.format(totals.input + totals.output)}</strong>
            </div>
            <div className="quota-card">
              <span className="quota-card-label">请求 / 会话</span>
              <strong>
                {numberFormat.format(totals.requests)} / {numberFormat.format(totals.sessions)}
              </strong>
            </div>
            <div className="quota-card">
              <span className="quota-card-label">估算成本</span>
              <strong>${totals.cost.toFixed(2)}</strong>
            </div>
          </section>

          <section className="quota-section">
            <div className="quota-section-title">订阅配额</div>
            {!providerId ? (
              <p className="quota-note">该模型没有可读取的订阅配额，下面显示本机用量。</p>
            ) : limitError ? (
              <p className="quota-note quota-warn">{limitError}</p>
            ) : !provider || provider.status !== "ok" ? (
              <p className="quota-note">
                {provider
                  ? `配额状态：${provider.status}${provider.error ? `（${provider.error}）` : ""}`
                  : "暂无订阅配额数据"}
              </p>
            ) : windows.length === 0 ? (
              <p className="quota-note">该模型没有匹配的配额窗口。</p>
            ) : (
              <div className="quota-windows">
                {windows.map((window) => (
                  <div key={window.id} className="quota-window">
                    <div className="quota-window-head">
                      <span>{window.label || window.id}</span>
                      <span>{Math.round(window.usedPercent)}%</span>
                    </div>
                    <div className="quota-track">
                      <div
                        className={`quota-fill ${window.usedPercent >= 80 ? "quota-fill-high" : ""}`}
                        style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }}
                      />
                    </div>
                    <div className="quota-window-foot">
                      <span>已用 {Math.round(window.usedPercent)}%</span>
                      {window.resetsAt ? (
                        <span>重置 {new Date(window.resetsAt).toLocaleString()}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {provider.extra ? (
                  <div className="quota-extra">
                    Extra usage：${provider.extra.usedUsd.toFixed(2)} / $
                    {provider.extra.limitUsd.toFixed(2)}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="quota-section">
            <div className="quota-section-title">近 30 天用量</div>
            {bars.length === 0 ? (
              <p className="quota-note">暂无该模型的本地用量。</p>
            ) : (
              <div className="quota-chart">
                {bars.map((bar) => (
                  <div key={bar.day} className="quota-bar-wrap" title={`${bar.day} · ${numberFormat.format(bar.tokens)}`}>
                    <div
                      className="quota-bar"
                      style={{ height: `${Math.max(4, (bar.tokens / maxBar) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="quota-detail">
              <span>输入 {numberFormat.format(totals.input)}</span>
              <span>输出 {numberFormat.format(totals.output)}</span>
              <span>缓存读 {numberFormat.format(totals.cacheRead)}</span>
              <span>缓存写 {numberFormat.format(totals.cacheWrite)}</span>
            </div>
          </section>
        </>
      ) : (
        <p className="quota-note">还没有本机模型用量。先在本机 CLI 跑一轮对话，再回来刷新。</p>
      )}
    </div>
  );
}

function PanelContainer(_props: { workspacePath: string }) {
  const h = host!.react;
  const ref = h.useRef<HTMLDivElement | null>(null);
  h.useEffect(() => {
    if (!ref.current) return;
    const root = createRoot(ref.current);
    root.render(<QuotaPanel />);
    return () => root.unmount();
  }, [h]);
  return h.createElement("div", { ref, className: "sage-quota-root" });
}

const activate: PluginActivate = (ctx) => {
  host = ctx;
  ctx.ui.registerPanelTab({
    label: () => "用量",
    component: PanelContainer,
    order: 31,
  });
  return () => {
    host = null;
  };
};

export default activate;
