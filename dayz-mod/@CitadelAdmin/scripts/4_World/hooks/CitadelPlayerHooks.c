/**
 * CitadelPlayerHooks — Deep PlayerBase integration.
 *
 * Hooks into the player lifecycle to provide:
 * - Per-player identity tracking (steamId, name, session)
 * - Damage source tracking (weapon, ammo, attacker)
 * - Death event processing with full context
 * - Speed hack detection
 * - Distance traveled accumulation
 * - Session statistics
 */
modded class PlayerBase extends ManBase
{
    // Identity
    private string m_CitSteamId = "";
    private string m_CitName = "Survivor";

    // Damage tracking
    private int m_CitLastDamageType;
    private string m_CitLastDamageAmmo;
    private EntityAI m_CitLastDamagingEntity;
    private string m_CitLastWeaponType = "";

    // Speed hack detection
    private int m_CitSpeedHackTriggers = 0;
    private float m_CitLastSpeedCheckTime = 0.0;
    private vector m_CitLastPosition;
    private float m_CitSpeedCheckResetTime = 0.0;

    // Distance tracking
    private vector m_CitDistanceLastPos;
    private float m_CitTickTime = 0.0;

    // State
    private bool m_CitDeathProcessed = false;
    private bool m_CitIdentitySet = false;

    // ─── Identity ─────────────────────────────────────

    string GetCitSteamId()
    {
        if (m_CitSteamId != "")
            return m_CitSteamId;
        if (GetIdentity())
            return GetIdentity().GetPlainId();
        return "";
    }

    string GetCitName()
    {
        if (m_CitName != "Survivor")
            return m_CitName;
        if (GetIdentity())
            return GetIdentity().GetName();
        return "Survivor";
    }

    void CitSetIdentity(string steamId, string name)
    {
        m_CitSteamId = steamId;
        m_CitName = name;
        m_CitIdentitySet = true;
        m_CitLastPosition = GetPosition();
        m_CitDistanceLastPos = GetPosition();
        m_CitLastSpeedCheckTime = GetGame().GetTickTime();
        m_CitSpeedCheckResetTime = GetGame().GetTickTime();

        GetCitadel().RegisterPlayer(steamId);
        GetCitadel().GetLogger().Debug(string.Format("Player identity set: %1 (%2)", name, steamId));
    }

    // ─── Damage Source Tracking ───────────────────────

    string GetCitLastWeaponType() { return m_CitLastWeaponType; }
    string GetCitLastDamageAmmo() { return m_CitLastDamageAmmo; }
    EntityAI GetCitLastDamagingEntity() { return m_CitLastDamagingEntity; }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (!GetGame().IsServer()) return;

        // Store damage context for death processing
        m_CitLastDamageType = damageType;
        m_CitLastDamageAmmo = ammo;
        m_CitLastDamagingEntity = source;

        // Resolve weapon type
        m_CitLastWeaponType = "";
        if (source)
        {
            Weapon_Base weapon = Weapon_Base.Cast(source);
            if (weapon)
                m_CitLastWeaponType = weapon.GetType();
            else
                m_CitLastWeaponType = source.GetType();
        }

        // Track hit stats for the attacker
        if (source && GetCitadel().GetConfiguration().GetTrackPlayerStats())
        {
            PlayerBase attacker = null;

            // Source could be a weapon held by a player
            Man sourceOwner = source.GetHierarchyRootPlayer();
            if (sourceOwner)
                attacker = PlayerBase.Cast(sourceOwner);

            if (attacker && attacker != this)
            {
                string attackerSteamId = attacker.GetCitSteamId();
                if (attackerSteamId != "")
                {
                    CitadelPlayerStats attackerStats = GetCitadel().GetPlayerStats(attackerSteamId);
                    if (attackerStats)
                    {
                        attackerStats.shotsHit++;
                        attackerStats.shotsHitPlayers++;
                    }
                }
            }

            // Log the hit event
            string victimSteamId = GetCitSteamId();
            if (victimSteamId != "")
            {
                float damage = 0;
                if (damageResult)
                    damage = damageResult.GetDamage(dmgZone, "Health");

                string attackerId = "";
                string attackerName = "";
                if (attacker && attacker != this)
                {
                    attackerId = attacker.GetCitSteamId();
                    attackerName = attacker.GetCitName();
                }

                CitadelEventLogger.LogHit(victimSteamId, GetCitName(), attackerId, attackerName, m_CitLastWeaponType, ammo, dmgZone, damage);
            }
        }
    }

    // ─── Death Processing ─────────────────────────────

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (m_CitDeathProcessed) return;
        m_CitDeathProcessed = true;

        string victimSteamId = GetCitSteamId();
        string victimName = GetCitName();
        if (victimSteamId == "") return;

        // Determine killer context
        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (killerPlayer && killerPlayer != this)
        {
            string killerSteamId = killerPlayer.GetCitSteamId();
            string killerName = killerPlayer.GetCitName();
            float distance = vector.Distance(GetPosition(), killerPlayer.GetPosition());

            string weapon = m_CitLastWeaponType;
            if (weapon == "")
            {
                EntityAI weaponInHands = killerPlayer.GetHumanInventory().GetEntityInHands();
                if (weaponInHands)
                    weapon = weaponInHands.GetType();
            }

            CitadelEventLogger.LogKill(killerSteamId, killerName, victimSteamId, victimName, distance, weapon);

            // Update killer stats
            CitadelPlayerStats killerStats = GetCitadel().GetPlayerStats(killerSteamId);
            if (killerStats)
                killerStats.killsPlayers++;
        }
        else if (killer == this || !killer)
        {
            CitadelEventLogger.LogSuicide(victimSteamId, victimName);
        }
        else
        {
            // Killed by non-player entity (zombie, animal, environment)
            string causeType = "unknown";
            if (killer)
                causeType = killer.GetType();

            CitadelEventLogger.LogDeath(victimSteamId, victimName, causeType);
        }
    }

    // ─── Speed Check & Distance Tracking ──────────────

    override void CommandHandler(float pDt, int pCurrentCommandID, bool pCurrentCommandFinished)
    {
        super.CommandHandler(pDt, pCurrentCommandID, pCurrentCommandFinished);

        if (!GetGame().IsServer()) return;
        if (!m_CitIdentitySet) return;

        float currentTime = GetGame().GetTickTime();
        vector currentPos = GetPosition();

        // Distance tracking (every tick)
        if (GetCitadel().GetConfiguration().GetTrackPlayerStats())
        {
            float moveDist = vector.Distance(currentPos, m_CitDistanceLastPos);
            if (moveDist > 0.1 && moveDist < 100.0) // Ignore teleports
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(m_CitSteamId);
                if (stats)
                {
                    if (IsInVehicle())
                        stats.vehicleDistance += moveDist;
                    else
                        stats.distance += moveDist;
                }
            }
            m_CitDistanceLastPos = currentPos;
        }

        // Speed hack detection (every 1 second)
        if (GetCitadel().GetConfiguration().GetSpeedCheckEnabled())
        {
            float deltaTime = currentTime - m_CitLastSpeedCheckTime;
            if (deltaTime >= 1.0)
            {
                float distance = vector.Distance(currentPos, m_CitLastPosition);
                float speed = distance / deltaTime;

                float threshold;
                if (IsInVehicle())
                    threshold = GetCitadel().GetConfiguration().GetSpeedCheckThresholdVehicle();
                else
                    threshold = GetCitadel().GetConfiguration().GetSpeedCheckThresholdFoot();

                if (speed > threshold && distance > 5.0) // Ignore small movements
                {
                    m_CitSpeedHackTriggers++;

                    // Reset trigger counter after 10 seconds of no flags
                    if ((currentTime - m_CitSpeedCheckResetTime) > 10.0)
                    {
                        m_CitSpeedHackTriggers = 1;
                        m_CitSpeedCheckResetTime = currentTime;
                    }

                    int triggerThreshold = GetCitadel().GetConfiguration().GetSpeedCheckTriggerCount();
                    if (m_CitSpeedHackTriggers >= triggerThreshold)
                    {
                        GetCitadel().GetLogger().Warn(string.Format("Speed flag: %1 (%2) speed=%3 m/s triggers=%4 pos=%5", m_CitName, m_CitSteamId, speed.ToString(), m_CitSpeedHackTriggers.ToString(), currentPos.ToString()));

                        CitadelEventLogger.LogSpeedFlag(m_CitSteamId, m_CitName, speed, currentPos, m_CitSpeedHackTriggers);
                    }
                }

                m_CitLastPosition = currentPos;
                m_CitLastSpeedCheckTime = currentTime;
            }
        }
    }

    bool IsInVehicle()
    {
        HumanCommandVehicle vehCmd = GetCommand_Vehicle();
        return (vehCmd != null);
    }
};
