////////////////////////////////////////////////////////////////////
//DeRap: C:\temp\pbo_work\final\Scripts\config.bin
//Produced from mikero's Dos Tools Dll version 10.13
//https://mikero.bytex.digital/Downloads
//'now' is Wed Mar 25 21:08:58 2026 : 'file' last modified on Wed Mar 25 21:08:49 2026
////////////////////////////////////////////////////////////////////

#define _ARMA_

class CfgPatches
{
	class DayZCommandRelay
	{
		name = "DayZ Command Relay";
		overview = "Polls a web API for commands and executes them on the server";
		author = "C";
		version = "1.0";
		requiredAddons[] = {"DZ_Data","DZ_Scripts"};
	};
};
class CfgMods
{
	class DayZCommandRelay
	{
		type = "mod";
		class defs
		{
			class worldScriptModule
			{
				value = "";
				files[] = {"DayZCommandRelay/Scripts/4_World"};
			};
			class missionScriptModule
			{
				value = "";
				files[] = {"DayZCommandRelay/Scripts/5_Mission"};
			};
		};
	};
};
