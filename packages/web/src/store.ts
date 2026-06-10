import { create } from 'zustand'
import { emptyProgress, type Course, type Progress } from '@code-quest/shared'

export type Screen = 'home' | 'generating' | 'map' | 'level' | 'badges' | 'cert'

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

  setScreen: (screen: Screen) => void
  setUpdateBaseline: (anchor: string | null) => void
  setProject: (id: string, name: string) => void
  setCourse: (course: Course | null) => void
  setProgress: (progress: Progress) => void
  openLevel: (levelId: string) => void
  setTree: (tree: string[]) => void
  toggleMuted: () => void
  toggleCrt: () => void
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

  setScreen: (screen) => set({ screen }),
  setUpdateBaseline: (anchor) => set({ updateBaseline: anchor }),
  setProject: (id, name) => set({ projectId: id, projectName: name, tree: null }),
  setCourse: (course) => set({ course }),
  setProgress: (progress) => set({ progress }),
  openLevel: (levelId) => set({ currentLevelId: levelId, screen: 'level' }),
  setTree: (tree) => set({ tree }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  toggleCrt: () => set((s) => ({ crt: !s.crt })),
}))
