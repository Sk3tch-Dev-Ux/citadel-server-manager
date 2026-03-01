/**
 * DSCPlayerActions — In-game player action execution.
 *
 * All methods receive the raw command JSON string and parse params as needed.
 * Returns true on success, sets error string on failure.
 */
class DSCPlayerActions
{
    /**
     * Find a player by Steam64 ID.
     */
    static PlayerBase FindPlayerBySteamId(string steamId)
    {
        ref array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);

        foreach (Man man : players)
        {
            PlayerBase player = PlayerBase.Cast(man);
            if (!player) continue;

            PlayerIdentity identity = player.GetIdentity();
            if (!identity) continue;

            if (identity.GetPlainId() == steamId)
                return player;
        }
        return null;
    }

    /**
     * Heal player to full health, blood, and shock.
     */
    static bool HealPlayer(string cmdJson, out string error)
    {
        string steamId = DSCCommandRunner.ExtractJsonString(cmdJson, "steamId");
        if (steamId == "")
        {
            // Try from params
            string params = DSCCommandRunner.ExtractParams(cmdJson);
            steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");
        }

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        player.SetHealth("GlobalHealth", "Health", player.GetMaxHealth("GlobalHealth", "Health"));
        player.SetHealth("GlobalHealth", "Blood", player.GetMaxHealth("GlobalHealth", "Blood"));
        player.SetHealth("GlobalHealth", "Shock", player.GetMaxHealth("GlobalHealth", "Shock"));

        // Remove all negative status effects
        player.GetStatHeatComfort().Set(0);
        player.GetStatTremor().Set(0);
        player.GetStatWater().Set(player.GetStatWater().GetMax());
        player.GetStatEnergy().Set(player.GetStatEnergy().GetMax());

        Print("[DSCAdmin] Healed player: " + steamId);
        return true;
    }

    /**
     * Kill a player instantly.
     */
    static bool KillPlayer(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        player.SetHealth("GlobalHealth", "Health", 0);
        Print("[DSCAdmin] Killed player: " + steamId);
        return true;
    }

    /**
     * Teleport a player to coordinates.
     */
    static bool TeleportPlayer(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");
        float x = DSCCommandRunner.ExtractJsonFloat(params, "x");
        float y = DSCCommandRunner.ExtractJsonFloat(params, "y");
        float z = DSCCommandRunner.ExtractJsonFloat(params, "z");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // DayZ coordinates: x=east/west, y=altitude, z=north/south
        // If altitude is 0, use terrain height at position
        if (y <= 0)
            y = GetGame().SurfaceY(x, z);

        vector pos = Vector(x, y, z);
        player.SetPosition(pos);

        Print("[DSCAdmin] Teleported " + steamId + " to " + pos.ToString());
        return true;
    }

    /**
     * Spawn an item in a player's inventory.
     */
    static bool SpawnItem(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");
        string itemClass = DSCCommandRunner.ExtractJsonString(params, "itemClass");
        int quantity = DSCCommandRunner.ExtractJsonInt(params, "quantity");
        if (quantity <= 0) quantity = 1;

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        for (int i = 0; i < quantity; i++)
        {
            EntityAI item = player.GetInventory().CreateInInventory(itemClass);
            if (!item)
            {
                // Inventory full — spawn near player
                vector pos = player.GetPosition();
                item = GetGame().CreateObjectEx(itemClass, pos, ECE_PLACE_ON_SURFACE);
            }

            if (!item && i == 0)
            {
                error = "Failed to spawn item: " + itemClass;
                return false;
            }
        }

        Print("[DSCAdmin] Spawned " + quantity.ToString() + "x " + itemClass + " on " + steamId);
        return true;
    }

    /**
     * Remove all items from a player's inventory.
     */
    static bool StripPlayer(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Remove all inventory items
        ref array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);

        foreach (EntityAI item : items)
        {
            if (item != player) // Don't delete the player themselves
                GetGame().ObjectDelete(item);
        }

        Print("[DSCAdmin] Stripped inventory of: " + steamId);
        return true;
    }

    /**
     * Create an explosion at a player's position (kills them spectacularly).
     */
    static bool ExplodePlayer(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector pos = player.GetPosition();

        // Create explosion
        Grenade_Base grenade = Grenade_Base.Cast(GetGame().CreateObjectEx("RGD5Grenade", pos, ECE_PLACE_ON_SURFACE));
        if (grenade)
        {
            grenade.Explode(DamageType.EXPLOSION, "RGD5Grenade_Ammo");
        }
        else
        {
            // Fallback: just kill them
            player.SetHealth("GlobalHealth", "Health", 0);
        }

        Print("[DSCAdmin] Exploded player: " + steamId);
        return true;
    }

    /**
     * Kick a player from the server.
     */
    static bool KickPlayer(string cmdJson, out string error)
    {
        string params = DSCCommandRunner.ExtractParams(cmdJson);
        string steamId = DSCCommandRunner.ExtractJsonString(params, "steamId");
        string reason = DSCCommandRunner.ExtractJsonString(params, "reason");
        if (reason == "") reason = "Kicked by admin";

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player || !player.GetIdentity())
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Use BattlEye kick via GetGame
        GetGame().SendPlayerMessage(player, reason);

        // Workaround: disconnect the player's identity
        // The engine will handle the actual disconnection
        Print("[DSCAdmin] Kicking player: " + steamId + " reason: " + reason);

        // Schedule actual kick for next frame to allow message to be sent
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(
            GetGame().DisconnectPlayer,
            100, false,
            player.GetIdentity(), steamId
        );

        return true;
    }
};
