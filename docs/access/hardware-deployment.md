# GymFlow Access — Hardware Deployment Specification

## 1. System Architecture & Component Roles

The GymFlow Access hardware architecture establishes a strict separation of concerns between physical transport, network interfaces, and business authorization authority.

```
GymFlow Cloud (SaaS)
        │  ▲
        │  │ Signed M2M / Mutual Authentication (HTTPS)
        ▼  │
GymFlow Access Gateway (On-Premise Appliance)
   ├── Local SQLite / Durable Event Queue
   ├── Offline Authorization Evaluator (Signed Snapshot v2)
   └── Hikvision ISAPI Device Adapter
        │  ▲
        │  │ Isolated Access-Control VLAN (HTTP/HTTPS + Digest Auth)
        ▼  │
Hikvision DS-K2602T (2-Door Access Controller)
   ├── Dry-Contact Relay Output 1 (Normally Open / COM)
   │        │
   │        ▼
   │   ZKTeco TS1000 Pro Turnstile (Entry Direction Actuation)
   ├── Dry-Contact Relay Output 2 (Normally Open / COM)
   │        │
   │        ▼
   │   ZKTeco TS1000 Pro Turnstile (Exit Direction Actuation)
   ├── RS-485 / OSDP Terminal 1 ──► Hikvision DS-K1108AMK (Entry Reader)
   └── RS-485 / OSDP Terminal 2 ──► Hikvision DS-K1108AMK (Exit Reader)
```

---

## 2. Bill of Materials & Specifications

| Component | Target Model | Interface / Role | Power Requirements |
| :--- | :--- | :--- | :--- |
| **Access Controller** | Hikvision DS-K2602T | 2-Door / 4-Reader ISAPI Controller | 12V DC ±15%, 2A |
| **RFID Readers** | 2 × Hikvision DS-K1108AMK | MIFARE / Desfire (13.56MHz), OSDP/RS-485 | 12V DC, 150mA each |
| **Turnstile** | ZKTeco TS1000 Pro | Bi-directional Tripod Turnstile | 100–240V AC, 60W |
| **Gateway Appliance** | Dedicated x86/ARM64 Mini-PC | Linux (Debian/Ubuntu), Dual Ethernet / VLAN | 12V / 19V DC PSU |
| **Power Supply (PSU)** | 12V DC 5A–7A with Battery Backup | Powers controller, readers, and lock interface | 230V AC Input, 12V 7Ah SLA Battery |

---

## 3. Physical Relay & Turnstile Interfacing

### Relay Configuration
- **Hikvision DS-K2602T Output**: Dry-contact Form-C relay (`COM` and `NO` terminals).
- **ZKTeco TS1000 Pro Input**: Dry-contact trigger inputs:
  - `K1` / `GND`: Open Entry direction.
  - `K2` / `GND`: Open Exit direction.
  - `Emergency / Drop-Arm`: Dedicated input for fire alarm / emergency release.

### Relay Pulse Duration
- `[CONFIGURATION-TARGET]`: Initial commissioning target is **300ms–500ms** momentary dry-contact closure configured in the DS-K2602T. Exact supported/configured duration and multimeter/oscilloscope confirmation must be verified during bench execution (`PHY-019`).
- `[DOCUMENTED]`: The turnstile initiates rotation upon contact closure. Rotation sensors in the turnstile manage passage completion and mechanical relock independently; physical verification pending `PHY-020`.

---

## 4. Fail-Safe vs. Fail-Secure & Life-Safety Priorities

1. **Life Safety Supremacy**: Under no circumstance does software or network authorization supersede emergency exit or fire alarm egress.
2. **Turnstile Drop-Arm Mechanism**: `[CONFIGURATION-TARGET]` / `[PHYSICAL-BENCH-REQUIRED]`: Connected directly to the venue fire alarm system. On fire alarm activation or total power failure, the turnstile electromagnet de-energizes, dropping the barrier arm immediately for unobstructed emergency egress (`PHY-021`).
3. **Power Loss State**:
   - Turnstile: Expected fail-safe drop-arm according to target documentation; must be physically verified during `PHY-022` before production.
   - Controller: Relays remain de-energized (NO contacts stay open).
   - Gateway: Shuts down gracefully via battery backup.

---

## 5. Technical Enclosure & Physical Security

All access control infrastructure (Controller, Gateway, Network Switch, 12V Backup PSU) must be housed in a **locked technical enclosure (NEMA / IP54 rated)** located inside a restricted staff area:
- Tamper switch on the enclosure door wired to an intrusion input on the DS-K2602T.
- Cabling between cabinet, readers, and turnstiles run through rigid metal conduit (EMT) to prevent physical tampering, wire tapping, or relay shorting.
