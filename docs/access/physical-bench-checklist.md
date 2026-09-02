# GymFlow Access — Physical Bench Testing Matrix (Batch D.3)

> **IMPORTANT**: These physical bench tests require real hardware and must remain **PHYSICAL-BENCH-REQUIRED** until physically executed on the test bench.

---

## 1. Test Evidence Template (Future D.3 Execution)

```
Test ID: PHY-xxx
Hardware Target: Hikvision DS-K2602T (Serial: **********1234)
Firmware Version: V2.x.x_buildxxxxxx
Gateway Software Revision: git commit xxxxxxx
Reader ID / Direction: Reader 1 (Entry) / DS-K1108AMK
Credential Identifier (Masked): ••••7788
Expected Decision: ALLOW / DENY
Actual Decision: [Pending physical execution]
Expected Physical Relay: Door 1 Relay Closes (300ms)
Actual Physical Relay: [Pending physical execution]
T0 Event Received: [Timestamp]
T1 Event Parsed: [Timestamp]
T3 Auth Decided: [Timestamp]
T4 Actuate Sent: [Timestamp]
T5 Controller Resp: [Timestamp]
Result: PHYSICAL-BENCH-REQUIRED
Notes: [Observations / Oscilloscope trace / multimeter readings]
```

---

## 2. Complete Physical Test Checklist

| Test ID | Scenario / Verification Objective | Target Hardware | Expected Physical Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **PHY-001** | Unregistered badge presented | DS-K2602T + Reader 1 | Event emitted on alertStream; Gateway denies; **ZERO relay activation** | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-002** | Valid active member badge presented | DS-K2602T + Reader 1 | Gateway ALLOW; RemoteControl PUT sent; **Door 1 Relay pulses (300ms)** | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-003** | Suspended/expired member badge | DS-K2602T + Reader 1 | Gateway DENY (`SUBSCRIPTION_EXPIRED`); **ZERO relay activation** | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-004** | Entry Reader scan | DS-K1108AMK (Reader 1) | Actuates **Relay 1 ONLY**; Relay 2 remains untouched | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-005** | Exit Reader scan | DS-K1108AMK (Reader 2) | Actuates **Relay 2 ONLY**; Relay 1 remains untouched | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-006** | Controller doorNo spoofing | DS-K2602T XML manipulation | Physical actuation strictly targets configured mapping Door 1 | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-007** | Physical Card UID Byte Order Discovery | MIFARE 1K / Desfire | Determine emitted format (Hex MSB, Hex LSB, Decimal 8/10-digit) | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-008** | Leading Zero Credential Behavior | Card with leading zeros | Verify padding preservation through normalization | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-009** | Internet Disconnected Offline Auth | WAN cable unplugged | Local Snapshot v2 authorizes badge; Relay opens; Event queued | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-010** | Offline Expired Snapshot Denial | Offline + Snapshot validUntil passed | Evaluator denies fail-closed; ZERO relay activation | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-011** | Gateway Offline Restart Cache Survival | Gateway power-cycled offline | Active snapshot reloads from SQLite; offline auth continues | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-012** | Durable Event Queue Survival | Power cut with queued events | SQLite transactions preserve queued events on reboot | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-013** | WAN Reconnection Sync | WAN restored | Gateway syncs; uploads all queued events; acknowledges once | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-014** | Controller Reboot Recovery | DS-K2602T power-cycled | Gateway detects connection drop; reconnects with jittered backoff | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-015** | LAN Cable Pull / Reconnect | Access VLAN cable pulled/restored | Adapter health flags DEGRADED, recovers to READY automatically | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-016** | 24-Hour AlertStream Stability | Continuous stream for 24h | Zero memory leak; zero dropped connection without recovery | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-017** | Rapid Repeated Badge Scans | Same badge scanned 5× in 2s | Dedup suppresses duplicate unlocks; 1 physical open issued | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-018** | Concurrent Multi-Reader Events | Simultaneous scan on Reader 1 & 2 | Both dispatches process; distinct relays actuate correctly | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-019** | Relay Pulse Timing Verification | Multimeter / Oscilloscope | Relay pulse duration matches 300ms–500ms configuration | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-020** | Turnstile Passage Sensor Feedback | TS1000 Pro rotation | Passage sensor feedback signals completed entry | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-021** | Fire Alarm Drop-Arm Trigger | Fire alarm contact closed | Turnstile arm immediately drops mechanically; fail-safe | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-022** | Total Power Loss Drop-Arm | 230V mains cut | Arm drops; controller relays de-energize; safe egress | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-023** | Reader Transport Mode Validation | RS-485 DIP switches | Verify reader address and baud rate matching controller | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-024** | OSDP Secure Channel Feasibility | DS-K1108AMK + DS-K2602T | Test if firmware supports OSDP v2 SC with master key | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-025** | Controller HTTPS Certificate Validation | DS-K2602T HTTPS port 443 | Test SSL handshake with self-signed / CA certificate | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-026** | Digest Auth on Target Firmware | Firmware ISAPI auth | Test digest MD5 / SHA-256 with nonce rotation and nc tracking | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-027** | End-to-End Latency Measurement | High-speed camera / logs | Badge tap to physical relay click < 250ms total latency | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-028** | Controller Clock Skew Tolerance | DS-K2602T clock set to 2020 | Gateway local clock evaluates validity; auth unaffected | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-029** | Configuration Reader Remap Test | Reader 1 mapped to Door 2 | Relay 2 actuates on Reader 1 tap; proven topology routing | `PHYSICAL-BENCH-REQUIRED` |
| **PHY-030** | 24-Hour Idle Soak Test | 24h run with periodic heartbeat | Zero spurious relay activations; zero unhandled errors | `PHYSICAL-BENCH-REQUIRED` |
