/**
 * CitadelWeaponHooks — Weapon firing and bullet tracking.
 *
 * Hooks into Weapon_Base to track:
 * - Shots fired per player
 * - Bullet creation for trajectory analysis (magic bullet detection)
 */
modded class Weapon_Base
{
    override void EEFired(int muzzleType, int mode, string ammoType)
    {
        super.EEFired(muzzleType, mode, ammoType);

        if (!GetGame().IsServer()) return;

        // Find the player who owns this weapon
        Man owner = GetHierarchyRootPlayer();
        if (!owner) return;

        PlayerBase player = PlayerBase.Cast(owner);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        // Increment shots fired (account for multi-projectile ammo like shotgun pellets)
        if (GetCitadel().GetConfiguration().GetTrackPlayerStats())
        {
            CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
            if (stats)
            {
                int projectilesCount = Math.Max(1, GetGame().ConfigGetInt("CfgAmmo " + ammoType + " projectilesCount"));
                stats.shotsFired += projectilesCount;
            }
        }

        GetCitadel().GetLogger().Debug(string.Format("EEFired: %1 fired %2 (ammo=%3, mode=%4)", player.GetCitName(), GetType(), ammoType, mode.ToString()));
    }
};
