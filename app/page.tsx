"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  cacheKey?: string;
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


export default function Page() {
  const [url, setUrl] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("tanstack");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState<Record<string, boolean>>({});
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [toast, setToast] = useState("");
  const [rememberUrl, setRememberUrl] = useState(true);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("openapi-last-url");
    if (saved) {
      setUrl(saved);
      setSearchInput("");
      setSearchQuery("");
    }
    const remember = localStorage.getItem("openapi-remember-url");
    if (remember === "0") {
      setRememberUrl(false);
    }
  }, []);

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

  async function handleGenerate() {
    if (url.trim().length === 0) {
      setError("OpenAPI JSON 또는 YAML 주소를 입력해 주세요.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (response.ok === false) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "생성에 실패했어요.");
      }

      const data = (await response.json()) as GenerateResponse;
      if (rememberUrl) {
        localStorage.setItem("openapi-last-url", url.trim());
        localStorage.setItem("openapi-remember-url", "1");
      } else {
        localStorage.removeItem("openapi-last-url");
        localStorage.setItem("openapi-remember-url", "0");
      }
      setResult(data);
      setFileContents({});
      setFileLoading({});
      setOpenFile(null);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.");
      setStatus("error");
    }
  }

  async function handleGenerateFile() {
    if (localFile === null) {
      setError("업로드할 OpenAPI 파일을 선택해 주세요.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("spec", localFile);
      const response = await fetch("/api/generate-file", {
        method: "POST",
        body: formData,
      });
      if (response.ok === false) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "생성에 실패했어요.");
      }
      const data = (await response.json()) as GenerateResponse;
      setResult(data);
      setFileContents({});
      setFileLoading({});
      setOpenFile(null);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.");
      setStatus("error");
    }
  }

  async function loadFile(path: string) {
    if (result === null) return;
    if (fileContents[path] || fileLoading[path]) return;
    setFileLoading((prev) => ({ ...prev, [path]: true }));
    try {
      const query = new URLSearchParams({
        sessionId: result.sessionId,
        path,
      });
      if (result.cacheKey) {
        query.set("cacheKey", result.cacheKey);
      }
      const response = await fetch(`/api/file?${query.toString()}`);
      if (response.ok === false) {
        throw new Error("파일을 불러오지 못했어요.");
      }
      const payload = (await response.json()) as { path: string; content: string };
      setFileContents((prev) => ({ ...prev, [payload.path]: payload.content }));
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
      <div className="panel">
        <label htmlFor="openapi-url">OpenAPI URL</label>
        <input
          id="openapi-url"
          type="text"
          placeholder="https://api.example.com/v3/api-docs"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button onClick={handleGenerate} disabled={status === "loading"}>
          {status === "loading" ? "생성 중…" : "생성"}
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rememberUrl}
            onChange={(event) => {
              const next = event.target.checked;
              setRememberUrl(next);
              localStorage.setItem("openapi-remember-url", next ? "1" : "0");
              if (next === false) {
                localStorage.removeItem("openapi-last-url");
              }
            }}
          />
          이전 URL 저장
        </label>
        <div className="divider">또는 파일 업로드</div>
        <input
          type="file"
          accept=".json,.yaml,.yml"
          onChange={(event) => setLocalFile(event.target.files?.[0] ?? null)}
        />
        <button onClick={handleGenerateFile} disabled={status === "loading"}>
          {status === "loading" ? "생성 중…" : "파일로 생성"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="검색"
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
      ) : (
        <p>URL 또는 파일을 넣고 생성하세요.</p>
      )}
      {toast ? <div className="toast">{toast}</div> : null}

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
