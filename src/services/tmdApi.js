/**
 * TMD NWP API Service
 * Reference: https://data.tmd.go.th/nwpapi/doc/main/getting_start.html
 */

const TMD_CONFIG = {
  BASE_URL: 'https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly',
  TOKEN: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImI5YzJkODUwZTE1OWJiYTE5NDliYzhjZTEyODllZWIyMjFlYjA4MTE5NGY4MTBhYWRhMjNiNTExMzdmZWQzZWFjMWY1YWI4NzNmMGNhZTFjIn0.eyJhdWQiOiIyIiwianRpIjoiYjljMmQ4NTBlMTU5YmJhMTk0OWJjOGNlMTI4OWVlYjIyMWViMDgxMTk0ZjgxMGFhZGEyM2I1MTEzN2ZlZDNlYWMxZjVhYjg3M2YwY2FlMWMiLCJpYXQiOjE3NzcyMTU1NzAsIm5iZiI6MTc3NzIxNTU3MCwiZXhwIjoxODA4NzUxNTcwLCJzdWIiOiI1MjMzIiwic2NvcGVzIjpbXX0.tHJVqVgv4YmwrUr5HeLTlJ1qfXPpXmVGOonCIZMIXj00FDTHGQ6u8SjCKm30kBy3F6NfQjldOVh8Y2LcP8UhHqYM-jxwm35qctp_S7hiSLr9bnLJND-Fl2Q3brqGRgGsfLVRBTDYlG3i4KoGxXjnswik1j_HIS9J_efkqeBbRhbs9DLWMEEw29DA5EUJmuBYR8M1Cl9T7XMeOkBt_ZIpYHEc9sIMSZwB8MV0yf6eSeQRZv2une9oZ4Nf0yccjZdMYapLrN0Jy-54HFgF3HL24aWPddQQP4I8JX_Y8fB-adThH8PGov78dNPCHC3hPf7R0AAsVxUmqeDS3zCHdFXd4BywD0D6KgDyLyq0scB3YyZP1sGhINCU3tFvIeNmP42kkwT1R221h7y0nEaoSiBTMNqTeZHNw4Ty7GNzVrAyV68nyZ4nnnvkqhAqOhcDiyh42a2ro7-xqOZcIREPuaxtVL6Jfp3Kha8gsA7QWncp9ooBVamjc-0QEvw-CP0h4_8mm6wzg6NRgWjouWBwcNsw93Wf3eOJhynjuOLMttGvQbiH2WWDq9e5CLQuVb8qqLVcfN7R06UQh9Ynw9JdOVY4CjXFMXeRyqkLO99ThuyxBW5-eSYTkrmCnnw8tadJ9uiIvzcTZUwFlCocss7biergwjcPbRYBn7SMglcDZUVjAq8'
};

export const getHourlyForecast = async (lat, lon) => {
  // Mock data as fallback
  const mockData = {
    WeatherForecasts: [
      {
        location: { lat, lon },
        forecasts: [
          { time: new Date().toISOString(), data: { tc: 28.5, rh: 72, rr: 0.0, ws: 2.1, wd: 180, cond: 2 } }
        ]
      }
    ]
  };

  try {
    const url = `${TMD_CONFIG.BASE_URL}?lat=${lat}&lon=${lon}&duration=6`;
    
    console.log('🌧️ Fetching TMD Weather (6h Forecast)...');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TMD_CONFIG.TOKEN}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) console.error('❌ TMD Token Expired or Invalid');
      return mockData;
    }

    const data = await response.json();
    console.log('✅ Real TMD data received');
    
    // TMD response structure fix
    if (data.WeatherForecasts && data.WeatherForecasts[0]) {
       return data;
    }
    
    return mockData;

  } catch (error) {
    console.warn('⚠️ TMD Fetch Error (likely CORS):', error.message);
    return mockData;
  }
};
