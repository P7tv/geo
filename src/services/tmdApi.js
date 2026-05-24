/**
 * TMD Weather Service — เรียกผ่าน server.js proxy เพื่อหลีกเลี่ยง CORS
 */

const PROXY_BASE = 'http://localhost:3001/api/tmd/forecast';

export const getHourlyForecast = async (lat, lon) => {
  const date = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();

  const params = new URLSearchParams({ lat, lon, date, hour, duration: 6 });
  const response = await fetch(`${PROXY_BASE}?${params}`);

  if (!response.ok) {
    throw new Error(`TMD proxy error: ${response.status}`);
  }

  return response.json();
};
