# Anura — Field Mobile

Anura Field Mobile is the purpose-built mobile application for field technicians, Team Leads, and Project Site Leads. It is not a scaled-down version of the full Anura interface — it is a dedicated mobile experience designed specifically for field execution. Same Anura database, same permissions system, completely different interface optimized for one-handed use in the field.

Reference UI: Salesforce Field Service mobile app. Match that experience and standard.

---

## Today's Schedule — Home Screen

The technician's home screen shows only their assigned work orders for today, in scheduled order:
- Property name and address
- Building and unit if applicable
- Work type
- Estimated duration
- Current status
- Assigned crew members

One tap opens the work order detail. Schedule is pushed by the Director of Field Services or Project Coordinator — the technician does not self-assign.

---

## Map View

All of today's work order stops plotted on a map:
- Each stop shown as a pin with work order number and status
- Route visualization between stops in scheduled order
- Tap a pin to see the work order summary card
- Navigate button launches Apple Maps or Google Maps with the address pre-loaded
- Current location shown in real time
- GPS coordinates logged at each stop

---

## Work Order Detail

Full work order view optimized for mobile:
- Property name, full address, building, unit
- Work type and estimated duration
- Assigned crew members for this work order
- Work plan steps in sequence
- Each step shows description, guidance notes, estimated duration, required evidence type, and status
- Complete steps in order — step cannot be marked complete without required evidence attached

---

## Photo Capture

Photo capture is inline — camera opens directly within the work step. No leaving the app.
- Before and after photo designated per step where required
- Photo attaches automatically to the specific work step on the record
- Photos sync to Supabase Storage immediately if connected, queued for sync if offline
- Technician cannot submit work order without all required photos captured

---

## Clock In / Clock Out

- Tap to clock in on arrival — timestamp and GPS recorded automatically
- Tap to clock out on completion — timestamp, GPS, and odometer entry recorded
- Travel work orders clocked the same way — shop load-up, drive to site, drive between sites, return to shop
- All time entries logged against the work order and technician record

---

## Work Order Submission

When all steps are complete and all evidence attached:
- Technician reviews completion summary
- Taps Submit for Verification
- Status changes to Work Order Submitted
- Project Coordinator notified automatically
- Technician returns to Today's Schedule

---

## Corrections Needed

- Push notification to technician and Team Lead
- Work order appears in schedule with Corrections Needed status highlighted
- Specific steps flagged with correction notes from Project Coordinator
- Technician completes corrections, re-attaches evidence, resubmits
- Resubmission logged as activity on the work order record

---

## Notifications

Push notifications for:
- New work order assigned
- Schedule change
- Corrections needed — work order kicked back
- Message from Project Coordinator
- Upcoming work order reminder — 30 minutes before
- Clock out reminder if work order still open past estimated completion

---

## Offline Capability

Critical for buildings with no cell service — concrete construction, basements, large multifamily complexes.
- Work orders and work plans cached locally when app opens in the morning
- Photos stored locally and queued for sync
- Step completions recorded offline and synced when connectivity returns
- Clock in / clock out recorded offline with timestamp and synced when connected
- Sync status indicator always visible
- Conflict resolution — flags conflicts for review rather than silently overwriting

---

## Technician Permissions in Mobile

Field Technicians see only their assigned work orders, their work plan steps, their clock in/out history, and their assigned equipment and vehicle. No financial fields. No project-level records. No other technicians' data.

Team Leads see all of the above plus their full team's work orders, vehicle check-out, crew phone issuance, and team clock records. Can submit work orders on behalf of their team.

Project Site Leads see all of the above plus real-time status across all three teams under their supervision.

---

## Technical Notes

- Progressive Web App (PWA) — installable on iOS and Android without app store, works in mobile browser. Or native React Native build if app store presence required — decision before build
- Offline-first architecture using local storage with background sync to Supabase
- Optimized for one-handed use — large tap targets, minimal typing, camera-first
- Works on crew-issued Android and iOS phones
- Low data usage — photos compressed before upload, sync batched on WiFi
