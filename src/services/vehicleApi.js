const BASE_URL = '/api';


export const getVehicleRouteSummary = async () => {
  try {
    const res = await fetch(`${BASE_URL}/vehicles/route-summary`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const getAiBriefing = async () => {
  try {
    const res = await fetch(`${BASE_URL}/ai/briefing`);
    if (!res.ok) return { briefing: '', alert_level: 1, generated_at: '' };
    return await res.json();
  } catch {
    return { briefing: '', alert_level: 1, generated_at: '' };
  }
};

export const getTerminalLogs = async () => {
  try {
    const res = await fetch(`${BASE_URL}/vehicles/logs`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
};
