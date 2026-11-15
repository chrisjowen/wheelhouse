# Events and reminders

Open **Events** in Wheelhouse's menu. The first release supports local reminders; GitHub sources, provider webhooks, Fleetyard deliveries, scheduled captain messages and waking a stopped machine come later.

The **Feed** shows upcoming reminders and the events they produced. Set a reminder with your own text, a time zone and one of these rules:

| Rule     | Example                         |
| -------- | ------------------------------- |
| Once     | `once 2026-11-20T09:00`         |
| Daily    | `daily 08:30`                   |
| Weekdays | `weekdays 08:30`                |
| Weekly   | `weekly mon,thu 17:00`          |
| Monthly  | `monthly 1 09:00`               |
| Interval | `every 2h` (minimum 15 minutes) |

An ISO timestamp ending in `Z` or an offset is an exact instant. Without an offset, the date and time use the reminder's IANA time zone. Calendar reminders skip a daylight-saving gap and fire once when a clock time repeats. If the machine was off, choose one reminder with a missed count (the default), every missed occurrence, or skip. Wheelhouse must be running: its scheduler checks about every 15 seconds.

## Connect Firstmate

In **Sources**, select **Connect events to Firstmate** and confirm the same-user-code trust and artifact-reference consent. Wheelhouse copies its packaged `firstmate-extension/` into its private configuration directory, writes a launcher using this installation's absolute Node path, then runs Firstmate's existing commands:

```text
fm-extension.sh bind <prepared-package> --adapter wheelhouse-events --trust-same-user-code --consent artifact-references
fm-procevent.sh register-extension wheelhouse-events wh-events --config-ref <outbox>
```

Firstmate pins and verifies the package digest. A Wheelhouse upgrade does not silently replace the enabled code. To rebind after an upgrade, disconnect and connect again. Disconnect uses the saved registration owner token and binding digest; it cannot retire a replacement owned by somebody else. Firstmate may require pending results to be handled before it will retire the binding. In that case, handle those results and retry disconnect.

The outbox and its connection record are under `<Wheelhouse config>/events/<home hash>/`. They are separate for each Firstmate home, and Wheelhouse refuses a config directory inside that home. Same-user processes are trusted, as with Firstmate's extension API. A cloud-paired machine without trusted passkey pins cannot enable or deliver events. Local, unpaired use needs no cloud service.

## Rules and pause

Rules are evaluated in order; the source default applies last. Levels are **off**, **Wheelhouse only** and **notify only**. There is no action or command level. New sources default to notify only. The default batch window is two minutes; a rule can select 0–30 minutes, an hourly digest, or a daily digest in the user's time zone.

Reminders bypass quiet hours because you chose their due time. Quiet-hour settings are retained for subsequent source kinds. **Pause events** holds everything, including due reminders and batches already queued. The extension returns no result while paused. Resuming releases a `paused-notice` digest. A batch already returned to Firstmate retains its exact retry bytes until durable capture is confirmed.

A source can send at most 30 events per hour to batches, and Firstmate receives at most 12 batches per hour. Extra events become a rate-limited count. Exceeding the source limit in three consecutive hourly windows pauses the source and rings the ship's bell. Review its reason and resume it in Sources. Batches merge repeated occurrences of the same reminder, show at most 20 subject lines and count the overflow.

Wheelhouse keeps handled Feed history for 30 days, up to the newest 2000 events. A batch Firstmate has captured is removed with its outbox file 7 days after it was created. Undelivered work is never pruned: held events, batches not yet captured and the events they contain stay until delivered, however long Events is paused.

## What Firstmate receives

Events use Firstmate's normal process-event wake queue. They never use the captain inbox. Firstmate itself writes the wake:

```text
check: procevent wheelhouse-events wh-events 1
```

The result is a fixed, notify-only template populated from checked fields. Reminder text is your own text, quoted and labelled `by=captain` and `verified=captain`. Provider prose is not accepted by this release. Event content grants no instruction, permission or authority.

The adapter waits at most 55 seconds per poll. It retains a batch on a retry with the same request id. Only a new request id, which Firstmate allocates after durable capture, marks the previous batch captured. Feed status may therefore lag capture until the next poll. “Handled” is an inference from Firstmate's current pending-result list, rather than an acknowledgement API. Firstmate's process-event runner does not promise lossless or exactly-once delivery.

## Development checks

`npm run build:cli` builds the standalone extension into `firstmate-extension/`, which is included in the npm package. Run the focused tests with:

```bash
npx vitest run --project unit src/lib/server/events/events.test.ts
```

These cover scheduling and DST, missed occurrences, dispatch defaults, limits, pause/resume, replay before capture, concurrent store writers and the import boundary that prevents the pipeline from reaching the Messenger or setup commands. A real Firstmate proof must use a disposable `FM_HOME` and a scratch claim directory: connect, schedule a reminder two minutes ahead, start/reconcile the source, read its result and wake, classify it, run `handled`, verify pause suppresses delivery, and retire the source. Never run that proof against an operator's live home.
