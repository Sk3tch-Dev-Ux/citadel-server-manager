/**
 * CitadelItemHooks — Item interaction tracking.
 *
 * Hooks into ItemBase to track:
 * - Items picked up by players
 * - Items dropped by players
 * - Weapon looting
 */
modded class ItemBase extends InventoryItem
{
    override void EEItemLocationChanged(notnull InventoryLocation oldLoc, notnull InventoryLocation newLoc)
    {
        super.EEItemLocationChanged(oldLoc, newLoc);

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackItems()) return;

        PlayerBase oldPlayer = null;
        PlayerBase newPlayer = null;

        // Resolve the root player for old and new locations
        EntityAI oldParent = oldLoc.GetParent();
        if (oldParent)
            oldPlayer = PlayerBase.Cast(oldParent.GetHierarchyRootPlayer());

        EntityAI newParent = newLoc.GetParent();
        if (newParent)
            newPlayer = PlayerBase.Cast(newParent.GetHierarchyRootPlayer());

        // Item picked up (from world/ground to player inventory)
        if (!oldPlayer && newPlayer)
        {
            string steamId = newPlayer.GetCitSteamId();
            if (steamId != "")
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                if (stats)
                {
                    stats.itemsPickedUp++;

                    // Track weapon looting
                    if (IsInherited(Weapon_Base))
                        stats.weaponsLooted++;
                }
            }
        }
        // Item dropped (from player inventory to world/ground)
        else if (oldPlayer && !newPlayer)
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
};
