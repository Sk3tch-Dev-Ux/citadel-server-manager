/**
 * CitadelEventLogger — Comprehensive game event logging to JSONL.
 *
 * Logs all significant game events to $profile:Citadel/events.jsonl
 * in a format the plugin agent tails and forwards to Citadel Cloud.
 *
 * Event types:
 *   kill, suicide, death, connect, playtime, chat,
 *   hit, baseBuilt, baseDestroyed, dynamicEvent,
 *   speedFlag, session, vehicleEnter, vehicleExit
 */
class CitadelEventLogger
{
    static const string EVENT_FILE = "$profile:Citadel/events.jsonl";

    // ─── Player Events ────────────────────────────────

    static void LogKill(string killerSteamId, string killerName, string victimSteamId, string victimName, float distance, string weapon)
    {
        string json = "{";
        json += "\"type\":\"kill\",";
        json += "\"steamId\":\"" + killerSteamId + "\",";
        json += "\"name\":\"" + EscapeJson(killerName) + "\",";
        json += "\"victimSteamId\":\"" + victimSteamId + "\",";
        json += "\"victimName\":\"" + EscapeJson(victimName) + "\",";
        json += "\"distance\":" + distance.ToString() + ",";
        json += "\"weapon\":\"" + EscapeJson(weapon) + "\",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogSuicide(string steamId, string name)
    {
        string json = "{";
        json += "\"type\":\"suicide\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogDeath(string steamId, string name, string cause)
    {
        string json = "{";
        json += "\"type\":\"death\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"cause\":\"" + EscapeJson(cause) + "\",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogConnect(string steamId, string name)
    {
        string json = "{";
        json += "\"type\":\"connect\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogDisconnect(string steamId, string name, int sessionSeconds)
    {
        string json = "{";
        json += "\"type\":\"playtime\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"seconds\":" + sessionSeconds.ToString() + ",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogChat(string steamId, string name, string message, string channel)
    {
        string json = "{";
        json += "\"type\":\"chat\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"message\":\"" + EscapeJson(message) + "\",";
        json += "\"channel\":\"" + channel + "\",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Combat Events ────────────────────────────────

    static void LogHit(string victimSteamId, string victimName, string attackerSteamId, string attackerName, string weapon, string ammo, string zone, float damage)
    {
        string json = "{";
        json += "\"type\":\"hit\",";
        json += "\"steamId\":\"" + victimSteamId + "\",";
        json += "\"name\":\"" + EscapeJson(victimName) + "\",";
        json += "\"attackerSteamId\":\"" + attackerSteamId + "\",";
        json += "\"attackerName\":\"" + EscapeJson(attackerName) + "\",";
        json += "\"weapon\":\"" + EscapeJson(weapon) + "\",";
        json += "\"ammo\":\"" + EscapeJson(ammo) + "\",";
        json += "\"zone\":\"" + EscapeJson(zone) + "\",";
        json += "\"damage\":" + damage.ToString() + ",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Base Building Events ─────────────────────────

    static void LogBaseBuilt(string steamId, string className, vector pos)
    {
        string json = "{";
        json += "\"type\":\"baseBuilt\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"className\":\"" + EscapeJson(className) + "\",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogBaseDestroyed(string ownerSteamId, string className, vector pos)
    {
        string json = "{";
        json += "\"type\":\"baseDestroyed\",";
        json += "\"steamId\":\"" + ownerSteamId + "\",";
        json += "\"className\":\"" + EscapeJson(className) + "\",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Dynamic World Events ─────────────────────────

    static void LogDynamicEvent(string action, string className, string displayName, vector pos)
    {
        string json = "{";
        json += "\"type\":\"dynamicEvent\",";
        json += "\"action\":\"" + action + "\",";
        json += "\"className\":\"" + EscapeJson(className) + "\",";
        json += "\"displayName\":\"" + EscapeJson(displayName) + "\",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Anti-Cheat Events ────────────────────────────

    static void LogSpeedFlag(string steamId, string name, float speed, vector pos, int triggerCount)
    {
        string json = "{";
        json += "\"type\":\"speedFlag\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"speed\":" + speed.ToString() + ",";
        json += "\"triggers\":" + triggerCount.ToString() + ",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Session Statistics ───────────────────────────

    static void LogSession(string steamId, string name, int durationSeconds, string statsJson)
    {
        string json = "{";
        json += "\"type\":\"session\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"duration\":" + durationSeconds.ToString() + ",";
        json += "\"stats\":" + statsJson + ",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Vehicle Events ───────────────────────────────

    static void LogVehicleEnter(string steamId, string name, string vehicleType, vector pos)
    {
        string json = "{";
        json += "\"type\":\"vehicleEnter\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"vehicleType\":\"" + EscapeJson(vehicleType) + "\",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    static void LogVehicleExit(string steamId, string name, string vehicleType, vector pos)
    {
        string json = "{";
        json += "\"type\":\"vehicleExit\",";
        json += "\"steamId\":\"" + steamId + "\",";
        json += "\"name\":\"" + EscapeJson(name) + "\",";
        json += "\"vehicleType\":\"" + EscapeJson(vehicleType) + "\",";
        json += "\"position\":{";
        json += "\"x\":" + pos[0].ToString() + ",";
        json += "\"y\":" + pos[1].ToString() + ",";
        json += "\"z\":" + pos[2].ToString();
        json += "},";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"";
        json += "}";
        AppendLine(json);
    }

    // ─── Utility ──────────────────────────────────────

    protected static void AppendLine(string line)
    {
        FileHandle file = OpenFile(EVENT_FILE, FileMode.APPEND);
        if (file != 0)
        {
            FPrintln(file, line);
            CloseFile(file);
        }
    }

    static string EscapeJson(string input)
    {
        string output = input;
        output.Replace("\"", "'");
        output.Replace("\n", " ");
        output.Replace("\r", " ");
        output.Replace("\t", " ");
        return output;
    }
};
