/**
 * CitadelHouseHooks — Building/structure map marker tracking.
 *
 * Hooks into House to register configurable map markers for world buildings
 * (Land_House_*, Land_Factory_*, etc.) based on MapMarkers.json config.
 *
 * Separate from CitadelBaseBuildingHooks.c which tracks player-built structures.
 */
modded class House
{
    private ref CitadelTrackedEvent m_CitMarkerEvent;

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackMapMarkers()) return;

        string className = GetType();
        CitadelMapMarkerEntry config = GetMarkerManager().GetConfig(className);
        if (!config) return;

        // Build a stable ID for duplicate tracking
        string objectId = className + "_" + GetPosition().ToString();
        if (GetMarkerManager().IsRegistered(objectId)) return;

        string displayName = config.displayName;
        if (displayName == "")
            displayName = className;

        m_CitMarkerEvent = new CitadelTrackedEvent(className, config.icon, this, displayName);
        GetCitadel().RegisterEvent(m_CitMarkerEvent);
        GetMarkerManager().MarkRegistered(objectId);

        GetCitadel().GetLogger().Debug(string.Format("[MapMarker] Registered building: %1 (%2)", displayName, className));
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitMarkerEvent)
        {
            string className = GetType();
            string objectId = className + "_" + GetPosition().ToString();

            GetCitadel().RemoveEvent(m_CitMarkerEvent);
            GetMarkerManager().UnmarkRegistered(objectId);
            m_CitMarkerEvent = null;

            GetCitadel().GetLogger().Debug(string.Format("[MapMarker] Unregistered building: %1", className));
        }

        super.EEDelete(parent);
    }
};
