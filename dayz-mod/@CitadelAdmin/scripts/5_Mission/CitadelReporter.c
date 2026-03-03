/**
 * CitadelReporter — Periodic telemetry reporting.
 *
 * Provides enhanced data export beyond basic metrics:
 * - Vehicle position snapshots (only vehicles that moved)
 * - Dynamic event list (active world events)
 * - Flushable on shutdown
 */
class CitadelReporter
{
    static const string VEHICLES_FILE = "$profile:Citadel/vehicles.json";
    static const string EVENTS_FILE = "$profile:Citadel/events_world.json";

    protected ref Timer m_ReportTimer;

    void CitadelReporter()
    {
        int interval = GetCitadel().GetConfiguration().GetReportingIntervalMs();
        m_ReportTimer = new Timer();
        m_ReportTimer.Run(interval * 0.001, this, "Report", null, true);

        GetCitadel().GetLogger().Info(string.Format("Reporter initialized (interval=%1ms)", interval.ToString()));
    }

    void ~CitadelReporter()
    {
        if (m_ReportTimer)
            m_ReportTimer.Stop();
    }

    void Report()
    {
        if (GetCitadel().GetConfiguration().GetTrackVehicles())
            ReportVehicles();

        if (GetCitadel().GetConfiguration().GetTrackDynamicEvents())
            ReportEvents();
    }

    void FlushAll()
    {
        ReportVehicles();
        ReportEvents();
        GetCitadel().GetLogger().Debug("Reporter flushed all data");
    }

    // ─── Vehicle Positions ────────────────────────────

    protected void ReportVehicles()
    {
        array<ref CitadelTrackedVehicle> vehicles = GetCitadel().GetTrackedVehicles();

        string json = "[";
        bool first = true;

        for (int i = 0; i < vehicles.Count(); i++)
        {
            CitadelTrackedVehicle tracked = vehicles.Get(i);
            if (!tracked || !tracked.Ref()) continue;

            if (!first)
                json += ",";
            first = false;

            vector pos = tracked.Ref().GetPosition();

            // Get damage state
            float health = 0;
            float maxHealth = 0;
            EntityAI entity = EntityAI.Cast(tracked.Ref());
            if (entity)
            {
                health = entity.GetHealth("", "Health");
                maxHealth = entity.GetMaxHealth("", "Health");
            }

            json += "{";
            json += "\"id\":\"" + tracked.GetID() + "\",";
            json += "\"className\":\"" + CitadelEventLogger.EscapeJson(tracked.GetClassName()) + "\",";
            json += "\"type\":\"" + tracked.GetVehicleType() + "\",";
            json += "\"icon\":\"" + tracked.GetIcon() + "\",";
            json += "\"position\":{";
            json += "\"x\":" + pos[0].ToString() + ",";
            json += "\"y\":" + pos[1].ToString() + ",";
            json += "\"z\":" + pos[2].ToString();
            json += "},";
            json += "\"health\":" + health.ToString() + ",";
            json += "\"maxHealth\":" + maxHealth.ToString();
            json += "}";
        }

        json += "]";

        FileHandle file = OpenFile(VEHICLES_FILE, FileMode.WRITE);
        if (file != 0)
        {
            FPrintln(file, json);
            CloseFile(file);
        }
    }

    // ─── Dynamic World Events ─────────────────────────

    protected void ReportEvents()
    {
        array<ref CitadelTrackedEvent> events = GetCitadel().GetTrackedEvents();

        string json = "[";
        bool first = true;

        for (int i = 0; i < events.Count(); i++)
        {
            CitadelTrackedEvent tracked = events.Get(i);
            if (!tracked || !tracked.Ref()) continue;

            if (!first)
                json += ",";
            first = false;

            vector pos = tracked.Ref().GetPosition();

            json += "{";
            json += "\"id\":\"" + tracked.GetID() + "\",";
            json += "\"className\":\"" + CitadelEventLogger.EscapeJson(tracked.GetClassName()) + "\",";
            json += "\"displayName\":\"" + CitadelEventLogger.EscapeJson(tracked.GetDisplayName()) + "\",";
            json += "\"icon\":\"" + tracked.GetIcon() + "\",";
            json += "\"position\":{";
            json += "\"x\":" + pos[0].ToString() + ",";
            json += "\"y\":" + pos[1].ToString() + ",";
            json += "\"z\":" + pos[2].ToString();
            json += "}";
            json += "}";
        }

        json += "]";

        FileHandle file = OpenFile(EVENTS_FILE, FileMode.WRITE);
        if (file != 0)
        {
            FPrintln(file, json);
            CloseFile(file);
        }
    }
};
