import { Routes, Route } from 'react-router-dom';
import RefereeLayout from './components/RefereeLayout';
import RefereeLogin from './pages/RefereeLogin';
import RefereeHome from './pages/RefereeHome';
import IndividualScoring from './pages/IndividualScoring';
import TeamMatchScoring from './pages/TeamMatchScoring';

export default function RefereeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RefereeLogin />} />
      <Route element={<RefereeLayout />}>
        <Route path="/games" element={<RefereeHome />} />
        <Route path="/match/:tournamentId/:matchId" element={<IndividualScoring />} />
        <Route path="/team/:tournamentId/:matchId" element={<TeamMatchScoring />} />
      </Route>
    </Routes>
  );
}
