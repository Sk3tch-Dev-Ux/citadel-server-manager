/**
 * CitadelPlayerHooks — Deep PlayerBase integration.
 *
 * Hooks into the player lifecycle to provide:
 * - Per-player identity tracking (steamId, name, session)
 * - Damage source tracking (weapon, ammo, attacker)
 * - Death event processing with full context
 * - Speed hack detection via OnScheduledTick (matching GameLabs pattern)
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
    private string m_CitLastDmgZone = "";

    // Speed hack detection
    private int m_CitSpeedHackTriggers = 0;
    private float m_CitTickTime = 0.0;
    private vector m_CitPosition;

    // State
    private bool m_CitDeathProcessed = false;
    private bool m_CitHitTracked = false;
    private bool m_CitIdentitySet = false;

    // Freeze state
    private bool m_CitFrozen = false;
    private vector m_CitFreezePosition;

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
        m_CitPosition = GetPosition();
        m_CitPosition[1] = 0; // Work with 2D only, matching GameLabs

        GetCitadel().RegisterPlayer(steamId, this);
        GetCitadel().GetLogger().Debug(string.Format("Player identity set: %1 (%2)", name, steamId));
    }

    // ─── Position Override (for teleport) ────────────

    void CitOverridePosition(vector position)
    {
        m_CitPosition = position;
    }

    void CitSetPositionEx(vector position)
    {
        CitOverridePosition(position);
        SetPosition(position);
    }

    // ─── Damage Source Tracking ───────────────────────

    string GetCitLastWeaponType() { return m_CitLastWeaponType; }
    string GetCitLastDamageAmmo() { return m_CitLastDamageAmmo; }
    EntityAI GetCitLastDamagingEntity() { return m_CitLastDamagingEntity; }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        // Store damage context BEFORE super call — super may trigger EEKilled
        // which needs this context to determine cause of death (GameLabs pattern)
        m_CitLastDamageAmmo = ammo;
        m_CitLastDamageType = damageType;
        m_CitLastDamagingEntity = source;
        m_CitLastDmgZone = dmgZone;

        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (!GetGame().IsServer()) return;

        // PERF: Early exit — skip all stat/log work if player already dead
        if (m_DeathSyncSent || CommitedSuicide()) return;

        // Resolve weapon type (only needed if we're still alive or processing death)
        m_CitLastWeaponType = "";
        if (source)
        {
            Weapon_Base weapon = Weapon_Base.Cast(source);
            if (weapon)
                m_CitLastWeaponType = weapon.GetType();
            else
                m_CitLastWeaponType = source.GetType();
        }

        // PERF: Early exit — skip stat tracking + logging when disabled
        if (!source || !GetCitadel().GetConfiguration().GetTrackPlayerStats())
        {
            // Still need to handle death processing even without stat tracking
            if (!IsAlive() && !m_CitDeathProcessed)
            {
                m_CitDeathProcessed = true;
                CitProcessKill(source);
            }
            else if (IsAlive())
            {
                m_CitDeathProcessed = false;
            }
            return;
        }

        // Track hit stats for the attacker (config already checked above)
        {
            PlayerBase attacker = null;

            // Source could be a weapon held by a player — resolve via hierarchy
            Man sourceOwner = source.GetHierarchyRootPlayer();
            if (sourceOwner)
                attacker = PlayerBase.Cast(sourceOwner);

            // Only track player-vs-player hits (matching GameLabs: if(!source || !murderer) return;)
            if (!source || !attacker) return;

            if (attacker && attacker != this)
            {
                string attackerSteamId = attacker.GetCitSteamId();
                if (attackerSteamId != "")
                {
                    CitadelPlayerStats attackerStats = GetCitadel().GetPlayerStats(attackerSteamId);
                    if (attackerStats)
                    {
                        if (!IsAlive())
                        {
                            // Last shot that killed — only count once
                            if (!m_CitHitTracked)
                            {
                                m_CitHitTracked = true;
                                attackerStats.shotsHit++;
                                attackerStats.shotsHitPlayers++;
                            }
                        }
                        else
                        {
                            attackerStats.shotsHit++;
                            attackerStats.shotsHitPlayers++;
                        }
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

        // Handle death from hit (GameLabs pattern: process death in EEHitBy too)
        if (IsAlive())
        {
            m_CitDeathProcessed = false;
        }
        else if (!m_CitDeathProcessed)
        {
            m_CitDeathProcessed = true;
            CitProcessKill(source);
        }
    }

    // ─── Death Processing ─────────────────────────────

    void CitProcessKill(Object killer)
    {
        string victimSteamId = GetCitSteamId();
        string victimName = GetCitName();
        if (victimSteamId == "") return;

        vector victimPos = GetPosition();

        // Null guard: starvation, dehydration, bleedout deaths have no killer object
        if (!killer)
        {
            CitadelEventLogger.LogDeath(victimSteamId, victimName, "environment", "", "", victimPos);
            return;
        }

        // Resolve killer through weapon hierarchy (GameLabs pattern)
        // When killer is a weapon/melee, resolve to the player holding it
        PlayerBase killerPlayer;
        EntityAI weapon;

        if (killer.IsWeapon() || killer.IsMeleeWeapon())
        {
            weapon = EntityAI.Cast(killer);
            killerPlayer = PlayerBase.Cast(weapon.GetHierarchyParent());
        }

        if (killerPlayer && killerPlayer != this)
        {
            // ── PvP Kill ──
            string killerSteamId = killerPlayer.GetCitSteamId();
            string killerName = killerPlayer.GetCitName();
            vector killerPos = killerPlayer.GetPosition();
            float distance = vector.Distance(victimPos, killerPos);

            // Capture weapon class (not just display name)
            string weaponType = "";
            if (killer)
                weaponType = killer.GetType();

            // Capture hit zone from cached damage tracking
            string zone = m_CitLastDmgZone;
            zone.ToLower();

            // Capture ammo type from cached damage tracking
            string ammoType = m_CitLastDamageAmmo;

            CitadelEventLogger.LogKill(killerSteamId, killerName, victimSteamId, victimName, distance, weaponType, zone, killerPos, victimPos);

            // Update killer stats
            CitadelPlayerStats killerStats = GetCitadel().GetPlayerStats(killerSteamId);
            if (killerStats)
                killerStats.killsPlayers++;
        }
        else if (killer == this)
        {
            // Suicide / self-inflicted — check for environmental causes
            if (weapon || CommitedSuicide())
            {
                CitadelEventLogger.LogSuicide(victimSteamId, victimName, victimPos);
            }
            else
            {
                // Environmental death (fall, explosion, etc.)
                string refType = "";
                if (m_CitLastDamagingEntity)
                    refType = m_CitLastDamagingEntity.GetType();

                if (m_CitLastDamageType == DT_EXPLOSION)
                    CitadelEventLogger.LogDeath(victimSteamId, victimName, "explosion", refType, "", victimPos);
                else if (m_CitLastDamageAmmo == "FallDamage")
                    CitadelEventLogger.LogDeath(victimSteamId, victimName, "fall", refType, "", victimPos);
                else
                    CitadelEventLogger.LogDeath(victimSteamId, victimName, "environment", refType, "", victimPos);
            }
        }
        else
        {
            // Non-player AI kill
            if (killer.IsInherited(ZombieBase))
                CitadelEventLogger.LogDeath(victimSteamId, victimName, "infected", killer.GetType(), "", victimPos);
            else if (killer.IsInherited(AnimalBase))
                CitadelEventLogger.LogDeath(victimSteamId, victimName, "animal", killer.GetType(), "", victimPos);
            else
                CitadelEventLogger.LogDeath(victimSteamId, victimName, "unknown", killer.GetType(), "", victimPos);
        }
    }

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (m_CitDeathProcessed) return;
        m_CitDeathProcessed = true;

        CitProcessKill(killer);
    }

    // ─── Freeze Enforcement (per-frame) ────────────────
    // CommandHandler fires every frame on the server. By setting position
    // back each frame the player is held completely solid — no rubberbanding.

    override void CommandHandler(float pDt, int pCurrentCommandID, bool pCurrentCommandFinished)
    {
        super.CommandHandler(pDt, pCurrentCommandID, pCurrentCommandFinished);

        if (m_CitFrozen && GetGame().IsServer())
        {
            SetPosition(m_CitFreezePosition);
        }
    }

    // ─── Speed Check & Distance Tracking ──────────────
    // Uses OnScheduledTick matching the GameLabs pattern — NOT CommandHandler
    // which fires every frame and is too expensive for stats/detection.

    override void OnScheduledTick(float deltaTime)
    {
        super.OnScheduledTick(deltaTime);
        if (!GetCitadel().IsServer()) return;
        if (!m_CitIdentitySet) return;

        float tickTime = GetGame().GetTickTime();
        float diff = (tickTime - m_CitTickTime);

        // Tick at a configurable interval (default ~2s), not every frame
        float tickInterval = 2.0;
        if (GetCitadel() && GetCitadel().GetConfiguration())
        {
            float cfgTick = GetCitadel().GetConfiguration().GetPlayerTickInterval();
            if (cfgTick > 0)
                tickInterval = cfgTick;
        }
        if (diff >= tickInterval)
        {
            m_CitTickTime = tickTime;
            CitPlayerTick(diff, tickTime);
        }
    }

    void CitPlayerTick(float diff, float tickTime)
    {
        vector currentPosition = GetPosition();
        currentPosition[1] = 0; // Work with 2D only
        float distance = vector.Distance(m_CitPosition, currentPosition);
        if (diff == 0)
            diff = 1;
        float unitsPerSecond = distance / diff;
        m_CitPosition = currentPosition;

        // Skip distance tracking and speed checks while frozen
        if (m_CitFrozen)
            return;

        // PERF: Cache config reference once (called every ~2s per player)
        CitadelConfiguration cfg = GetCitadel().GetConfiguration();

        // Distance tracking
        if (cfg.GetTrackPlayerStats())
        {
            if (distance > 0.1 && distance < 500.0) // Ignore teleports
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(m_CitSteamId);
                if (stats)
                {
                    if (IsInVehicle())
                        stats.vehicleDistance += distance;
                    else
                        stats.distance += distance;
                }
            }
        }

        // Speed hack detection
        if (cfg.GetSpeedCheckEnabled())
        {
            float warningThreshold;
            if (IsInVehicle())
                warningThreshold = cfg.GetSpeedCheckThresholdVehicle();
            else
                warningThreshold = cfg.GetSpeedCheckThresholdFoot();

            if (unitsPerSecond >= warningThreshold)
            {
                m_CitSpeedHackTriggers++;
                GetCitadel().GetLogger().Warn(string.Format("[SPEED-HACK] Potential speed-hack player=%1, distance=%2u, unitsPerSecond=%3 [threshold=%4, inVehicle=%5, triggers=%6]", m_CitSteamId, distance, unitsPerSecond, warningThreshold, IsInVehicle(), m_CitSpeedHackTriggers));

                int triggerThreshold = cfg.GetSpeedCheckTriggerCount();
                if (m_CitSpeedHackTriggers >= triggerThreshold)
                {
                    CitadelEventLogger.LogSpeedFlag(m_CitSteamId, m_CitName, unitsPerSecond, GetPosition(), m_CitSpeedHackTriggers);
                }
            }
        }
    }

    // ─── Freeze Control ─────────────────────────────────

    void CitSetFrozen(bool frozen)
    {
        m_CitFrozen = frozen;
        if (frozen)
        {
            m_CitFreezePosition = GetPosition();
            GetCitadel().GetLogger().Info(string.Format("Player frozen: %1", m_CitSteamId));
        }
        else
        {
            GetCitadel().GetLogger().Info(string.Format("Player unfrozen: %1", m_CitSteamId));
        }
    }

    bool CitIsFrozen() { return m_CitFrozen; }

    // ─── Heal (Comprehensive, matching GameLabs GLHealEx) ──

    void CitHealEx()
    {
        SetHealth(GetMaxHealth("", ""));
        SetHealth("", "Blood", GetMaxHealth("", "Blood"));
        SetHealth("", "Shock", GetMaxHealth("", "Shock"));
        SetWet(GetWetInit());
        SetTemperatureDirect(GameConstants.ITEM_TEMPERATURE_NEUTRAL_ZONE_MIDDLE);
        GetStatHeatBuffer().Set(GetStatHeatBuffer().GetMax());
        GetStatHeatComfort().Set(GetStatHeatComfort().GetMax());
        GetStatTremor().Set(GetStatTremor().GetMin());
        GetStatWet().Set(GetStatWet().GetMin());
        GetStatEnergy().Set(GetStatEnergy().GetMax());
        GetStatWater().Set(GetStatWater().GetMax());
        GetStatDiet().Set(GetStatDiet().GetMax());
        GetStatSpecialty().Set(GetStatSpecialty().GetMax());
        SetBleedingBits(0);

        SetHealth("LeftLeg", "Health", GetMaxHealth("LeftLeg", "Health"));
        SetHealth("RightLeg", "Health", GetMaxHealth("RightLeg", "Health"));

        if (GetBleedingManagerServer())
            GetBleedingManagerServer().RemoveAllSources();

        RemoveAllAgents();
        ModifiersManager modifiers_manager = GetModifiersManager();

        // Consumption based
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_CHOLERA))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_CHOLERA);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_INFLUENZA))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_INFLUENZA);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_SALMONELLA))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_SALMONELLA);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_POISONING))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_POISONING);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_HEMOLYTIC_REACTION))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_HEMOLYTIC_REACTION);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_VOMITSTUFFED))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_VOMITSTUFFED);

        // Brain disease
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_BRAIN))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_BRAIN);

        // Infections
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_WOUND_INFECTION1))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_WOUND_INFECTION1);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_WOUND_INFECTION2))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_WOUND_INFECTION2);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_FEVER))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_FEVER);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_COMMON_COLD))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_COMMON_COLD);

        // Gas/contamination
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_TOXICITY))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_TOXICITY);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_CONTAMINATION1))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_CONTAMINATION1);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_CONTAMINATION2))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_CONTAMINATION2);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_CONTAMINATION3))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_CONTAMINATION3);
        if (modifiers_manager.IsModifierActive(eModifiers.MDF_AREAEXPOSURE))
            modifiers_manager.DeactivateModifier(eModifiers.MDF_AREAEXPOSURE);
    }

    bool CitIsInVehicle()
    {
        HumanCommandVehicle vehCmd = GetCommand_Vehicle();
        return (vehCmd != null);
    }
};
