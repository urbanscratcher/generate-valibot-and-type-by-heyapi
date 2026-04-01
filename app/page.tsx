"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("typescript", typescript);

type GeneratedFile = {
  path: string;
  lines: number;
  chars: number;
};

type GenerateResponse = {
  files: GeneratedFile[];
  sourceUrl: string;
  generatedAt: string;
  sessionId: string;
};

type BuildSource = {
  id: string;
  label: string;
  generatedAt?: string;
  files?: GeneratedFile[];
};

type EndpointInfo = {
  operation: string;
  method: string;
  url: string;
  description: string;
  dataType: string;
  responseType: string;
};

type EndpointSnippet = {
  file: string;
  line: number;
  preview: string;
};

const groups = [
  {
    id: "tanstack",
    label: "탠스택 쿼리",
    file: "@tanstack/react-query.gen.ts",
  },
  {
    id: "types",
    label: "타입",
    file: "types.gen.ts",
  },
  {
    id: "schemas",
    label: "스키마",
    file: "valibot.gen.ts",
  },
  {
    id: "others",
    label: "나머지",
    file: null,
  },
];

function groupFiles(files: GeneratedFile[]): Map<string, GeneratedFile[]> {
  const bucketed = new Map<string, GeneratedFile[]>();
  groups.forEach((group) => bucketed.set(group.id, []));

  files.forEach((file) => {
    let matched = false;
    for (const group of groups) {
      if (group.file && file.path.endsWith(group.file)) {
        bucketed.get(group.id)?.push(file);
        matched = true;
        break;
      }
    }
    if (!matched) {
      bucketed.get("others")?.push(file);
    }
  });

  return bucketed;
}

function parseComment(rawComment?: string): string {
  if (!rawComment) return "";
  return rawComment
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

function parseSdkEndpoints(content: string): EndpointInfo[] {
  const regex =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?export const\s+(\w+)\s*=([\s\S]*?)\(options\.client\s*\?\?\s*client\)\.(\w+)<([\s\S]*?)>\(\{([\s\S]*?)\}\);/g;

  const endpoints: EndpointInfo[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const comment = parseComment(match[1]);
    const operation = match[2] ?? "";
    const signaturePart = match[3] ?? "";
    const clientMethod = (match[4] ?? "").toUpperCase();
    const genericPart = match[5] ?? "";
    const requestObject = match[6] ?? "";

    const urlMatch = requestObject.match(/url:\s*"([^"]+)"/);
    const dataTypeMatch = signaturePart.match(/options:\s*Options<([^,>]+)/);
    const responseTypeMatch = genericPart.match(/^\s*([^,>\s]+)/);

    if (!urlMatch?.[1]) continue;

    endpoints.push({
      operation,
      method: clientMethod,
      url: urlMatch[1],
      description: comment,
      dataType: dataTypeMatch?.[1]?.trim() ?? "-",
      responseType: responseTypeMatch?.[1]?.trim() ?? "-",
    });
  }

  return endpoints;
}

function indexToLine(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function extractPreview(content: string, index: number, needleLength: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + needleLength + 120);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function findSnippets(fileMap: Record<string, string>, endpoint: EndpointInfo): EndpointSnippet[] {
  const keys = [endpoint.url, endpoint.operation, endpoint.dataType, endpoint.responseType]
    .filter((item) => item && item !== "-")
    .map((item) => item.toLowerCase());

  const snippets: EndpointSnippet[] = [];

  for (const [file, content] of Object.entries(fileMap)) {
    const lower = content.toLowerCase();
    let foundIndex = -1;
    let foundNeedle = "";

    for (const key of keys) {
      const idx = lower.indexOf(key);
      if (idx >= 0) {
        foundIndex = idx;
        foundNeedle = key;
        break;
      }
    }

    if (foundIndex < 0) continue;

    snippets.push({
      file,
      line: indexToLine(content, foundIndex),
      preview: extractPreview(content, foundIndex, foundNeedle.length),
    });
  }

  return snippets;
}

export default function Page() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (path: string) => (basePath ? `${basePath}${path}` : path);
  const withBust = (path: string, bust: number) =>
    withBasePath(`${path}${path.includes("?") ? "&" : "?"}t=${bust}`);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [endpointInput, setEndpointInput] = useState("");
  const [endpointQuery, setEndpointQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("tanstack");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState<Record<string, boolean>>({});
  const [allFilesLoaded, setAllFilesLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const [buildSources, setBuildSources] = useState<BuildSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const loadSources = async () => {
      try {
        const response = await fetch(withBust("/api/openapi/index", cacheBust), { cache: "no-store" });
        if (!response.ok) return;
        const raw = await response.text();
        const payload = JSON.parse(raw) as { sources?: BuildSource[] };
        if (payload.sources) {
          setBuildSources(payload.sources);
        }
      } catch {
        // ignore
      }
    };
    void loadSources();
  }, [basePath, cacheBust]);

  const groupedFiles = useMemo(
    () => (result ? groupFiles(result.files) : new Map<string, GeneratedFile[]>()),
    [result]
  );

  const filteredFiles = useMemo(() => {
    const files = groupedFiles.get(activeGroup) ?? [];
    if (searchQuery.trim().length === 0) return files;
    const query = searchQuery.toLowerCase();
    return files.filter((file) => file.path.toLowerCase().includes(query));
  }, [groupedFiles, activeGroup, searchQuery]);

  const endpointResults = useMemo(() => {
    const query = endpointQuery.trim().toLowerCase();
    if (!query) return [];
    const sdkContent = fileContents["sdk.gen.ts"];
    if (!sdkContent) return [];

    const tokens = query.split(/\s+/).filter(Boolean);
    const endpoints = parseSdkEndpoints(sdkContent);

    return endpoints
      .filter((endpoint) => {
        const haystack = [
          endpoint.operation,
          endpoint.method,
          endpoint.url,
          endpoint.description,
          endpoint.dataType,
          endpoint.responseType,
        ]
          .join(" ")
          .toLowerCase();

        return tokens.every((token) => haystack.includes(token));
      })
      .map((endpoint) => ({
        endpoint,
        snippets: findSnippets(fileContents, endpoint),
      }));
  }, [endpointQuery, fileContents]);

  async function openSingleFile(groupId: string) {
    if (!result) return;
    const group = groups.find((item) => item.id === groupId);
    if (!group?.file) return;
    const target = result.files.find((file) => file.path.endsWith(group.file!));
    if (!target) return;
    if (fileContents[target.path] === undefined) {
      await loadFile(target.path);
    }
    setOpenFile(target.path);
  }

  async function handleSelectSource(source: BuildSource) {
    setError("");
    setActiveSourceId(source.id);
    const nextResult = {
      files: source.files ?? [],
      sourceUrl: source.label,
      generatedAt: source.generatedAt ?? new Date().toISOString(),
      sessionId: "",
    };

    setResult(nextResult);
    setFileContents({});
    setFileLoading({});
    setAllFilesLoaded(false);
    setEndpointQuery("");
    setEndpointInput("");
    setOpenFile(null);

    if ((source.files ?? []).length > 0) {
      await loadAllFiles(source.id, source.files ?? []);
    }
  }

  async function reloadSourcesAndSelect(sourceId: string, bust: number) {
    const response = await fetch(withBust("/api/openapi/index", bust), { cache: "no-store" });
    if (!response.ok) {
      throw new Error("index.json을 다시 불러오지 못했어요.");
    }
    const raw = await response.text();
    let payload: { sources?: BuildSource[] } = {};
    try {
      payload = JSON.parse(raw) as { sources?: BuildSource[] };
    } catch {
      throw new Error("index.json 형식이 올바르지 않아요.");
    }
    const sources = payload.sources ?? [];
    setBuildSources(sources);
    const target = sources.find((item) => item.id === sourceId);
    if (target) {
      await handleSelectSource(target);
    }
  }

  async function handleRefreshSource() {
    if (!activeSourceId) return;
    setError("");
    setIsRefreshing(true);
    try {
      const response = await fetch(withBasePath("/api/openapi/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: activeSourceId }),
      });
      const raw = await response.text();
      let payload: { ok?: boolean; error?: string } = {};
      try {
        payload = JSON.parse(raw) as { ok?: boolean; error?: string };
      } catch {
        throw new Error("서버가 JSON이 아닌 응답을 반환했어요. API 라우트 상태를 확인해 주세요.");
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `새로고침에 실패했어요. (status ${response.status})`);
      }

      const bust = Date.now();
      setCacheBust(bust);
      await reloadSourcesAndSelect(activeSourceId, bust);
    } catch (err) {
      setError(err instanceof Error ? err.message : "새로고침 중 오류가 발생했어요.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function fetchFileContent(sourceId: string, path: string): Promise<string> {
    const query = new URLSearchParams({ sourceId, path });
    const response = await fetch(withBust(`/api/openapi/file?${query.toString()}`, cacheBust), {
      cache: "no-store",
    });
    if (response.ok === false) {
      throw new Error("파일을 불러오지 못했어요.");
    }
    return await response.text();
  }

  async function loadAllFiles(sourceId: string, files: GeneratedFile[]) {
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          content: await fetchFileContent(sourceId, file.path),
        }))
      );
      setFileContents(
        loaded.reduce<Record<string, string>>((acc, item) => {
          acc[item.path] = item.content;
          return acc;
        }, {})
      );
      setAllFilesLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 불러오는 중 오류가 발생했어요.");
    }
  }

  async function loadFile(path: string) {
    if (result === null) return;
    if (fileContents[path] || fileLoading[path]) return;
    if (!activeSourceId) return;
    setFileLoading((prev) => ({ ...prev, [path]: true }));
    try {
      const content = await fetchFileContent(activeSourceId, path);
      setFileContents((prev) => ({ ...prev, [path]: content }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 불러오는 중 오류가 발생했어요.");
    } finally {
      setFileLoading((prev) => ({ ...prev, [path]: false }));
    }
  }

  const openContent = openFile ? fileContents[openFile] : "";

  useEffect(() => {
    if (!openFile) return;
    if (!openContent) return;
    if (!codeRef.current) return;
    hljs.highlightElement(codeRef.current);
  }, [openFile, openContent]);

  return (
    <div className="app">
      <h1>OpenAPI Snippet</h1>
      <div>
        <Link href="/search">/search로 이동</Link>
      </div>
      <div className="panel">
        {buildSources.length > 0 ? (
          <div className="env-buttons">
            {buildSources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => {
                  void handleSelectSource(source);
                }}
              >
                {source.label}
              </button>
            ))}
            <button type="button" onClick={() => void handleRefreshSource()} disabled={!activeSourceId || isRefreshing}>
              {isRefreshing ? "새로고침 중..." : "새로고침"}
            </button>
          </div>
        ) : (
          <p>설정된 OpenAPI 소스가 없어요.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="파일명 검색"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSearchQuery(searchInput.trim());
            }
          }}
        />
        <div className="tabs">
          {groups.map((group) => (
            <button
              key={group.id}
              className={activeGroup === group.id ? "active" : ""}
              onClick={() => {
                setActiveGroup(group.id);
                if (group.file) {
                  void openSingleFile(group.id);
                }
              }}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className="endpoint-panel">
            <div className="endpoint-title">엔드포인트 검색</div>
            <input
              className="search"
              type="search"
              placeholder="예: /admin/products, delete, tag"
              value={endpointInput}
              onChange={(event) => setEndpointInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setEndpointQuery(endpointInput.trim());
                }
              }}
            />
            {!allFilesLoaded && <p className="meta-line">파일 로딩 중입니다...</p>}
            {endpointQuery && endpointResults.length === 0 && allFilesLoaded ? (
              <p>매칭되는 엔드포인트가 없어요.</p>
            ) : null}
            {endpointResults.length > 0 && (
              <div className="results">
                {endpointResults.map(({ endpoint, snippets }) => (
                  <article key={`${endpoint.method}-${endpoint.url}-${endpoint.operation}`} className="code-card">
                    <header>
                      <div>
                        <strong>
                          {endpoint.method} {endpoint.url}
                        </strong>
                        <div className="meta-line">operation: {endpoint.operation}</div>
                        <div className="meta-line">request: {endpoint.dataType}</div>
                        <div className="meta-line">response: {endpoint.responseType}</div>
                        {endpoint.description && <div className="meta-line">{endpoint.description}</div>}
                      </div>
                    </header>
                    <div className="snippet-list">
                      {snippets.length === 0 ? (
                        <div className="meta-line">연관 파일 스니펫 없음</div>
                      ) : (
                        snippets.map((snippet) => (
                          <button
                            key={`${endpoint.url}-${snippet.file}-${snippet.line}`}
                            className="snippet-item"
                            onClick={async () => {
                              if (fileContents[snippet.file] === undefined) {
                                await loadFile(snippet.file);
                              }
                              setOpenFile(snippet.file);
                            }}
                          >
                            <strong>
                              {snippet.file}:{snippet.line}
                            </strong>
                            <span>{snippet.preview}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="results">
            {filteredFiles.length === 0 ? (
              <p>검색 결과 없음</p>
            ) : (
              filteredFiles.map((file) => (
                <article key={file.path} className="code-card">
                  <header>
                    <div>
                      <strong>{file.path}</strong>
                      <div className="meta-line">
                        {file.lines} lines · {file.chars} chars
                      </div>
                    </div>
                    <div className="actions">
                      <button
                        onClick={async () => {
                          if (fileContents[file.path] === undefined) {
                            await loadFile(file.path);
                          }
                          setOpenFile(file.path);
                        }}
                      >
                        펼치기
                      </button>
                    </div>
                  </header>
                </article>
              ))
            )}
          </div>
        </>
      ) : (
        <p>버튼을 눌러 생성된 코드를 확인하세요.</p>
      )}

      {openFile ? (
        <div className="overlay">
          <div className="overlay-header">
            <div className="overlay-title">{openFile}</div>
            <button className="overlay-close" onClick={() => setOpenFile(null)}>
              닫기
            </button>
          </div>
          <div className="overlay-body">
            {fileLoading[openFile] && openContent.length === 0 ? (
              <div>불러오는 중…</div>
            ) : (
              <pre>
                <code ref={codeRef} className="language-ts">
                  {openContent}
                </code>
              </pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
