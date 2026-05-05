import { useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { BackgroundBlobs } from './components/BackgroundBlobs';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ThemePanel } from './components/ThemePanel';
import { NotificationPanel } from './components/NotificationPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { IconButton } from './components/IconButton';
import { Dashboard } from './pages/Dashboard';
import { Monitor } from './pages/Monitor';
import { AutoReply } from './pages/AutoReply';
import { AI } from './pages/AI';
import { Stats } from './pages/Stats';
import { PK } from './pages/PK';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

  return (
    <ThemeProvider>
      <BrowserRouter>
        <div
          className="w-full h-screen overflow-hidden flex relative"
          style={{
            background: 'var(--background)',
          }}
        >
          <BackgroundBlobs />

          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleThemePanel={() => setThemePanelOpen(!themePanelOpen)}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onToggleSettings={() => setSettingsPanelOpen(!settingsPanelOpen)}
          />

          <div className="flex-1 flex flex-col overflow-hidden relative">
            {sidebarCollapsed && (
              <div className="absolute left-4 top-4 z-10">
                <IconButton onClick={() => setSidebarCollapsed(false)}>
                  <ChevronRight className="w-4 h-4" />
                </IconButton>
              </div>
            )}

            <TopBar
              onToggleNotifications={() => setNotificationPanelOpen(!notificationPanelOpen)}
              sidebarCollapsed={sidebarCollapsed}
            />

            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/auto-reply" element={<AutoReply />} />
                <Route path="/ai" element={<AI />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/pk" element={<PK />} />
              </Routes>
            </main>
          </div>

          {themePanelOpen && (
            <ThemePanel onClose={() => setThemePanelOpen(false)} />
          )}

          {notificationPanelOpen && (
            <NotificationPanel onClose={() => setNotificationPanelOpen(false)} />
          )}

          {settingsPanelOpen && (
            <SettingsPanel onClose={() => setSettingsPanelOpen(false)} />
          )}
        </div>
      </BrowserRouter>
    </ThemeProvider>
  );
}