-- Fallback ONLY if the card still reads 71 after a re-sync on v0.7.2+.
-- Reclassifies the mirror in place exactly as the deployed classifier would;
-- a later sync produces the same result, so this is safe to run once.
-- Paste into the Supabase SQL editor.
update ca_appointments set category = 'excluded'
 where name ilike 'MT Discovery Call%' and category <> 'excluded';
update ca_appointments set category = 'discoveryPhone'
 where name ilike 'Discovery Call Appointment (Phone)' and category <> 'discoveryPhone';
-- Sanity check afterwards: expect NO 'MT ...' rows and NO '(Phone)' rows as Zoom.
select category, name, count(*) from ca_appointments
 where category in ('discoveryPhone','discoveryZoom') group by 1,2 order by 1,3 desc;
