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
};

type BuildSource = {
  id: string;
  label: string;
  generatedAt?: string;
  files?: GeneratedFile[];
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
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (path: string) => (basePath ? `${basePath}${path}` : path);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("tanstack");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState<Record<string, boolean>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [buildSources, setBuildSources] = useState<BuildSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const loadSources = async () => {
      try {
        const response = await fetch(withBasePath("/openapi/index.json"));
        if (!response.ok) return;
        const payload = (await response.json()) as { sources?: BuildSource[] };
        if (payload.sources) {
          setBuildSources(payload.sources);
        }
      } catch {
        // ignore
      }
    };
    void loadSources();
  }, [basePath]);

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

  async function handleSelectSource(source: BuildSource) {
    setError("");
    setActiveSourceId(source.id);
    setResult({
      files: source.files ?? [],
      sourceUrl: source.label,
      generatedAt: source.generatedAt ?? new Date().toISOString(),
      sessionId: "",
    });
    setFileContents({});
    setFileLoading({});
    setOpenFile(null);
  }

  async function loadFile(path: string) {
    if (result === null) return;
    if (fileContents[path] || fileLoading[path]) return;
    if (!activeSourceId) return;
    setFileLoading((prev) => ({ ...prev, [path]: true }));
    try {
      const response = await fetch(withBasePath(`/openapi/${activeSourceId}/${path}`));
      if (response.ok === false) {
        throw new Error("파일을 불러오지 못했어요.");
      }
      const content = await response.text();
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
