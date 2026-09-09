import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { RepoFilterProvider } from './context/RepoFilterContext';
import AppShell from './layout/AppShell';
import Overview from './pages/Overview';
import TicketPipeline from './pages/TicketPipeline';
import StagingSandbox from './pages/StagingSandbox';
import EventLog from './pages/EventLog';
import RulesPolling from './pages/RulesPolling';
import Repositories from './pages/Repositories';
import Untracked from './pages/Untracked';

function Shell() {
  return (
    <AppProvider>
      <RepoFilterProvider>
        <AppShell />
      </RepoFilterProvider>
    </AppProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Overview />} />
            <Route path="/pipeline" element={<TicketPipeline />} />
            <Route path="/staging" element={<StagingSandbox />} />
            <Route path="/log" element={<EventLog />} />
            <Route path="/untracked" element={<Untracked />} />
            <Route path="/settings" element={<RulesPolling />} />
            <Route path="/repos" element={<Repositories />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
