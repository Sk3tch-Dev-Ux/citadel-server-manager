/**
 * CitadelFPSTracker — Server FPS and tick time measurement.
 *
 * Hooks into DayZGame.OnUpdate() to measure real server performance.
 * Follows the GameLabs/CFTools pattern exactly:
 *   - Counts ticks per second for FPS
 *   - Tracks tick time deltas for avg/low/high
 *   - Stores results in CitadelCore via SetServerFPS() / SetTickTimes()
 */
modded class DayZGame
{
    int cit_tps = 0;
    int cit_ticks = 0;
    int cit_tpsTime = 0;
    int cit_ticksTotal = 0;
    float cit_lastTickTime = 0.0;
    float cit_tickTimeHigh = 0.0;
    float cit_tickTimeLow = 0.0;

    ref array<float> cit_tickTimes = {};
    int cit_tickTimeAverageWindow = 60;

    bool cit_missionLoaded = false;

    void CitSetMissionLoaded()
    {
        this.cit_missionLoaded = true;
    }

    void CitSetAllTickTimeValues()
    {
        if (GetCitadel())
        {
            GetCitadel().SetTickTimes(this.CitGetAverageTickTime(), this.cit_tickTimeLow, this.cit_tickTimeHigh);
        }
    }

    float CitGetAverageTickTime()
    {
        if (this.cit_tickTimes.Count() < this.cit_tickTimeAverageWindow) return 0.0;

        float sum = 0.0;
        for (int i = 0; i < this.cit_tickTimes.Count(); i++)
        {
            sum += this.cit_tickTimes.Get(i);
        }
        return (sum / this.cit_tickTimes.Count());
    }

    override void OnUpdate(bool doSim, float timeslice)
    {
        super.OnUpdate(doSim, timeslice);

        if (g_Game && g_Game.IsServer())
        {
            this.cit_ticksTotal++;

            float tickTime = GetGame().GetTickTime();

            if (this.cit_missionLoaded)
            {
                float tickTimeScaled = tickTime * 1000;

                if (this.cit_lastTickTime == 0)
                {
                    this.cit_lastTickTime = tickTimeScaled;
                }
                else
                {
                    float diff = tickTimeScaled - this.cit_lastTickTime;
                    this.cit_lastTickTime = tickTimeScaled;

                    if (this.cit_tickTimeLow == 0.0)
                    {
                        this.cit_tickTimeLow = diff;
                    }
                    else
                    {
                        if (diff < this.cit_tickTimeLow)
                        {
                            this.cit_tickTimeLow = diff;
                        }
                    }

                    if (this.cit_tickTimeHigh == 0.0)
                    {
                        this.cit_tickTimeHigh = diff;
                    }
                    else
                    {
                        if (diff > this.cit_tickTimeHigh)
                        {
                            this.cit_tickTimeHigh = diff;
                        }
                    }

                    this.cit_tickTimes.Insert(diff);
                    if (this.cit_tickTimes.Count() > this.cit_tickTimeAverageWindow)
                    {
                        this.cit_tickTimes.Remove(0);
                    }
                }
            }

            this.cit_ticks++;
            if (this.cit_tpsTime + 1 < tickTime)
            {
                this.cit_tpsTime = tickTime;
                this.cit_tps = this.cit_ticks / 2;
                this.cit_ticks = 0;
                if (GetCitadel()) GetCitadel().SetServerFPS(this.cit_tps);
            }
        }
    }
};
