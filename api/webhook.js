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
    const geoRes = await fetch(`https://api.zippopotam.us/${country}/${zip}`);
    if (!geoRes.ok) {
      return res.status(200).send("Normal");
    }
    const geoData = await geoRes.json();
    const lat = geoData.places[0].latitude;
    const lon = geoData.places[0].longitude;

    // Step 2: Get 5-day forecast from Open-Meteo (free, no key)
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5&temperature_unit=fahrenheit`
    );
    const weatherData = await weatherRes.json();
    const maxTemps = weatherData.daily.temperature_2m_max; // [80, 81, 70, 75, 85]

    // Step 3: Count how many days fall into each category
    const extremeColdDays = maxTemps.filter((t) => t < 32).length;
    const coldDays        = maxTemps.filter((t) => t >= 32 && t < 50).length;
    const heatDays        = maxTemps.filter((t) => t >= 80).length;

    // Step 4: 3 or more days out of 5 = dominant condition
    const MAJORITY = 3;

    // Priority: Extreme-Cold > Heat-Warning > Cold-Weather > Normal
    let tag;
    if (extremeColdDays >= MAJORITY) {
      tag = "Extreme-Cold";
    } else if (heatDays >= MAJORITY) {
      tag = "Heat-Warning";
    } else if (coldDays >= MAJORITY) {
      tag = "Cold-Weather";
    } else {
      tag = "Normal";
    }

    // Step 5: Return plain text tag (Shopify Flow reads this directly)
    return res.status(200).send(tag);
  } catch (error) {
    // On any error return Normal as safe fallback
    return res.status(200).send("Normal");
  }
}