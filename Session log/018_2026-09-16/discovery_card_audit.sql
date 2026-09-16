-- Audit: exactly what the Metrics "Discovery calls → conversion" card (003)
-- counts for a date range, with the columns the Explore modal hides.
-- Mirrors src/db.ts pageDiscovery + fetchRangeAppointments. Paste into the
-- Supabase SQL editor (runs as postgres, bypasses RLS). Edit the two dates.

with range as (select date '2026-01-01' as d_from, date '2026-12-31' as d_to)
select
  a.id,
  a.name,                              -- the label the substring rule matched
  a.category,
  a.status,                            -- always 'A' here; stale cancels still read 'A'
  a.date_added   as booked_on,         -- the date the card buckets by
  a.start_date   as scheduled_for,     -- the actual call date
  c.name         as prospect,
  a.client_id,
  co.name        as coach,
  a.coach_id,
  a.engagement_id,
  a.synced_at                          -- first-insert time only (not refreshed on upsert)
from ca_appointments a
cross join range r
left join ca_clients c  on c.id  = a.client_id
left join ca_coaches co on co.id = a.coach_id
where a.category in ('discoveryPhone', 'discoveryZoom')
  and a.status = 'A'
  and (
        (a.date_added between r.d_from and r.d_to)
     or (a.date_added is null and a.start_date between r.d_from and r.d_to)
  )
  and coalesce(c.is_excluded, false) = false
  and not exists (
        select 1 from mentees m
        where m.client_id = a.client_id and m.is_test = true
  )
order by a.date_added desc nulls last, a.start_date desc;

-- Every label that the classifier files under a discovery category, by status.
-- Anything here that is not a real discovery-call appointment type is a
-- classification leak (lib/config.ts DISCOVERY_*_CONTAINS).
select a.category, a.name, a.status, count(*) as rows
from ca_appointments a
where a.category in ('discoveryPhone', 'discoveryZoom')
group by 1, 2, 3
order by 1, 4 desc;

-- Prospects with more than one active discovery call (double bookings or
-- cancel+rebook reschedules whose old row never got its status updated).
select a.client_id, c.name as prospect, count(*) as calls,
       string_agg(a.id::text || ' @ ' || coalesce(a.start_date::text, '?'), ', '
                  order by a.start_date) as appointments
from ca_appointments a
left join ca_clients c on c.id = a.client_id
where a.category in ('discoveryPhone', 'discoveryZoom') and a.status = 'A'
group by 1, 2
having count(*) > 1
order by calls desc, prospect;
