/**
 * CitadelItemHooks — Item interaction and map marker tracking.
 *
 * Hooks into ItemBase to track:
 * - Items picked up by players
 * - Items dropped by players
 * - Weapon looting
 * - Configurable map markers (register/unregister based on MapMarkers.json)
 */
modded class ItemBase extends InventoryItem
{
    private ref CitadelTrackedEvent m_CitMarkerEvent;
    float m_CitStartQty; // Used by action hooks to measure food/drink consumption

    void ItemBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;
        GetCitadel().IncrEntityCount();
    }

    void ~ItemBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;
        GetCitadel().DecrEntityCount();
    }

    // ─── Map Marker Registration ─────────────────────────

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackMapMarkers()) return;

        RegisterMapMarker();
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer())
        {
            UnregisterMapMarker();
        }

        super.EEDelete(parent);
    }

    protected void RegisterMapMarker()
    {
        if (m_CitMarkerEvent) return; // Already registered

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

        GetCitadel().GetLogger().Debug(string.Format("[MapMarker] Registered item: %1 (%2)", displayName, className));
    }

    protected void UnregisterMapMarker()
    {
        if (!m_CitMarkerEvent) return;

        string className = GetType();
        string objectId = className + "_" + GetPosition().ToString();

        GetCitadel().RemoveEvent(m_CitMarkerEvent);
        GetMarkerManager().UnmarkRegistered(objectId);
        m_CitMarkerEvent = null;

        GetCitadel().GetLogger().Debug(string.Format("[MapMarker] Unregistered item: %1", className));
    }

    // ─── Item Pickup / Drop Tracking ─────────────────────

    override void EEItemLocationChanged(notnull InventoryLocation oldLoc, notnull InventoryLocation newLoc)
    {
        super.EEItemLocationChanged(oldLoc, newLoc);

        if (!GetGame().IsServer()) return;

        // PERF: Cache config reference once (avoids 4x GetCitadel().GetConfiguration() chain)
        CitadelConfiguration cfg = GetCitadel().GetConfiguration();
        bool trackItems = cfg.GetTrackItems();
        bool trackMarkers = cfg.GetTrackMapMarkers();

        // Early exit if nothing to track
        if (!trackItems && !trackMarkers) return;

        PlayerBase oldPlayer = null;
        PlayerBase newPlayer = null;

        // Resolve the root player for old and new locations
        EntityAI oldParent = oldLoc.GetParent();
        if (oldParent)
            oldPlayer = PlayerBase.Cast(oldParent.GetHierarchyRootPlayer());

        EntityAI newParent = newLoc.GetParent();
        if (newParent)
            newPlayer = PlayerBase.Cast(newParent.GetHierarchyRootPlayer());

        // Track pickup/drop stats (matching GameLabs pattern)
        if (newPlayer && newPlayer != oldPlayer)
        {
            // Unregister map marker when picked up
            if (trackMarkers)
                UnregisterMapMarker();

            if (trackItems)
            {
                string steamId = newPlayer.GetCitSteamId();
                if (steamId != "")
                {
                    CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                    if (stats)
                    {
                        stats.itemsPickedUp++;

                        // player -> player transfer (looting body/player)
                        if (oldPlayer)
                            stats.playersLooted++;

                        // AI (infected/animal) -> player
                        if (oldParent && (oldParent.IsInherited(DayZInfected) || oldParent.IsInherited(AnimalBase)))
                            stats.aiLooted++;

                        // Track weapon looting from any source
                        if (IsInherited(Weapon_Base))
                            stats.weaponsLooted++;
                    }
                }
            }
        }

        if (oldPlayer && oldPlayer != newPlayer)
        {
            // Re-register map marker when dropped back to world
            if (!newPlayer && trackMarkers)
                RegisterMapMarker();

            if (trackItems)
            {
                string dropSteamId = oldPlayer.GetCitSteamId();
                if (dropSteamId != "")
                {
                    CitadelPlayerStats dropStats = GetCitadel().GetPlayerStats(dropSteamId);
                    if (dropStats)
                        dropStats.itemsDropped++;
                }
            }
        }
    }
};
