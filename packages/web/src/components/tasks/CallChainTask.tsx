import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { judgeCallChain, type Task } from '@sourcerealm/shared'

type CallChainTask = Extract<Task, { type: 'call-chain' }>

interface CallChainTaskProps {
  task: CallChainTask
  onAnswer: (correct: boolean) => void
}

/** 确定性洗牌:用 task.id 字符做种子,保证同一题每次进入顺序一致 */
function seededOrder(task: CallChainTask): number[] {
  let seed = 0
  for (const c of task.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
  const idx = task.items.map((_, i) => i)
  // Fisher-Yates,用线性同余发生器产生伪随机数
  for (let i = idx.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  // 永不与正确顺序意外相同:相同则整体旋转一位
  if (judgeCallChain(task.order, idx)) {
    idx.push(idx.shift() as number)
  }
  return idx
}

export function CallChainTask({ task, onAnswer }: CallChainTaskProps): JSX.Element {
  // cards 保存的是原始 item 下标的当前排列
  const initial = useMemo(() => seededOrder(task), [task])
  const [cards, setCards] = useState<number[]>(initial)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setCards((prev) => {
      const from = prev.indexOf(Number(active.id))
      const to = prev.indexOf(Number(over.id))
      if (from === -1 || to === -1) return prev
      return arrayMove(prev, from, to)
    })
  }

  function submit(): void {
    onAnswer(judgeCallChain(task.order, cards))
  }

  return (
    <div className="tp-task cc">
      <p className="tp-instruction">拖动卡片,排出正确的调用 / 执行顺序。</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards} strategy={verticalListSortingStrategy}>
          <ol className="cc-list">
            {cards.map((itemIndex, pos) => (
              <SortableCard
                key={itemIndex}
                id={itemIndex}
                position={pos + 1}
                item={task.items[itemIndex]}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" className="nes-btn is-primary" onClick={submit}>
        提交顺序
      </button>
    </div>
  )
}

function SortableCard({
  id,
  position,
  item,
}: {
  id: number
  position: number
  item: CallChainTask['items'][number]
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`cc-card ${isDragging ? 'cc-card--dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <span className="cc-handle" aria-hidden="true">
        ⠿
      </span>
      <span className="cc-pos">{position}</span>
      <span className="cc-label">
        {item.label}
        {item.ref && (
          <span className="cc-ref code-font">
            {item.ref.file}:{item.ref.startLine}
          </span>
        )}
      </span>
    </li>
  )
}
