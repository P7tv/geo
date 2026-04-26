/**
 * Simple backend proxy untuk bypass CORS
 * Run: node server.js
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3001;

// TMD JWT Token
const TMD_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImI5YzJkODUwZTA1OWJiYTE5NDliYzhjZTEyODllZWIyMjFlYjA4MTE5NGY4MTBhYWRhMjNiNTExMzdmZWQzZWFjMWY1YWI4NzNmMGNhZTFjIn0.eyJhdWQiOiIyIiwianRpIjoiYjljMmQ4NTBlMTU5YmJhMTk0OWJjOGNlMTI4OWVlYjIyMWViMDgxMTk0ZjgxMGFhZGEyM2I1MTEzN2ZlZDNlYWMxZjVhYjg3M2YwY2FlMWMiLCJpYXQiOjE3NzcyMTU1NzAsIm5iZiI6MTc3NzIxNTU3MCwiZXhwIjoxODA4NzUxNTcwLCJzdWIiOiI1MjMzIiwic2NvcGVzIjpbXX0.tHJVqVgv4YmwrUr5HeLTlJ1qfXPpXmVGOonCIZMIXj00FDTHGQ6u8SjCKm30kBy3F6NfQjldOVh8Y2LcP8UhHqYM-jxwm35qctp_S7hiSLr9bnLJND-Fl2Q3brqGRgGsfLVRBTDYlG3i4KoGxXjnswik1j_HIS9J_efkqeBbRhbs9DLWMEEw29DA5EUJmuBYR8M1Cl9T7XMeOkBt_ZIpYHEc9sIMSZwB8MV0yf6eSeQRZv2une9oZ4Nf0yccjZdMYapLrN0Jy-54HFgF3HL24aWPddQQP4I8JX_Y8fB-adThH8PGov78dNPCHC3hPf7R0AAsVxUmqeDS3zCHdFXd4BywD0D6KgDyLyq0scB3YyZP1sGhINCU3tFvIeNmP42kkwT1R221h7y0nEaoSiBTMNqTeZHNw4Ty7GNzVrAyV68nyZ4nnnvkqhAqOhcDiyh42a2ro7-xqOZcIREPuaxtVL6Jfp3Kha8gsA7QWncp9ooBVamjc-0QEvw-CP0h4_8mm6wzg6NRgWjouWBwcNsw93Wf3eOJhynjuOLMttGvQbiH2WWDq9e5CLQuVb8qqLVcfN7R06UQh9Ynw9JdOVY4CjXFMXeRyqkLO99ThuyxBW5-eSYTkrmCnnw8tadJ9uiIvzcTZUwFlCocss7biergwjcPbRYBn7SMglcDZUVjAq8';

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', server: 'TMD API Proxy' });
});

// Proxy endpoint for TMD forecast
app.get('/api/tmd/forecast', async (req, res) => {
  try {
    const { lat, lon, date, hour, duration } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'Missing lat/lon parameters' });
    }

    const url = `https://data.tmd.go.th/nwpapi/v1/forecast/hourly/at?lat=${lat}&lon=${lon}&fields=tc,rh,rr,ws,wd,cond&date=${date || new Date().toISOString().slice(0, 10)}&hour=${hour || new Date().getHours()}&duration=${duration || 6}`;

    console.log('📡 Proxying TMD request:', url.replace(TMD_TOKEN, '***'));

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TMD_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.warn('⚠️ TMD API error:', response.status, data);
      return res.status(response.status).json(data);
    }

    console.log('✅ TMD API success');
    res.json(data);

  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 TMD API Proxy running on http://localhost:${PORT}`);
  console.log(`📡 Use: http://localhost:${PORT}/api/tmd/forecast?lat=18.79&lon=98.99\n`);
});

export default app;
