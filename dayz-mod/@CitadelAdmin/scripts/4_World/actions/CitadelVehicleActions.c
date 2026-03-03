/**
 * CitadelVehicleActions — In-game vehicle action execution.
 */
class CitadelVehicleActions
{
    static CarScript FindVehicle(string vehicleId)
    {
        if (vehicleId == "")
            return null;

        CarScript car;

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object o : objects)
        {
            car = CarScript.Cast(o);
            if (car)
            {
                EntityAI entity = EntityAI.Cast(car);
                if (entity && entity.GetNetworkIDString() == vehicleId)
                    return car;
            }
        }

        return null;
    }

    static bool DeleteVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        GetGame().ObjectDelete(vehicle);
        Print("[Citadel] Deleted vehicle: " + vehicleId);
        return true;
    }

    static bool RepairVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        ref array<string> zones = new array<string>();
        vehicle.GetDamageZones(zones);

        foreach (string zone : zones)
        {
            vehicle.SetHealth(zone, "Health", vehicle.GetMaxHealth(zone, "Health"));
        }

        vehicle.SetHealth("Engine", "Health", vehicle.GetMaxHealth("Engine", "Health"));

        Print("[Citadel] Repaired vehicle: " + vehicleId);
        return true;
    }

    static bool RefuelVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vehicle.Fill(CarFluid.FUEL, vehicle.GetFluidCapacity(CarFluid.FUEL));
        vehicle.Fill(CarFluid.OIL, vehicle.GetFluidCapacity(CarFluid.OIL));
        vehicle.Fill(CarFluid.BRAKE, vehicle.GetFluidCapacity(CarFluid.BRAKE));
        vehicle.Fill(CarFluid.COOLANT, vehicle.GetFluidCapacity(CarFluid.COOLANT));

        Print("[Citadel] Refueled vehicle: " + vehicleId);
        return true;
    }

    static bool UnstuckVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vector pos = vehicle.GetPosition();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]) + 1.0;
        vehicle.SetPosition(pos);

        vector orient = vehicle.GetOrientation();
        orient[1] = 0;
        orient[2] = 0;
        vehicle.SetOrientation(orient);

        Print("[Citadel] Unstuck vehicle: " + vehicleId);
        return true;
    }

    static bool ExplodeVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vehicle.Explode(DT_EXPLOSION, "LandFuelFeed_Ammo");

        Print("[Citadel] Exploded vehicle: " + vehicleId);
        return true;
    }

    static bool KillEngine(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vehicle.SetHealth("Engine", "Health", 0);

        Print("[Citadel] Killed engine: " + vehicleId);
        return true;
    }

    static bool EjectDriver(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        int c;
        Human crew;
        PlayerBase player;
        for (c = 0; c < vehicle.CrewSize(); c++)
        {
            crew = vehicle.CrewMember(c);
            if (!crew) continue;

            if (Class.CastTo(player, crew))
            {
                if (vehicle.CrewMemberIndex(player) == DayZPlayerConstants.VEHICLESEAT_DRIVER)
                {
                    HumanCommandVehicle vehCommand = player.GetCommand_Vehicle();
                    if (vehCommand)
                        vehCommand.GetOutVehicle();
                    break;
                }
            }
        }

        Print("[Citadel] Ejected driver from vehicle: " + vehicleId);
        return true;
    }
};
