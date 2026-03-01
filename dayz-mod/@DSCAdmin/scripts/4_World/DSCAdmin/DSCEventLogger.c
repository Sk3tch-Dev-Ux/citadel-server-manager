/**
 * DSCEventLogger — Logs game events (kills, deaths, connections) to a JSONL file.
 * The sidecar reads and processes this file to build player statistics.
 */
class DSCEventLogger
{
    static const string EVENT_FILE = "$profile:DSC\\events.jsonl";

    /**
     * Log a player kill event.
     */
    static void LogKill(string killerSteamId, string killerName, string victimSteamId, string victimName, float distance, string weapon)
    {
        string json = "{";
        json += "\"type\":\"kill\",";
        json += "\"steamId\":\"" + killerSteamId + "\",";
        json += "\"name\":\"" + DSCPlayerTracker.EscapeJsonString(killerName) + "\",";
        json += "\"victimSteamId\":\"" + victimSteamId + "\",";
        json += "\"victimName\":\"" + DSCPlayerTracker.EscapeJsonString(victimName) + "\",";
        json += "\"distance\":" + distance.ToString() + ",";
        json += "\"weapon\":\"" + DSCPlayerTracker.EscapeJsonString(weapon) + "\",";
        json += "\"timestamp\":" + GetGame().GetTime().ToString();
        json += "}";
        AppendLine(json);
    }

    /**
     * Log a player connection event.
     */
    static void LogConnect(string steamId, string name)
    {
        string json = "{";
        json += "\"type\":\"connect\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + DSCPlayerTracker.EscapeJsonString(name) + "\",";
        json += "\"timestamp\":" + GetGame().GetTime().ToString();
        json += "}";
        AppendLine(json);
    }

    /**
     * Log a player disconnect event (with playtime delta).
     */
    static void LogDisconnect(string steamId, string name, int sessionSeconds)
    {
        string json = "{";
        json += "\"type\":\"playtime\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + DSCPlayerTracker.EscapeJsonString(name) + "\",";
        json += "\"seconds\":" + sessionSeconds.ToString() + ",";
        json += "\"timestamp\":" + GetGame().GetTime().ToString();
        json += "}";
        AppendLine(json);
    }

    /**
     * Log a suicide event.
     */
    static void LogSuicide(string steamId, string name)
    {
        string json = "{";
        json += "\"type\":\"suicide\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + DSCPlayerTracker.EscapeJsonString(name) + "\",";
        json += "\"timestamp\":" + GetGame().GetTime().ToString();
        json += "}";
        AppendLine(json);
    }

    /**
     * Append a line to the event log file.
     */
    protected static void AppendLine(string line)
    {
        FileHandle file = OpenFile(EVENT_FILE, FileMode.APPEND);
        if (file != 0)
        {
            FPrintln(file, line);
            CloseFile(file);
        }
    }
};
