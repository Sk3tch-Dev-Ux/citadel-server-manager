/**
 * CitadelCloudClient — DIRECT mode (G2): talk to the Citadel cloud over HTTP,
 * with NO host-side agent. Lets the mod run on rented hosts (Nitrado/GPORTAL)
 * where you can install a server mod via the workshop but cannot run a separate
 * Windows process.
 *
 * Activates only when `$profile:Citadel/cloud.json` exists:
 *     { "endpoint": "https://api.citadels.cc/api/v1/plugin",
 *       "apiKey":   "<key from the cloud dashboard>",
 *       "postIntervalMs": 3000 }
 * No cloud.json → this is a no-op and the mod stays in file-IPC/agent mode.
 * (Don't run both an agent and direct mode for one server — the cloud also
 * refuses HTTP ingest while a live agent WS exists, but pick one.)
 *
 * Telemetry egress: drains CitadelEventLogger's direct buffer (events.jsonl
 * lines) + reads the current metrics/players/vehicles/world snapshot files —
 * all already valid JSON — and POSTs them raw to /ingest. The CLOUD translates
 * the raw shapes into wire messages (mod-telemetry-translate.ts), so there's no
 * per-topic serialization here.
 *
 * Command ingress: the /ingest response carries queued commands. We write each
 * as a normal `commands/<id>.cmd.json` so the EXISTING CitadelCommandRunner
 * executes it unchanged (all 40+ actions reused), then POST the resulting
 * `responses/<id>.res.json` back to /commands/<id>/result.
 *
 * NOTE: DayZ's Enforce RestApi can't set arbitrary request headers, so the API
 * key travels in the JSON body (same as GLMetrics' mod). Server-side only.
 *
 * Unverified outside the DayZ toolchain — written to the mod's conventions +
 * GLMetrics' RestApi pattern; validate on a live host.
 */

class CitadelCloudConfig
{
    string endpoint = "";
    string apiKey = "";
    int postIntervalMs = 3000;
}

// RestApi calls back here on POST completion. We only need the /ingest response
// (to pull commands); result POSTs ignore their response.
class CitadelCloudCallback extends RestCallback
{
    private CitadelCloudClient m_Client;

    void CitadelCloudCallback(CitadelCloudClient client)
    {
        m_Client = client;
    }

    override void OnSuccess(string data, int dataSize)
    {
        if (m_Client)
            m_Client.HandleIngestResponse(data);
    }

    override void OnError(int errorCode)
    {
        if (GetCitadel())
            GetCitadel().GetLogger().Warn(string.Format("Cloud ingest error: %1", errorCode.ToString()));
    }

    override void OnTimeout()
    {
        if (GetCitadel())
            GetCitadel().GetLogger().Warn("Cloud ingest timeout");
    }
}

class CitadelCloudClient
{
    private bool m_Enabled = false;
    private string m_Endpoint = "";
    private string m_ApiKey = "";

    private RestContext m_Ctx;
    private ref CitadelCloudCallback m_IngestCb;
    private ref CitadelCloudCallback m_ResultCb;
    private ref Timer m_PostTimer;
    private ref Timer m_ResultTimer;

    private static const string CONFIG_PATH   = "$profile:Citadel/cloud.json";
    private static const string METRICS_FILE  = "$profile:Citadel/metrics.json";
    private static const string PLAYERS_FILE  = "$profile:Citadel/players.json";
    private static const string VEHICLES_FILE = "$profile:Citadel/vehicles.json";
    private static const string WORLD_FILE    = "$profile:Citadel/events_world.json";
    private static const string CMD_DIR       = "$profile:Citadel/commands";
    private static const string RES_DIR       = "$profile:Citadel/responses";

    void CitadelCloudClient()
    {
        if (!GetGame() || !GetGame().IsServer())
            return;
        if (!FileExist(CONFIG_PATH))
            return; // no cloud.json → agent/file-IPC mode (this is a no-op)

        CitadelCloudConfig cfg = new CitadelCloudConfig();
        JsonFileLoader<CitadelCloudConfig>.JsonLoadFile(CONFIG_PATH, cfg);
        if (cfg.endpoint == "" || cfg.apiKey == "")
        {
            GetCitadel().GetLogger().Warn("cloud.json present but missing endpoint/apiKey — direct mode off");
            return;
        }

        m_Endpoint = cfg.endpoint;
        m_ApiKey = cfg.apiKey;
        m_Enabled = true;

        // Mirror logged events into the HTTP egress buffer.
        CitadelEventLogger.SetDirectMode(true);

        RestApi rest = GetRestApi();
        if (!rest) rest = CreateRestApi();
        if (!rest)
        {
            GetCitadel().GetLogger().Warn("RestApi unavailable — direct mode off");
            m_Enabled = false;
            return;
        }
        m_Ctx = rest.GetRestContext(m_Endpoint);
        m_Ctx.SetHeader("application/json");
        m_IngestCb = new CitadelCloudCallback(this);
        m_ResultCb = new CitadelCloudCallback(this);

        int interval = cfg.postIntervalMs;
        if (interval < 1000) interval = 3000;

        m_PostTimer = new Timer();
        m_PostTimer.Run(interval * 0.001, this, "PostTelemetry", null, true);
        m_ResultTimer = new Timer();
        m_ResultTimer.Run(1.0, this, "PostResults", null, true);

        GetCitadel().GetLogger().Info("Cloud client (direct mode) enabled → " + m_Endpoint);
    }

    void ~CitadelCloudClient()
    {
        if (m_PostTimer) m_PostTimer.Stop();
        if (m_ResultTimer) m_ResultTimer.Stop();
    }

    bool IsDirectMode() { return m_Enabled; }

    // ─── Telemetry egress ───────────────────────────────────
    void PostTelemetry()
    {
        if (!m_Enabled || !m_Ctx) return;
        m_Ctx.POST(m_IngestCb, "/ingest", BuildPayload());
    }

    private string BuildPayload()
    {
        string p = "{\"apiKey\":\"" + m_ApiKey + "\"";

        // events — already-valid JSON objects from the direct buffer.
        array<string> events = CitadelEventLogger.DrainDirectBuffer();
        p += ",\"events\":[";
        for (int i = 0; i < events.Count(); i++)
        {
            if (i > 0) p += ",";
            p += events.Get(i);
        }
        p += "]";

        // snapshots — current file contents (already JSON), embedded raw.
        string metrics = ReadWholeFile(METRICS_FILE);
        if (metrics != "") p += ",\"metrics\":" + metrics;
        string players = ReadWholeFile(PLAYERS_FILE);
        if (players != "") p += ",\"players\":" + players;
        string vehicles = ReadWholeFile(VEHICLES_FILE);
        if (vehicles != "") p += ",\"vehicles\":" + vehicles;
        string world = ReadWholeFile(WORLD_FILE);
        if (world != "") p += ",\"worldEvents\":" + world;

        p += "}";
        return p;
    }

    // ─── Command ingress (reuses CitadelCommandRunner) ──────
    // The /ingest response is { "ok": true, "commands": [ {type,id,action,params}, ... ] }.
    // Drop each command object into the commands dir as <id>.cmd.json; the
    // existing runner executes it and writes responses/<id>.res.json.
    void HandleIngestResponse(string data)
    {
        array<string> cmds = ExtractArrayObjects(data, "commands");
        if (cmds.Count() == 0) return;

        MakeDirectory(CMD_DIR);
        for (int i = 0; i < cmds.Count(); i++)
        {
            string cmd = cmds.Get(i);
            string id = ExtractJsonString(cmd, "id");
            if (id == "") continue;
            WriteWholeFile(CMD_DIR + "/" + id + ".cmd.json", cmd); // CommandRunner ignores the extra "type"
        }
    }

    // ─── Result egress ──────────────────────────────────────
    void PostResults()
    {
        if (!m_Enabled || !m_Ctx) return;

        string fileName;
        int fileAttr;
        FindFileHandle h = FindFile(RES_DIR + "/*.res.json", fileName, fileAttr, FindFileFlags.ALL);
        if (fileName != "")
            PostOneResult(fileName);
        if (h != 0)
        {
            while (FindNextFile(h, fileName, fileAttr))
                PostOneResult(fileName);
            CloseFindFile(h);
        }
    }

    private void PostOneResult(string fileName)
    {
        string path = RES_DIR + "/" + fileName;
        string content = ReadWholeFile(path);
        if (content == "")
        {
            DeleteFile(path);
            return;
        }
        string id = ExtractJsonString(content, "id");
        if (id == "")
        {
            DeleteFile(path);
            return;
        }
        // CommandRunner writes "ok": true|false and an "error" string.
        bool ok = content.Contains("\"ok\":true") || content.Contains("\"ok\": true");
        string msg = ExtractJsonString(content, "error");

        // Enforce Script has no ternary operator.
        string okStr = "false";
        if (ok) okStr = "true";

        string body = "{\"apiKey\":\"" + m_ApiKey + "\"";
        body += ",\"success\":" + okStr;
        body += ",\"message\":\"" + CitadelEventLogger.EscapeJson(msg) + "\"}";

        m_Ctx.POST(m_ResultCb, "/commands/" + id + "/result", body);
        DeleteFile(path);
    }

    // ─── Helpers ────────────────────────────────────────────
    private string ReadWholeFile(string path)
    {
        if (!FileExist(path)) return "";
        FileHandle f = OpenFile(path, FileMode.READ);
        if (f == 0) return "";
        string result = "";
        string line;
        while (FGets(f, line) >= 0)
            result += line;
        CloseFile(f);
        return result;
    }

    private void WriteWholeFile(string path, string content)
    {
        FileHandle f = OpenFile(path, FileMode.WRITE);
        if (f == 0) return;
        FPrintln(f, content);
        CloseFile(f);
    }

    // Extract a single top-level string value by key ("key":"value").
    private string ExtractJsonString(string json, string key)
    {
        string marker = "\"" + key + "\":\"";
        int start = json.IndexOf(marker);
        if (start == -1) return "";
        int valStart = start + marker.Length();
        int end = json.IndexOfFrom(valStart, "\"");
        if (end == -1) return "";
        return json.Substring(valStart, end - valStart);
    }

    // Extract each top-level object string from a JSON array field ("key":[ {...},{...} ]).
    // Brace-balanced, so nested `params` objects are kept intact.
    private array<string> ExtractArrayObjects(string json, string key)
    {
        array<string> result = new array<string>();
        string marker = "\"" + key + "\":[";
        int start = json.IndexOf(marker);
        if (start == -1) return result;

        int i = start + marker.Length();
        int n = json.Length();
        int depth = 0;
        int objStart = -1;
        while (i < n)
        {
            string ch = json.Substring(i, 1);
            if (depth == 0 && ch == "]")
                break; // end of the array
            if (ch == "{")
            {
                if (depth == 0) objStart = i;
                depth++;
            }
            else if (ch == "}")
            {
                depth--;
                if (depth == 0 && objStart != -1)
                {
                    result.Insert(json.Substring(objStart, i - objStart + 1));
                    objStart = -1;
                }
            }
            i++;
        }
        return result;
    }
}
