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
  muted: boolean
  crt: boolean

  setScreen: (screen: Screen) => void
  setProject: (id: string, name: string) => void
  setCourse: (course: Course | null) => void
  setProgress: (progress: Progress) => void
  openLevel: (levelId: string) => void
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
  muted: false,
  crt: true,

  setScreen: (screen) => set({ screen }),
  setProject: (id, name) => set({ projectId: id, projectName: name }),
  setCourse: (course) => set({ course }),
  setProgress: (progress) => set({ progress }),
  openLevel: (levelId) => set({ currentLevelId: levelId, screen: 'level' }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  toggleCrt: () => set((s) => ({ crt: !s.crt })),
}))
