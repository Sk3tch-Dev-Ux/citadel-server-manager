/**
 * DSCCommandRunner — Main command processor.
 *
 * Runs on a scheduled timer, reads command files from the queue directory,
 * dispatches them to the appropriate action handler, and writes response files.
 */
class DSCCommandRunner
{
    // Paths (relative to profile directory)
    static const string DSC_DIR = "$profile:DSC";
    static const string CMD_DIR = "$profile:DSC\\commands";
    static const string RES_DIR = "$profile:DSC\\responses";

    // Poll interval in milliseconds
    static const int POLL_INTERVAL_MS = 500;

    protected ref Timer m_PollTimer;

    void DSCCommandRunner()
    {
        // Ensure directories exist
        if (!FileExist(DSC_DIR))
            MakeDirectory(DSC_DIR);
        if (!FileExist(CMD_DIR))
            MakeDirectory(CMD_DIR);
        if (!FileExist(RES_DIR))
            MakeDirectory(RES_DIR);

        // Start polling
        m_PollTimer = new Timer();
        m_PollTimer.Run(POLL_INTERVAL_MS * 0.001, this, "ProcessQueue", null, true);

        Print("[DSCAdmin] Command runner initialized — polling " + CMD_DIR);
    }

    void ~DSCCommandRunner()
    {
        if (m_PollTimer)
            m_PollTimer.Stop();
    }

    /**
     * Scan the command directory for .cmd.json files and process each one.
     */
    void ProcessQueue()
    {
        string fileName;
        FileAttr fileAttr;
        FindFileHandle findHandle = FindFile(CMD_DIR + "\\*.cmd.json", fileName, fileAttr, FindFileFlags.ALL);

        if (findHandle == 0)
            return;

        // Process first file found
        ProcessCommandFile(CMD_DIR + "\\" + fileName);

        // Process remaining files
        while (FindNextFile(findHandle, fileName, fileAttr))
        {
            ProcessCommandFile(CMD_DIR + "\\" + fileName);
        }

        CloseFindFile(findHandle);
    }

    /**
     * Read a command file, execute it, and write the response.
     */
    protected void ProcessCommandFile(string filePath)
    {
        // Read command JSON
        FileHandle file = OpenFile(filePath, FileMode.READ);
        if (file == 0)
            return;

        string content = "";
        string line;
        while (FGets(file, line) >= 0)
        {
            content += line;
        }
        CloseFile(file);

        // Delete the command file immediately to prevent re-processing
        DeleteFile(filePath);

        if (content.Length() == 0)
            return;

        // Parse command
        string id, action;
        ref JsonObject cmdJson = new JsonObject();

        // Simple JSON parsing for our known format
        // We extract: id, action, params
        id = ExtractJsonString(content, "id");
        action = ExtractJsonString(content, "action");

        if (id == "" || action == "")
        {
            Print("[DSCAdmin] Invalid command file: missing id or action");
            return;
        }

        Print("[DSCAdmin] Processing command: " + action + " (id: " + id + ")");

        // Dispatch to action handlers
        bool success = false;
        string error = "";
        string responseData = "{}";

        if (action == "player.heal")
            success = DSCPlayerActions.HealPlayer(content, error);
        else if (action == "player.kill")
            success = DSCPlayerActions.KillPlayer(content, error);
        else if (action == "player.teleport")
            success = DSCPlayerActions.TeleportPlayer(content, error);
        else if (action == "player.spawnItem")
            success = DSCPlayerActions.SpawnItem(content, error);
        else if (action == "player.strip")
            success = DSCPlayerActions.StripPlayer(content, error);
        else if (action == "player.explode")
            success = DSCPlayerActions.ExplodePlayer(content, error);
        else if (action == "player.kick")
            success = DSCPlayerActions.KickPlayer(content, error);
        else if (action == "vehicle.delete")
            success = DSCVehicleActions.DeleteVehicle(content, error);
        else if (action == "vehicle.repair")
            success = DSCVehicleActions.RepairVehicle(content, error);
        else if (action == "vehicle.refuel")
            success = DSCVehicleActions.RefuelVehicle(content, error);
        else if (action == "vehicle.unstuck")
            success = DSCVehicleActions.UnstuckVehicle(content, error);
        else if (action == "vehicle.explode")
            success = DSCVehicleActions.ExplodeVehicle(content, error);
        else if (action == "vehicle.kill-engine")
            success = DSCVehicleActions.KillEngine(content, error);
        else if (action == "vehicle.eject-driver")
            success = DSCVehicleActions.EjectDriver(content, error);
        else if (action == "world.time")
            success = DSCWorldActions.SetTime(content, error);
        else if (action == "world.weather")
            success = DSCWorldActions.SetWeather(content, error);
        else if (action == "world.sunny")
            success = DSCWorldActions.ClearWeather(error);
        else if (action == "world.wipeAI")
            success = DSCWorldActions.WipeAI(error);
        else if (action == "world.wipeVehicles")
            success = DSCWorldActions.WipeVehicles(error);
        else if (action == "world.spawnItem")
            success = DSCWorldActions.SpawnItemWorld(content, error);
        else
        {
            error = "Unknown action: " + action;
        }

        // Write response file
        WriteResponse(id, success, responseData, error);
    }

    /**
     * Write a response JSON file for the sidecar to pick up.
     */
    protected void WriteResponse(string id, bool success, string data, string error)
    {
        string resPath = RES_DIR + "\\" + id + ".res.json";
        FileHandle file = OpenFile(resPath, FileMode.WRITE);
        if (file == 0)
        {
            Print("[DSCAdmin] ERROR: Could not write response file: " + resPath);
            return;
        }

        string json = "{";
        json += "\"id\":\"" + id + "\",";
        json += "\"ok\":" + (success ? "true" : "false") + ",";
        json += "\"data\":" + data + ",";
        json += "\"error\":" + (error != "" ? ("\"" + error + "\"") : "null") + ",";
        json += "\"timestamp\":" + GetGame().GetTime().ToString();
        json += "}";

        FPrintln(file, json);
        CloseFile(file);
    }

    // ─── JSON Helpers ────────────────────────────────────

    /**
     * Extract a string value from JSON by key name.
     * Simple implementation for our known flat JSON format.
     */
    static string ExtractJsonString(string json, string key)
    {
        string search = "\"" + key + "\":\"";
        int pos = json.IndexOf(search);
        if (pos < 0)
            return "";

        int start = pos + search.Length();
        int end = json.IndexOfFrom(start, "\"");
        if (end < 0)
            return "";

        return json.Substring(start, end - start);
    }

    /**
     * Extract a float value from JSON by key name.
     */
    static float ExtractJsonFloat(string json, string key)
    {
        // Try quoted value first
        string strVal = ExtractJsonString(json, key);
        if (strVal != "")
            return strVal.ToFloat();

        // Try unquoted number
        string search = "\"" + key + "\":";
        int pos = json.IndexOf(search);
        if (pos < 0)
            return 0;

        int start = pos + search.Length();
        // Skip whitespace
        while (start < json.Length() && (json[start] == " " || json[start] == "\t"))
            start++;

        int end = start;
        while (end < json.Length() && json[end] != "," && json[end] != "}" && json[end] != " ")
            end++;

        if (end <= start)
            return 0;

        return json.Substring(start, end - start).ToFloat();
    }

    /**
     * Extract an int value from JSON by key name.
     */
    static int ExtractJsonInt(string json, string key)
    {
        return (int)ExtractJsonFloat(json, key);
    }

    /**
     * Extract the params sub-object as a raw JSON string.
     */
    static string ExtractParams(string json)
    {
        string search = "\"params\":{";
        int pos = json.IndexOf(search);
        if (pos < 0)
            return "{}";

        int start = pos + search.Length() - 1; // include opening {
        int depth = 0;
        int i = start;
        while (i < json.Length())
        {
            if (json[i] == "{") depth++;
            else if (json[i] == "}") depth--;
            if (depth == 0)
                return json.Substring(start, i - start + 1);
            i++;
        }
        return "{}";
    }
};
