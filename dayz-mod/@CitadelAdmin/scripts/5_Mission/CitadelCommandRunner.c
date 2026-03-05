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
