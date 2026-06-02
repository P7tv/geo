const BASE = '/api';

export const getWaterLevels = async (province = 'เชียงราย') => {
  try {
    const r = await fetch(`${BASE}/water-levels?province=${province}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export const getDamLevels = async (province = 'เชียงราย') => {
  try {
    const r = await fetch(`${BASE}/dams?province=${province}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export const getShelters = async (province = 'เชียงราย') => {
  try {
    const r = await fetch(`${BASE}/shelters?province=${province}`);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
};

export const getTmdWarnings = async (province = 'เชียงราย') => {
  try {
    const r = await fetch(`${BASE}/warnings?province=${province}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};
