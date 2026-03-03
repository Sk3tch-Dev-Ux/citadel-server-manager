/**
 * CitadelMapMarkerManager — Configurable map marker system.
 *
 * Loads marker definitions from MapMarkers.json and tracks which objects
 * have been registered as map events. Server hosts configure which DayZ
 * classNames should appear on the live map with custom icons and names.
 *
 * Access via global function: GetMarkerManager()
 */

// ─── Config Data Classes (for JsonFileLoader) ────────────

class CitadelMapMarkerEntry
{
    string className;
    string icon;
    string displayName;
};

class CitadelMapMarkerConfig
{
    ref array<ref CitadelMapMarkerEntry> markers = new array<ref CitadelMapMarkerEntry>;
};

// ─── Manager Singleton ───────────────────────────────────

class CitadelMapMarkerManager
{
    private static const string CONFIG_PATH = "$profile:Citadel/MapMarkers.json";

    private ref map<string, ref CitadelMapMarkerEntry> m_ItemConfigs;
    private ref map<string, bool> m_RegisteredObjects;

    void CitadelMapMarkerManager()
    {
        m_ItemConfigs = new map<string, ref CitadelMapMarkerEntry>;
        m_RegisteredObjects = new map<string, bool>;

        LoadConfig();
    }

    // ─── Config Loading ──────────────────────────────────

    protected void LoadConfig()
    {
        if (FileExist(CONFIG_PATH))
        {
            CitadelMapMarkerConfig cfg = new CitadelMapMarkerConfig();
            JsonFileLoader<CitadelMapMarkerConfig>.JsonLoadFile(CONFIG_PATH, cfg);

            if (cfg.markers)
            {
                for (int i = 0; i < cfg.markers.Count(); i++)
                {
                    CitadelMapMarkerEntry entry = cfg.markers.Get(i);
                    if (entry && entry.className != "")
                    {
                        m_ItemConfigs.Set(entry.className, entry);
                    }
                }
            }

            GetCitadel().GetLogger().Info(string.Format("MapMarkerManager loaded %1 marker definitions", m_ItemConfigs.Count().ToString()));
        }
        else
        {
            SaveDefaults();
            GetCitadel().GetLogger().Info("MapMarkerManager created default config");
        }
    }

    protected void SaveDefaults()
    {
        CitadelMapMarkerConfig cfg = new CitadelMapMarkerConfig();

        CitadelMapMarkerEntry e1 = new CitadelMapMarkerEntry();
        e1.className = "SeaChest";
        e1.icon = "chest";
        e1.displayName = "Sea Chest";
        cfg.markers.Insert(e1);

        CitadelMapMarkerEntry e2 = new CitadelMapMarkerEntry();
        e2.className = "Barrel_Green";
        e2.icon = "barrel";
        e2.displayName = "Barrel (Green)";
        cfg.markers.Insert(e2);

        CitadelMapMarkerEntry e3 = new CitadelMapMarkerEntry();
        e3.className = "Barrel_Blue";
        e3.icon = "barrel";
        e3.displayName = "Barrel (Blue)";
        cfg.markers.Insert(e3);

        JsonFileLoader<CitadelMapMarkerConfig>.JsonSaveFile(CONFIG_PATH, cfg);

        // Also populate the in-memory lookup
        for (int i = 0; i < cfg.markers.Count(); i++)
        {
            CitadelMapMarkerEntry entry = cfg.markers.Get(i);
            m_ItemConfigs.Set(entry.className, entry);
        }
    }

    // ─── Lookup ──────────────────────────────────────────

    CitadelMapMarkerEntry GetConfig(string className)
    {
        if (m_ItemConfigs.Contains(className))
            return m_ItemConfigs.Get(className);
        return null;
    }

    bool HasConfig(string className)
    {
        return m_ItemConfigs.Contains(className);
    }

    int GetConfigCount()
    {
        return m_ItemConfigs.Count();
    }

    // ─── Registration Tracking ───────────────────────────

    bool IsRegistered(string objectId)
    {
        return m_RegisteredObjects.Contains(objectId);
    }

    void MarkRegistered(string objectId)
    {
        m_RegisteredObjects.Set(objectId, true);
    }

    void UnmarkRegistered(string objectId)
    {
        m_RegisteredObjects.Remove(objectId);
    }
};

// ─── Global Singleton Access ─────────────────────────────

private static ref CitadelMapMarkerManager g_MarkerManager;

static ref CitadelMapMarkerManager GetMarkerManager()
{
    if (!g_MarkerManager)
    {
        g_MarkerManager = new CitadelMapMarkerManager();
    }
    return g_MarkerManager;
};
