/**
 * CitadelPlayerActions — In-game player action execution.
 *
 * All methods receive the raw command JSON string and parse params as needed.
 * Returns true on success, sets error string on failure.
 */
class CitadelPlayerActions
{
    static PlayerBase FindPlayerBySteamId(string steamId)
    {
        // Use CitadelCore registry — GetGame().GetPlayers() can return empty
        // on some DayZ dedicated server versions.
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();
        if (activePlayers.Contains(steamId))
        {
            return PlayerBase.Cast(activePlayers.Get(steamId));
        }
        return null;
    }

    static bool HealPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Use comprehensive heal matching GameLabs GLHealEx pattern
        // (handles bleeding, diseases, modifiers, leg damage, agents, etc.)
        player.CitHealEx();

        Print("[Citadel] Healed player: " + steamId);
        return true;
    }

    static bool KillPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // GameLabs uses SetHealth(0) on the root entity (not "GlobalHealth" zone)
        player.SetHealth(0);
        Print("[Citadel] Killed player: " + steamId);
        return true;
    }

    static bool TeleportPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float x = CitadelJson.ExtractFloat(params, "x");
        float y = CitadelJson.ExtractFloat(params, "y");
        float z = CitadelJson.ExtractFloat(params, "z");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        if (y <= 0)
            y = GetGame().SurfaceY(x, z);

        vector pos = Vector(x, y, z);
        // Use CitSetPositionEx to update both world position and internal
        // tracker position (prevents false speed hack flags after teleport)
        player.CitSetPositionEx(pos);

        Print("[Citadel] Teleported " + steamId + " to " + pos.ToString());
        return true;
    }

    static bool SpawnItem(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string itemClass = CitadelJson.ExtractString(params, "itemClass");
        int quantity = CitadelJson.ExtractInt(params, "quantity");
        if (quantity <= 0) quantity = 1;
        if (quantity > 100) quantity = 100;

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
                vector pos = player.GetPosition();
                item = GetGame().CreateObjectEx(itemClass, pos, ECE_PLACE_ON_SURFACE);
            }

            if (!item && i == 0)
            {
                error = "Failed to spawn item: " + itemClass;
                return false;
            }
        }

        Print("[Citadel] Spawned " + quantity.ToString() + "x " + itemClass + " on " + steamId);
        return true;
    }

    static bool StripPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Use built-in RemoveAllItems (matching GameLabs pattern)
        player.RemoveAllItems();

        Print("[Citadel] Stripped inventory of: " + steamId);
        return true;
    }

    static bool ExplodePlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        player.Explode(DT_EXPLOSION, "LandFuelFeed_Ammo");

        Print("[Citadel] Exploded player: " + steamId);
        return true;
    }

    static bool KickPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string reason = CitadelJson.ExtractString(params, "reason");
        if (reason == "") reason = "Kicked by admin";

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player || !player.GetIdentity())
        {
            error = "Player not found: " + steamId;
            return false;
        }

        Print("[Citadel] Kicking player: " + steamId + " reason: " + reason);

        // Send kick reason to the player before disconnecting
        PlayerIdentity identity = player.GetIdentity();
        if (reason != "")
        {
            Param1<string> msgParam = new Param1<string>("[Kicked] " + reason);
            GetGame().RPCSingleParam(player, ERPCs.RPC_USER_ACTION_MESSAGE, msgParam, true, identity);
        }

        // DisconnectPlayer expects (identity, uid) — pass the player's plain ID
        GetGame().DisconnectPlayer(identity, identity.GetPlainId());

        return true;
    }

    /**
     * Send a message to a player via server chat.
     */
    static bool MessagePlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string text = CitadelJson.ExtractString(params, "text");

        if (text == "")
        {
            error = "Message text is required";
            return false;
        }

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player || !player.GetIdentity())
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Send message to specific player via their RPC channel
        Param1<string> msgParam = new Param1<string>("[Citadel] " + text);
        GetGame().RPCSingleParam(player, ERPCs.RPC_USER_ACTION_MESSAGE, msgParam, true, player.GetIdentity());

        Print("[Citadel] Messaged player: " + steamId);
        return true;
    }

    static bool UnstuckPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector pos = player.GetPosition();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]) + 0.5;
        player.CitSetPositionEx(pos);

        Print("[Citadel] Unstuck player: " + steamId);
        return true;
    }

    static bool FreezePlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        int frozen = CitadelJson.ExtractInt(params, "frozen");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        bool shouldFreeze = (frozen == 1);
        player.CitSetFrozen(shouldFreeze);

        Print("[Citadel] " + steamId + " frozen=" + shouldFreeze.ToString());
        return true;
    }

    static bool TeleportToPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string targetSteamId = CitadelJson.ExtractString(params, "targetSteamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Source player not found: " + steamId;
            return false;
        }

        PlayerBase target = FindPlayerBySteamId(targetSteamId);
        if (!target)
        {
            error = "Target player not found: " + targetSteamId;
            return false;
        }

        vector targetPos = target.GetPosition();
        targetPos[0] = targetPos[0] + 1.0;
        player.CitSetPositionEx(targetPos);

        Print("[Citadel] Teleported " + steamId + " to " + targetSteamId);
        return true;
    }

    static bool GetLoadout(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        // Enumerate all items in player's inventory
        array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);

        string json = "{\"items\":[";
        bool first = true;
        for (int i = 0; i < items.Count(); i++)
        {
            EntityAI item = items.Get(i);
            if (!item) continue;
            if (item == player) continue;

            if (!first) json += ",";
            first = false;

            float health = item.GetHealth("", "Health");
            float maxHealth = item.GetMaxHealth("", "Health");
            int quantity = 1;

            ItemBase itemBase = ItemBase.Cast(item);
            if (itemBase && itemBase.HasQuantity())
                quantity = itemBase.GetQuantity();

            json += "{\"className\":\"" + item.GetType() + "\",\"health\":" + health.ToString() + ",\"maxHealth\":" + maxHealth.ToString() + ",\"quantity\":" + quantity.ToString() + "}";
        }
        json += "]}";

        responseData = json;
        Print("[Citadel] Got loadout for: " + steamId + " (" + items.Count().ToString() + " items)");
        return true;
    }
};
