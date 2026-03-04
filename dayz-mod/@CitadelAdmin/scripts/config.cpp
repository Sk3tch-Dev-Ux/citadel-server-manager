class CfgPatches
{
    class CitadelAdmin
    {
        units[] = {};
        weapons[] = {};
        requiredVersion = 0.1;
        requiredAddons[] = {"DZ_Data", "DZ_Scripts"};
    };

    class CitadelDefine
    {
        units[] = {};
        weapons[] = {};
        requiredVersion = 0.1;
        requiredAddons[] = {};
    };
};

class CfgMods
{
    class CitadelAdmin
    {
        dir = "CitadelAdmin";
        picture = "";
        action = "";
        hideName = 0;
        hidePicture = 1;
        name = "CitadelAdmin";
        credits = "Citadel";
        author = "Citadel";
        authorID = "0";
        version = "2.0";
        extra = 0;
        type = "mod";

        dependencies[] = {"Core", "Game", "World", "Mission"};

        defines[] =
        {
            "CitadelAdmin",
            "CitadelDefine",
            "CITADEL"
        };

        class defs
        {
            class gameScriptModule
            {
                value = "";
                files[] = {"CitadelAdmin/scripts/3_Game"};
            };
            class worldScriptModule
            {
                value = "";
                files[] = {"CitadelAdmin/scripts/4_World"};
            };
            class missionScriptModule
            {
                value = "";
                files[] = {"CitadelAdmin/scripts/5_Mission"};
            };
        };
    };
};
