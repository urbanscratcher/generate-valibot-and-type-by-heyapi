"use client";

import { useEffect, useMemo, useState } from "react";

type BuildSource = {
  id: string;
  label: string;
};

type EndpointItem = {
  operation: string;
  method: string;
  url: string;
  domain: string;
  description: string;
  dataType: string;
  responseType: string;
};

const methodColors: Record<string, string> = {
  GET: "#2e7d32",
  POST: "#1565c0",
  PUT: "#6a1b9a",
  PATCH: "#ef6c00",
  DELETE: "#c62828",
};

export default function SearchPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (path: string) => (basePath ? `${basePath}${path}` : path);

  const [sources, setSources] = useState<BuildSource[]>([]);
  const [sourceId, setSourceId] = useState("dol_admin");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EndpointItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    const loadSources = async () => {
      try {
        const response = await fetch(withBasePath("/api/openapi/index"), { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { sources?: BuildSource[] };
        const next = payload.sources ?? [];
        setSources(next);
        if (next.length > 0) {
          setSourceId(next[0].id);
        }
      } catch {
        // ignore
      }
    };
    void loadSources();
  }, [basePath]);

  useEffect(() => {
    const load = async () => {
      setError("");
      setLoading(true);
      try {
        const params = new URLSearchParams({ sourceId, q: query });
        const response = await fetch(withBasePath(`/api/openapi/search?${params.toString()}`), {
          cache: "no-store",
        });
        const payload = (await response.json()) as { items?: EndpointItem[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "검색 실패");
        }
        setItems(payload.items ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "검색 중 오류가 발생했어요.");
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [sourceId, query, basePath]);

  const grouped = useMemo(() => {
    return items.reduce<Record<string, EndpointItem[]>>((acc, item) => {
      const key = item.domain || "others";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="app">
      <h1>Endpoint Search</h1>
      <div className="panel">
        <div className="toolbar">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
          <input
            className="search"
            type="search"
            placeholder="endpoint / method / operation / keyword"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQuery(input.trim());
            }}
          />
          <button onClick={() => setQuery(input.trim())}>검색</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {loading ? <p>검색 중...</p> : null}
      {!loading && items.length === 0 ? <p>검색 결과 없음</p> : null}

      {Object.entries(grouped).map(([group, endpoints]) => (
        <details key={group} className="code-card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            /{group} <span className="meta-line">({endpoints.length} endpoints)</span>
          </summary>
          <div className="results" style={{ marginTop: 8 }}>
            {endpoints.map((item) => (
              <article key={`${item.method}-${item.url}-${item.operation}`} className="code-card">
                <header>
                  <strong>
                    <span
                      style={{
                        display: "inline-block",
                        minWidth: 64,
                        color: "#fff",
                        background: methodColors[item.method] ?? "#455a64",
                        borderRadius: 6,
                        padding: "2px 8px",
                        marginRight: 8,
                        fontSize: 12,
                      }}
                    >
                      {item.method}
                    </span>
                    <button
                      type="button"
                      className="path-copy"
                      onClick={async () => {
                        await navigator.clipboard.writeText(item.url);
                        const key = `${item.method}-${item.url}-copy`;
                        setCopiedKey(key);
                        setTimeout(() => {
                          setCopiedKey((prev) => (prev === key ? "" : prev));
                        }, 1200);
                      }}
                    >
                      {item.url}
                    </button>
                  </strong>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(`${item.method} ${item.url}`);
                        const key = `${item.method}-${item.url}-full`;
                        setCopiedKey(key);
                        setTimeout(() => {
                          setCopiedKey((prev) => (prev === key ? "" : prev));
                        }, 1200);
                      }}
                    >
                      {copiedKey === `${item.method}-${item.url}-full` ? "copied" : "full copy"}
                    </button>
                  </div>
                </header>
                <div className="meta-line">operation: {item.operation}</div>
                <div className="meta-line">request: {item.dataType}</div>
                <div className="meta-line">response: {item.responseType}</div>
                {item.description ? <div className="meta-line">{item.description}</div> : null}
              </article>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
