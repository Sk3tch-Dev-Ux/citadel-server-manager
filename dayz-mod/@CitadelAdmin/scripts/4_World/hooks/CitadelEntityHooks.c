/**
 * CitadelEntityHooks — Vehicle and AI entity lifecycle tracking.
 *
 * Hooks into CarScript, BoatScript, ZombieBase, and AnimalBase to
 * register/deregister entities with CitadelCore for accurate count
 * tracking and position monitoring.
 *
 * Uses constructor/destructor with deferred init via CallQueue,
 * matching the proven GameLabs pattern for reliable entity lifecycle.
 */

// ─── Vehicle Tracking ─────────────────────────────────

modded class CarScript
{
    private ref CitadelTrackedVehicle m_CitTracked;

    void CarScript()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        // Deferred init ensures entity is fully constructed before registration
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Call(this._CitInitVehicle);
    }

    void ~CarScript()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().DecrVehicleCount();
        if (m_CitTracked) GetCitadel().RemoveVehicle(m_CitTracked);
    }

    private void _CitInitVehicle()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackVehicles()) return;

        GetCitadel().IncrVehicleCount();

        // Determine vehicle icon/type
        string icon = "car";
        string vType = "car";

        string className = GetType();
        className.ToLower();

        // Expansion (and similar) helicopters extend CarScript, so detect them
        // here rather than letting them fall through to the generic car icon.
        if (className.Contains("heli") || className.Contains("uh1") || className.Contains("mh6") || className.Contains("merlin") || className.Contains("gyro"))
        {
            icon = "helicopter";
            vType = "helicopter";
        }
        else if (className.Contains("truck") || className.Contains("v3s"))
        {
            icon = "truck";
            vType = "truck";
        }
        else if (className.Contains("offroad"))
        {
            vType = "offroad";
        }

        m_CitTracked = new CitadelTrackedVehicle(this, icon, vType);
        GetCitadel().RegisterVehicle(m_CitTracked);
    }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (damageType != DamageType.FIRE_ARM) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        PlayerBase player;
        if (source)
            player = PlayerBase.Cast(source.GetHierarchyRootPlayer());
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId != "")
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                stats.shotsHit++;
                stats.shotsHitVehicles++;
            }
        }
    }
};

// ─── Boat Tracking ───────────────────────────────────

modded class BoatScript
{
    private ref CitadelTrackedVehicle m_CitTracked;

    void BoatScript()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Call(this._CitInitBoat);
    }

    void ~BoatScript()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().DecrVehicleCount();
        if (m_CitTracked) GetCitadel().RemoveVehicle(m_CitTracked);
    }

    private void _CitInitBoat()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackVehicles()) return;

        GetCitadel().IncrVehicleCount();

        m_CitTracked = new CitadelTrackedVehicle(this, "ship", "boat");
        GetCitadel().RegisterVehicle(m_CitTracked);
    }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (damageType != DamageType.FIRE_ARM) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        PlayerBase player;
        if (source)
            player = PlayerBase.Cast(source.GetHierarchyRootPlayer());
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId != "")
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                stats.shotsHit++;
                stats.shotsHitVehicles++;
            }
        }
    }
};

// ─── Infected (Zombie) Tracking ───────────────────────

modded class ZombieBase extends DayZInfected
{
    private ref CitadelTrackedAI m_CitTracked;
    private bool m_CitHitTracked = false;

    void ZombieBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Call(this._CitInitAI);
    }

    void ~ZombieBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().DecrAICount();
        if (m_CitTracked) GetCitadel().RemoveAI(m_CitTracked);
    }

    private void _CitInitAI()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().IncrAICount();

        m_CitTracked = new CitadelTrackedAI(this, true);
        GetCitadel().RegisterAI(m_CitTracked);
    }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (damageType != DamageType.FIRE_ARM) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        // Prevent double-counting hits on dead entities
        if (!IsAlive())
        {
            if (m_CitHitTracked) return;
            m_CitHitTracked = true;
        }

        PlayerBase player;
        if (source)
            player = PlayerBase.Cast(source.GetHierarchyRootPlayer());
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId != "")
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                stats.shotsHit++;
                stats.shotsHitInfected++;
            }
        }
    }

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        // Credit the kill to the player
        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (!killerPlayer)
        {
            // Killer might be a weapon -- resolve to owner
            EntityAI killerEntity = EntityAI.Cast(killer);
            if (killerEntity)
            {
                Man ownerMan = killerEntity.GetHierarchyRootPlayer();
                if (ownerMan)
                    killerPlayer = PlayerBase.Cast(ownerMan);
            }
        }

        if (killerPlayer)
        {
            string steamId = killerPlayer.GetCitSteamId();
            if (steamId != "")
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                if (stats)
                    stats.killsInfected++;
            }
        }
    }
};

// ─── Animal Tracking ──────────────────────────────────

modded class AnimalBase extends DayZAnimal
{
    private ref CitadelTrackedAI m_CitTracked;
    private bool m_CitHitTracked = false;

    void AnimalBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Call(this._CitInitAnimal);
    }

    void ~AnimalBase()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().DecrAnimalCount();
        if (m_CitTracked) GetCitadel().RemoveAI(m_CitTracked);
    }

    private void _CitInitAnimal()
    {
        if (!GetCitadel()) return;
        if (!GetCitadel().IsServer()) return;

        GetCitadel().IncrAnimalCount();

        m_CitTracked = new CitadelTrackedAI(this, false);
        GetCitadel().RegisterAI(m_CitTracked);
    }

    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);

        if (damageType != DamageType.FIRE_ARM) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        // Prevent double-counting hits on dead entities
        if (!IsAlive())
        {
            if (m_CitHitTracked) return;
            m_CitHitTracked = true;
        }

        PlayerBase player;
        if (source)
            player = PlayerBase.Cast(source.GetHierarchyRootPlayer());
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId != "")
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                stats.shotsHit++;
                stats.shotsHitAnimals++;
            }
        }
    }

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (!killerPlayer)
        {
            EntityAI killerEntity = EntityAI.Cast(killer);
            if (killerEntity)
            {
                Man ownerMan = killerEntity.GetHierarchyRootPlayer();
                if (ownerMan)
                    killerPlayer = PlayerBase.Cast(ownerMan);
            }
        }

        if (killerPlayer)
        {
            string steamId = killerPlayer.GetCitSteamId();
            if (steamId != "")
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                if (stats)
                    stats.killsAnimals++;
            }
        }
    }
};
