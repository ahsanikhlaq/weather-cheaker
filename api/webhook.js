export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, country = "US" } = req.query;
  if (!zip) {
    console.error("[Weather API] Missing zip parameter");
    return res.status(400).send("Missing zip parameter");
  }

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
      console.log(`[Weather API] Nominatim resolved zip=${zip}, country=${country} → lat=${lat}, lon=${lon}`);
    } else {
      console.warn(`[Weather API] Nominatim found no results for zip=${zip}, country=${country}. Trying Zippopotam...`);

      // Step 1b: Fallback to Zippopotam
      const zippoRes = await fetch(`https://api.zippopotam.us/${country}/${zip}`);

      if (zippoRes.ok) {
        const zippoData = await zippoRes.json();
        lat = zippoData.places[0].latitude;
        lon = zippoData.places[0].longitude;
        console.log(`[Weather API] Zippopotam resolved zip=${zip}, country=${country} → lat=${lat}, lon=${lon}`);
      } else {
        console.warn(`[Weather API] Zippopotam failed (status=${zippoRes.status}) for zip=${zip}, country=${country}. Trying Census...`);

        // Step 1c: Fallback to US Census Geocoder
        const censusRes = await fetch(
          `https://geocoding.geo.census.gov/geocoder/locations/address?street=&city=&state=&zip=${zip}&benchmark=Public_AR_Current&format=json`
        );
        const censusData = await censusRes.json();
        const match = censusData?.result?.addressMatches?.[0];

        if (match) {
          lat = match.coordinates.y;
          lon = match.coordinates.x;
          console.log(`[Weather API] Census resolved zip=${zip} → lat=${lat}, lon=${lon}`);
        } else {
          // ❌ All 3 geocoders failed — invalid zip/country combo
          console.error(`[Weather API] All geocoders failed. No match found for zip=${zip}, country=${country}. Returning blank tag.`);
          return res.status(200).send("");
        }
      }
    }

    // Step 2: Get 5-day forecast from Open-Meteo
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&timezone=auto&forecast_days=5&temperature_unit=fahrenheit`
    );

    if (!weatherRes.ok) {
      console.error(`[Weather API] Open-Meteo request failed with status=${weatherRes.status} for lat=${lat}, lon=${lon}`);
      return res.status(200).send("");
    }

    const weatherData = await weatherRes.json();

    if (!weatherData?.daily?.temperature_2m_max) {
      console.error(`[Weather API] Open-Meteo returned unexpected data structure:`, JSON.stringify(weatherData));
      return res.status(200).send("");
    }

    const maxTemps = weatherData.daily.temperature_2m_max;
    console.log(`[Weather API] 5-day max temps for zip=${zip}:`, maxTemps);

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

    console.log(`[Weather API] Tag assigned for zip=${zip}: "${tag}" (coldDays=${coldDays}, heatDays=${heatDays})`);
    return res.status(200).send(tag);

  } catch (error) {
    console.error(`[Weather API] Unhandled exception for zip=${zip}, country=${country}:`, error);
    return res.status(200).send("");
  }
}