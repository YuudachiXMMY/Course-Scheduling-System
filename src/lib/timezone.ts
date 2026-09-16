// Single source of truth for the application's time zone.
//
// Every instant is stored in UTC in the database. This constant is only the
// zone used to (a) render UTC instants as wall-clock times and (b) interpret
// wall-clock input / recurrence rules back into UTC. Changing it does not move
// any already-stored instant — it only changes which wall-clock a given instant
// is shown as, and which wall-clock new input maps to.
//
// Keep this as the ONLY place the app-default IANA zone is written, so a future
// relocation is a one-line change plus a data migration for stored per-row zones.
export const APP_TIME_ZONE = 'America/Toronto'
