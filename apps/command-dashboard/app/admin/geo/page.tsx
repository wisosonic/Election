'use client';

import { useEffect, useState, FormEvent } from 'react';
import { RouteGuard } from '../../../components/RouteGuard';
import { AppShell } from '../../../components/AppShell';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { inputClass, labelClass } from '../../../components/ui/form';
import { useAuth } from '../../../lib/auth-context';
import {
  GeoRow,
  createElection,
  createMohafazat,
  createQada,
  createVotingCenter,
  createRoom,
  listElections,
  listMohafazats,
  listQadas,
  listVotingCenters,
} from '../../../lib/api-client';

function GeoContent() {
  const { accessToken } = useAuth();
  const token = accessToken as string;

  const [elections, setElections] = useState<GeoRow[]>([]);
  const [mohafazats, setMohafazats] = useState<GeoRow[]>([]);
  const [qadas, setQadas] = useState<GeoRow[]>([]);
  const [centers, setCenters] = useState<GeoRow[]>([]);

  const [selectedElection, setSelectedElection] = useState('');
  const [selectedMohafazat, setSelectedMohafazat] = useState('');
  const [selectedQada, setSelectedQada] = useState('');
  const [selectedCenter, setSelectedCenter] = useState('');

  const [electionName, setElectionName] = useState('');
  const [electionDate, setElectionDate] = useState('');
  const [mohafazatName, setMohafazatName] = useState('');
  const [qadaName, setQadaName] = useState('');
  const [centerName, setCenterName] = useState('');
  const [roomLabel, setRoomLabel] = useState('');

  function refreshElections() {
    listElections(token)
      .then(setElections)
      .catch(() => setElections([]));
  }

  useEffect(refreshElections, [token]);

  useEffect(() => {
    if (!selectedElection) return setMohafazats([]);
    listMohafazats(token, selectedElection)
      .then(setMohafazats)
      .catch(() => setMohafazats([]));
  }, [token, selectedElection]);

  useEffect(() => {
    if (!selectedMohafazat) return setQadas([]);
    listQadas(token, selectedMohafazat)
      .then(setQadas)
      .catch(() => setQadas([]));
  }, [token, selectedMohafazat]);

  useEffect(() => {
    if (!selectedQada) return setCenters([]);
    listVotingCenters(token, selectedQada)
      .then(setCenters)
      .catch(() => setCenters([]));
  }, [token, selectedQada]);

  async function handleCreateElection(e: FormEvent) {
    e.preventDefault();
    await createElection(token, electionName, electionDate);
    setElectionName('');
    setElectionDate('');
    refreshElections();
  }

  async function handleCreateMohafazat(e: FormEvent) {
    e.preventDefault();
    if (!selectedElection) return;
    await createMohafazat(token, selectedElection, mohafazatName);
    setMohafazatName('');
    listMohafazats(token, selectedElection).then(setMohafazats);
  }

  async function handleCreateQada(e: FormEvent) {
    e.preventDefault();
    if (!selectedMohafazat) return;
    await createQada(token, selectedMohafazat, qadaName);
    setQadaName('');
    listQadas(token, selectedMohafazat).then(setQadas);
  }

  async function handleCreateCenter(e: FormEvent) {
    e.preventDefault();
    if (!selectedQada) return;
    await createVotingCenter(token, selectedQada, centerName);
    setCenterName('');
    listVotingCenters(token, selectedQada).then(setCenters);
  }

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!selectedCenter) return;
    await createRoom(token, selectedCenter, roomLabel);
    setRoomLabel('');
  }

  return (
    <AppShell>
      <PageHeader title="Election Setup" description="Build the mohafazat → qada → voting center → room hierarchy for this election." />

      <div className="space-y-6">
        <Card title="1. Election">
          <form onSubmit={handleCreateElection} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="electionName" className={labelClass}>
                Name
              </label>
              <input id="electionName" value={electionName} onChange={(e) => setElectionName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label htmlFor="electionDate" className={labelClass}>
                Date
              </label>
              <input
                id="electionDate"
                type="date"
                value={electionDate}
                onChange={(e) => setElectionDate(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <Button type="submit">Create</Button>
          </form>
          {elections.length > 0 && (
            <div className="mt-4">
              <label htmlFor="electionSelect" className={labelClass}>
                Select election
              </label>
              <select id="electionSelect" value={selectedElection} onChange={(e) => setSelectedElection(e.target.value)} className={inputClass}>
                <option value="">-- choose --</option>
                {elections.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.name ?? el.id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card>

        {selectedElection && (
          <Card title="2. Mohafazat">
            <form onSubmit={handleCreateMohafazat} className="grid gap-4 sm:grid-cols-[2fr_auto] sm:items-end">
              <div>
                <label htmlFor="mohafazatName" className={labelClass}>
                  Name
                </label>
                <input id="mohafazatName" value={mohafazatName} onChange={(e) => setMohafazatName(e.target.value)} required className={inputClass} />
              </div>
              <Button type="submit">Add</Button>
            </form>
            {mohafazats.length > 0 && (
              <div className="mt-4">
                <label htmlFor="mohafazatSelect" className={labelClass}>
                  Select mohafazat
                </label>
                <select
                  id="mohafazatSelect"
                  value={selectedMohafazat}
                  onChange={(e) => setSelectedMohafazat(e.target.value)}
                  className={inputClass}
                >
                  <option value="">-- choose --</option>
                  {mohafazats.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Card>
        )}

        {selectedMohafazat && (
          <Card title="3. Qada">
            <form onSubmit={handleCreateQada} className="grid gap-4 sm:grid-cols-[2fr_auto] sm:items-end">
              <div>
                <label htmlFor="qadaName" className={labelClass}>
                  Name
                </label>
                <input id="qadaName" value={qadaName} onChange={(e) => setQadaName(e.target.value)} required className={inputClass} />
              </div>
              <Button type="submit">Add</Button>
            </form>
            {qadas.length > 0 && (
              <div className="mt-4">
                <label htmlFor="qadaSelect" className={labelClass}>
                  Select qada
                </label>
                <select id="qadaSelect" value={selectedQada} onChange={(e) => setSelectedQada(e.target.value)} className={inputClass}>
                  <option value="">-- choose --</option>
                  {qadas.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name ?? q.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Card>
        )}

        {selectedQada && (
          <Card title="4. Voting center">
            <form onSubmit={handleCreateCenter} className="grid gap-4 sm:grid-cols-[2fr_auto] sm:items-end">
              <div>
                <label htmlFor="centerName" className={labelClass}>
                  Name (school)
                </label>
                <input id="centerName" value={centerName} onChange={(e) => setCenterName(e.target.value)} required className={inputClass} />
              </div>
              <Button type="submit">Add</Button>
            </form>
            {centers.length > 0 && (
              <div className="mt-4">
                <label htmlFor="centerSelect" className={labelClass}>
                  Select voting center
                </label>
                <select id="centerSelect" value={selectedCenter} onChange={(e) => setSelectedCenter(e.target.value)} className={inputClass}>
                  <option value="">-- choose --</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Card>
        )}

        {selectedCenter && (
          <Card title="5. Room (قلم)">
            <form onSubmit={handleCreateRoom} className="grid gap-4 sm:grid-cols-[2fr_auto] sm:items-end">
              <div>
                <label htmlFor="roomLabel" className={labelClass}>
                  Label
                </label>
                <input id="roomLabel" value={roomLabel} onChange={(e) => setRoomLabel(e.target.value)} required className={inputClass} />
              </div>
              <Button type="submit">Add</Button>
            </form>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

export default function GeoAdminPage() {
  return (
    <RouteGuard>
      <GeoContent />
    </RouteGuard>
  );
}
