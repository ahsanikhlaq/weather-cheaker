export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, country = "US", shipdate } = req.query;

  if (!zip) {
    console.error("[Weather API] Missing zip parameter");
    return res.status(400).send("Missing zip parameter");
  }

  // ─── Step 0: Determine weather window ───────────────────────────────────────
  //
  // Three scenarios:
  //   A) shipdate provided + <= 16 days away → window = (ship_date-4) to ship_date
  //   B) shipdate provided + >  16 days away → return "Weather-Pending"
  //   C) no shipdate provided               → next 5 days from today (original behavior)

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let forecastDays = 5;       // how many days to request from Open-Meteo
  let windowStartOffset = 0;  // index in forecast array where our 5-day window starts

  if (shipdate) {
    const shipDate = new Date(shipdate + "T00:00:00");

    if (isNaN(shipDate.getTime())) {
      console.warn(`[Weather API] Invalid shipdate="${shipdate}", falling back to next 5 days`);
    } else {
      const daysUntilShip = Math.round((shipDate - today) / (1000 * 60 * 60 * 24));
      console.log(`[Weather API] shipdate=${shipdate}, daysUntilShip=${daysUntilShip}`);

      if (daysUntilShip > 16) {
        // Scenario B: Too far — forecast not reliable yet
        console.log(`[Weather API] Ship date is ${daysUntilShip} days away (>16). Returning Weather-Pending.`);
        return res.status(200).send("Weather-Pending");

      } else {
        // Scenario A: Within 16 days
        // Fetch enough days to reach ship_date, then slice last 5 (ship_date-4 → ship_date)
        forecastDays = Math.min(Math.max(daysUntilShip + 1, 5), 16);
        windowStartOffset = Math.max(daysUntilShip - 4, 0);
        console.log(`[Weather API] Scenario A: forecastDays=${forecastDays}, windowStartOffset=${windowStartOffset}`);
      }
    }
  }

  // ─── Step 1: Geocode zip → lat/lon ──────────────────────────────────────────

  try {
    let lat, lon;

    // 1a: Nominatim
    const nominatimRes = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=${country}&format=json&limit=1`,
      { headers: { "User-Agent": "weather-checker-app" } }
    );
    const nominatimData = await nominatimRes.json();

    if (nominatimData && nominatimData.length > 0) {
      lat = nominatimData[0].lat;
      lon = nominatimData[0].lon;
      console.log(`[Weather API] Nominatim → lat=${lat}, lon=${lon}`);
    } else {
      console.warn(`[Weather API] Nominatim failed for zip=${zip}. Trying Zippopotam...`);

      // 1b: Zippopotam
      const zippoRes = await fetch(`https://api.zippopotam.us/${country}/${zip}`);

      if (zippoRes.ok) {
        const zippoData = await zippoRes.json();
        lat = zippoData.places[0].latitude;
        lon = zippoData.places[0].longitude;
        console.log(`[Weather API] Zippopotam → lat=${lat}, lon=${lon}`);
      } else {
        console.warn(`[Weather API] Zippopotam failed. Trying Census...`);

        // 1c: US Census Geocoder
        const censusRes = await fetch(
          `https://geocoding.geo.census.gov/geocoder/locations/address?street=&city=&state=&zip=${zip}&benchmark=Public_AR_Current&format=json`
        );
        const censusData = await censusRes.json();
        const match = censusData?.result?.addressMatches?.[0];

        if (match) {
          lat = match.coordinates.y;
          lon = match.coordinates.x;
          console.log(`[Weather API] Census → lat=${lat}, lon=${lon}`);
        } else {
          console.error(`[Weather API] All geocoders failed for zip=${zip}, country=${country}.`);
          return res.status(200).send("");
        }
      }
    }

    // ─── Step 2: Fetch forecast from Open-Meteo ───────────────────────────────

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&timezone=auto&forecast_days=${forecastDays}&temperature_unit=fahrenheit`
    );

    if (!weatherRes.ok) {
      console.error(`[Weather API] Open-Meteo failed, status=${weatherRes.status}`);
      return res.status(200).send("");
    }

    const weatherData = await weatherRes.json();

    if (!weatherData?.daily?.temperature_2m_max) {
      console.error(`[Weather API] Unexpected Open-Meteo structure:`, JSON.stringify(weatherData));
      return res.status(200).send("");
    }

    const allTemps = weatherData.daily.temperature_2m_max;

    // ─── Step 3: Slice correct 5-day window ───────────────────────────────────
     //
     // Scenario A example:
    //   ship_date = April 30 (10 days away)
    //   forecastDays = 11, windowStartOffset = 6
    //   allTemps = [Apr13, Apr14, Apr15, Apr16, Apr17, Apr18, Apr19, Apr20... Apr30]
    //   window  = [Apr26, Apr27, Apr28, Apr29, Apr30]  ← last 5 days up to ship date
    //
    // Scenario C (no ship date):
    //   windowStartOffset = 0, forecastDays = 5
    //   window = [today, +1, +2, +3, +4]

    const maxTemps = allTemps.slice(windowStartOffset, windowStartOffset + 5);
    console.log(`[Weather API] Window temps (offset=${windowStartOffset}):`, maxTemps);

    if (maxTemps.length === 0) {
      console.error(`[Weather API] Empty window. allTemps.length=${allTemps.length}, offset=${windowStartOffset}`);
      return res.status(200).send("");
    }

    // ─── Step 4: Tag logic ────────────────────────────────────────────────────

    const coldDays = maxTemps.filter((t) => t < 30).length;
    const heatDays = maxTemps.filter((t) => t > 90).length;

    let tag;
    if (coldDays >= 2) {
      tag = "Cold/High-Risk";
    } else if (heatDays >= 3) {
      tag = "Heat/High-Risk";
    } else {
      tag = "Normal";
    }

    console.log(`[Weather API] Final tag="${tag}" | zip=${zip} | shipdate=${shipdate || "none"} | coldDays=${coldDays} | heatDays=${heatDays}`);
    return res.status(200).send(tag);

  } catch (error) {
    console.error(`[Weather API] Unhandled exception:`, error);
    return res.status(200).send("");
  }
}
