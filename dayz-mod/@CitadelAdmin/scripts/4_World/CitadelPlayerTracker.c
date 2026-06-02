/**
 * CitadelPlayerTracker — Periodically writes active player data to a JSON file
 * that the plugin agent reads for player sessions, positions, and status.
 *
 * Enhanced with: vehicle status, speed, energy/water stats, session duration.
 */
class CitadelPlayerTracker
{
    static const string PLAYER_FILE = "$profile:Citadel/players.json";

    protected ref Timer m_UpdateTimer;
    protected ref Timer m_StatsTimer;

    void CitadelPlayerTracker()
    {
        int interval = GetCitadel().GetConfiguration().GetPlayerUpdateIntervalMs();
        m_UpdateTimer = new Timer();
        m_UpdateTimer.Run(interval * 0.001, this, "UpdatePlayerData", null, true);

        // Independent, slower cadence for per-player stats snapshots that feed
        // the cloud anti-cheat pipeline (accuracy/aimbot). Decoupled from the
        // position loop so each can be tuned separately.
        int statsInterval = GetCitadel().GetConfiguration().GetStatsUpdateIntervalMs();
        m_StatsTimer = new Timer();
        m_StatsTimer.Run(statsInterval * 0.001, this, "EmitPlayerStats", null, true);

        GetCitadel().GetLogger().Info(string.Format("Player tracker initialized (interval=%1ms, stats=%2ms)", interval.ToString(), statsInterval.ToString()));
    }

    void ~CitadelPlayerTracker()
    {
        if (m_UpdateTimer)
            m_UpdateTimer.Stop();
        if (m_StatsTimer)
            m_StatsTimer.Stop();
    }

    // Periodic per-player cumulative-stats emit (~30s). Mirrors the active-player
    // iteration in UpdatePlayerData (cast element → identity → plain id) so the
    // steamId keying matches the disconnect-time LogSession path exactly.
    // Gated on the same trackPlayerStats flag the session dump uses.
    void EmitPlayerStats()
    {
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats())
            return;

        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();
        for (int i = 0; i < activePlayers.Count(); i++)
        {
            PlayerBase player = PlayerBase.Cast(activePlayers.GetElement(i));
            if (!player) continue;

            PlayerIdentity identity = player.GetIdentity();
            if (!identity) continue;

            string steamId = identity.GetPlainId();
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
                CitadelEventLogger.LogPlayerStats(steamId, stats);
        }
    }

    void UpdatePlayerData()
    {
        // Use our own registry instead of GetGame().GetPlayers() which
        // can return empty on some DayZ dedicated server versions.
        // The registry is populated by InvokeOnConnect/InvokeOnDisconnect.
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();

        string json = "[";
        bool first = true;

        for (int i = 0; i < activePlayers.Count(); i++)
        {
            string regSteamId = activePlayers.GetKey(i);
            PlayerBase player = PlayerBase.Cast(activePlayers.GetElement(i));
            if (!player) continue;

            PlayerIdentity identity = player.GetIdentity();
            if (!identity) continue;

            if (!first)
                json += ",";
            first = false;

            vector pos = player.GetPosition();
            float health = player.GetHealth("GlobalHealth", "Health");
            float blood = player.GetHealth("GlobalHealth", "Blood");
            float shock = player.GetHealth("GlobalHealth", "Shock");

            // Vehicle status
            bool inVehicle = player.CitIsInVehicle();
            string vehicleType = "";
            if (inVehicle)
            {
                HumanCommandVehicle vehCmd = player.GetCommand_Vehicle();
                if (vehCmd)
                {
                    Transport transport = vehCmd.GetTransport();
                    if (transport)
                        vehicleType = transport.GetType();
                }
            }

            // Survival stats
            float water = 0;
            float energy = 0;
            if (player.GetStatWater())
                water = player.GetStatWater().Get();
            if (player.GetStatEnergy())
                energy = player.GetStatEnergy().Get();

            // Session duration
            string steamId = identity.GetPlainId();
            int sessionDuration = GetCitadel().GetPlayerSessionDuration(steamId);

            json += "{";
            json += "\"steamId\":\"" + steamId + "\",";
            json += "\"name\":\"" + CitadelEventLogger.EscapeJson(identity.GetName()) + "\",";
            json += "\"id\":\"" + identity.GetId() + "\",";
            json += "\"position\":{";
            json += "\"x\":" + pos[0].ToString() + ",";
            json += "\"y\":" + pos[1].ToString() + ",";
            json += "\"z\":" + pos[2].ToString();
            json += "},";
            json += "\"heading\":" + CitGetPlayerDirection(player).ToString() + ",";
            json += "\"health\":" + health.ToString() + ",";
            json += "\"blood\":" + blood.ToString() + ",";
            json += "\"shock\":" + shock.ToString() + ",";
            json += "\"water\":" + water.ToString() + ",";
            json += "\"energy\":" + energy.ToString() + ",";
            string aliveStr = "false";
            if (player.IsAlive()) aliveStr = "true";
            json += "\"alive\":" + aliveStr + ",";
            string vehStr = "false";
            if (inVehicle) vehStr = "true";
            json += "\"inVehicle\":" + vehStr + ",";
            if (inVehicle && vehicleType != "")
                json += "\"vehicleType\":\"" + CitadelEventLogger.EscapeJson(vehicleType) + "\",";
            json += "\"sessionSeconds\":" + sessionDuration.ToString();
            json += "}";
        }

        json += "]";

        FileHandle file = OpenFile(PLAYER_FILE, FileMode.WRITE);
        if (file != 0)
        {
            FPrintln(file, json);
            CloseFile(file);
        }
        else
        {
            Print("[CitadelAdmin] WARNING: Failed to open player data file for writing: " + PLAYER_FILE);
        }
    }
};
