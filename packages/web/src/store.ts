import { create } from 'zustand'
import { emptyProgress, type Course, type Progress } from '@sourcerealm/shared'

export type Screen = 'home' | 'generating' | 'map' | 'level' | 'badges' | 'cert'

export type ToastType = 'info' | 'success' | 'warning' | 'error'
export interface Toast {
  id: number
  type: ToastType
  text: string
}

export type ConfirmVariant = 'warning' | 'danger'
export interface ConfirmDialogState {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
  onConfirm: () => void
}

/** toast 自动消失时长(ms);error 停留更久 */
const TOAST_TTL: Record<ToastType, number> = { info: 4000, success: 4000, warning: 6000, error: 8000 }
let toastSeq = 0

interface GameState {
  screen: Screen
  projectId: string | null
  projectName: string
  course: Course | null
  progress: Progress
  currentLevelId: string | null
  tree: string[] | null
  muted: boolean
  crt: boolean
  updateBaseline: string | null
  toasts: Toast[]
  confirmDialog: ConfirmDialogState | null

  setScreen: (screen: Screen) => void
  setUpdateBaseline: (anchor: string | null) => void
  setProject: (id: string, name: string) => void
  setCourse: (course: Course | null) => void
  setProgress: (progress: Progress) => void
  openLevel: (levelId: string) => void
  setTree: (tree: string[]) => void
  toggleMuted: () => void
  toggleCrt: () => void
  pushToast: (type: ToastType, text: string) => void
  dismissToast: (id: number) => void
  showConfirm: (dialog: ConfirmDialogState) => void
  hideConfirm: () => void
}

export const useStore = create<GameState>((set) => ({
  screen: 'home',
  projectId: null,
  projectName: '',
  course: null,
  progress: emptyProgress(),
  currentLevelId: null,
  tree: null,
  muted: false,
  crt: true,
  updateBaseline: null,
  toasts: [],
  confirmDialog: null,

  setScreen: (screen) => set({ screen }),
  setUpdateBaseline: (anchor) => set({ updateBaseline: anchor }),
  setProject: (id, name) => set({ projectId: id, projectName: name, tree: null }),
  setCourse: (course) => set({ course }),
  setProgress: (progress) => set({ progress }),
  openLevel: (levelId) => set({ currentLevelId: levelId, screen: 'level' }),
  setTree: (tree) => set({ tree }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  toggleCrt: () => set((s) => ({ crt: !s.crt })),
  pushToast: (type, text) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, type, text }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_TTL[type])
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showConfirm: (dialog) => set({ confirmDialog: dialog }),
  hideConfirm: () => set({ confirmDialog: null }),
}))
