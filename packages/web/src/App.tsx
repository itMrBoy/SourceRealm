import { useStore } from './store.js'
import { Home } from './screens/Home.js'
import { Generating } from './screens/Generating.js'
import { MapScreen } from './screens/MapScreen.js'
import { LevelScreen } from './screens/LevelScreen.js'
import { BadgesScreen } from './screens/BadgesScreen.js'
import { CertScreen } from './screens/CertScreen.js'
import { ToastContainer } from './components/Toast.js'
import { ConfirmDialog } from './components/ConfirmDialog.js'

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
      content = <BadgesScreen />
      break
    case 'cert':
      content = <CertScreen />
      break
  }

  return (
    <div className={crt ? 'crt' : ''}>
      {content}
      <ConfirmDialog />
      <ToastContainer />
    </div>
  )
}
