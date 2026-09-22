import { useEffect } from 'react';

import { Capture } from './screens/Capture.js';
import { Game } from './screens/Game.js';
import { History } from './screens/History.js';
import { Setup } from './screens/Setup.js';
import { setLocale } from './i18n/index.js';
import { useMatchStore } from './store/match.js';

export function App() {
  const ready = useMatchStore((s) => s.ready);
  const screen = useMatchStore((s) => s.screen);
  const locale = useMatchStore((s) => s.settings.locale);
  const init = useMatchStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  if (!ready) return <div className="screen" />;

  if (screen === 'game') return <Game />;
  if (screen === 'history') return <History />;
  if (screen === 'capture') return <Capture />;
  return <Setup />;
}
