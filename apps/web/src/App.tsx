import { useEffect } from 'react';

import { Capture } from './screens/Capture.js';
import { CameraRole } from './screens/CameraRole.js';
import { Game } from './screens/Game.js';
import { History } from './screens/History.js';
import { Landing } from './screens/Landing.js';
import { ModeChoice } from './screens/ModeChoice.js';
import { PairHub } from './screens/PairHub.js';
import { RoleChoice } from './screens/RoleChoice.js';
import { Setup } from './screens/Setup.js';
import { Stats } from './screens/Stats.js';
import { setLocale } from './i18n/index.js';
import { hashForScreen, screenFromHash } from './route.js';
import { useMatchStore } from './store/match.js';

export function App() {
  const ready = useMatchStore((s) => s.ready);
  const screen = useMatchStore((s) => s.screen);
  const locale = useMatchStore((s) => s.settings.locale);
  const init = useMatchStore((s) => s.init);

  useEffect(() => {
    // The address decides where a reload lands; without one, the landing page.
    void init(screenFromHash(location.hash) ?? undefined);
  }, [init]);

  // Back and forward move between screens rather than out of the app.
  useEffect(() => {
    const onPopState = () => {
      const target = screenFromHash(location.hash);
      if (target) useMatchStore.setState({ screen: target });
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const hash = hashForScreen(screen);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }, [ready, screen]);

  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  if (!ready) return <div className="screen" />;

  switch (screen) {
    case 'landing':
      return <Landing />;
    case 'mode':
      return <ModeChoice />;
    case 'pairRole':
      return <RoleChoice />;
    case 'pair':
      return <PairHub />;
    case 'camera':
      return <CameraRole />;
    case 'game':
      return <Game />;
    case 'history':
      return <History />;
    case 'capture':
      return <Capture />;
    case 'stats':
      return <Stats />;
    default:
      return <Setup />;
  }
}
