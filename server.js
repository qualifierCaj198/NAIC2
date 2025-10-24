import express from "express";
import path from "path";
import morgan from "morgan";
import expressLayouts from "express-ejs-layouts";
import NodeCache from "node-cache";
import pLimit from "p-limit";
import pRetry from "p-retry";

const app = express();
const __dirname = path.resolve();

// Basic middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(morgan("dev"));

// Simple in-memory cache for 5 minutes to avoid hammering the API during testing
const cache = new NodeCache({ stdTTL: 300 });

// States to check (from user spec)
const STATES = [
  "AL","AK","AZ","AR","CT","DE","DC","GU","HI","ID","IL","IA","KS",
  "MD","MA","MI","MN","MO","MT","NE","NH","NJ","NM","NC","ND",
  "OK","OR","RI","SC","TN","VT","VA","WV","WI"
];

// Helpers
const NAIC_BASE = "https://services.naic.org/api";

async function fetchJson(url) {
  return await pRetry(async () => {
    const res = await fetch(url, {
      headers: {
        "accept": "application/json, text/plain, */*",
        "user-agent": "NAIC2/1.0 (+https://github.com/qualifierCaj198/NAIC2)"
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }, { retries: 2 });
}

async function fetchStateBundle(state, npn) {
  // 3) search license by npn
  const searchUrl = `${NAIC_BASE}/licenseLookup/search?jurisdiction=${state}&searchType=Licensee&entityType=IND&npn=${encodeURIComponent(npn)}`;

  const search = await fetchJson(searchUrl);

  if (!Array.isArray(search) || search.length === 0) {
    return {
      state,
      found: false,
      message: `Not found in ${state}`
    };
  }

  // Take the first hit (usually one per state for an NPN)
  const licenseSummary = search[0];
  const licenseNumber = licenseSummary.licenseNumber;
  if (!licenseNumber) {
    return {
      state,
      found: false,
      message: `Not found in ${state}`
    };
  }

  // 5) license types to get licenseId
  const typesUrl = `${NAIC_BASE}/licenseeLookup/summary/licenseTypes/${state}/${licenseNumber}`;
  const types = await fetchJson(typesUrl);
  const licenseId = Array.isArray(types) && types.length ? (types[0].licenseId || types[0].licenseID) : null;
  if (!licenseId) {
    return {
      state,
      found: false,
      search: licenseSummary,
      licenseTypes: types || [],
      message: `No licenseId returned for ${state}`
    };
  }

  // 7) appointments
  const apptUrl = `${NAIC_BASE}/licenseeLookup/summary/appointments/${state}/${licenseId}`;
  const appointments = await fetchJson(apptUrl);

  return {
    state,
    found: true,
    search: licenseSummary,
    licenseTypes: types,
    appointments: Array.isArray(appointments?.appointments) ? appointments.appointments : []
  };
}

// Routes
app.get("/", (req, res) => {
  res.render("index", { results: null, npn: "", error: null });
});

app.post("/lookup", async (req, res) => {
  try {
    const npn = (req.body.npn || "").trim();
    if (!npn) {
      return res.render("index", { results: null, npn, error: "Please enter an NPN." });
    }

    const cacheKey = `npn:${npn}`;
    if (cache.has(cacheKey)) {
      return res.render("index", { results: cache.get(cacheKey), npn, error: null });
    }

    const limit = pLimit(6); // up to 6 concurrent requests

    const results = await Promise.all(
      STATES.map((st) => limit(() => fetchStateBundle(st, npn).catch(() => ({
        state: st,
        found: false,
        message: `Not found in ${st}`
      }))))
    );

    cache.set(cacheKey, results);
    res.render("index", { results, npn, error: null });
  } catch (e) {
    console.error(e);
    res.render("index", { results: null, npn: req.body?.npn || "", error: "Something went wrong. Please try again." });
  }
});

// JSON API variant (optional)
app.get("/api/lookup", async (req, res) => {
  try {
    const npn = (req.query.npn || "").trim();
    if (!npn) return res.status(400).json({ error: "npn required" });

    const limit = pLimit(6);
    const results = await Promise.all(
      STATES.map((st) => limit(() => fetchStateBundle(st, npn).catch(() => ({
        state: st,
        found: false,
        message: `Not found in ${st}`
      }))))
    );
    res.json({ npn, results });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});