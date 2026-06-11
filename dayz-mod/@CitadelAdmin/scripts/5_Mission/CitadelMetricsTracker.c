/**
 * CitadelMetricsTracker — Server performance and entity metrics collection.
 *
 * Relocated from 4_World to 5_Mission (proper layer).
 * Enhanced: reads entity counts from CitadelCore registries instead of
 * re-scanning the 15km radius each tick, and includes tick time metrics.
 *
 * The payload is engine-serialized (JsonFileLoader) and written atomically
 * (.tmp + copy) so the sidecar and cloud client never parse a torn file.
 * Also exports weather, the in-game clock, and FPS window min/max.
 */

// Wire format for metrics.json. Member names ARE the JSON field names
// (JsonFileLoader serializes them verbatim), so they stay snake_case to
// match what the sidecar and cloud ingest already expect.
class CitadelMetricsDTO
{
    int fps;              // server FPS * 100 (sidecar divides back)
    int fps_min;          // lowest 1s FPS sample in the collection window
    int fps_max;          // highest 1s FPS sample in the collection window
    int players;
    int ai_count;
    int active_ai;
    int animal_count;
    int vehicle_count;
    int entity_count;
    int event_count;
    float tick_avg;
    float tick_low;
    float tick_high;
    int uptime;
    float weather_rain;   // 0..1
    float weather_fog;    // 0..1
    float weather_clouds; // 0..1 (overcast)
    float weather_snow;   // 0..1
    float wind_speed;     // m/s
    int game_hour;        // in-game clock
    int game_minute;
};

class CitadelMetricsTracker
{
    static const string METRICS_FILE = "$profile:Citadel/metrics.json";
    static const string METRICS_TMP = "$profile:Citadel/metrics.json.tmp";

    protected ref Timer m_UpdateTimer;
    protected int m_StartTime;
    protected ref CitadelMetricsDTO m_DTO;

    void CitadelMetricsTracker()
    {
        m_StartTime = GetGame().GetTime();
        m_DTO = new CitadelMetricsDTO();

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
        m_DTO.players = GetCitadel().GetActivePlayerCount();

        // Entity counts from CitadelCore registries (no 15km scan needed)
        m_DTO.ai_count = GetCitadel().GetAICount();
        m_DTO.active_ai = GetCitadel().GetActiveAICount();
        m_DTO.animal_count = GetCitadel().GetAnimalCount();
        m_DTO.vehicle_count = GetCitadel().GetVehicleCount();
        m_DTO.entity_count = GetCitadel().GetEntityCount();

        // Sync tick times + FPS window from DayZGame to CitadelCore before
        // reading. This also closes the FPS sampling window.
        GetDayZGame().CitSetAllTickTimeValues();

        // Server performance — measured by CitadelFPSTracker in DayZGame.OnUpdate()
        m_DTO.fps = GetCitadel().GetServerFPS() * 100;
        m_DTO.fps_min = GetCitadel().GetFPSWindowMin();
        m_DTO.fps_max = GetCitadel().GetFPSWindowMax();

        m_DTO.tick_avg = GetCitadel().GetTickTimeAvg();
        m_DTO.tick_low = GetCitadel().GetTickTimeLow();
        m_DTO.tick_high = GetCitadel().GetTickTimeHigh();

        m_DTO.uptime = (GetGame().GetTime() - m_StartTime) / 1000;
        m_DTO.event_count = GetCitadel().GetTrackedEvents().Count();

        CollectEnvironment();
        WriteAtomic();
    }

    // Weather + in-game clock. All reads are O(1) engine getters.
    protected void CollectEnvironment()
    {
        Weather weather = GetGame().GetWeather();
        if (weather)
        {
            m_DTO.weather_rain = weather.GetRain().GetActual();
            m_DTO.weather_fog = weather.GetFog().GetActual();
            m_DTO.weather_clouds = weather.GetOvercast().GetActual();
            m_DTO.weather_snow = weather.GetSnowfall().GetActual();
            m_DTO.wind_speed = weather.GetWindSpeed();
        }

        int year;
        int month;
        int day;
        int hour;
        int minute;
        GetGame().GetWorld().GetDate(year, month, day, hour, minute);
        m_DTO.game_hour = hour;
        m_DTO.game_minute = minute;
    }

    // Serialize to a temp file, then copy over the real path. Enforce has no
    // rename, so copy is the closest to atomic we get — the destination is
    // rewritten in one fast engine call instead of incremental FPrintln
    // lines, so readers (sidecar, cloud client) never see a half-written file.
    protected void WriteAtomic()
    {
        JsonFileLoader<CitadelMetricsDTO>.JsonSaveFile(METRICS_TMP, m_DTO);
        if (CopyFile(METRICS_TMP, METRICS_FILE))
            DeleteFile(METRICS_TMP);
    }
};
