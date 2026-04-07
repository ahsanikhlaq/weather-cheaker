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
    // Step 1: Convert zip to lat/lon using Zippopotam.us (free, no key, US focused)
    const geoRes = await fetch(
      `https://api.zippopotam.us/${country}/${zip}`
    );

    if (!geoRes.ok) {
      return res.status(200).send("Normal"); // fallback tag if zip not found
    }

    const geoData = await geoRes.json();
    const lat = geoData.places[0].latitude;
    const lon = geoData.places[0].longitude;

    // Step 2: Get 5-day forecast from Open-Meteo (free, no key)
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5&temperature_unit=fahrenheit`
    );

    const weatherData = await weatherRes.json();
    const daily = weatherData.daily;

    // Step 3: Calculate 5-day average using MAX temps only
    // (daily highs determine risk for products, not lows)
    const maxTemps = daily.temperature_2m_max;
    const avgMaxTemp =
      maxTemps.reduce((sum, t) => sum + t, 0) / maxTemps.length;

    // Step 4: Determine tag based on average HIGH temperature
    // Below 32°F  → Extreme-Cold (freezing risk)
    // 32°F - 49°F → Cold-Weather (insulation needed)
    // 50°F - 79°F → Normal (standard shipping)
    // 80°F+       → Heat-Warning (melting risk)
    let tag;
    if (avgMaxTemp < 32) {
      tag = "Extreme-Cold";
    } else if (avgMaxTemp < 50) {
      tag = "Cold-Weather";
    } else if (avgMaxTemp < 80) {
      tag = "Normal";
    } else {
      tag = "Heat-Warning";
    }

    // Step 5: Return plain text tag (Shopify Flow reads this directly)
    return res.status(200).send(tag);

  } catch (error) {
    // On any error return Normal as safe fallback
    return res.status(200).send("Normal");
  }
}