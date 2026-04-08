export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, country = "US" } = req.query;
  if (!zip) {
    return res.status(400).send("Missing zip parameter");
  }

  try {
    // Step 1: Convert zip to lat/lon using Zippopotam.us
    const geoRes = await fetch(`https://api.zippopotam.us/${country}/${zip}`);
    if (!geoRes.ok) {
      return res.status(200).send("Normal");
    }
    const geoData = await geoRes.json();
    const lat = geoData.places[0].latitude;
    const lon = geoData.places[0].longitude;

    // Step 2: Get 5-day forecast from Open-Meteo
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5&temperature_unit=fahrenheit`
    );
    const weatherData = await weatherRes.json();
    const maxTemps = weatherData.daily.temperature_2m_max;

    // Step 3: Count days in each risk category
    // Cold High Risk  → below 30°F
    // Heat High Risk  → above 90°F
    // Normal          → 30°F to 90°F
    const coldDays = maxTemps.filter((t) => t < 30).length;
    const heatDays = maxTemps.filter((t) => t > 90).length;

    // Step 4: 2+ days = Cold-High-Risk, 3+ days = Heat-High-Risk, else Normal
    let tag;
    if (coldDays >= 2) {
      tag = "Cold/High-Risk";
    } else if (heatDays >= 3) {
      tag = "Heat/High-Risk";
    } else {
      tag = "Normal";
    }

    // Step 5: Return plain text tag
    return res.status(200).send(tag);
  } catch (error) {
    return res.status(200).send("Normal");
  }
}