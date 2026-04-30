# Live Bot Context

This project is a Bilibili-focused live-room interaction assistant. It helps a streamer monitor live-room events, send automated danmu replies, and keep lightweight local interaction records.

## Language

**Live-room Interaction Assistant**:
A desktop tool that observes one Bilibili live room and reacts to audience interactions with configured automated behavior.
_Avoid_: Live operations platform, multi-platform bot, recording tool

**Live Room**:
A Bilibili live room selected by room ID as the source of events and the target for sent danmu.
_Avoid_: Channel, stream

**Live Session**:
One continuous period from a Bilibili live room going live until that room goes offline.
_Avoid_: App run, monitor run

**Live Event**:
A notification-style viewer or room activity received from the Bilibili live-room event stream.
_Avoid_: Message, packet, heartbeat, connection log

**Danmu Reply**:
A danmu message sent by the assistant in response to a live event or timed rule.
_Avoid_: Chat message, notification

**Interaction Rule**:
A configured behavior that turns live events or commands into danmu replies or local records.
_Avoid_: Plugin, script, automation

**Interaction Record**:
A persisted fact derived from a live event, keeping the original event payload plus stable fields for statistics, user lookup, and later analysis.
_Avoid_: Log line, cache entry

**Legacy Danmu Count**:
A shortcut counter for the existing danmu count command, kept temporarily until interaction records become the source for count queries.
_Avoid_: Event history, fact source

**Live Session Summary**:
The aggregate view of interaction records for one bounded live session.
_Avoid_: Dashboard, report

## Relationships

- A **Live-room Interaction Assistant** observes exactly one active **Live Room** at a time.
- A **Live Room** has many **Live Sessions** over time.
- A **Live Session** belongs to exactly one **Live Room**.
- A **Live Room** produces many **Live Events**.
- A **Live Event** may produce one **Interaction Record**.
- An **Interaction Rule** may produce one or more **Danmu Replies** from a **Live Event**.
- A **Danmu Reply** is sent back to the same **Live Room**.
- A **Live Session Summary** is calculated from the **Interaction Records** in one **Live Session**.
- **Legacy Danmu Count** may be updated alongside **Interaction Records**, but it is not the long-term source of historical event facts.

## Example dialogue

> **Dev:** "Should the assistant support Douyin rooms in the next milestone?"
> **Domain expert:** "No. This milestone is still a Bilibili **Live-room Interaction Assistant**. Multi-platform support is outside the current context."

> **Dev:** "Can we show a **Live Session Summary** by scanning the UI log text?"
> **Domain expert:** "No. The summary should come from **Interaction Records**, because log text is only for human troubleshooting."

> **Dev:** "If the app restarts while the room is still live, is that a new **Live Session**?"
> **Domain expert:** "No. A **Live Session** follows the room's live/offline boundary, not the app process lifecycle."

> **Dev:** "Can an **Interaction Record** keep only the fields the UI needs today?"
> **Domain expert:** "No. It should keep the original event payload too, so future statistics can be rebuilt when Bilibili fields or product needs change."

> **Dev:** "Should websocket heartbeats become **Interaction Records**?"
> **Domain expert:** "No. They are protocol traffic, not **Live Events**."

> **Dev:** "If recording an **Interaction Record** fails, should the assistant stop replying?"
> **Domain expert:** "No. Record the failure in the runtime log and continue handling interaction rules."

> **Dev:** "Should the existing danmu count command immediately query **Interaction Records**?"
> **Domain expert:** "No. Keep **Legacy Danmu Count** for now and migrate only after interaction records have proven stable."

## Flagged ambiguities

- "Bot" can mean a small danmu responder or a broad live-operations platform. Resolved: in this project it means **Live-room Interaction Assistant**.
- "Statistics" can mean temporary UI counters or persisted historical facts. Resolved: next-stage statistics come from **Interaction Records**.
- "Session" can mean an app run or a live broadcast period. Resolved: **Live Session** means the Bilibili room's live-to-offline period.
- "Danmu count" currently refers to **Legacy Danmu Count** in code, but future historical counts should be derived from **Interaction Records**.
