/**
 * CitadelMetricsTracker — Server performance and entity metrics collection.
 *
 * Relocated from 4_World to 5_Mission (proper layer).
 * Enhanced: reads entity counts from CitadelCore registries instead of
 * re-scanning the 15km radius each tick, and includes tick time metrics.
 */
class CitadelMetricsTracker
{
    static const string METRICS_FILE = "$profile:Citadel/metrics.json";

    protected ref Timer m_UpdateTimer;
    protected int m_StartTime;

    void CitadelMetricsTracker()
    {
        m_StartTime = GetGame().GetTime();

        int interval = GetCitadel().GetConfiguration().GetMetricsUpdateIntervalMs();
        m_UpdateTimer = new Timer();
        m_UpdateTimer.Run(interval * 0.001, this, "CollectMetrics", null, true);

        GetCitadel().GetLogger().Info(string.Format("Metrics tracker initialized (interval=%1ms)", interval.ToString()));
    }

    void ~CitadelMetricsTracker()
    {
        if (m_UpdateTimer)
            m_UpdateTimer.Stop();
    }

    void CollectMetrics()
    {
        // Player count — use our own registry (GetGame().GetPlayers() can
        // return empty on some DayZ dedicated server versions)
        int playerCount = GetCitadel().GetActivePlayerCount();

        // Entity counts from CitadelCore registries (no 15km scan needed)
        int aiCount = GetCitadel().GetAICount();
        int activeAi = GetCitadel().GetActiveAICount();
        int animalCount = GetCitadel().GetAnimalCount();
        int vehicleCount = GetCitadel().GetVehicleCount();
        int entityCount = GetCitadel().GetEntityCount();

        // Sync tick times from DayZGame to CitadelCore before reading
        GetDayZGame().CitSetAllTickTimeValues();

        // Server performance — measured by CitadelFPSTracker in DayZGame.OnUpdate()
        int fps = GetCitadel().GetServerFPS();
        int fps100 = fps * 100;

        float tickAvg = GetCitadel().GetTickTimeAvg();
        float tickLow = GetCitadel().GetTickTimeLow();
        float tickHigh = GetCitadel().GetTickTimeHigh();

        // Uptime
        int uptime = (GetGame().GetTime() - m_StartTime) / 1000;

        // Dynamic events count
        int eventCount = GetCitadel().GetTrackedEvents().Count();

        // Write metrics JSON
        string json = "{";
        json += "\"fps\":" + fps100.ToString() + ",";
        json += "\"players\":" + playerCount.ToString() + ",";
        json += "\"ai_count\":" + aiCount.ToString() + ",";
        json += "\"active_ai\":" + activeAi.ToString() + ",";
        json += "\"animal_count\":" + animalCount.ToString() + ",";
        json += "\"vehicle_count\":" + vehicleCount.ToString() + ",";
        json += "\"entity_count\":" + entityCount.ToString() + ",";
        json += "\"event_count\":" + eventCount.ToString() + ",";
        json += "\"tick_avg\":" + tickAvg.ToString() + ",";
        json += "\"tick_low\":" + tickLow.ToString() + ",";
        json += "\"tick_high\":" + tickHigh.ToString() + ",";
        json += "\"uptime\":" + uptime.ToString();
        json += "}";

        FileHandle file = OpenFile(METRICS_FILE, FileMode.WRITE);
        if (file != 0)
        {
            FPrintln(file, json);
            CloseFile(file);
        }
    }
};
