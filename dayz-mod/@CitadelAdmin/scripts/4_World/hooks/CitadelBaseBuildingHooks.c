/**
 * CitadelBaseBuildingHooks — Base building lifecycle tracking.
 *
 * Hooks into BaseBuildingBase to track:
 * - Construction ownership (who built it)
 * - Placement and destruction events
 * - Persistent identification
 */
modded class BaseBuildingBase extends ItemBase
{
    private string m_CitOwnerSteamId = "";
    private string m_CitPersistentId = "";

    // ─── Lifecycle Hooks ──────────────────────────────

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackBaseBuilding()) return;

        // Generate a persistent ID for this base component
        if (m_CitPersistentId == "")
            m_CitPersistentId = CitGeneratePersistentId();

        GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] EEInit %1 (type=%2, id=%3)", this, GetType(), m_CitPersistentId));
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && GetCitadel().GetConfiguration().GetTrackBaseBuilding())
        {
            GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] EEDelete %1 (type=%2, owner=%3)", this, GetType(), m_CitOwnerSteamId));

            if (m_CitOwnerSteamId != "")
            {
                vector pos = GetPosition();
                CitadelEventLogger.LogBaseDestroyed(m_CitOwnerSteamId, GetType(), pos);
            }
        }

        super.EEDelete(parent);
    }

    // ─── Ownership ────────────────────────────────────

    void CitSetOwner(string steamId)
    {
        m_CitOwnerSteamId = steamId;
        GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] Owner set: %1 for %2", steamId, GetType()));
    }

    string CitGetOwner() { return m_CitOwnerSteamId; }
    string CitGetPersistentId() { return m_CitPersistentId; }

    // ─── Utility ──────────────────────────────────────

    protected string CitGeneratePersistentId()
    {
        // Generate a unique ID based on position + type + time
        vector pos = GetPosition();
        string raw = string.Format("%1_%2_%3_%4_%5", GetType(), pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetGame().GetTime().ToString());
        return raw;
    }
};

// ─── Territory Flag Kit (Ownership Capture) ─────────────

modded class TerritoryFlagKit
{
    override void OnPlacementComplete(Man player, vector position = "0 0 0", vector orientation = "0 0 0")
    {
        super.OnPlacementComplete(player, position, orientation);

        if (!GetGame().IsServer()) return;

        PlayerBase playerBase = PlayerBase.Cast(player);
        if (!playerBase) return;

        PlayerIdentity identity = playerBase.GetIdentity();
        if (!identity) return;

        string steamId = identity.GetPlainId();

        // Find the TerritoryFlag that was just created nearby
        vector playerPos = player.GetPosition();
        ref array<Object> nearestObjects = new array<Object>();
        GetGame().GetObjectsAtPosition(playerPos, 15.0, nearestObjects, null);

        TerritoryFlag relatedFlag;
        foreach (Object nearestObject : nearestObjects)
        {
            EntityAI ent = EntityAI.Cast(nearestObject);
            if (!ent) continue;
            if (ent.GetType() != "TerritoryFlag") continue;

            TerritoryFlag tmpFlag = TerritoryFlag.Cast(ent);
            if (tmpFlag && tmpFlag.CitGetOwner() == "")
            {
                relatedFlag = tmpFlag;
                break;
            }
        }

        if (relatedFlag)
        {
            relatedFlag.CitSetOwner(steamId);
            GetCitadel().GetLogger().Debug(string.Format("[TerritoryFlagKit] Owner %1 associated with flag at %2", steamId, playerPos.ToString()));
        }
        else
        {
            GetCitadel().GetLogger().Debug(string.Format("[TerritoryFlagKit] No TerritoryFlag found near %1 for owner %2", playerPos.ToString(), steamId));
        }
    }
};

// ─── Territory Flag (Map Marker + Lifetime Display) ─────

modded class TerritoryFlag
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackBaseBuilding()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        string displayName = CitBuildFlagDisplayName();
        m_CitEvent = new CitadelTrackedEvent(GetType(), "flag", this, displayName);
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), displayName, pos);

        // Refresh display name every hour (3600000ms)
        GetGame().GetCallQueue(CALL_CATEGORY_GAMEPLAY).CallLater(CitRefreshDisplayName, 3600000, true);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer())
        {
            GetGame().GetCallQueue(CALL_CATEGORY_GAMEPLAY).Remove(CitRefreshDisplayName);

            if (m_CitEvent)
            {
                GetCitadel().RemoveEvent(m_CitEvent);
                CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Territory Flag", GetPosition());
            }
        }

        super.EEDelete(parent);
    }

    void CitRefreshDisplayName()
    {
        if (!m_CitEvent) return;
        m_CitEvent.SetDisplayName(CitBuildFlagDisplayName());
    }

    protected string CitBuildFlagDisplayName()
    {
        string name = "Territory Flag";
        string owner = CitGetOwner();
        if (owner != "")
            name = name + " | Owner: " + owner;

        float lifetime01 = GetRefresherTime01();
        int lifetimePct = Math.Round(lifetime01 * 100);
        name = name + " | Lifetime: " + lifetimePct.ToString() + "%";

        return name;
    }
};
