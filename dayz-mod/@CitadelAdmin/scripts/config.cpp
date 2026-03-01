class CfgPatches
{
    class CitadelAdmin
    {
        units[] = {};
        weapons[] = {};
        requiredVersion = 0.1;
        requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
    };
};

class CfgMods
{
    class CitadelAdmin
    {
        type = "mod";
        dependencies[] = {"World"};
        class defs
        {
            class worldScriptModule
            {
                value = "";
                files[] = {"CitadelAdmin/scripts/4_World"};
            };
        };
    };
};
