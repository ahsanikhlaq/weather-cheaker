export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, country = "US" } = req.query;
  if (!zip) return res.status(400).send("Missing zip parameter");

  try {
    let lat, lon;

    // Step 1a: Try Nominatim first
    const nominatimRes = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=${country}&format=json&limit=1`,
      { headers: { "User-Agent": "weather-checker-app" } }
    );
    const nominatimData = await nominatimRes.json();

    if (nominatimData && nominatimData.length > 0) {
      lat = nominatimData[0].lat;
      lon = nominatimData[0].lon;
    } else {
      // Step 1b: Fallback to Zippopotam
      const zippoRes = await fetch(
        `https://api.zippopotam.us/${country}/${zip}`
      );
      if (zippoRes.ok) {
        const zippoData = await zippoRes.json();
        lat = zippoData.places[0].latitude;
        lon = zippoData.places[0].longitude;
      } else {
        // Step 1c: Fallback to US Census Geocoder (works for ALL US zip codes)
        const censusRes = await fetch(
          `https://geocoding.geo.census.gov/geocoder/locations/address?street=&city=&state=&zip=${zip}&benchmark=Public_AR_Current&format=json`
        );
        const censusData = await censusRes.json();
        const match = censusData?.result?.addressMatches?.[0];
        if (match) {
          lat = match.coordinates.y;
          lon = match.coordinates.x;
        } else {
          return res.status(200).send("Normal");
        }
      }
    }

    // Step 2: Get 5-day forecast from Open-Meteo
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&timezone=auto&forecast_days=5&temperature_unit=fahrenheit`
    );
    const weatherData = await weatherRes.json();
    const maxTemps = weatherData.daily.temperature_2m_max;

    // Step 3: Count days in each risk category
    const coldDays = maxTemps.filter((t) => t < 30).length;
    const heatDays = maxTemps.filter((t) => t > 90).length;

    // Step 4: Assign tag
    let tag;
    if (coldDays >= 2) {
      tag = "Cold/High-Risk";
    } else if (heatDays >= 3) {
      tag = "Heat/High-Risk";
    } else {
      tag = "Normal";
    }

    return res.status(200).send(tag);
  } catch (error) {
    return res.status(200).send("Normal");
  }
}