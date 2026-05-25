/**
 * CitadelCommandRunner — File-based command queue processor.
 *
 * Relocated from 4_World to 5_Mission (proper layer for command execution).
 * Enhanced with additional commands and richer response payloads.
 *
 * Polls $profile:Citadel/commands/ for *.cmd.json files, processes them,
 * and writes responses to $profile:Citadel/responses/.
 *
 * ─── Command File Format (.cmd.json) ───────────────────────────────────
 *
 *   {
 *     "id": "<unique-command-id>",
 *     "action": "<action-name>",
 *     "params": { <action-specific parameters> }
 *   }
 *
 *   - id:     Unique identifier (alphanumeric, hyphens, underscores). Used for
 *             matching the response file.
 *   - action: The command to execute (see list below).
 *   - params: JSON object with action-specific parameters.
 *
 * ─── Response File Format (.res.json) ──────────────────────────────────
 *
 *   {
 *     "id": "<matching-command-id>",
 *     "ok": true|false,
 *     "data": { <action-specific response data> },
 *     "error": null|"<error message>",
 *     "timestamp": "<ISO8601>"
 *   }
 *
 * ─── Available Commands ────────────────────────────────────────────────
 *
 *   PLAYER ACTIONS (params: { "steamId": "..." })
 *     player.heal              — Full heal (health, blood, shock, diseases, bleeding)
 *     player.kill              — Kill player
 *     player.teleport          — Teleport { steamId, x, y, z }
 *     player.spawnItem         — Spawn item { steamId, itemClass, quantity }
 *     player.strip             — Remove all items
 *     player.explode           — Explode player
 *     player.kick              — Kick { steamId, reason }
 *     player.message           — Send message { steamId, text }
 *     player.unstuck           — Move to surface
 *     player.freeze            — Freeze/unfreeze { steamId, frozen: 0|1 }
 *     player.teleportToPlayer  — Teleport to another player { steamId, targetSteamId }
 *     player.getLoadout        — Query player inventory (returns data)
 *     player.dry               — Remove wetness
 *     player.breakLegs         — Break legs
 *     player.makeSick          — Infect { steamId, diseaseType: cholera|influenza|salmonella }
 *     player.cure              — Remove all agents
 *     player.setBloodType      — Set blood type { steamId, bloodType: "O+"|"A-"|... }
 *     player.forceDrink        — Max water
 *     player.forceEat          — Max energy
 *     player.knockout          — Set shock to 0
 *     player.wake              — Set shock to 100
 *     player.setBleeding       — Add bleeding { steamId, sourceCount }
 *     player.stopBleeding      — Remove all bleeding
 *     player.dropGear          — Drop all items on ground
 *     player.launch            — Launch into air { steamId, power, angle }
 *     player.setStat           — Set stat { steamId, stat: health|blood|shock|water|energy, value }
 *     player.ragdoll           — Trigger ragdoll
 *     player.setGodmode        — Enable god mode
 *     player.removeGodmode     — Disable god mode
 *     player.setInvisible      — Enable invisibility
 *     player.removeInvisible   — Disable invisibility
 *     player.setStaminaInfinite    — Enable infinite stamina
 *     player.removeStaminaInfinite — Disable infinite stamina
 *     player.respawn           — Kill and respawn
 *     player.clearInventory    — Remove all items
 *     player.fillMagazines     — Fill all magazines to max ammo
 *     player.ban               — Ban player (adds to ban list)
 *     player.unban             — Unban player (removes from ban list)
 *     player.applyLoadout      — Apply saved loadout { steamId, loadoutName }
 *
 *   VEHICLE ACTIONS (params: { "vehicleId": "..." })
 *     vehicle.delete           — Delete vehicle
 *     vehicle.repair           — Full repair
 *     vehicle.refuel           — Full refuel
 *     vehicle.unstuck          — Unstick vehicle
 *     vehicle.explode          — Explode vehicle
 *     vehicle.kill-engine      — Kill engine
 *     vehicle.eject-driver     — Eject driver
 *     vehicle.teleport         — Teleport vehicle { vehicleId, x, y, z }
 *
 *   WORLD ACTIONS
 *     world.time               — Set time { hour, minute }
 *     world.weather            — Set weather { overcast, rain, fog, snow, wind }
 *     world.sunny              — Clear all weather
 *     world.wipeAI             — Delete all AI (zombies + animals)
 *     world.wipeVehicles       — Delete all vehicles
 *     world.spawnItem          — Spawn at coords { itemClass, x, y, z }
 *     world.broadcast          — Message all players { text }
 *     world.setFog             — Set fog { density }
 *     world.setWind            — Set wind { speed }
 *     world.flattenTrees       — Remove trees { x, z, radius | steamId }
 *     world.clearZombies       — Clear zombies { x, z, radius | steamId }
 *     world.deleteObjectsRadius — Delete objects { x, z, radius, objectType | steamId }
 *     world.deleteObject       — Delete by network ID { objectId }
 *
 *   SPAWN ACTIONS
 *     spawn.zombie             — Spawn zombies near player { steamId, count }
 *     spawn.animal             — Spawn animal { steamId, animalType }
 *     spawn.vehicle            — Spawn vehicle { steamId, vehicleClass }
 *     spawn.building           — Spawn building { steamId, buildingClass }
 *     spawn.horde              — Spawn zombie horde { steamId, count (max 50) }
 *     spawn.supplyCrate        — Spawn crate { coords }
 *     spawn.lootPile           — Spawn loot pile { steamId }
 *     spawn.itemAttached       — Spawn in inventory { steamId, itemClass }
 *     spawn.itemAt             — Spawn at coords { itemClass, coords }
 *     spawn.zombieAt           — Spawn zombies at coords { coords, count }
 *     spawn.animalAt           — Spawn animal at coords { animalType, coords }
 *     spawn.fire               — Spawn fire { steamId }
 *     spawn.smoke              — Spawn smoke { steamId, color: white|red|green|black }
 *     spawn.heliCrash          — Spawn heli crash { coords }
 *     spawn.gasZone            — Spawn gas zone { coords }
 *     spawn.supplyCrateJson    — Spawn supply crate from JSON config
 *
 *   STRUCTURE ACTIONS
 *     structure.openDoors      — Open doors { steamId, radius }
 *     structure.closeDoors     — Close doors { steamId, radius }
 *     structure.lootMagnet     — Pull loot to player { steamId, radius }
 *
 *   ITEM ACTIONS
 *     item.delete              — Delete item { persistentId }
 *     item.repair              — Repair item { persistentId }
 *
 *   QUERY ACTIONS (return data in response)
 *     player.getPosition       — Get position { steamId }
 *     player.getInfo           — Get full player info { steamId }
 *     player.getGear           — Get gear slots { steamId }
 *     player.getInventory      — Get full inventory { steamId }
 *     player.getStats          — Get session stats { steamId }
 *     player.getFull           — Get info+stats+gear combined { steamId }
 *     player.getGearFull       — Get detailed gear { steamId }
 *     player.getHandsData      — Get item in hands { steamId }
 *     data.onlinePlayers       — List all online players
 *     data.allPlayers          — Same as onlinePlayers (in-game only)
 *     data.serverInfo          — Server FPS, player count, entity counts
 *     data.nearbyVehicles      — Vehicles near coords { x, z, radius }
 *     data.vehicleInfo         — Vehicle details { vehicleId }
 *     data.itemDetails         — Item details { objectId }
 *     data.baseObjects         — Base objects near coords { x, z, radius }
 *     data.storageContents     — Container contents { objectId }
 *     data.allStorageObjects   — List all storage containers
 *     data.nearbyPlayers       — Players near player { steamId, radius }
 *     data.nearbyLoot          — Loot near player { steamId, radius }
 *     data.nearbyEntities      — Entities near player { steamId, radius }
 *     data.nearbyEntitiesAt    — Entities near coords { x, z, radius }
 *     data.nearbyLootAt        — Loot near coords { x, z, radius }
 *     data.bans                — Get all banned players list
 *
 *   CONFIG
 *     config.reload            — Reload citadel.cfg from disk
 *
 *   SERVER
 *     server.lock              — Lock server (requires RCON)
 *     server.unlock            — Unlock server (requires RCON)
 *
 * ─── Example Command ───────────────────────────────────────────────────
 *
 *   File: $profile:Citadel/commands/abc123.cmd.json
 *   {
 *     "id": "abc123",
 *     "action": "player.heal",
 *     "params": { "steamId": "76561198012345678" }
 *   }
 *
 *   Response: $profile:Citadel/responses/abc123.res.json
 *   {
 *     "id": "abc123",
 *     "ok": true,
 *     "data": {},
 *     "error": null,
 *     "timestamp": "2026-03-22T12:00:00Z"
 *   }
 */
class CitadelCommandRunner
{
    static const string CMD_DIR = "$profile:Citadel/commands";
    static const string RES_DIR = "$profile:Citadel/responses";

    protected ref Timer m_PollTimer;

    void CitadelCommandRunner()
    {
        int interval = GetCitadel().GetConfiguration().GetPollIntervalMs();
        m_PollTimer = new Timer();
        m_PollTimer.Run(interval * 0.001, this, "ProcessQueue", null, true);
        GetCitadel().GetLogger().Info(string.Format("Command runner initialized (interval=%1ms)", interval.ToString()));
    }

    void ~CitadelCommandRunner()
    {
        if (m_PollTimer)
            m_PollTimer.Stop();
    }

    // Maximum commands to process per poll cycle (rate limiting)
    static const int MAX_COMMANDS_PER_CYCLE = 10;

    void ProcessQueue()
    {
        // Periodic stamina refill for infinite stamina players
        CitadelPlayerActions.RefillInfiniteStamina();

        string fileName;
        FileAttr fileAttr;
        FindFileHandle findHandle = FindFile(CMD_DIR + "/*.cmd.json", fileName, fileAttr, FindFileFlags.ALL);

        if (findHandle == 0)
            return;

        int cmdCount = 0;
        ProcessCommandFile(CMD_DIR + "/" + fileName);
        cmdCount++;

        while (FindNextFile(findHandle, fileName, fileAttr))
        {
            if (cmdCount >= MAX_COMMANDS_PER_CYCLE)
            {
                GetCitadel().GetLogger().Warn("Rate limit reached: " + MAX_COMMANDS_PER_CYCLE.ToString() + " commands per cycle, deferring remaining");
                break;
            }
            ProcessCommandFile(CMD_DIR + "/" + fileName);
            cmdCount++;
        }

        CloseFindFile(findHandle);
    }

    protected void ProcessCommandFile(string filePath)
    {
        FileHandle file = OpenFile(filePath, FileMode.READ);
        if (file == 0)
            return;

        string content = "";
        string line;
        while (FGets(file, line) >= 0)
        {
            content += line;
        }
        CloseFile(file);

        // Delete immediately to prevent re-processing
        DeleteFile(filePath);

        if (content.Length() == 0)
            return;

        string id = ExtractJsonString(content, "id");
        string action = ExtractJsonString(content, "action");

        if (id == "" || action == "")
        {
            GetCitadel().GetLogger().Warn("Invalid command file: missing id or action");
            return;
        }

        GetCitadel().GetLogger().Info(string.Format("Processing command: %1 (id: %2)", action, id));

        bool success = false;
        string error = "";
        string responseData = "{}";

        // ─── Player Actions ─────────────────────────

        if (action == "player.heal")
            success = CitadelPlayerActions.HealPlayer(content, error);
        else if (action == "player.kill")
            success = CitadelPlayerActions.KillPlayer(content, error);
        else if (action == "player.teleport")
            success = CitadelPlayerActions.TeleportPlayer(content, error);
        else if (action == "player.spawnItem")
            success = CitadelPlayerActions.SpawnItem(content, error);
        else if (action == "player.strip")
            success = CitadelPlayerActions.StripPlayer(content, error);
        else if (action == "player.explode")
            success = CitadelPlayerActions.ExplodePlayer(content, error);
        else if (action == "player.kick")
            success = CitadelPlayerActions.KickPlayer(content, error);
        else if (action == "player.message")
            success = CitadelPlayerActions.MessagePlayer(content, error);
        else if (action == "player.unstuck")
            success = CitadelPlayerActions.UnstuckPlayer(content, error);
        else if (action == "player.freeze")
            success = CitadelPlayerActions.FreezePlayer(content, error);
        else if (action == "player.teleportToPlayer")
            success = CitadelPlayerActions.TeleportToPlayer(content, error);
        else if (action == "player.getLoadout")
            success = CitadelPlayerActions.GetLoadout(content, error, responseData);

        // ─── Player Actions — Health/Status ────────

        else if (action == "player.dry")
            success = CitadelPlayerActions.DryPlayer(content, error);
        else if (action == "player.breakLegs")
            success = CitadelPlayerActions.BreakLegs(content, error);
        else if (action == "player.makeSick")
            success = CitadelPlayerActions.MakeSick(content, error);
        else if (action == "player.cure")
            success = CitadelPlayerActions.CurePlayer(content, error);
        else if (action == "player.setBloodType")
            success = CitadelPlayerActions.SetBloodType(content, error);
        else if (action == "player.forceDrink")
            success = CitadelPlayerActions.ForceDrink(content, error);
        else if (action == "player.forceEat")
            success = CitadelPlayerActions.ForceEat(content, error);
        else if (action == "player.knockout")
            success = CitadelPlayerActions.KnockoutPlayer(content, error);
        else if (action == "player.wake")
            success = CitadelPlayerActions.WakePlayer(content, error);
        else if (action == "player.setBleeding")
            success = CitadelPlayerActions.SetBleeding(content, error);
        else if (action == "player.stopBleeding")
            success = CitadelPlayerActions.StopBleeding(content, error);

        // ─── Player Actions — Ability/State ────────

        else if (action == "player.dropGear")
            success = CitadelPlayerActions.DropGear(content, error);
        else if (action == "player.launch")
            success = CitadelPlayerActions.LaunchPlayer(content, error);
        else if (action == "player.setStat")
            success = CitadelPlayerActions.SetStat(content, error);
        else if (action == "player.ragdoll")
            success = CitadelPlayerActions.RagdollPlayer(content, error);
        else if (action == "player.setGodmode")
            success = CitadelPlayerActions.SetGodmode(content, error);
        else if (action == "player.removeGodmode")
            success = CitadelPlayerActions.RemoveGodmode(content, error);
        else if (action == "player.setInvisible")
            success = CitadelPlayerActions.SetInvisible(content, error);
        else if (action == "player.removeInvisible")
            success = CitadelPlayerActions.RemoveInvisible(content, error);
        else if (action == "player.setStaminaInfinite")
            success = CitadelPlayerActions.SetStaminaInfinite(content, error);
        else if (action == "player.removeStaminaInfinite")
            success = CitadelPlayerActions.RemoveStaminaInfinite(content, error);
        else if (action == "player.respawn")
            success = CitadelPlayerActions.RespawnPlayer(content, error);
        else if (action == "player.clearInventory")
            success = CitadelPlayerActions.ClearInventory(content, error);
        else if (action == "player.fillMagazines")
            success = CitadelPlayerActions.FillMagazines(content, error);
        else if (action == "player.ban")
            success = CitadelPlayerActions.BanPlayer(content, error);
        else if (action == "player.unban")
            success = CitadelPlayerActions.UnbanPlayer(content, error);
        else if (action == "player.applyLoadout")
            success = CitadelPlayerActions.ApplyLoadout(content, error);

        // ─── Vehicle Actions ────────────────────────

        else if (action == "vehicle.delete")
            success = CitadelVehicleActions.DeleteVehicle(content, error);
        else if (action == "vehicle.repair")
            success = CitadelVehicleActions.RepairVehicle(content, error);
        else if (action == "vehicle.refuel")
            success = CitadelVehicleActions.RefuelVehicle(content, error);
        else if (action == "vehicle.unstuck")
            success = CitadelVehicleActions.UnstuckVehicle(content, error);
        else if (action == "vehicle.explode")
            success = CitadelVehicleActions.ExplodeVehicle(content, error);
        else if (action == "vehicle.kill-engine")
            success = CitadelVehicleActions.KillEngine(content, error);
        else if (action == "vehicle.eject-driver")
            success = CitadelVehicleActions.EjectDriver(content, error);
        else if (action == "vehicle.teleport")
            success = CitadelVehicleActions.TeleportVehicle(content, error);

        // ─── World Actions ──────────────────────────

        else if (action == "world.time")
            success = CitadelWorldActions.SetTime(content, error);
        else if (action == "world.weather")
            success = CitadelWorldActions.SetWeather(content, error);
        else if (action == "world.sunny")
            success = CitadelWorldActions.ClearWeather(error);
        else if (action == "world.wipeAI")
            success = CitadelWorldActions.WipeAI(error);
        else if (action == "world.wipeVehicles")
            success = CitadelWorldActions.WipeVehicles(error);
        else if (action == "world.spawnItem")
            success = CitadelWorldActions.SpawnItemWorld(content, error);
        else if (action == "world.broadcast")
            success = CitadelWorldActions.BroadcastMessage(content, error);
        // ─── World Actions — Extended ─────────────────

        else if (action == "world.setFog")
            success = CitadelWorldActions.SetFog(content, error);
        else if (action == "world.setWind")
            success = CitadelWorldActions.SetWind(content, error);
        else if (action == "world.flattenTrees")
            success = CitadelWorldActions.FlattenTrees(content, error);
        else if (action == "world.clearZombies")
            success = CitadelWorldActions.ClearZombies(content, error);
        else if (action == "world.deleteObjectsRadius")
            success = CitadelWorldActions.DeleteObjectsRadius(content, error);

        // ─── Spawn Actions ────────────────────────────

        else if (action == "spawn.zombie")
            success = CitadelWorldActions.SpawnZombie(content, error);
        else if (action == "spawn.animal")
            success = CitadelWorldActions.SpawnAnimal(content, error);
        else if (action == "spawn.vehicle")
            success = CitadelWorldActions.SpawnVehicle(content, error);
        else if (action == "spawn.building")
            success = CitadelWorldActions.SpawnBuilding(content, error);
        else if (action == "spawn.horde")
            success = CitadelWorldActions.SpawnHorde(content, error);
        else if (action == "spawn.supplyCrate")
            success = CitadelWorldActions.SpawnSupplyCrate(content, error);
        else if (action == "spawn.lootPile")
            success = CitadelWorldActions.SpawnLootPile(content, error);
        else if (action == "spawn.itemAttached")
            success = CitadelPlayerActions.SpawnItemAttached(content, error);
        else if (action == "spawn.itemAt")
            success = CitadelWorldActions.SpawnItemAt(content, error);
        else if (action == "spawn.zombieAt")
            success = CitadelWorldActions.SpawnZombieAt(content, error);
        else if (action == "spawn.animalAt")
            success = CitadelWorldActions.SpawnAnimalAt(content, error);
        else if (action == "spawn.fire")
            success = CitadelWorldActions.SpawnFire(content, error);
        else if (action == "spawn.smoke")
            success = CitadelWorldActions.SpawnSmoke(content, error);
        else if (action == "spawn.heliCrash")
            success = CitadelWorldActions.SpawnHeliCrash(content, error);
        else if (action == "spawn.gasZone")
            success = CitadelWorldActions.SpawnGasZone(content, error);
        else if (action == "spawn.supplyCrateJson")
            success = CitadelWorldActions.SpawnSupplyCrateJson(content, error);

        // ─── Structure Actions ────────────────────────

        else if (action == "structure.openDoors")
            success = CitadelWorldActions.OpenDoors(content, error);
        else if (action == "structure.closeDoors")
            success = CitadelWorldActions.CloseDoors(content, error);
        else if (action == "structure.lootMagnet")
            success = CitadelWorldActions.LootMagnet(content, error);

        // ─── Item Actions ─────────────────────────────

        else if (action == "item.delete")
            success = CitadelWorldActions.DeleteItem(content, error);
        else if (action == "item.repair")
            success = CitadelWorldActions.RepairItem(content, error);

        // ─── Config ───────────────────────────────────

        else if (action == "config.reload")
        {
            GetCitadel().GetConfiguration().LoadFromDisk();
            if (GetCitadel().GetServerConfig())
                GetCitadel().GetServerConfig().LoadFromDisk();
            success = true;
            GetCitadel().GetLogger().Info("Configuration reloaded from disk");
        }

        // ─── Server Actions ─────────────────────────

        else if (action == "world.deleteObject")
            success = DeleteWorldObject(content, error, responseData);
        else if (action == "server.lock")
            success = LockServer(error);
        else if (action == "server.unlock")
            success = UnlockServer(error);

        // ─── Player Queries ─────────────────────────

        else if (action == "player.getPosition")
            success = CitadelQueryActions.GetPlayerPosition(content, error, responseData);
        else if (action == "player.getInfo")
            success = CitadelQueryActions.GetPlayerInfo(content, error, responseData);
        else if (action == "player.getGear")
            success = CitadelQueryActions.GetPlayerGear(content, error, responseData);
        else if (action == "player.getInventory")
            success = CitadelQueryActions.GetPlayerInventory(content, error, responseData);
        else if (action == "player.getStats")
            success = CitadelQueryActions.GetPlayerStats(content, error, responseData);
        else if (action == "player.getFull")
            success = CitadelQueryActions.GetPlayerFull(content, error, responseData);
        else if (action == "player.getGearFull")
            success = CitadelQueryActions.GetPlayerGearFull(content, error, responseData);
        else if (action == "player.getHandsData")
            success = CitadelQueryActions.GetPlayerHandsData(content, error, responseData);

        // ─── Data Queries ───────────────────────────

        else if (action == "data.onlinePlayers")
            success = CitadelQueryActions.GetOnlinePlayers(error, responseData);
        else if (action == "data.allPlayers")
            success = CitadelQueryActions.GetAllPlayers(error, responseData);
        else if (action == "data.serverInfo")
            success = CitadelQueryActions.GetServerInfo(error, responseData);
        else if (action == "data.nearbyVehicles")
            success = CitadelQueryActions.GetNearbyVehicles(content, error, responseData);
        else if (action == "data.vehicleInfo")
            success = CitadelQueryActions.GetVehicleInfo(content, error, responseData);
        else if (action == "data.itemDetails")
            success = CitadelQueryActions.GetItemDetails(content, error, responseData);
        else if (action == "data.baseObjects")
            success = CitadelQueryActions.GetBaseObjects(content, error, responseData);
        else if (action == "data.storageContents")
            success = CitadelQueryActions.GetStorageContents(content, error, responseData);
        else if (action == "data.allStorageObjects")
            success = CitadelQueryActions.GetAllStorageObjects(error, responseData);
        else if (action == "data.nearbyPlayers")
            success = CitadelQueryActions.GetNearbyPlayers(content, error, responseData);
        else if (action == "data.nearbyLoot")
            success = CitadelQueryActions.GetNearbyLoot(content, error, responseData);
        else if (action == "data.nearbyEntities")
            success = CitadelQueryActions.GetNearbyEntities(content, error, responseData);
        else if (action == "data.nearbyEntitiesAt")
            success = CitadelQueryActions.GetNearbyEntitiesAt(content, error, responseData);
        else if (action == "data.nearbyLootAt")
            success = CitadelQueryActions.GetNearbyLootAt(content, error, responseData);
        else if (action == "data.bans")
            success = CitadelPlayerActions.GetBans(content, error, responseData);

        else
        {
            error = "Unknown action: " + action;
            GetCitadel().GetLogger().Warn(error);
        }

        WriteResponse(id, success, responseData, error);
    }

    // ─── New Server Actions ─────────────────────────

    protected bool DeleteWorldObject(string cmdJson, out string error, out string responseData)
    {
        string params = ExtractParams(cmdJson);
        string objectId = ExtractJsonString(params, "objectId");

        if (objectId == "")
        {
            error = "objectId required";
            return false;
        }

        // Search all objects for matching network ID
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && CitGetNetworkIDString(entity) == objectId)
            {
                string type = entity.GetType();
                GetGame().ObjectDelete(entity);
                GetCitadel().GetLogger().Info("Deleted world object: " + type + " (id: " + objectId + ")");
                responseData = "{\"deleted\":\"" + type + "\"}";
                return true;
            }
        }

        error = "Object not found: " + objectId;
        return false;
    }

    protected bool LockServer(out string error)
    {
        // Server lock/unlock requires BattlEye RCON — cannot be done from script directly.
        // The plugin agent should handle this via RCON instead.
        error = "Server lock requires RCON — use the plugin agent";
        GetCitadel().GetLogger().Warn("server.lock requested but requires RCON");
        return false;
    }

    protected bool UnlockServer(out string error)
    {
        // Server lock/unlock requires BattlEye RCON — cannot be done from script directly.
        error = "Server unlock requires RCON — use the plugin agent";
        GetCitadel().GetLogger().Warn("server.unlock requested but requires RCON");
        return false;
    }

    // ─── Response Writer ────────────────────────────

    protected void WriteResponse(string id, bool success, string data, string error)
    {
        // Sanitize id to prevent path traversal — only allow alphanumeric, hyphens, underscores
        string ALLOWED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
        string safeId = "";
        for (int ci = 0; ci < id.Length(); ci++)
        {
            string ch = id.Get(ci);
            if (ALLOWED.IndexOf(ch) >= 0)
                safeId += ch;
        }
        if (safeId == "")
        {
            GetCitadel().GetLogger().Error("WriteResponse: invalid command id (empty after sanitization)");
            return;
        }

        string resPath = RES_DIR + "/" + safeId + ".res.json";
        FileHandle file = OpenFile(resPath, FileMode.WRITE);
        if (file == 0)
        {
            GetCitadel().GetLogger().Error("Could not write response file: " + resPath);
            return;
        }

        string okStr = "false";
        if (success) okStr = "true";
        string errStr = "null";
        if (error != "") errStr = "\"" + error + "\"";

        string json = "{\"id\":\"" + id + "\",";
        json += "\"ok\":" + okStr + ",";
        json += "\"data\":" + data + ",";
        json += "\"error\":" + errStr + ",";
        json += "\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"}";

        FPrintln(file, json);
        CloseFile(file);
    }

    // JSON helpers delegate to CitadelJson (3_Game)
    static string ExtractJsonString(string json, string key) { return CitadelJson.ExtractString(json, key); }
    static float ExtractJsonFloat(string json, string key) { return CitadelJson.ExtractFloat(json, key); }
    static int ExtractJsonInt(string json, string key) { return CitadelJson.ExtractInt(json, key); }
    static string ExtractParams(string json) { return CitadelJson.ExtractParams(json); }
};
