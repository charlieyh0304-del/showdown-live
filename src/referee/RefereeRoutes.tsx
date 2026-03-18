import { Routes, Route } from 'react-router-dom';
import RefereeLayout from './components/RefereeLayout';
import PracticeLayout from './components/PracticeLayout';
import RefereeLogin from './pages/RefereeLogin';
import RefereeHome from './pages/RefereeHome';
import IndividualScoring from './pages/IndividualScoring';
import TeamMatchScoring from './pages/TeamMatchScoring';
import PracticeHome from './pages/practice/PracticeHome';
import PracticeSetup from './pages/practice/PracticeSetup';
import PracticeScoring from './pages/practice/PracticeScoring';

export default function RefereeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RefereeLogin />} />
      <Route element={<RefereeLayout />}>
        <Route path="/games" element={<RefereeHome />} />
        <Route path="/match/:tournamentId/:matchId" element={<IndividualScoring />} />
        <Route path="/team/:tournamentId/:matchId" element={<TeamMatchScoring />} />
      </Route>
      <Route path="/practice" element={<PracticeLayout />}>
        <Route index element={<PracticeHome />} />
        <Route path="setup" element={<PracticeSetup />} />
        <Route path="play" element={<PracticeScoring />} />
      </Route>
    </Routes>
  );
}
