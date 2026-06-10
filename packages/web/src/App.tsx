import { useStore } from './store.js'
import { Home } from './screens/Home.js'
import { Generating } from './screens/Generating.js'
import { MapScreen } from './screens/MapScreen.js'
import { LevelScreen } from './screens/LevelScreen.js'

function ScreenPlaceholder({ label }: { label: string }) {
  return <section className="nes-container is-dark with-title">{label}</section>
}

export function App() {
  const screen = useStore((s) => s.screen)
  const crt = useStore((s) => s.crt)

  let content: JSX.Element
  switch (screen) {
    case 'home':
      content = <Home />
      break
    case 'generating':
      content = <Generating />
      break
    case 'map':
      content = <MapScreen />
      break
    case 'level':
      content = <LevelScreen />
      break
    case 'badges':
      content = <ScreenPlaceholder label="CodeQuest — badges (W6 待实现)" />
      break
    case 'cert':
      content = <ScreenPlaceholder label="CodeQuest — cert (W6 待实现)" />
      break
  }

  return <div className={crt ? 'crt' : ''}>{content}</div>
}
