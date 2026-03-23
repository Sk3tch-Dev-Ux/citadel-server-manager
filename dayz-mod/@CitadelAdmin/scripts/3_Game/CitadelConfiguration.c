/**
 * CitadelConfiguration — Loads and manages mod settings from citadel.cfg.
 *
 * Uses DayZ's JsonFileLoader to deserialize the config file into this class.
 * All settings have sane defaults so the mod works out-of-the-box.
 */
class CitadelConfiguration
{
    // General
    bool debugEnabled = false;

    // Intervals (milliseconds)
    int pollIntervalMs = 500;
    int playerUpdateIntervalMs = 5000;
    int metricsUpdateIntervalMs = 15000;
    int reportingIntervalMs = 10000;

    // Anti-cheat: speed hack detection
    bool speedCheckEnabled = false;
    float speedCheckThresholdFoot = 8.0;
    float speedCheckThresholdVehicle = 100.0;
    int speedCheckTriggerCount = 3;

    // Anti-cheat: magic bullet detection
    bool enableMagicBulletCheck = false;
    bool enableMagicBulletInvalidation = false;

    // Chat
    bool chatSanitizeBattlEyePrefix = false;
    bool chatSanitizeBattlEyeJoinLeave = false;

    // Tracking features
    bool trackDynamicEvents = true;
    bool trackVehicles = true;
    bool trackBaseBuilding = true;
    bool trackPlayerStats = true;
    bool trackItems = true;
    bool trackMapMarkers = true;

    // Player tick interval (seconds) for speed check / distance tracking
    float playerTickInterval = 2.0;

    // Metrics
    bool enableMetricsDump = false;

    [NonSerialized()]
    private static const string CONFIG_PATH = "$profile:citadel.cfg";

    bool CheckDiskPresence()
    {
        return FileExist(CONFIG_PATH);
    }

    void LoadFromDisk()
    {
        JsonFileLoader<CitadelConfiguration>.JsonLoadFile(CONFIG_PATH, this);
        ValidateAndExtend();
    }

    void SaveDefaults()
    {
        JsonFileLoader<CitadelConfiguration>.JsonSaveFile(CONFIG_PATH, this);
    }

    // Getters
    bool GetDebugEnabled() { return debugEnabled; }
    int GetPollIntervalMs() { return pollIntervalMs; }
    int GetPlayerUpdateIntervalMs() { return playerUpdateIntervalMs; }
    int GetMetricsUpdateIntervalMs() { return metricsUpdateIntervalMs; }
    int GetReportingIntervalMs() { return reportingIntervalMs; }

    bool GetSpeedCheckEnabled() { return speedCheckEnabled; }
    float GetSpeedCheckThresholdFoot() { return speedCheckThresholdFoot; }
    float GetSpeedCheckThresholdVehicle() { return speedCheckThresholdVehicle; }
    int GetSpeedCheckTriggerCount() { return speedCheckTriggerCount; }

    bool GetMagicBulletCheckEnabled() { return enableMagicBulletCheck; }
    bool GetMagicBulletInvalidateEnabled() { return enableMagicBulletInvalidation; }

    bool GetChatSanitizeBattlEyePrefix() { return chatSanitizeBattlEyePrefix; }
    bool GetChatSanitizeBattlEyeJoinLeave() { return chatSanitizeBattlEyeJoinLeave; }

    bool GetTrackDynamicEvents() { return trackDynamicEvents; }
    bool GetTrackVehicles() { return trackVehicles; }
    bool GetTrackBaseBuilding() { return trackBaseBuilding; }
    bool GetTrackPlayerStats() { return trackPlayerStats; }
    bool GetTrackItems() { return trackItems; }
    bool GetTrackMapMarkers() { return trackMapMarkers; }

    float GetPlayerTickInterval() { return playerTickInterval; }

    bool GetMetricsDump() { return enableMetricsDump; }

    protected void ValidateAndExtend()
    {
        if (pollIntervalMs < 100)
            pollIntervalMs = 500;
        if (playerUpdateIntervalMs < 1000)
            playerUpdateIntervalMs = 5000;
        if (metricsUpdateIntervalMs < 5000)
            metricsUpdateIntervalMs = 15000;
        if (reportingIntervalMs < 5000)
            reportingIntervalMs = 10000;
        if (speedCheckThresholdFoot <= 1.0)
            speedCheckThresholdFoot = 8.0;
        if (speedCheckThresholdVehicle <= 1.0)
            speedCheckThresholdVehicle = 100.0;
        if (speedCheckTriggerCount < 1)
            speedCheckTriggerCount = 3;
        if (playerTickInterval < 0.5)
            playerTickInterval = 2.0;
    }
};
