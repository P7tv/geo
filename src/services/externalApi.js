const BASE = 'http://localhost:3001/api';

export const getWaterLevels = async () => {
  try {
    const r = await fetch(`${BASE}/water-levels`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
};

export const getDamLevels = async () => {
  try {
    const r = await fetch(`${BASE}/dams`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
};

export const getShelters = async () => {
  try {
    const r = await fetch(`${BASE}/shelters`);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
};

export const getTmdWarnings = async () => {
  try {
    const r = await fetch(`${BASE}/warnings`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
};

export const getRouteRisk = async () => {
  try {
    const r = await fetch(`${BASE}/route-risk`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
};
