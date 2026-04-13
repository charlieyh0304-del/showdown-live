import { Routes, Route, Navigate } from 'react-router-dom';
import RefereeLayout from './components/RefereeLayout';
import PracticeLayout from './components/PracticeLayout';
import { SectionErrorBoundary } from '@shared/components/ErrorBoundary';
import RefereeLogin from './pages/RefereeLogin';
import RefereeHome from './pages/RefereeHome';
import IndividualScoring from './pages/IndividualScoring';
import TeamMatchScoring from './pages/TeamMatchScoring';
import PracticeHome from './pages/practice/PracticeHome';
import PracticeSetup from './pages/practice/PracticeSetup';
import PracticeScoring from './pages/practice/PracticeScoring';
import PracticeHistory from './pages/practice/PracticeHistory';

export default function RefereeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SectionErrorBoundary><RefereeLogin /></SectionErrorBoundary>} />
      <Route element={<RefereeLayout />}>
        <Route path="/games" element={<SectionErrorBoundary><RefereeHome /></SectionErrorBoundary>} />
        <Route path="/match/:tournamentId/:matchId" element={<SectionErrorBoundary><IndividualScoring /></SectionErrorBoundary>} />
        <Route path="/team/:tournamentId/:matchId" element={<SectionErrorBoundary><TeamMatchScoring /></SectionErrorBoundary>} />
      </Route>
      <Route path="/practice" element={<PracticeLayout />}>
        <Route index element={<SectionErrorBoundary><PracticeHome /></SectionErrorBoundary>} />
        <Route path="setup" element={<SectionErrorBoundary><PracticeSetup /></SectionErrorBoundary>} />
        <Route path="play" element={<SectionErrorBoundary><PracticeScoring /></SectionErrorBoundary>} />
        <Route path="history" element={<SectionErrorBoundary><PracticeHistory /></SectionErrorBoundary>} />
      </Route>
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}
