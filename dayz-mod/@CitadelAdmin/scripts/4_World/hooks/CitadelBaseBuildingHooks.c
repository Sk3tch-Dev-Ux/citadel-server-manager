/**
 * CitadelBaseBuildingHooks — Base building lifecycle tracking.
 *
 * Hooks into BaseBuildingBase to track:
 * - Construction ownership (who built it)
 * - Placement and destruction events
 * - Persistent identification
 */
modded class BaseBuildingBase
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

    // ─── Base Hit Tracking (matching GameLabs EEHitBy) ──

    private bool m_CitHitTracked = false;

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        // PERF: Early exit chain — cheapest checks first
        if (!GetGame().IsServer()) return;
        if (!source) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        // Resolve attacker via weapon hierarchy parent (GameLabs pattern)
        PlayerBase attacker = PlayerBase.Cast(source.GetHierarchyParent());
        if (!attacker) return;

        string steamId = attacker.GetCitSteamId();
        if (steamId != "")
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                // GameLabs: base object hits do NOT increase shotsHit, only shotsHitBaseObjects
                if (!IsAlive())
                {
                    if (!m_CitHitTracked)
                    {
                        m_CitHitTracked = true;
                        stats.shotsHitBaseObjects++;
                    }
                }
                else
                {
                    stats.shotsHitBaseObjects++;
                }
            }
        }
    }

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
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(playerPos, 15.0, nearestObjects, proxyCargos);

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

modded class TerritoryFlag extends BaseBuildingBase
{
    private ref CitadelTrackedEvent m_CitEvent;
    private ref Timer m_CitUpdateTimer;

    void TerritoryFlag()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        // Deferred init to avoid issues with hard refs during construction
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Call(this._CitInitFlag);
        m_CitUpdateTimer = new Timer(CALL_CATEGORY_SYSTEM);
        // 3601s to avoid accidentally catching the same hour due to rounding
        m_CitUpdateTimer.Run(3601, this, "_CitUpdateEvent", null, true);
    }

    void ~TerritoryFlag()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        if (m_CitEvent) GetCitadel().RemoveEvent(m_CitEvent);
        if (m_CitUpdateTimer) m_CitUpdateTimer.Stop();
    }

    private void _CitInitFlag()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackBaseBuilding()) return;

        string displayName = CitBuildFlagDisplayName();
        m_CitEvent = new CitadelTrackedEvent(GetType(), "flag", this, displayName);
        GetCitadel().RegisterEvent(m_CitEvent);

        vector pos = GetPosition();
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), displayName, pos);
    }

    private void _CitUpdateEvent()
    {
        if (!m_CitEvent) return;
        string displayName = CitBuildFlagDisplayName();
        if (m_CitEvent.GetDisplayName() != displayName)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            _CitInitFlag();
        }
    }

    protected string CitBuildFlagDisplayName()
    {
        float remainingLifetime = GetLifetime() / 3600;
        string owner = CitGetOwner();

        string displayName;
        if (owner != "")
        {
            displayName = string.Format("Territory Flag | Flag Level: %1%% | Lifetime: ~%2h | Owner: %3", Math.Round(GetRefresherTime01() * 100), Math.Round(remainingLifetime), owner);
        }
        else
        {
            displayName = string.Format("Territory Flag | Flag Level: %1%% | Lifetime: ~%2h", Math.Round(GetRefresherTime01() * 100), Math.Round(remainingLifetime));
        }

        return displayName;
    }
};
