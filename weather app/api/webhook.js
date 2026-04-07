export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, country = "US" } = req.query;

  if (!zip) {
    return res.status(400).json({
      error: "Missing zip parameter",
      example: "/api/weather?zip=10001&country=US",
    });
  }

  try {
    // Step 1: Convert zip code to lat/lon using Nominatim (free, no key)
    const geoUrl = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=${country}&format=json&limit=1`;

    const geoRes = await fetch(geoUrl, {
      headers: {
        "User-Agent": "WeatherApp/1.0 (weather-lookup-tool)",
        Accept: "application/json",
      },
    });

    const geoData = await geoRes.json();

    if (!geoData || geoData.length === 0) {
      return res.status(404).json({
        error: "Zip code not found",
        zip,
        country,
      });
    }

    const { lat, lon, display_name } = geoData[0];

    // Step 2: Get weather from Open-Meteo (free, no key)
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m,apparent_temperature,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&forecast_days=5`;

    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();

    const cw = weatherData.current_weather;
    const daily = weatherData.daily;

    // Map WMO weather codes to human-readable descriptions
    const weatherDescriptions = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Icy fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Heavy drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      71: "Slight snow",
      73: "Moderate snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Slight showers",
      81: "Moderate showers",
      82: "Violent showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with hail",
      99: "Thunderstorm with heavy hail",
    };

    const getDescription = (code) =>
      weatherDescriptions[code] || `Weather code ${code}`;

    // Get current hour index for humidity/feels_like
    const currentHour = new Date().getUTCHours();
    const humidity =
      weatherData.hourly?.relativehumidity_2m?.[currentHour] || null;
    const feelsLike =
      weatherData.hourly?.apparent_temperature?.[currentHour] || null;
    const precipProb =
      weatherData.hourly?.precipitation_probability?.[currentHour] || null;

    // Build 5-day forecast
    const forecast = daily.time.map((date, i) => ({
      date,
      condition: getDescription(daily.weathercode[i]),
      weatherCode: daily.weathercode[i],
      tempMax: daily.temperature_2m_max[i],
      tempMin: daily.temperature_2m_min[i],
      precipitation: daily.precipitation_sum[i],
    }));

    // Final response
    return res.status(200).json({
      zip,
      country: country.toUpperCase(),
      location: display_name,
      coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) },
      current: {
        temperature: cw.temperature,
        feelsLike,
        humidity,
        windspeed: cw.windspeed,
        windDirection: cw.winddirection,
        condition: getDescription(cw.weathercode),
        weatherCode: cw.weathercode,
        isDay: cw.is_day === 1,
        precipitationProbability: precipProb,
        time: cw.time,
        units: {
          temperature: "°C",
          windspeed: "km/h",
          precipitation: "mm",
        },
      },
      forecast,
      source: "Open-Meteo + OpenStreetMap Nominatim (no API key required)",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch weather data",
      message: error.message,
    });
  }
}