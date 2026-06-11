/**
 * CitadelFPSTracker — Server FPS and tick time measurement.
 *
 * Hooks into DayZGame.OnUpdate() to measure real server performance.
 * Follows the GameLabs/CFTools pattern exactly:
 *   - Counts ticks per second for FPS
 *   - Tracks tick time deltas for avg/low/high
 *   - Stores results in CitadelCore via SetServerFPS() / SetTickTimes()
 *
 * PERFORMANCE: Two optimizations vs. original:
 *   1. RING BUFFER — Replaces Insert()+Remove(0) with circular overwrite.
 *      Remove(0) shifts the entire array left (O(n=60) every frame).
 *      Ring buffer just overwrites the oldest slot (O(1) every frame).
 *   2. EVENT FLUSH — Calls CitadelEventLogger.CheckFlush() every tick
 *      so buffered events are written to disk within ~2 seconds.
 */
modded class DayZGame
{
    int cit_tps = 0;
    int cit_ticks = 0;
    int cit_tpsTime = 0;
    int cit_ticksTotal = 0;
    // Min/max of the 1s FPS samples since the last CitSetAllTickTimeValues()
    // sync — i.e. over one metrics collection window. 0 means "no sample yet".
    int cit_tpsWindowMin = 0;
    int cit_tpsWindowMax = 0;
    float cit_lastTickTime = 0.0;
    float cit_tickTimeHigh = 0.0;
    float cit_tickTimeLow = 0.0;

    // Ring buffer for tick times (replaces dynamic array with Remove(0))
    ref array<float> cit_tickTimes = new array<float>();
    int cit_tickTimeAverageWindow = 60;
    int cit_ringIndex = 0;
    bool cit_ringFull = false;

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
            GetCitadel().SetTickCount(this.cit_ticksTotal);
            // Publish the FPS window, then open a fresh one. Only the metrics
            // tracker calls this, so the window length equals the metrics
            // collection interval.
            GetCitadel().SetFPSWindow(this.cit_tpsWindowMin, this.cit_tpsWindowMax);
            this.cit_tpsWindowMin = 0;
            this.cit_tpsWindowMax = 0;
        }
    }

    float CitGetAverageTickTime()
    {
        int count;
        if (this.cit_ringFull)
            count = this.cit_tickTimeAverageWindow;
        else
            count = this.cit_tickTimes.Count();

        // Average over whatever samples we have. Returning 0 until the
        // buffer was full meant the dashboard showed FPS=0 for the first
        // ~2 seconds after mission load, since the sidecar derives FPS
        // from `1000 / tick_avg` and a 0 tick_avg falls through to the
        // fps fallback (also 0 at startup).
        if (count <= 0) return 0.0;

        float sum = 0.0;
        for (int i = 0; i < count; i++)
        {
            sum += this.cit_tickTimes.Get(i);
        }
        return (sum / count);
    }

    override void OnUpdate(bool doSim, float timeslice)
    {
        super.OnUpdate(doSim, timeslice);

        if (g_Game && g_Game.IsServer())
        {
            this.cit_ticksTotal++;

            // Flush buffered event log entries (cost: one float comparison)
            CitadelEventLogger.CheckFlush();

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

                    // Skip zero-diffs (GetTickTime() can return the same value
                    // for consecutive rapid OnUpdate() calls due to precision)
                    if (diff > 0.0)
                    {
                        if (this.cit_tickTimeLow == 0.0 || diff < this.cit_tickTimeLow)
                        {
                            this.cit_tickTimeLow = diff;
                        }

                        if (diff > this.cit_tickTimeHigh)
                        {
                            this.cit_tickTimeHigh = diff;
                        }

                        // ─── Ring Buffer Write (O(1) vs. O(n) Remove(0)) ───
                        if (this.cit_ringFull)
                        {
                            // Overwrite oldest entry in-place
                            this.cit_tickTimes.Set(this.cit_ringIndex, diff);
                        }
                        else
                        {
                            // Still filling the buffer
                            this.cit_tickTimes.Insert(diff);
                        }

                        this.cit_ringIndex++;
                        if (this.cit_ringIndex >= this.cit_tickTimeAverageWindow)
                        {
                            this.cit_ringIndex = 0;
                            this.cit_ringFull = true;
                        }
                    }
                }
            }

            // Count SIMULATION frames only. On an idle dedicated server OnUpdate
            // is called uncapped (tens of thousands/sec), so counting every call
            // reported a meaningless ~41k "FPS". doSim is true on actual sim ticks
            // — counting those gives the real server FPS (~30-60) that fits the
            // cloud's fps×100 smallint and matches what operators expect.
            if (doSim)
                this.cit_ticks++;
            if (this.cit_tpsTime + 1 < tickTime)
            {
                this.cit_tpsTime = tickTime;
                // Ticks counted in the last ~1s window IS the FPS — the
                // previous code divided by 2 here for no reason, halving
                // every reported FPS. (Real 30fps would show as 15.)
                this.cit_tps = this.cit_ticks;
                this.cit_ticks = 0;
                if (this.cit_tpsWindowMin == 0 || this.cit_tps < this.cit_tpsWindowMin)
                    this.cit_tpsWindowMin = this.cit_tps;
                if (this.cit_tps > this.cit_tpsWindowMax)
                    this.cit_tpsWindowMax = this.cit_tps;
                if (GetCitadel()) GetCitadel().SetServerFPS(this.cit_tps);
            }
        }
    }
};
