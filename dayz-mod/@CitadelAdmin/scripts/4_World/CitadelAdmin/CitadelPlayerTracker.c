/**
 * CitadelPlayerTracker — Periodically writes active player data to a JSON file
 * that the sidecar reads for player sessions, positions, and status.
 */
class CitadelPlayerTracker
{
    static const string PLAYER_FILE = "$profile:Citadel\\players.json";
    static const int UPDATE_INTERVAL_MS = 5000; // 5 seconds

    protected ref Timer m_UpdateTimer;

    void CitadelPlayerTracker()
    {
        m_UpdateTimer = new Timer();
        m_UpdateTimer.Run(UPDATE_INTERVAL_MS * 0.001, this, "UpdatePlayerData", null, true);
        Print("[Citadel] Player tracker initialized");
    }

    void ~CitadelPlayerTracker()
    {
        if (m_UpdateTimer)
            m_UpdateTimer.Stop();
    }

    void UpdatePlayerData()
    {
        ref array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);

        string json = "[";
        bool first = true;

        foreach (Man man : players)
        {
            PlayerBase player = PlayerBase.Cast(man);
            if (!player)
                continue;

            PlayerIdentity identity = player.GetIdentity();
            if (!identity)
                continue;

            if (!first)
                json += ",";
            first = false;

            vector pos = player.GetPosition();
            float health = player.GetHealth("GlobalHealth", "Health");
            float blood = player.GetHealth("GlobalHealth", "Blood");
            float shock = player.GetHealth("GlobalHealth", "Shock");

            json += "{";
            json += "\"steamId\":\"" + identity.GetPlainId() + "\",";
            json += "\"name\":\"" + EscapeJsonString(identity.GetName()) + "\",";
            json += "\"id\":\"" + identity.GetId() + "\",";
            json += "\"position\":{";
            json += "\"x\":" + pos[0].ToString() + ",";
            json += "\"y\":" + pos[1].ToString() + ",";
            json += "\"z\":" + pos[2].ToString();
            json += "},";
            json += "\"health\":" + health.ToString() + ",";
            json += "\"blood\":" + blood.ToString() + ",";
            json += "\"shock\":" + shock.ToString() + ",";
            json += "\"alive\":" + (player.IsAlive() ? "true" : "false") + ",";
            json += "\"ping\":" + identity.GetPing().ToString() + ",";
            json += "\"loaded\":true,";
            json += "\"source\":\"inhouse\"";
            json += "}";
        }

        json += "]";

        // Write to file
        FileHandle file = OpenFile(PLAYER_FILE, FileMode.WRITE);
        if (file != 0)
        {
            FPrintln(file, json);
            CloseFile(file);
        }
    }

    /**
     * Escape special characters in a string for JSON.
     */
    static string EscapeJsonString(string input)
    {
        string output = input;
        // Replace backslash first, then quotes
        output.Replace("\\", "\\\\");
        output.Replace("\"", "\\\"");
        output.Replace("\n", "\\n");
        output.Replace("\r", "\\r");
        output.Replace("\t", "\\t");
        return output;
    }
};
