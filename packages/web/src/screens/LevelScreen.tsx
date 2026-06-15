import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { judgeTreasureHunt, type Task } from '@sourcerealm/shared'
import * as api from '../api.js'
import { useStore } from '../store.js'
import { useRun } from '../game/run.js'
import { CodeBrowser, type HighlightRef } from '../components/CodeBrowser.js'
import { TaskPanel } from '../components/TaskPanel.js'
import { SettlementModal } from '../components/SettlementModal.js'
import { SplitHandle } from '../components/SplitHandle.js'

/** 当前任务涉及的首个 ref 文件(用于自动打开代码浏览器) */
function firstRefFile(task: Task | undefined): string | null {
  if (!task) return null
  if (task.type === 'quiz') return task.refs[0]?.file ?? null
  if (task.type === 'treasure-hunt') return task.target.file
  if (task.type === 'code-fill' || task.type === 'code-type') return task.ref.file
  if (task.type === 'call-chain') {
    for (const it of task.items) if (it.ref) return it.ref.file
  }
  return null
}

export function LevelScreen(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const levelId = useStore((s) => s.currentLevelId)
  const setScreen = useStore((s) => s.setScreen)
  const showConfirm = useStore((s) => s.showConfirm)
  const pushToast = useStore((s) => s.pushToast)

  const setCourse = useStore((s) => s.setCourse)
  const setProgress = useStore((s) => s.setProgress)
  const course = useStore((s) => s.course)

  const level = useRun((s) => s.level)
  const freshness = useRun((s) => s.freshness)
  const taskIndex = useRun((s) => s.taskIndex)
  const phase = useRun((s) => s.phase)
  const error = useRun((s) => s.error)
  const settlement = useRun((s) => s.settlement)
  const loadLevel = useRun((s) => s.loadLevel)
  const answer = useRun((s) => s.answer)
  const finishLevel = useRun((s) => s.finishLevel)
  const retryLevel = useRun((s) => s.retryLevel)
  const reset = useRun((s) => s.reset)
  const snapshot = useRun((s) => s.snapshot)

  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [highlightRef, setHighlightRef] = useState<HighlightRef | null>(null)
  // 寻宝任务当前题答错次数(每题重置)
  const [treasureWrong, setTreasureWrong] = useState(0)

  // 三栏宽度:文件栏(px)与左侧整体占比(%),可拖拽调整
  const gridRef = useRef<HTMLDivElement>(null)
  const [railWidth, setRailWidth] = useState(180)
  const [leftPercent, setLeftPercent] = useState(55)

  const onDragRail = useCallback((clientX: number) => {
    const grid = gridRef.current
    if (!grid) return
    const x = clientX - grid.getBoundingClientRect().left
    setRailWidth(Math.min(Math.max(x, 120), 400))
  }, [])

  const onDragMain = useCallback((clientX: number) => {
    const grid = gridRef.current
    if (!grid) return
    const rect = grid.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setLeftPercent(Math.min(Math.max(pct, 25), 80))
  }, [])

  // 挂载:先刷新项目进度,再加载关卡,避免保存后重新进入时使用旧 store。
  useEffect(() => {
    if (!projectId || !levelId) return () => reset()
    let alive = true
    void (async () => {
      try {
        const { course: c, progress } = await api.getProject(projectId)
        if (!alive) return
        setCourse(c)
        setProgress(progress)
      } catch {
        if (alive) pushToast('warning', '读取最新进度失败，将尝试使用本地已有进度进入关卡')
      }
      if (alive) void loadLevel(projectId, levelId)
    })()
    return () => {
      alive = false
      reset()
    }
  }, [projectId, levelId, loadLevel, pushToast, reset, setCourse, setProgress])

  const task: Task | undefined = level?.tasks[taskIndex]
  const taskCount = level?.tasks.length ?? 0
  const stale = task ? freshness[task.id] === false : false

  // 切题:自动打开首个 ref 文件,重置寻宝错误计数与高亮
  useEffect(() => {
    const file = firstRefFile(task)
    if (file) setActiveFile(file)
    setTreasureWrong(0)
    setHighlightRef(null)
  }, [task])

  // 全部任务完成 → 自动结算(提交进度一次)
  useEffect(() => {
    if (phase === 'level-done' && projectId) void finishLevel(projectId)
  }, [phase, projectId, finishLevel])

  // 页面关闭/刷新时尽量保存断点;显式退出保存仍是可靠路径
  useEffect(() => {
    if (!projectId) return
    const persist = () => {
      const run = snapshot()
      if (run) api.saveLevelRunBestEffort(projectId, run)
    }
    window.addEventListener('pagehide', persist)
    window.addEventListener('beforeunload', persist)
    return () => {
      window.removeEventListener('pagehide', persist)
      window.removeEventListener('beforeunload', persist)
    }
  }, [projectId, snapshot])

  const backToMap = useCallback(() => {
    setScreen('map')
  }, [setScreen])

  // 结算后返回地图:刷新项目以拿到最新 course/progress
  const settleBackToMap = useCallback(async () => {
    if (projectId) {
      try {
        const { course: c, progress } = await api.getProject(projectId)
        setCourse(c)
        setProgress(progress)
      } catch {
        // 刷新失败也返回地图(进度已在结算时入 store)
      }
    }
    setScreen('map')
  }, [projectId, setCourse, setProgress, setScreen])

  // 章节标题映射(供结算徽章文案使用)
  const chapterTitles = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of course?.chapters ?? []) map[ch.id] = ch.title
    return map
  }, [course])

  const leaveLevel = useCallback((target: 'map' | 'home') => {
    const run = snapshot()
    if (projectId && run) {
      showConfirm({
        title: '退出关卡',
        message: '关卡尚未完成。你可以保存断点后离开,也可以放弃本次关卡进度。',
        confirmText: '保存离开',
        secondaryText: '放弃进度',
        cancelText: '继续闯关',
        variant: 'warning',
        secondaryVariant: 'danger',
        onConfirm: () => {
          void api
            .saveLevelRun(projectId, run)
            .then((progress) => {
              setProgress(progress)
              pushToast('success', `已保存到第 ${run.taskIndex + 1} 题`)
              setScreen(target)
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : '保存进度失败'
              const hint =
                message === '未找到'
                  ? '保存接口未找到，请重启后端服务后再试'
                  : message
              pushToast('error', `保存进度失败：${hint}`)
            })
        },
        onSecondary: () => {
          void api
            .discardLevelRun(projectId, run.levelId)
            .then((progress) => {
              setProgress(progress)
              setScreen(target)
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : '放弃进度失败'
              pushToast('error', `放弃进度失败：${message}`)
            })
        },
      })
      return
    }
    setScreen(target)
  }, [projectId, pushToast, setProgress, setScreen, showConfirm, snapshot])

  const onAnswer = useCallback(
    (correct: boolean, _task: Task) => {
      if (!_task) return
      answer(correct, _task.type)
    },
    [answer],
  )

  // 寻宝:浏览器行点击 → 判定
  const onLineClick = useCallback(
    (file: string, line: number) => {
      if (!task || task.type !== 'treasure-hunt') return
      if (phase !== 'answering') return
      const correct = judgeTreasureHunt(task.target, { file, line })
      if (!correct) setTreasureWrong((n) => n + 1)
      answer(correct, 'treasure-hunt')
    },
    [task, phase, answer],
  )

  // 寻宝重试本题时重置高亮(保留错误计数以便逐步给提示)
  const onGuideMe = useCallback(() => {
    if (!task || task.type !== 'treasure-hunt') return
    const t = task.target
    setActiveFile(t.file)
    setHighlightRef({
      file: t.file,
      startLine: Math.max(1, t.startLine - 20),
      endLine: t.endLine + 20,
    })
  }, [task])

  const isTreasure = task?.type === 'treasure-hunt'
  const lineClickHandler = useMemo(
    () => (isTreasure ? onLineClick : undefined),
    [isTreasure, onLineClick],
  )

  if (!projectId || !levelId) {
    return (
      <div className="level">
        <p className="level-msg">未选择关卡。</p>
        <button type="button" className="nes-btn" onClick={backToMap}>
          返回地图
        </button>
      </div>
    )
  }

  return (
    <div className="level">
      <div className="level-bar">
        <span className="level-bar-title" title={level?.title ?? ''}>
          {phase === 'loading' ? '加载中…' : (level?.title ?? '关卡')}
        </span>
        <button type="button" className="nes-btn level-exit" onClick={() => leaveLevel('map')}>
          退出
        </button>
        <button type="button" className="nes-btn level-exit" onClick={() => leaveLevel('home')}>
          主菜单
        </button>
      </div>

      {phase === 'loading' && <p className="level-msg blink">关卡加载中…</p>}

      {phase === 'failed' && error && (
        <div className="level-msg level-error">
          <p>{error}</p>
          <button type="button" className="nes-btn" onClick={backToMap}>
            返回地图
          </button>
        </div>
      )}

      {level && phase !== 'loading' && !(phase === 'failed' && error) && (
        <div
          className="level-grid"
          ref={gridRef}
          style={{ gridTemplateColumns: `${leftPercent}% 6px 1fr` }}
        >
          <div className="level-left">
            <CodeBrowser
              projectId={projectId}
              files={level.files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              onLineClick={lineClickHandler}
              highlightRef={highlightRef}
              railWidth={railWidth}
              onDragRail={onDragRail}
            />
          </div>
          <SplitHandle onDrag={onDragMain} />
          <div className="level-right">
            {task && (
              <TaskPanel
                task={task}
                taskIndex={taskIndex}
                taskCount={taskCount}
                stale={stale}
                onAnswer={onAnswer}
                onBackToMap={backToMap}
                treasureWrongCount={treasureWrong}
                onGuideMe={onGuideMe}
              />
            )}
          </div>
        </div>
      )}

      {phase === 'settled' && settlement && (
        <SettlementModal
          settlement={settlement}
          chapterTitles={chapterTitles}
          onBackToMap={() => void settleBackToMap()}
          onRetry={retryLevel}
        />
      )}
    </div>
  )
}
