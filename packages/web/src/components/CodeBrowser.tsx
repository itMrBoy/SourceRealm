import { useEffect, useMemo, useRef, useState } from 'react'
import TreeView, { type INode, type NodeId } from 'react-accessible-treeview'
import { codeToHtml } from 'shiki'
import * as api from '../api.js'
import { useStore } from '../store.js'
import { SplitHandle } from './SplitHandle.js'

export interface HighlightRef {
  file: string
  startLine: number
  endLine: number
}

interface CodeBrowserProps {
  projectId: string
  /** 本关相关文件优先(置顶并标 ★) */
  files: string[]
  onLineClick?: (file: string, line: number) => void
  highlightRef?: HighlightRef | null
  /** 受控当前文件(可选);未提供时内部自管 */
  activeFile?: string | null
  /** 受控模式下,用户在文件栏选择文件时回调 */
  onSelectFile?: (file: string) => void
  /** 文件栏宽度(px),可拖拽时由父组件受控 */
  railWidth?: number
  /** 文件栏分隔条拖动回调(clientX) */
  onDragRail?: (clientX: number) => void
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  php: 'php',
  css: 'css',
  scss: 'scss',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
}

type FileTreeKind = 'root' | 'directory' | 'file'

interface FileTreeMeta {
  kind: FileTreeKind
  path: string
}

interface BuiltFileTree {
  data: Array<INode<FileTreeMeta>>
  fileToId: Map<string, NodeId>
  parentIdsByFile: Map<string, NodeId[]>
}

const ROOT_ID = '__root__'

function normalizeRepoPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\/+/, '')
}

function dirId(path: string): string {
  return `dir:${path}`
}

function fileId(path: string): string {
  return `file:${path}`
}

function sortTreeChildren(nodes: Array<INode<FileTreeMeta>>): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    node.children.sort((a, b) => {
      const left = byId.get(a)
      const right = byId.get(b)
      if (!left || !right) return String(a).localeCompare(String(b))
      if (left.metadata?.kind !== right.metadata?.kind) {
        return left.metadata?.kind === 'directory' ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  }
}

function buildFileTree(files: string[]): BuiltFileTree {
  const nodes = new Map<NodeId, INode<FileTreeMeta>>()
  const fileToId = new Map<string, NodeId>()
  const parentIdsByFile = new Map<string, NodeId[]>()

  nodes.set(ROOT_ID, {
    id: ROOT_ID,
    name: '',
    parent: null,
    children: [],
    metadata: { kind: 'root', path: '' },
  })

  const ensureDirectory = (path: string, parent: NodeId, name: string): NodeId => {
    const id = dirId(path)
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        name,
        parent,
        children: [],
        metadata: { kind: 'directory', path },
      })
      nodes.get(parent)?.children.push(id)
    }
    return id
  }

  for (const rawFile of files) {
    const file = normalizeRepoPath(rawFile)
    if (!file) continue

    const parts = file.split('/').filter(Boolean)
    let parent: NodeId = ROOT_ID
    let currentPath = ''
    const parentIds: NodeId[] = []

    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      parent = ensureDirectory(currentPath, parent, part)
      parentIds.push(parent)
    }

    const id = fileId(file)
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        name: parts[parts.length - 1] ?? file,
        parent,
        children: [],
        metadata: { kind: 'file', path: file },
      })
      nodes.get(parent)?.children.push(id)
    }
    fileToId.set(file, id)
    parentIdsByFile.set(file, parentIds)
  }

  const data = Array.from(nodes.values())
  sortTreeChildren(data)
  return { data, fileToId, parentIdsByFile }
}

function escapeFileSelector(value: string): string {
  return window.CSS?.escape(value) ?? value.replace(/["\\]/g, '\\$&')
}

function langOf(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'txt'
}

// 一次会话内已上报 file-read 的文件,避免重复 POST
const readReported = new Set<string>()

/** 把 shiki 输出按行拆出 innerHTML 列表(每行一个 .line span 的内容) */
function splitLines(html: string): string[] {
  const m = html.match(/<code[^>]*>([\s\S]*?)<\/code>/)
  const inner = m ? m[1] : html
  const lines: string[] = []
  const re = /<span class="line"[^>]*>([\s\S]*?)<\/span>(?:\n|$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(inner)) !== null) {
    lines.push(match[1])
  }
  // 末尾可能有不带换行的空行被吞掉,做个兜底
  if (lines.length === 0) lines.push('')
  return lines
}

export function CodeBrowser({
  projectId,
  files,
  onLineClick,
  highlightRef,
  activeFile,
  onSelectFile,
  railWidth,
  onDragRail,
}: CodeBrowserProps): JSX.Element {
  const setProgress = useStore((s) => s.setProgress)

  const treeFiles = useStore((s) => s.tree)
  const setTree = useStore((s) => s.setTree)

  const [internalFile, setInternalFile] = useState<string | null>(null)
  const currentFile = activeFile ?? internalFile

  const [lines, setLines] = useState<string[]>([])
  const [loadingCode, setLoadingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<NodeId[]>([])

  const levelFiles = useMemo(() => files.filter(Boolean), [files])
  const levelFileSet = useMemo(
    () => new Set(levelFiles.map(normalizeRepoPath)),
    [levelFiles],
  )
  const allFiles = useMemo(
    () => (treeFiles ?? []).map(normalizeRepoPath).filter(Boolean),
    [treeFiles],
  )
  const fileTree = useMemo(() => buildFileTree(allFiles), [allFiles])
  const selectedTreeId = currentFile
    ? fileTree.fileToId.get(normalizeRepoPath(currentFile))
    : undefined

  const codeAreaRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)

  // 拉取整个文件树(用于「其他文件」)
  useEffect(() => {
    if (treeFiles) return
    let cancelled = false
    api
      .getTree(projectId)
      .then((list) => {
        if (!cancelled) setTree(list)
      })
      .catch(() => {
        if (!cancelled) setTree([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, treeFiles, setTree])

  // 默认打开第一个本关文件
  useEffect(() => {
    if (activeFile === undefined && internalFile === null && levelFiles[0]) {
      setInternalFile(levelFiles[0])
    }
  }, [activeFile, internalFile, levelFiles])

  // 加载并高亮当前文件
  useEffect(() => {
    if (!currentFile) {
      setLines([])
      return
    }
    let cancelled = false
    setLoadingCode(true)
    setCodeError(null)
    ;(async () => {
      try {
        const content = await api.getFile(projectId, currentFile)
        const html = await codeToHtml(content, {
          lang: langOf(currentFile),
          theme: 'github-dark',
        })
        if (!cancelled) setLines(splitLines(html))
      } catch (err) {
        if (!cancelled) {
          setCodeError(err instanceof Error ? err.message : '文件加载失败')
          setLines([])
        }
      } finally {
        if (!cancelled) setLoadingCode(false)
      }
      // fire-and-forget 上报已读(去重)
      if (!readReported.has(currentFile)) {
        readReported.add(currentFile)
        api
          .markFileRead(projectId, currentFile)
          .then((progress) => setProgress(progress))
          .catch(() => readReported.delete(currentFile))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, currentFile, setProgress])

  // highlightRef 命中当前文件 → 滚动定位 + 高亮行范围
  useEffect(() => {
    if (!highlightRef || highlightRef.file !== currentFile) return
    const el = codeAreaRef.current
    if (!el) return
    const target = el.querySelector<HTMLElement>(
      `[data-line="${highlightRef.startLine}"]`,
    )
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightRef, currentFile, lines])

  function openFile(file: string): void {
    if (activeFile === undefined) setInternalFile(file)
    else onSelectFile?.(file)
  }

  function revealInTree(file: string): void {
    const normalized = normalizeRepoPath(file)
    const parentIds = fileTree.parentIdsByFile.get(normalized) ?? []
    if (parentIds.length > 0) {
      setExpandedIds((prev) => Array.from(new Set([...prev, ...parentIds])))
    }
    window.requestAnimationFrame(() => {
      const selector = `[data-tree-file="${escapeFileSelector(normalized)}"]`
      railRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({
        block: 'nearest',
      })
    })
  }

  function selectFile(file: string): void {
    openFile(file)
    revealInTree(file)
  }

  const inHighlight = (line: number): boolean =>
    !!highlightRef &&
    highlightRef.file === currentFile &&
    line >= highlightRef.startLine &&
    line <= highlightRef.endLine

  useEffect(() => {
    if (currentFile) revealInTree(currentFile)
    // fileTree changes when the async full repo tree arrives; keep the current file visible then.
  }, [currentFile, fileTree])

  return (
    <div
      className="cb"
      style={
        onDragRail
          ? { gridTemplateColumns: `${railWidth ?? 180}px 6px 1fr` }
          : undefined
      }
    >
      <aside className="cb-rail" ref={railRef}>
        <p className="cb-rail-title">本关文件</p>
        <ul className="cb-file-list">
          {levelFiles.map((f) => (
            <li key={f}>
              <button
                type="button"
                className={`cb-file ${f === currentFile ? 'cb-file--active' : ''}`}
                onClick={() => selectFile(f)}
                title={f}
              >
                <span className="cb-file-star">★</span>
                <span className="cb-file-name">{f}</span>
              </button>
            </li>
          ))}
          {levelFiles.length === 0 && <li className="cb-file-empty">(无)</li>}
        </ul>

        <p className="cb-rail-title cb-rail-title--all">全部文件 ({allFiles.length})</p>
        {allFiles.length === 0 ? (
          <p className="cb-file-empty">
            {treeFiles ? '(无)' : '加载文件树中…'}
          </p>
        ) : (
          <TreeView
            data={fileTree.data}
            className="cb-tree"
            expandedIds={expandedIds}
            selectedIds={selectedTreeId ? [selectedTreeId] : []}
            onExpand={({ element, isExpanded }) => {
              setExpandedIds((prev) => {
                const next = new Set(prev)
                if (isExpanded) next.add(element.id)
                else next.delete(element.id)
                return Array.from(next)
              })
            }}
            nodeRenderer={({
              element,
              getNodeProps,
              handleExpand,
              isBranch,
              isExpanded,
              level,
            }) => {
              const path = element.metadata?.path ?? ''
              const isFile = element.metadata?.kind === 'file'
              const isLevelFile = isFile && levelFileSet.has(path)
              const isActive = isFile && path === normalizeRepoPath(currentFile ?? '')
              const nodeProps = getNodeProps({
                onClick: (event) => {
                  if (isBranch) handleExpand(event)
                  else if (isFile) selectFile(path)
                },
              })

              return (
                <div
                  {...nodeProps}
                  className={`cb-tree-node ${isBranch ? 'cb-tree-node--branch' : 'cb-tree-node--file'} ${
                    isLevelFile ? 'cb-tree-node--level-file' : ''
                  } ${isActive ? 'cb-tree-node--active' : ''}`}
                  data-tree-file={isFile ? path : undefined}
                  title={isFile ? path : undefined}
                  style={{ paddingLeft: `${Math.max(level - 1, 0) * 12 + 4}px` }}
                >
                  <span className="cb-tree-icon">
                    {isBranch ? (isExpanded ? '▾' : '▸') : isLevelFile ? '★' : '•'}
                  </span>
                  <span className="cb-tree-name">{element.name}</span>
                </div>
              )
            }}
          />
        )}
      </aside>

      {onDragRail && <SplitHandle onDrag={onDragRail} />}

      <div className="cb-code code-font" ref={codeAreaRef}>
        {!currentFile && <p className="cb-placeholder">选择左侧文件查看源码</p>}
        {currentFile && loadingCode && <p className="cb-placeholder">加载中…</p>}
        {currentFile && codeError && <p className="cb-error">{codeError}</p>}
        {currentFile && !loadingCode && !codeError && (
          <div className="cb-lines">
            {lines.map((html, i) => {
              const line = i + 1
              return (
                <div
                  key={line}
                  data-line={line}
                  className={`cb-line ${inHighlight(line) ? 'line-highlight' : ''} ${
                    onLineClick ? 'cb-line--clickable' : ''
                  }`}
                  onClick={onLineClick ? () => onLineClick(currentFile, line) : undefined}
                >
                  <span className="cb-ln">{line}</span>
                  <span className="cb-lc" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
