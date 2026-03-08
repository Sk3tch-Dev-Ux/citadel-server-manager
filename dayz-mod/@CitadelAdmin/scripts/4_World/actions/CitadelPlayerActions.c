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

    // ─── Health/Status Actions ─────────────────────────

    static bool DryPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.GetStatWet().Set(0);
        Print("[Citadel] Dried player: " + steamId);
        return true;
    }

    static bool BreakLegs(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetHealth("LeftLeg", "Health", 0);
        player.SetHealth("RightLeg", "Health", 0);
        Print("[Citadel] Broke legs of: " + steamId);
        return true;
    }

    static bool MakeSick(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string diseaseType = CitadelJson.ExtractString(params, "diseaseType");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        if (diseaseType == "cholera")
            player.InsertAgent(eAgents.CHOLERA, 1);
        else if (diseaseType == "influenza")
            player.InsertAgent(eAgents.INFLUENZA, 1);
        else if (diseaseType == "salmonella")
            player.InsertAgent(eAgents.SALMONELLA, 1);
        else
            player.InsertAgent(eAgents.CHOLERA, 1);

        Print("[Citadel] Made " + steamId + " sick: " + diseaseType);
        return true;
    }

    static bool CurePlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.RemoveAllAgents();
        Print("[Citadel] Cured player: " + steamId);
        return true;
    }

    static bool SetBloodType(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string bloodType = CitadelJson.ExtractString(params, "bloodType");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        int bt = 0;
        if (bloodType == "O+") bt = BloodTypes.O_P;
        else if (bloodType == "O-") bt = BloodTypes.O_N;
        else if (bloodType == "A+") bt = BloodTypes.A_P;
        else if (bloodType == "A-") bt = BloodTypes.A_N;
        else if (bloodType == "B+") bt = BloodTypes.B_P;
        else if (bloodType == "B-") bt = BloodTypes.B_N;
        else if (bloodType == "AB+") bt = BloodTypes.AB_P;
        else if (bloodType == "AB-") bt = BloodTypes.AB_N;

        player.SetBloodType(bt);
        Print("[Citadel] Set blood type of " + steamId + " to " + bloodType);
        return true;
    }

    static bool ForceDrink(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.GetStatWater().Set(player.GetStatWater().GetMax());
        Print("[Citadel] Force drink: " + steamId);
        return true;
    }

    static bool ForceEat(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.GetStatEnergy().Set(player.GetStatEnergy().GetMax());
        Print("[Citadel] Force eat: " + steamId);
        return true;
    }

    static bool KnockoutPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetHealth("","Shock", 0);
        Print("[Citadel] Knocked out: " + steamId);
        return true;
    }

    static bool WakePlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetHealth("","Shock", 100);
        Print("[Citadel] Woke up: " + steamId);
        return true;
    }

    static bool SetBleeding(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        int sourceCount = CitadelJson.ExtractInt(params, "sourceCount");
        if (sourceCount <= 0) sourceCount = 1;
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        for (int i = 0; i < sourceCount; i++)
            player.GetBleedingManagerServer().AttemptAddBleedingSourceBySelection("Torso");

        Print("[Citadel] Set bleeding on: " + steamId);
        return true;
    }

    static bool StopBleeding(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.GetBleedingManagerServer().RemoveAllSources();
        Print("[Citadel] Stopped bleeding on: " + steamId);
        return true;
    }

    // ─── Ability/State Actions ───────────────────────

    static bool DropGear(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);
        foreach (EntityAI item : items)
        {
            if (item && item != player)
                player.ServerDropEntity(item);
        }

        Print("[Citadel] Dropped gear of: " + steamId);
        return true;
    }

    static bool LaunchPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float power = CitadelJson.ExtractFloat(params, "power");
        float angle = CitadelJson.ExtractFloat(params, "angle");
        if (power <= 0) power = 50;
        if (angle <= 0) angle = 75;
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        float radAngle = angle * Math.DEG2RAD;
        vector vel = Vector(0, Math.Sin(radAngle) * power, Math.Cos(radAngle) * power);
        player.SetVelocity(player, vel);

        Print("[Citadel] Launched " + steamId + " power=" + power.ToString());
        return true;
    }

    static bool SetStat(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string stat = CitadelJson.ExtractString(params, "stat");
        string value = CitadelJson.ExtractString(params, "value");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        float fVal = value.ToFloat();
        if (stat == "health") player.SetHealth(fVal);
        else if (stat == "blood") player.SetHealth("","Blood", fVal);
        else if (stat == "shock") player.SetHealth("","Shock", fVal);
        else if (stat == "water") player.GetStatWater().Set(fVal);
        else if (stat == "energy") player.GetStatEnergy().Set(fVal);
        else { error = "Unknown stat: " + stat; return false; }

        Print("[Citadel] Set " + stat + "=" + value + " on " + steamId);
        return true;
    }

    static bool RagdollPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        // Temporary shock to trigger ragdoll
        player.SetHealth("","Shock", 0);
        Print("[Citadel] Ragdolled: " + steamId);
        return true;
    }

    static bool SetGodmode(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetAllowDamage(false);
        Print("[Citadel] God mode ON: " + steamId);
        return true;
    }

    static bool RemoveGodmode(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetAllowDamage(true);
        Print("[Citadel] God mode OFF: " + steamId);
        return true;
    }

    static bool SetInvisible(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetInvisible(true);
        Print("[Citadel] Invisible ON: " + steamId);
        return true;
    }

    static bool RemoveInvisible(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.SetInvisible(false);
        Print("[Citadel] Invisible OFF: " + steamId);
        return true;
    }

    static bool SetStaminaInfinite(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.GetStaminaHandler().SetStamina(player.GetStaminaHandler().GetStaminaCap());
        Print("[Citadel] Infinite stamina ON: " + steamId);
        return true;
    }

    static bool RemoveStaminaInfinite(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        Print("[Citadel] Infinite stamina OFF: " + steamId);
        return true;
    }

    static bool RespawnPlayer(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        // Kill and let DayZ handle respawn naturally
        player.SetHealth(0);
        Print("[Citadel] Respawned: " + steamId);
        return true;
    }

    static bool ClearInventory(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        player.RemoveAllItems();
        Print("[Citadel] Cleared inventory: " + steamId);
        return true;
    }

    static bool FillMagazines(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);
        foreach (EntityAI item : items)
        {
            Magazine mag = Magazine.Cast(item);
            if (mag)
                mag.ServerSetAmmoCount(mag.GetAmmoMax());
        }

        Print("[Citadel] Filled magazines: " + steamId);
        return true;
    }

    static bool SpawnItemAttached(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string itemClass = CitadelJson.ExtractString(params, "itemClass");
        PlayerBase player = FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        EntityAI item = player.GetInventory().CreateInInventory(itemClass);
        if (!item)
        {
            vector pos = player.GetPosition();
            item = GetGame().CreateObjectEx(itemClass, pos, ECE_PLACE_ON_SURFACE);
        }
        if (!item) { error = "Failed to spawn: " + itemClass; return false; }

        Print("[Citadel] Spawned attached " + itemClass + " on " + steamId);
        return true;
    }

    // ─── Loadout Query ───────────────────────────────

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
