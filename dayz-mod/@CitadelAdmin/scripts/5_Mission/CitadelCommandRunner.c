/**
 * CitadelCommandRunner — File-based command queue processor.
 *
 * Relocated from 4_World to 5_Mission (proper layer for command execution).
 * Enhanced with additional commands and richer response payloads.
 *
 * Polls $profile:Citadel/commands/ for *.cmd.json files, processes them,
 * and writes responses to $profile:Citadel/responses/.
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

    void ProcessQueue()
    {
        string fileName;
        FileAttr fileAttr;
        FindFileHandle findHandle = FindFile(CMD_DIR + "/*.cmd.json", fileName, fileAttr, FindFileFlags.ALL);

        if (findHandle == 0)
            return;

        ProcessCommandFile(CMD_DIR + "/" + fileName);

        while (FindNextFile(findHandle, fileName, fileAttr))
        {
            ProcessCommandFile(CMD_DIR + "/" + fileName);
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
        string resPath = RES_DIR + "/" + id + ".res.json";
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

        string json = "{\"id\":\"" + id + "\",\"ok\":" + okStr + ",\"data\":" + data + ",\"error\":" + errStr + ",\"timestamp\":\"" + CitadelLogger.GetISO8601Static() + "\"}";

        FPrintln(file, json);
        CloseFile(file);
    }

    // JSON helpers delegate to CitadelJson (3_Game)
    static string ExtractJsonString(string json, string key) { return CitadelJson.ExtractString(json, key); }
    static float ExtractJsonFloat(string json, string key) { return CitadelJson.ExtractFloat(json, key); }
    static int ExtractJsonInt(string json, string key) { return CitadelJson.ExtractInt(json, key); }
    static string ExtractParams(string json) { return CitadelJson.ExtractParams(json); }
};
