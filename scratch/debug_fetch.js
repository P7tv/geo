import fs from 'fs';
import path from 'path';

// Native env loader
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=');
        if (index > -1) {
          const key = trimmed.substring(0, index).trim();
          const val = trimmed.substring(index + 1).trim();
          process.env[key] = val;
        }
      }
    });
  }
} catch (e) {
  console.error(e);
}

const ML_INFERENCE_URL = process.env.ML_INFERENCE_URL;
const B200_API_KEY = process.env.B200_API_KEY;
const JUPYTERHUB_TOKEN = process.env.JUPYTERHUB_TOKEN;

const mlHeaders = () => ({
  'Content-Type': 'application/json',
  ...(B200_API_KEY ? { 'X-API-Key': B200_API_KEY } : {}),
  ...(JUPYTERHUB_TOKEN ? { 'Authorization': `token ${JUPYTERHUB_TOKEN}` } : {})
});

async function run() {
  console.log('Target URL:', `${ML_INFERENCE_URL}/all_cctv_congestion`);
  console.log('Headers:', mlHeaders());
  
  try {
    const res = await fetch(`${ML_INFERENCE_URL}/all_cctv_congestion`, {
      headers: mlHeaders()
    });
    console.log('Response Status:', res.status);
    const json = await res.json();
    console.log('Response JSON:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Error fetching:', err);
  }
}

run();
